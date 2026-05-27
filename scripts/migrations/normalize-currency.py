#!/usr/bin/env python3
"""
normalize-currency.py — Standardisation des devises ISO 4217
==============================================================
Certaines variantes en base ne sont pas du ISO 4217 standard :
  - "GBp"  → GBP (pence britanniques, sous-unité)
  - "ZAc"  → ZAR (cents sud-africains)
  - "ILA"  → ILS (agorot israéliens)
  - "KWF"  → KWD (devise Koweït)

Ces variantes proviennent de Yahoo Finance qui distingue parfois
les sous-unités. On veut normaliser à la devise majeure.

Usage :
    python3 scripts/migrations/normalize-currency.py [--apply]
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# Mapping non-ISO → ISO 4217
CURRENCY_MAP = {
    "GBp":  "GBP",  # pence → pound
    "GBX":  "GBP",  # même
    "ZAc":  "ZAR",  # cents → rand
    "ILA":  "ILS",  # agorot → shekel
    "KWF":  "KWD",  # erreur typique → dinar
    "EUR ": "EUR",  # trailing space
}


def run(apply: bool):
    print("=" * 60)
    print("  Normalize Currency → ISO 4217")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    total_updates = 0
    for variant, canonical in CURRENCY_MAP.items():
        r = client.table("investissement_funds") \
            .select("isin", count="exact") \
            .eq("currency", variant) \
            .execute()
        n = r.count or 0
        if n == 0:
            continue
        print(f"  {variant!r:8} → {canonical!r:6} : {n} fonds")
        total_updates += n

        if apply:
            # Un seul UPDATE WHERE — évite les 20k+ requêtes HTTP/2 individuelles
            client.table("investissement_funds") \
                .update({"currency": canonical}) \
                .eq("currency", variant) \
                .execute()

    print(f"\n  Total : {total_updates} fonds à normaliser")

    if apply:
        log_run(
            scraper="normalize-currency",
            status="success",
            records_processed=total_updates,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
