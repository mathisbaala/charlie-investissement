#!/usr/bin/env python3
"""
av-lux-lmep-easypack.py — Catalogue UC LMEP (AG2R La Mondiale Europartner)
==========================================================================
La Mondiale Europartner (AG2R La Mondiale, AV Luxembourg) publie son univers de
supports via un portail Quantalys "Easypack" public :
  https://ag2rlmep-easypack.quantalys.com/LMEPEasypack

⚠️ Réparé 2026-06-21 (était au backlog : ancienne version en `requests` rendait 0
et pendait). Deux corrections :
  1. ANTI-BOT : la page pose une porte JS (`window.location.href='/redirect_<TOKEN>/…'`)
     qui dépose les cookies de session. Il faut la suivre dans une session
     curl_cffi (impersonate chrome), sinon l'API /Data répond vide. Plain
     `requests` ne passait pas la porte → 0 ligne, d'où l'ancien échec silencieux.
  2. PAYLOAD : l'API DataTables exige les `columns[i][name]` (71 colonnes, lues
     dans le driver JS), la liste des bassins `Values.lstContrats[i]` (lus dans le
     hidden #produitsString) et `Values.lstIDProduits`. L'ancien payload générique
     renvoyait recordsTotal=0.

ÉLIGIBILITÉ-ONLY : ne récupère que des ISIN puis n'écrit QUE le lien
(isin, contrat) dans investissement_av_lux_eligibility, filtré sur les ISIN déjà
présents dans investissement_funds. N'insère/écrase JAMAIS de fonds (contrairement
à l'ancienne version qui faisait un upsert_funds_bulk — supprimé).

Usage :
    python3 scripts/scrapers/av-lux-lmep-easypack.py            # dry-run
    python3 scripts/scrapers/av-lux-lmep-easypack.py --apply
"""

import re
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as cffi_requests
from parsel import Selector

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session  # noqa: E402  (filtre éligibilité-only + proxy partagés)

ROOT     = "https://ag2rlmep-easypack.quantalys.com"
BASE_URL = f"{ROOT}/LMEPEasypack"
DATA_URL = f"{BASE_URL}/Data"
DRIVER_JS = f"{ROOT}/Areas/Partenaire/Easypack/LMEPEasypack/Supports/LMEPEasypack.js"

COMPANY  = "AG2R La Mondiale"
CONTRACT = "LMEP Europartner Luxembourg"

ISIN_RE   = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")
PAGE_SIZE = 400
TIMEOUT   = 45
MIN_EXPECTED = 500  # garde anti-régression : sous ce seuil, on logge un échec
                    # (la source en porte ~3100 UC ; <500 = porte/payload cassé).


def _open_session() -> tuple["cffi_requests.Session", str, str]:
    """Ouvre une session, franchit la porte JS, renvoie (session, referer, html).

    ⚠️ L'URL de redirect porte un token à usage unique : on lit le HTML servi par
    CE franchissement (qui contient #produitsString) ; un 2e GET ne le renverrait
    plus.
    """
    # use_proxy=True : quantalys peut bloquer/ralentir les IP datacenter → proxy
    # résidentiel si AV_PROXY_URL posée (sinon connexion directe).
    s = make_session(use_proxy=True)
    g = s.get(BASE_URL, timeout=TIMEOUT)
    m = re.search(r"window\.location\.href\s*=\s*'([^']+)'", g.text or "")
    if not m:
        # Pas de porte (peut arriver si cookies déjà posés) — page directe.
        return s, BASE_URL, g.text or ""
    referer = ROOT + m.group(1)
    page = s.get(referer, timeout=TIMEOUT)  # dépose les cookies + sert la page UC
    return s, referer, page.text or ""


def _discover_bassins(html: str) -> list[str]:
    """Lit les ID_Bassin (contrats) dans le hidden #produitsString de la page."""
    ps = Selector(html).css("#produitsString::attr(value)").get()
    if not ps:
        return []
    try:
        arr = json.loads(ps)
    except Exception:
        return []
    return sorted({str(x["ID_Bassin"]) for x in arr
                   if isinstance(x, dict) and x.get("ID_Bassin") is not None})


def _discover_columns(session) -> list[str]:
    """Lit les noms de colonnes DataTables dans le driver JS (ordre significatif).

    ⚠️ Réparé 2026-07-10 : le driver JS n'est plus minifié (`name: "X"` avec
    espace → l'ancienne regex `name:"X"` rendait 0 colonne, garde-fou déclenché).
    On borne au bloc `var columns = [...]` pour ne pas attraper les `name:` des
    onglets (tabAccueil, tabISR…) qui suivent dans le même fichier.
    """
    js = session.get(DRIVER_JS, timeout=TIMEOUT).text or ""
    block = re.search(r"var\s+columns\s*=\s*\[(.*?)\];", js, re.S)
    if not block:
        return []
    return re.findall(r'name:\s*"([^"]+)"', block.group(1))


def _build_payload(columns, bassins, start, length) -> dict:
    p = {
        "draw": "1", "start": str(start), "length": str(length),
        "search[value]": "", "search[regex]": "false",
        "order[0][column]": "5", "order[0][dir]": "asc",  # tri par sNom (col 5)
        "langueSearch": "",
        "Values.lstIDProduits[0]": "1", "Values.lstIDProduits[1]": "2",
    }
    for i, name in enumerate(columns):
        p[f"columns[{i}][data]"] = str(i)
        p[f"columns[{i}][name]"] = name
        p[f"columns[{i}][searchable]"] = "true"
        p[f"columns[{i}][orderable]"] = "true"
        p[f"columns[{i}][search][value]"] = ""
        p[f"columns[{i}][search][regex]"] = "false"
    for i, b in enumerate(bassins):
        p[f"Values.lstContrats[{i}]"] = b
    return p


def fetch_isins() -> list[str]:
    """Toutes les UC (ISIN distincts) du portail LMEP Easypack."""
    session, referer, html = _open_session()
    bassins = _discover_bassins(html)
    columns = _discover_columns(session)
    if not bassins or not columns:
        print(f"  ⚠ découverte incomplète (bassins={len(bassins)}, colonnes={len(columns)})")
        return []
    print(f"  Contrats (bassins) : {len(bassins)} | colonnes DataTables : {len(columns)}")

    headers = {
        "X-Requested-With": "XMLHttpRequest", "Referer": referer,
        "Origin": ROOT, "Accept": "application/json, text/javascript, */*",
    }
    isins: set[str] = set()
    start, total = 0, None
    while True:
        payload = _build_payload(columns, bassins, start, PAGE_SIZE)
        # Retry par page : les pages profondes ralentissent (timeout ponctuel) — un
        # échec isolé ne doit pas interrompre toute la collecte.
        j = None
        for attempt in range(3):
            try:
                r = session.post(DATA_URL, data=payload, headers=headers, timeout=TIMEOUT)
                if r.status_code != 200:
                    print(f"  ⚠ HTTP {r.status_code} sur /Data (start={start}, essai {attempt+1})")
                    time.sleep(1.5 * (attempt + 1))
                    continue
                j = r.json()
                break
            except Exception as e:
                print(f"  ⚠ POST start={start} essai {attempt+1} : {str(e)[:60]}")
                time.sleep(1.5 * (attempt + 1))
        if j is None:
            print(f"  ⚠ page start={start} abandonnée après 3 essais — collecte partielle.")
            break
        if total is None:
            total = j.get("recordsTotal") or j.get("recordsFiltered") or 0
            print(f"  recordsTotal = {total}")
        data = j.get("data") or j.get("aaData") or []
        if not data:
            break
        for row in data:
            code = ""
            if isinstance(row, dict):
                code = str(row.get("sCodeISIN") or "").strip().upper()
            if ISIN_RE.match(code):
                isins.add(code)
        start += PAGE_SIZE
        if total and start >= total:
            break
        time.sleep(0.3)
    return sorted(isins)


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print(f"  {COMPANY} — LMEP Easypack (catalogue UC)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 60)
    started = datetime.now(timezone.utc)

    isins = fetch_isins()
    print(f"  ISIN distincts récupérés : {len(isins)}")

    if len(isins) < MIN_EXPECTED:
        # Garde anti-régression : ne pas écrire un catalogue tronqué en silence.
        print(f"  ✗ sous le seuil attendu ({MIN_EXPECTED}) — porte/payload probablement cassé.")
        if apply:
            log_run("av-lux-lmep-easypack", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  Aperçu (10 premiers ISIN) :", ", ".join(isins[:10]))
        print(f"  DRY-RUN — rien écrit. {len(isins)} ISIN bruts (avant filtre base).")
        return

    client = get_client()
    known = existing_isins(client)
    kept = [x for x in isins if x in known]
    if limit:
        kept = kept[:limit]
    print(f"  ISIN en base : {len(known)} | éligibles LMEP retenus : {len(kept)}")

    now = datetime.now(timezone.utc).isoformat()
    batch, ok = [], 0
    for x in kept:  # déjà distincts → pas de doublon (isin, contract) possible
        batch.append({
            "isin": x, "company_name": COMPANY, "contract_name": CONTRACT,
            "source_url": BASE_URL, "scraped_at": now,
        })
        if len(batch) >= 200:
            client.table("investissement_av_lux_eligibility") \
                .upsert(batch, on_conflict="isin,contract_name").execute()
            ok += len(batch)
            batch = []
    if batch:
        client.table("investissement_av_lux_eligibility") \
            .upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)

    print(f"  Éligibilité écrite : {ok} lignes.")
    log_run("av-lux-lmep-easypack", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LMEP Easypack — catalogue UC (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N ISIN (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
