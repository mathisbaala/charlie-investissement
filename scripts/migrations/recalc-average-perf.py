#!/usr/bin/env python3
"""
recalc-average-perf.py — Recalcul de average_performance
==========================================================
Boursorama et Morningstar ne calculent pas average_performance.
Ce script lit p1y/p3y/p5y et recompute la moyenne pour tous les fonds.

Usage :
    python3 scripts/migrations/recalc-average-perf.py [--apply]
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH_SIZE = 500


def run(apply: bool):
    print("=" * 60)
    print("  Recalc Average Performance")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Charger tous les fonds avec au moins une performance
    funds: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin,performance_1y,performance_3y,performance_5y,average_performance")
            .not_.is_("performance_1y", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(funds)} fonds avec performance_1y")

    updates: list[dict] = []
    for fund in funds:
        vals = [v for v in [
            fund.get("performance_1y"),
            fund.get("performance_3y"),
            fund.get("performance_5y"),
        ] if v is not None]
        if not vals:
            continue
        avg = round(sum(vals) / len(vals), 4)
        old_avg = fund.get("average_performance")
        if old_avg is None or abs(float(old_avg) - avg) > 0.01:
            updates.append({"isin": fund["isin"], "average_performance": avg})

    print(f"  {len(updates)} fonds à mettre à jour")

    if not apply:
        print("\n  Aperçu (5 premiers) :")
        for r in updates[:5]:
            isin = r["isin"]
            orig = next(f for f in funds if f["isin"] == isin)
            print(f"    {isin} | p1y={orig.get('performance_1y')} | "
                  f"p3y={orig.get('performance_3y')} | "
                  f"p5y={orig.get('performance_5y')} | "
                  f"avg_new={r['average_performance']}")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i in range(0, len(updates), BATCH_SIZE):
        batch = updates[i : i + BATCH_SIZE]
        for row in batch:
            try:
                client.table("investissement_funds") \
                    .update({"average_performance": row["average_performance"],
                             "updated_at": now}) \
                    .eq("isin", row["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"  ✗ {row['isin']} : {e}")

        pct = min(i + len(batch), len(updates)) / len(updates) * 100
        if i % (BATCH_SIZE * 4) == 0 or i + len(batch) >= len(updates):
            print(f"  [{i + len(batch):5d}/{len(updates)}] {pct:.0f}%  ✓{ok}  ✗{fail}")

    print(f"\n  → {ok} mis à jour, {fail} erreurs")
    log_run("recalc-average-perf", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recalcul average_performance")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
