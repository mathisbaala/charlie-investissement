#!/usr/bin/env python3
"""
cssf-lux-funds.py — Registre OPC Luxembourg via CSSF API
===========================================================
La CSSF (régulateur Lux) expose une API publique pour rechercher les entités
supervisées. On récupère TOUS les OPC (fonds Lux) en itérant alphabétiquement.

API endpoint :
  GET /search-entities-api/api/v1/entite?page=N&size=200&st=advanced&entNames=LETTRE

Types de fonds Lux :
  - OPC  : Organisme de Placement Collectif
  - SIC  : SICAV
  - OEX  : ?
  - C15  : Loi de 2010 partie I (UCITS)
  - FCP  : FCP Luxembourgeois (Fonds Commun de Placement)

Pour chaque entité, on récupère :
  - entiteName (nom)
  - entiteCode (code CSSF)
  - entiteCountryCode
  - entiteAddress
  - dtDebValid (date d'inception)
  - entiteType, entiteGroup

ISIN n'est pas fourni par cette API → on stocke avec un ISIN synthétique
`CSSF_{entiteCode}` et on matche après avec les fonds existants en base.

Usage :
    python3 scripts/scrapers/cssf-lux-funds.py [--apply] [--limit-letters N]
"""

import sys
import json
import time
import string
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

CSSF_API = "https://edesk.apps.cssf.lu/search-entities-api/api/v1/entite"
RATE_LIMIT_SEC = 0.5
TIMEOUT_SEC = 20
PAGE_SIZE = 200

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Accept": "application/json",
}

# Types CSSF qui correspondent à des fonds (pas SGP, pas administrateurs)
FUND_TYPES = {"OPC", "SIC", "OEX", "C15", "FCP", "FSP", "FIS", "RFI"}


def fetch_page(session: FetcherSession, ent_name: str, page: int) -> dict | None:
    params = {
        "page": page,
        "size": PAGE_SIZE,
        "st": "advanced",
        "entNames": ent_name,
        "sort": "entiteType,asc",
    }
    try:
        r = session.get(CSSF_API, params=params, stealthy_headers=True, timeout=TIMEOUT_SEC)
        if r.status != 200:
            return None
        return json.loads(r.body.decode("utf-8"))
    except Exception:
        return None


def map_to_fund(entity: dict) -> dict:
    """Convertit une entité CSSF en row pour investissement_funds."""
    code = entity.get("entiteCode")
    typ = entity.get("entiteType")
    name = entity.get("entiteName", "").strip()
    inception = entity.get("dtDebValid")

    # product_type : on map vers nos conventions
    product_type_map = {
        "OPC": "opcvm",
        "SIC": "sicav",
        "C15": "opcvm",  # UCITS Loi 2010
        "FCP": "opcvm",
        "OEX": "opcvm",
        "FIS": "fps",  # Fonds d'Investissement Spécialisé
        "RFI": "fpci",
        "FSP": "fps",
    }
    product_type = product_type_map.get(typ, "opcvm")

    return {
        "isin": f"CSSF_{code}",
        "name": name[:200],
        "product_type": product_type,
        "currency": "EUR",
        "data_source": "cssf-lux",
        "distributor_france": False,  # à valider
        "av_lux_eligible": True,  # tout fonds CSSF Lux est potentiellement éligible AV Lux
        "inception_date": inception if inception else None,
    }


def run(apply: bool, limit_letters: int | None):
    print("=" * 64)
    print("  CSSF Lux Funds Scanner")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()
    client = get_client() if apply else None

    # Iterer sur l'alphabet pour récupérer toutes les entités
    letters = list(string.ascii_uppercase)
    if limit_letters:
        letters = letters[:limit_letters]

    seen_codes = set()
    all_funds = []
    by_type = {}

    for letter in letters:
        print(f"\n  [LETTER {letter}] fetching...", end=" ", flush=True)
        page = 0
        letter_count = 0
        while True:
            data = fetch_page(session, letter, page)
            if not data:
                print("  ✗ error")
                break

            content = data.get("content", [])
            if not content:
                break

            for ent in content:
                code = ent.get("entiteCode")
                typ = ent.get("entiteType")
                if not code or typ not in FUND_TYPES:
                    continue
                if code in seen_codes:
                    continue
                seen_codes.add(code)
                fund = map_to_fund(ent)
                all_funds.append(fund)
                by_type[typ] = by_type.get(typ, 0) + 1
                letter_count += 1

            total_pages = data.get("totalPages", 1)
            if page >= total_pages - 1:
                break
            page += 1
            time.sleep(RATE_LIMIT_SEC)

        print(f"+{letter_count} fonds (total cum: {len(all_funds)})")

    print(f"\n  Total fonds CSSF Lux uniques : {len(all_funds)}")
    print(f"  Distribution par type CSSF :")
    for typ, n in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"    {typ:5} : {n}")

    if not apply:
        print("\n  DRY-RUN — pas d'écriture.")
        return

    # Upsert en base
    print("\n  Upsert en base...")
    new_count = updated_count = fail = 0
    for i, fund in enumerate(all_funds, 1):
        try:
            # Vérifier si déjà en base (par CSSF_code)
            existing = client.table("investissement_funds").select("isin") \
                .eq("isin", fund["isin"]).execute().data
            if upsert_fund(fund):
                if existing:
                    updated_count += 1
                else:
                    new_count += 1
            else:
                fail += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"    ✗ {fund['isin']}: {e}")
        if i % 500 == 0:
            print(f"    [{i}/{len(all_funds)}] new={new_count} upd={updated_count} fail={fail}")

    print(f"\n  ✓ {new_count} nouveaux fonds, {updated_count} mis à jour, {fail} échecs")
    log_run(
        scraper="cssf-lux-funds",
        status="success" if fail < len(all_funds) / 10 else "partial",
        records_processed=new_count + updated_count,
        records_failed=fail,
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit-letters", type=int, default=None)
    args = parser.parse_args()
    run(apply=args.apply, limit_letters=args.limit_letters)
