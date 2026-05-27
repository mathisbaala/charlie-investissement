#!/usr/bin/env python3
"""
fix-null-names.py — Corrige les fonds avec name=null dans investissement_funds
===============================================================================
Récupère les noms depuis Yahoo Finance (shortName / longName), puis depuis
l'ISIN lui-même comme fallback. Met à jour la colonne name en base.

Usage :
    python3 scripts/fix-null-names.py [--apply] [--limit N]
"""

import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from db import get_client, log_run

try:
    import yfinance as yf
except ImportError:
    raise ImportError("yfinance non installé — pip install yfinance")

RATE_LIMIT = 0.5


def fetch_name_yahoo(isin: str) -> str | None:
    try:
        info = yf.Ticker(isin).info
        name = info.get("shortName") or info.get("longName") or info.get("name")
        if name and len(name.strip()) > 1:
            return name.strip()[:200]
    except Exception:
        pass
    return None


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Fix Null Names — Récupération des noms manquants")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    # Récupérer tous les fonds avec name=null
    all_nulls = []
    page_size = 1000
    offset = 0
    while True:
        resp = client.table("investissement_funds") \
            .select("isin, product_type") \
            .is_("name", "null") \
            .range(offset, offset + page_size - 1) \
            .execute()
        batch = resp.data or []
        all_nulls.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    if limit:
        all_nulls = all_nulls[:limit]

    print(f"  {len(all_nulls)} fonds avec name=null")
    print()

    fixed = 0
    fallback = 0
    failed = 0

    for i, fund in enumerate(all_nulls, 1):
        isin = fund["isin"]

        time.sleep(RATE_LIMIT)
        name = fetch_name_yahoo(isin)

        if not name:
            # Fallback : ISIN comme nom temporaire pour lever la contrainte
            name = f"FONDS {isin}"
            fallback += 1
            if i <= 20 or i % 500 == 0:
                print(f"  ~ [{i:5d}] {isin} | fallback ISIN")
        else:
            fixed += 1
            if i <= 20 or i % 200 == 0:
                print(f"  ✓ [{i:5d}] {isin} | {name[:50]}")

        if apply:
            try:
                client.table("investissement_funds") \
                    .update({"name": name}) \
                    .eq("isin", isin) \
                    .execute()
            except Exception as e:
                failed += 1
                print(f"  ✗ [{i:5d}] {isin} | erreur: {e}")

    print()
    print(f"  ✓ {fixed} noms récupérés via Yahoo")
    print(f"  ~ {fallback} noms fallback (ISIN)")
    print(f"  ✗ {failed} erreurs d'écriture")

    if apply:
        log_run("fix-null-names", "success", fixed + fallback, failed, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fix null names in investissement_funds")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
