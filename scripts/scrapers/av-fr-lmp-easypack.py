#!/usr/bin/env python3
"""
av-fr-lmp-easypack.py — PER/retraite AG2R La Mondiale (Easypack France)
========================================================================
Jumeau FRANCE du portail LMEP Luxembourg (av-lux-lmep-easypack.py) :
  https://ag2rlm-easypack.quantalys.com/LMPEasypack
Le hidden #produitsString expose 1 042 bassins (contrats) du groupe —
La Mondiale Partenaire (patrimonial/CGP), La Mondiale, La Mondiale Retraite
supplémentaire — chacun requêtable individuellement → éligibilité PAR CONTRAT.

Différences vs LMEP Lux (repérage 2026-07-16) :
  - endpoint données : POST /Recherche/Data (et non /LMPEasypack/Data) ;
  - driver JS : /Areas/Partenaire/Easypack/LMPEasypack/Supports/LMPEasypack.js
    (65 colonnes dans `var columns = [...]`) ;
  - payload DataTables identique (columns[i], Values.lstContrats[i], lstIDProduits).

PÉRIMÈTRE ACTUEL : les bassins RETRAITE/PER/Madelin (~41, mission PER du 16/07)
+ CAPITALISATION (~244, mission capi du 16/07 — stock patrimonial La Mondiale
Partenaire, fermés inclus : utile à l'analyse de portefeuilles clients ; les
variantes à univers identique sont regroupées par la matview contract_groups).
Le stock AV (vie) France du groupe (~700 bassins) reste hors périmètre —
extension possible en élargissant BASSIN_RE.
company_name = « AG2R La Mondiale » (nom déjà autoritaire en base pour le
groupe ; les entités juridiques par bassin sont dans sAssureur si besoin).

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-fr-lmp-easypack.py            # dry-run
    python3 scripts/scrapers/av-fr-lmp-easypack.py --apply
"""

import re
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from parsel import Selector

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session  # noqa: E402

ROOT      = "https://ag2rlm-easypack.quantalys.com"
BASE_URL  = f"{ROOT}/LMPEasypack"
DATA_URL  = f"{ROOT}/Recherche/Data"
DRIVER_JS = f"{ROOT}/Areas/Partenaire/Easypack/LMPEasypack/Supports/LMPEasypack.js"

COMPANY = "AG2R La Mondiale"

# Bassins retenus : contrats retraite/PER/Madelin + capitalisation.
BASSIN_RE = re.compile(r"retraite|\bper\b|perin|\bperp\b|madelin|capitalisation|\bcapi\b",
                       re.IGNORECASE)

ISIN_RE   = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")
PAGE_SIZE = 400
TIMEOUT   = 45
MIN_EXPECTED = 300  # Excellie Retraite GB seul ~1 351 UC ; union < 300 = cassé.


def _open_session():
    """Ouvre une session, franchit la porte JS Quantalys (cf. LMEP)."""
    s = make_session(use_proxy=True)
    g = s.get(BASE_URL, timeout=TIMEOUT)
    m = re.search(r"window\.location\.href\s*=\s*'([^']+)'", g.text or "")
    if not m:
        return s, BASE_URL, g.text or ""
    referer = ROOT + m.group(1)
    page = s.get(referer, timeout=TIMEOUT)
    return s, referer, page.text or ""


def _discover_bassins(html: str) -> list[dict]:
    """Bassins retraite/PER : [{id, contract, assureur}] depuis #produitsString."""
    ps = Selector(html).css("#produitsString::attr(value)").get()
    if not ps:
        return []
    try:
        arr = json.loads(ps)
    except Exception:
        return []
    out = []
    for x in arr:
        if not isinstance(x, dict) or x.get("ID_Bassin") is None:
            continue
        name = " ".join(str(x.get("sNomContrat") or "").split())
        if name and BASSIN_RE.search(name):
            out.append({"id": str(x["ID_Bassin"]), "contract": name,
                        "assureur": str(x.get("sAssureur") or "")})
    # dédup par nom de contrat (certains bassins doublonnent en casse)
    seen: set[str] = set()
    return [b for b in out if not (b["contract"].lower() in seen
                                   or seen.add(b["contract"].lower()))]


def _discover_columns(session) -> list[str]:
    js = session.get(DRIVER_JS, timeout=TIMEOUT).text or ""
    block = re.search(r"var\s+columns\s*=\s*\[(.*?)\];", js, re.S)
    if not block:
        return []
    return re.findall(r'name:\s*"([^"]+)"', block.group(1))


def _build_payload(columns, bassin_id: str, start: int, length: int) -> dict:
    p = {
        "draw": "1", "start": str(start), "length": str(length),
        "search[value]": "", "search[regex]": "false",
        "order[0][column]": "5", "order[0][dir]": "asc",
        "langueSearch": "",
        "Values.lstIDProduits[0]": "1", "Values.lstIDProduits[1]": "2",
        "Values.lstContrats[0]": bassin_id,
    }
    for i, name in enumerate(columns):
        p[f"columns[{i}][data]"] = str(i)
        p[f"columns[{i}][name]"] = name
        p[f"columns[{i}][searchable]"] = "true"
        p[f"columns[{i}][orderable]"] = "true"
        p[f"columns[{i}][search][value]"] = ""
        p[f"columns[{i}][search][regex]"] = "false"
    return p


def _fetch_bassin_isins(session, referer, columns, bassin_id: str) -> list[str]:
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
                r = session.post(DATA_URL, data=_build_payload(columns, bassin_id, start, PAGE_SIZE),
                                 headers=headers, timeout=TIMEOUT)
                if r.status_code != 200:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                j = r.json()
                break
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        if j is None:
            print(f"      ⚠ bassin {bassin_id} : page start={start} abandonnée — collecte partielle.")
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
            if ISIN_RE.match(code):
                isins.add(code)
        start += PAGE_SIZE
        if total and start >= total:
            break
        time.sleep(0.3)
    return sorted(isins)


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print(f"  {COMPANY} — LMP Easypack France (contrats retraite/PER)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    session, referer, html = _open_session()
    bassins = _discover_bassins(html)
    columns = _discover_columns(session)
    if not bassins or not columns:
        print(f"  ✗ découverte incomplète (bassins={len(bassins)}, colonnes={len(columns)})")
        if apply:
            log_run("av-fr-lmp-easypack", "failed", 0, 0, started_at=started)
        return
    if limit:
        bassins = bassins[:limit]
    print(f"  Bassins retraite/PER : {len(bassins)} | colonnes : {len(columns)}")

    per_contract: list[tuple[str, list[str]]] = []
    for i, b in enumerate(bassins):
        isins = _fetch_bassin_isins(session, referer, columns, b["id"])
        print(f"  [{i+1}/{len(bassins)}] {b['contract'][:46]:46} {len(isins):5} ISIN")
        per_contract.append((b["contract"], isins))
        time.sleep(0.3)

    union = sorted({x for _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if len(union) < MIN_EXPECTED:
        print(f"  ✗ sous le seuil attendu ({MIN_EXPECTED}) — porte/payload probablement cassé.")
        if apply:
            log_run("av-fr-lmp-easypack", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for contract_name, isins in per_contract:
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
    log_run("av-fr-lmp-easypack", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AG2R La Mondiale — PER/retraite France (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N bassins (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
