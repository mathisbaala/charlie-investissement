#!/usr/bin/env python3
"""
av-lux-cnp-catalog.py — Catalogue UC CNP Luxembourg (LPS France)
=================================================================
CNP Luxembourg (groupe CNP Assurances) commercialise en France en LPS depuis
2015 (CGP + La Banque Postale, clientèle patrimoniale). Son univers de supports
est publié via un screener Quantalys en marque blanche, PAR CONTRAT :
  https://cnplux-ezp.quantalys.com/CNPLuxEasypack

Même mécanique que av-lux-lmep-easypack.py (porte JS + DataTables), avec deux
différences :
  1. Les listes sont PAR CONTRAT (<select class="selectListeCNPLux">, option
     value=ID de liste, attribut data-agrement="FR") → on écrit un contract_name
     par contrat au lieu d'un univers global.
  2. Le POST /Data prend `Values.lstListe=<id>` + `agrement=FR` (pas de bassins).

Repérage 2026-07-16 : ~1 856 UC pour CNP One Lux, JSON avec sCodeISIN. On exclut
les listes hors France (CNP ONE BEL, CNP ONE ITALIA) même si le filtre les
marque FR.

ÉLIGIBILITÉ-ONLY : ne récupère que des ISIN puis n'écrit QUE le lien
(isin, contrat) dans investissement_av_lux_eligibility, filtré sur les ISIN déjà
présents dans investissement_funds. N'insère/écrase JAMAIS de fonds.

Usage :
    python3 scripts/scrapers/av-lux-cnp-catalog.py            # dry-run
    python3 scripts/scrapers/av-lux-cnp-catalog.py --apply
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from parsel import Selector

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session  # noqa: E402

ROOT     = "https://cnplux-ezp.quantalys.com"
BASE_URL = f"{ROOT}/CNPLuxEasypack"
DATA_URL = f"{BASE_URL}/Data"

# ⚠ contract_name DOIT différer de company_name (matview FILTER
#   contract_name <> company_name — cf. migrations Generali/Swiss Life Lux).
COMPANY = "CNP Luxembourg"

# Listes hors marché France (contrats Belgique/Italie marqués FR dans le filtre).
EXCLUDE_CONTRACT = re.compile(r"\b(BEL|ITALIA|ITALIE)\b", re.IGNORECASE)

ISIN_RE   = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")
PAGE_SIZE = 1000
TIMEOUT   = 45
RATE      = 0.5
MIN_EXPECTED = 300  # garde anti-régression : CNP One Lux seul porte ~1 856 UC ;
                    # une union < 300 = porte/payload cassé → ne rien écrire.


def _open_session():
    """Ouvre une session, franchit la porte JS Quantalys, renvoie (session,
    referer, html). L'URL de redirect porte un token à usage unique : on lit le
    HTML servi par CE franchissement (il contient le <select> des listes)."""
    s = make_session(use_proxy=True)  # quantalys : proxy résidentiel si posé
    g = s.get(BASE_URL, timeout=TIMEOUT)
    m = re.search(r"window\.location\.href\s*=\s*'([^']+)'", g.text or "")
    if not m:
        return s, BASE_URL, g.text or ""
    referer = ROOT + m.group(1)
    page = s.get(referer, timeout=TIMEOUT)
    return s, referer, page.text or ""


def _discover_lists(html: str) -> list[dict]:
    """Lit les listes de contrats dans <select class="selectListeCNPLux">.

    Retourne [{id, name, agrement}] pour les listes France uniquement.
    """
    sel = Selector(html)
    out = []
    for opt in sel.css("select.selectListeCNPLux option"):
        list_id = (opt.attrib.get("value") or "").strip()
        name = " ".join("".join(opt.css("::text").getall()).split())
        agrement = (opt.attrib.get("data-agrement") or "").strip().upper()
        if not list_id or not list_id.isdigit() or not name:
            continue
        if agrement and agrement != "FR":
            continue
        if EXCLUDE_CONTRACT.search(name):
            continue
        out.append({"id": list_id, "name": name})
    # dédup par id, ordre stable
    seen: set[str] = set()
    return [x for x in out if not (x["id"] in seen or seen.add(x["id"]))]


def _build_payload(list_id: str, start: int, length: int) -> dict:
    """Payload DataTables minimal : seules les colonnes demandées sont renvoyées
    (champs nommés — sNom, sCodeISIN), pas de jeton anti-forgery."""
    p = {
        "draw": "1", "start": str(start), "length": str(length),
        "search[value]": "", "search[regex]": "false",
        "order[0][column]": "0", "order[0][dir]": "asc",
        "Values.lstListe": list_id,
        "agrement": "FR",
    }
    for i, name in enumerate(("sNom", "sCodeISIN")):
        p[f"columns[{i}][data]"] = name
        p[f"columns[{i}][name]"] = name
        p[f"columns[{i}][searchable]"] = "true"
        p[f"columns[{i}][orderable]"] = "true"
        p[f"columns[{i}][search][value]"] = ""
        p[f"columns[{i}][search][regex]"] = "false"
    return p


def _fetch_list_isins(session, referer: str, list_id: str) -> list[str]:
    """Tous les ISIN d'une liste (contrat), avec pagination défensive."""
    headers = {
        "X-Requested-With": "XMLHttpRequest", "Referer": referer,
        "Origin": ROOT, "Accept": "application/json, text/javascript, */*",
    }
    isins: set[str] = set()
    start, total = 0, None
    while True:
        j = None
        for attempt in range(3):
            try:
                r = session.post(DATA_URL, data=_build_payload(list_id, start, PAGE_SIZE),
                                 headers=headers, timeout=TIMEOUT)
                if r.status_code != 200:
                    print(f"      ⚠ HTTP {r.status_code} /Data liste={list_id} (essai {attempt+1})")
                    time.sleep(1.5 * (attempt + 1))
                    continue
                j = r.json()
                break
            except Exception as e:
                print(f"      ⚠ POST liste={list_id} essai {attempt+1} : {str(e)[:60]}")
                time.sleep(1.5 * (attempt + 1))
        if j is None:
            print(f"      ⚠ liste {list_id} abandonnée après 3 essais — collecte partielle.")
            break
        if total is None:
            total = j.get("recordsTotal") or j.get("recordsFiltered") or 0
        data = j.get("data") or j.get("aaData") or []
        if not data:
            break
        for row in data:
            code = ""
            if isinstance(row, dict):
                code = str(row.get("sCodeISIN") or "").strip().upper()
            elif isinstance(row, list) and len(row) > 1:
                code = str(row[1] or "").strip().upper()
            if ISIN_RE.match(code):
                isins.add(code)
        start += PAGE_SIZE
        if total and start >= total:
            break
        time.sleep(0.3)
    return sorted(isins)


def fetch_contracts() -> list[tuple[str, list[str]]]:
    """[(contract_name, [isins])] pour toutes les listes France du screener."""
    session, referer, html = _open_session()
    lists = _discover_lists(html)
    if not lists:
        print("  ⚠ aucune liste découverte (porte cassée ou <select> renommé)")
        return []
    print(f"  Listes France découvertes : {len(lists)}")
    out = []
    for i, lst in enumerate(lists):
        isins = _fetch_list_isins(session, referer, lst["id"])
        print(f"  [{i+1}/{len(lists)}] {lst['name'][:44]:44} {len(isins):5} ISIN")
        out.append((lst["name"], isins))
        time.sleep(RATE)
    return out


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print(f"  {COMPANY} — Quantalys Easypack (catalogue UC par contrat)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    contracts = fetch_contracts()
    if limit:
        contracts = contracts[:limit]
    union = sorted({x for _, isins in contracts for x in isins})
    print(f"\n  Contrats : {len(contracts)} | union ISIN distincts : {len(union)}")

    if len(union) < MIN_EXPECTED:
        print(f"  ✗ sous le seuil attendu ({MIN_EXPECTED}) — porte/payload probablement cassé.")
        if apply:
            log_run("av-lux-cnp-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  Aperçu (10 premiers ISIN) :", ", ".join(union[:10]))
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for contract_name, isins in contracts:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": COMPANY, "contract_name": contract_name,
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

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} ISIN bruts avant filtre).")
    log_run("av-lux-cnp-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CNP Luxembourg — catalogue UC (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
