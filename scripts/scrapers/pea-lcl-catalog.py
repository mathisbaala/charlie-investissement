#!/usr/bin/env python3
"""
pea-lcl-catalog.py — Sélection de fonds du PEA LCL (API Amundi TIP publique)
=============================================================================
opc.lcl.fr (widget Amundi « TIP ») expose une API JSON publique, rejouable en
requests sans cookie (repérage 2026-07-17) :
  GET https://opc.lcl.fr/product-services/tip/shares/v2/categories/public/search.json
      ?limit=100&page=N&perimeter=168&offset=…&grouping=false&category=public
      &partnerId=371&locale=fr-FR&id=326
  → réponse type Solr : ~250 fonds (périmètre particuliers) avec `isin` et le
    flag natif `class.peaEligibility` (~79 true).

ÉLIGIBILITÉ-ONLY via _pea_common (contrat « PEA LCL », company « LCL »).

Usage :
    python3 scripts/scrapers/pea-lcl-catalog.py            # dry-run
    python3 scripts/scrapers/pea-lcl-catalog.py --apply
"""

import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _av_pdf_common import make_session, _valid_isin  # noqa: E402
from _pea_common import write_pea_contracts  # noqa: E402

API_URL    = "https://opc.lcl.fr/product-services/tip/shares/v2/categories/public/search.json"
SOURCE_URL = "https://opc.lcl.fr/"

COMPANY = "LCL"
TIMEOUT = 45
LIMIT   = 100
MAX_PAGES = 20


def _doc_isin(doc: dict) -> str | None:
    """ISIN d'un document Solr LCL : au niveau racine ou dans un sous-objet."""
    for key in ("isin", "isinCode"):
        v = str(doc.get(key) or "").upper()
        if _valid_isin(v):
            return v
    # repli : premier ISIN valide n'importe où dans le doc
    import json as _json
    import re as _re
    for m in _re.finditer(r'"([A-Z]{2}[A-Z0-9]{9}\d)"', _json.dumps(doc)):
        if _valid_isin(m.group(1)):
            return m.group(1)
    return None


def fetch_pea_isins(session) -> list[str]:
    isins: set[str] = set()
    for page in range(1, MAX_PAGES + 1):
        params = {
            "limit": str(LIMIT), "page": str(page), "perimeter": "168",
            "offset": str((page - 1) * LIMIT), "grouping": "false",
            "category": "public", "partnerId": "371", "locale": "fr-FR", "id": "326",
        }
        try:
            r = session.get(API_URL, params=params, timeout=TIMEOUT)
        except Exception as e:
            print(f"  ⚠ page {page} : {str(e)[:60]}")
            break
        if r.status_code != 200:
            print(f"  ⚠ page {page} : HTTP {r.status_code}")
            break
        j = r.json()
        docs = (((j.get("data") or {}).get("response") or {}).get("docs")) or []
        for doc in docs:
            if not isinstance(doc, dict):
                continue
            # le flag vit dans le sous-objet `class` du document
            if (doc.get("class") or {}).get("peaEligibility") is not True:
                continue
            isin = _doc_isin(doc)
            if isin:
                isins.add(isin)
        if len(docs) < LIMIT:
            break
        time.sleep(0.5)
    return sorted(isins)


def main():
    ap = argparse.ArgumentParser(description="LCL — PEA (éligibilité-only)")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = ap.parse_args()
    started = datetime.now(timezone.utc)

    print("=" * 64)
    print(f"  {COMPANY} — sélection de fonds PEA (API Amundi TIP)")
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    session = make_session()
    isins = fetch_pea_isins(session)
    print(f"  Fonds peaEligibility=true : {len(isins)}")
    write_pea_contracts(COMPANY, [("PEA LCL", isins, SOURCE_URL)],
                        scraper_name="pea-lcl-catalog", apply=args.apply, started=started)


if __name__ == "__main__":
    main()
