#!/usr/bin/env python3
"""
pea-easybourse-catalog.py — Univers OPCVM PEA / PEA-PME d'Easybourse (LBP)
===========================================================================
Le moteur OPCVM d'easybourse.com (courtier de La Banque Postale) répond à un
endpoint REST public, sans cookie ni session (repérage 2026-07-17 — le verdict
antérieur « navigateur requis » est invalidé) :
  POST https://www.easybourse.com/rest/search
  body form-encodé : method=searchOpcvm
    &data[datas][UNIVERS][]=UNIVERS_EASYBOURSE
    &data[datas][ELIGIBILITY][]=INST_PEAADMITED
  → JSON par fonds : isin, name, pea, peapme, perfs, rating, risk…
~297 fonds PEA (24 PEA-PME) sur ~995 à l'univers.

ÉLIGIBILITÉ-ONLY via _pea_common (contrats « PEA Easybourse » /
« PEA-PME Easybourse », company « Easybourse »).

Usage :
    python3 scripts/scrapers/pea-easybourse-catalog.py            # dry-run
    python3 scripts/scrapers/pea-easybourse-catalog.py --apply
"""

import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _av_pdf_common import make_session, _valid_isin  # noqa: E402
from _pea_common import write_pea_contracts  # noqa: E402

REST_URL   = "https://www.easybourse.com/rest/search"
SOURCE_URL = "https://www.easybourse.com/opcvm/"

COMPANY = "Easybourse"
TIMEOUT = 45


def fetch_pea_funds(session) -> list[dict]:
    body = {
        "method": "searchOpcvm",
        "data[datas][UNIVERS][]": "UNIVERS_EASYBOURSE",
        "data[datas][ELIGIBILITY][]": "INST_PEAADMITED",
    }
    r = session.post(REST_URL, data=body, timeout=TIMEOUT)
    if r.status_code != 200:
        print(f"  ⚠ HTTP {r.status_code} sur /rest/search")
        return []
    j = r.json()
    # Réponse = dict indexé {"0": "<json-string>", "1": …} : chaque valeur est
    # une CHAÎNE JSON à re-parser (vérifié 17/07).
    values = j.values() if isinstance(j, dict) else (j if isinstance(j, list) else [])
    rows: list[dict] = []
    for v in values:
        if isinstance(v, dict):
            rows.append(v)
        elif isinstance(v, str):
            try:
                d = json.loads(v)
                if isinstance(d, dict):
                    rows.append(d)
            except Exception:
                continue
    return rows


def main():
    ap = argparse.ArgumentParser(description="Easybourse — univers PEA (éligibilité-only)")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = ap.parse_args()
    started = datetime.now(timezone.utc)

    print("=" * 64)
    print(f"  {COMPANY} — univers OPCVM PEA/PEA-PME (REST public)")
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    session = make_session()
    rows = fetch_pea_funds(session)
    pea = sorted({str(x.get("isin") or "").upper() for x in rows
                  if _valid_isin(str(x.get("isin") or "").upper())})
    peapme = sorted({str(x.get("isin") or "").upper() for x in rows
                     if str(x.get("peapme")).strip().lower() == "oui" and _valid_isin(str(x.get("isin") or "").upper())})
    print(f"  PEA : {len(pea)} ISIN | dont PEA-PME : {len(peapme)}")

    per_contract = [("PEA Easybourse", pea, SOURCE_URL)]
    if peapme:
        per_contract.append(("PEA-PME Easybourse", peapme, SOURCE_URL))
    write_pea_contracts(COMPANY, per_contract,
                        scraper_name="pea-easybourse-catalog",
                        apply=args.apply, started=started)


if __name__ == "__main__":
    main()
