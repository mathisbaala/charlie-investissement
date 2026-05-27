#!/usr/bin/env python3
"""
recalc-track-record.py — Calcule track_record_years depuis inception_date
==========================================================================
Pour les fonds avec inception_date mais sans track_record_years.

Usage :
    python3 scripts/migrations/recalc-track-record.py [--apply]
"""

import sys
import argparse
from datetime import datetime, date, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH_SIZE = 500


def run(apply: bool):
    print("=" * 60)
    print("  Recalcul track_record_years depuis inception_date")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    today   = date.today()

    funds: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin,inception_date")
            .not_.is_("inception_date", "null")
            .is_("track_record_years", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(funds)} fonds à traiter\n")

    if not apply:
        print("  Aperçu (5 premiers) :")
        for f in funds[:5]:
            inc = date.fromisoformat(f["inception_date"][:10])
            years = round((today - inc).days / 365.25, 1)
            print(f"    {f['isin']} | {f['inception_date'][:10]} → {years}Y")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i in range(0, len(funds), BATCH_SIZE):
        batch = funds[i: i + BATCH_SIZE]
        for fund in batch:
            try:
                inc = date.fromisoformat(fund["inception_date"][:10])
                years = round((today - inc).days / 365.25, 1)
                client.table("investissement_funds") \
                    .update({"track_record_years": years, "updated_at": now}) \
                    .eq("isin", fund["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"  ✗ {fund['isin']} : {e}")

        pct = min(i + len(batch), len(funds)) / len(funds) * 100
        print(f"  [{i + len(batch):5d}/{len(funds)}] {pct:.0f}%  ✓{ok}  ✗{fail}")

    print(f"\n  → {ok} track_record_years recalculés, {fail} erreurs")
    log_run("recalc-track-record", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
