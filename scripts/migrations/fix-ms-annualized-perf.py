#!/usr/bin/env python3
"""
fix-ms-annualized-perf.py — Conversion performance Morningstar annualisée → cumul total
=========================================================================================
Morningstar M36/M60 stockent des rendements ANNUALISÉS (ex: 11.1% par an sur 3 ans).
compute-metrics stocke des rendements CUMULATIFS (ex: 35.7% sur 3 ans).

Ce script corrige les fonds qui n'ont PAS d'historique de prix (source = Morningstar seul)
et dont la performance_3y / performance_5y est donc en format annualisé.

Conversion : total_Ny = ((1 + ann_Ny/100)^N - 1) × 100

Usage :
    python3 scripts/migrations/fix-ms-annualized-perf.py [--apply]
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
    print("  Fix Morningstar annualisé → cumul total")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Fonds avec price history (compute-metrics corrigera ces fonds)
    isins_with_prices: set[str] = set()
    offset = 0
    while True:
        batch = client.table("investissement_fund_prices").select("isin") \
            .range(offset, offset + 999).execute().data or []
        for row in batch:
            isins_with_prices.add(row["isin"])
        if len(batch) < 1000:
            break
        offset += 1000
    print(f"  {len(isins_with_prices)} fonds avec historique de prix (ignorés)")

    # Fonds avec morningstar_rating ET performance_3y (source probable = Morningstar)
    ms_funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,performance_3y,performance_5y") \
            .not_.is_("morningstar_rating", "null") \
            .not_.is_("performance_3y", "null") \
            .range(offset, offset + 999).execute().data or []
        ms_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    # Filtrer ceux sans price history ET dont p3y semble encore annualisée
    # Garde-fou idempotent : si p3y > 100%, c'est déjà en cumul (ou corrompu) → skip
    # Morningstar annualisé : rarement > 50% par an pour un fonds réel
    MAX_ANNUALIZED = 100.0
    to_fix = [
        f for f in ms_funds
        if f["isin"] not in isins_with_prices
        and abs(float(f["performance_3y"])) <= MAX_ANNUALIZED
    ]
    skipped = len([f for f in ms_funds if f["isin"] not in isins_with_prices]) - len(to_fix)
    print(f"  {len(to_fix)} fonds à corriger (Morningstar sans price history, p3y ≤ {MAX_ANNUALIZED}%)")
    if skipped:
        print(f"  {skipped} ignorés (p3y > {MAX_ANNUALIZED}% → déjà convertis ou corrompus)\n")

    if not apply:
        print("  Aperçu (5 premiers) :")
        for f in to_fix[:5]:
            p3 = float(f["performance_3y"])
            p5 = float(f["performance_5y"]) if f.get("performance_5y") else None
            t3 = ((1 + p3 / 100) ** 3 - 1) * 100
            t5 = ((1 + p5 / 100) ** 5 - 1) * 100 if p5 else None
            p5_str = f"{p5:.2f}% → {t5:.2f}%" if p5 is not None else "N/A"
            print(f"    {f['isin']} | p3y: {p3:.2f}% (ann) → {t3:.2f}% (total) | p5y: {p5_str}")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i in range(0, len(to_fix), BATCH_SIZE):
        batch = to_fix[i: i + BATCH_SIZE]
        for fund in batch:
            PERF_MAX = 9999.9999
            p3 = float(fund["performance_3y"])
            total_3y = max(-PERF_MAX, min(PERF_MAX, round(((1 + p3 / 100) ** 3 - 1) * 100, 4)))
            upd: dict = {"performance_3y": total_3y, "updated_at": now}

            if fund.get("performance_5y") is not None:
                p5 = float(fund["performance_5y"])
                upd["performance_5y"] = max(-PERF_MAX, min(PERF_MAX, round(((1 + p5 / 100) ** 5 - 1) * 100, 4)))

            try:
                client.table("investissement_funds") \
                    .update(upd) \
                    .eq("isin", fund["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"  ✗ {fund['isin']} : {e}")

        pct = min(i + len(batch), len(to_fix)) / len(to_fix) * 100
        if i % (BATCH_SIZE * 4) == 0 or i + len(batch) >= len(to_fix):
            print(f"  [{i + len(batch):5d}/{len(to_fix)}] {pct:.0f}%  ✓{ok}  ✗{fail}")

    print(f"\n  → {ok} corrigés, {fail} erreurs")
    log_run("fix-ms-annualized-perf", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
