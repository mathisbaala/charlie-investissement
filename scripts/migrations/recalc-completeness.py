#!/usr/bin/env python3
"""
recalc-completeness.py — Recalcul complet du score data_completeness
=====================================================================
Les mises à jour partielles (compute-metrics, etc.) écrasent data_completeness
avec un score partiel calculé uniquement sur les champs fournis à ce moment-là.

Ce script lit tous les champs pertinents pour chaque fonds et recalcule le score.

Usage :
    python3 scripts/migrations/recalc-completeness.py [--apply]
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

COMPLETENESS_FIELDS = (
    "isin,ongoing_charges,ter,sri,srri,performance_1y,performance_3y,"
    "sfdr_article,aum_eur,kid_parsed_at,data_completeness"
)
BATCH_SIZE = 500


def compute_completeness_full(fund: dict) -> int:
    score = 0
    if fund.get("ongoing_charges") is not None or fund.get("ter") is not None:
        score += 14
    if fund.get("sri") is not None or fund.get("srri") is not None:
        score += 14
    if fund.get("performance_1y") is not None:
        score += 14
    if fund.get("performance_3y") is not None:
        score += 14
    if fund.get("sfdr_article") is not None:
        score += 14
    if fund.get("aum_eur") is not None:
        score += 14
    if fund.get("kid_parsed_at") is not None:
        score += 16
    return min(score, 100)


def run(apply: bool):
    print("=" * 60)
    print("  Recalc Completeness — Recalcul data_completeness")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Paginer tous les fonds
    funds: list[dict] = []
    offset = 0
    page   = 1000
    while True:
        batch = (
            client.table("investissement_funds")
            .select(COMPLETENESS_FIELDS)
            .range(offset, offset + page - 1)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < page:
            break
        offset += page

    print(f"  {len(funds)} fonds chargés")

    # Calculer le vrai score
    updates: list[dict] = []
    changed = 0
    for fund in funds:
        true_score = compute_completeness_full(fund)
        old_score  = fund.get("data_completeness") or 0
        if true_score != old_score:
            updates.append({"isin": fund["isin"], "data_completeness": true_score})
            changed += 1

    print(f"  {changed} fonds avec score incorrect à corriger")
    print()

    if not apply:
        from collections import Counter
        # Show distribution preview
        new_dist = Counter()
        for f in funds:
            s = compute_completeness_full(f)
            bucket = (s // 10) * 10
            new_dist[bucket] += 1
        print("  Distribution après recalcul :")
        for bucket in sorted(new_dist):
            print(f"    {bucket:3d}-{bucket+9}: {new_dist[bucket]:5d} fonds")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i in range(0, len(updates), BATCH_SIZE):
        batch = updates[i : i + BATCH_SIZE]
        for row in batch:
            try:
                client.table("investissement_funds") \
                    .update({"data_completeness": row["data_completeness"], "updated_at": now}) \
                    .eq("isin", row["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"  ✗ {row['isin']} : {e}")

        pct = min(i + len(batch), len(updates)) / len(updates) * 100
        if i % (BATCH_SIZE * 5) == 0 or i + len(batch) >= len(updates):
            print(f"  [{i + len(batch):6d}/{len(updates)}] {pct:.0f}%  ✓{ok}  ✗{fail}")

    print(f"\n  → {ok} mis à jour, {fail} erreurs")
    log_run("recalc-completeness", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recalcul data_completeness")
    parser.add_argument("--apply", action="store_true", help="Écrire les corrections")
    args = parser.parse_args()
    run(apply=args.apply)
