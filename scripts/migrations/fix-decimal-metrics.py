#!/usr/bin/env python3
"""
fix-decimal-metrics.py — Corrige les métriques stockées en format décimal
==========================================================================
compute-metrics.py (ancienne version) stockait les métriques en fractions décimales
(0.0982 = 9.82%) au lieu de pourcentages (9.82 = 9.82%).

Ce script identifie et corrige ces enregistrements :

Cas 1 — Format entièrement décimal (volatility_1y < 0.5 %)
  → Tous les champs financiers multipliés par 100

Cas 2 — Format mixte (volatility_1y ≥ 5 % mais performance_1y < 1 %)
  → Seuls les champs de performance multipliés par 100

Usage :
    python3 scripts/migrations/fix-decimal-metrics.py          # dry-run
    python3 scripts/migrations/fix-decimal-metrics.py --apply  # écriture
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH_SIZE = 500


def fix_value(v, scale: float) -> float | None:
    if v is None:
        return None
    try:
        return round(float(v) * scale, 4)
    except (ValueError, TypeError):
        return None


def fix_if_small(v, threshold: float, scale: float) -> float | None:
    """Multiplie seulement si la valeur est dans l'intervalle [-threshold, threshold]."""
    if v is None:
        return None
    try:
        fv = float(v)
        if abs(fv) < threshold:
            return round(fv * scale, 4)
        return fv  # déjà en format %
    except (ValueError, TypeError):
        return None


FIELDS = ("isin,performance_1y,performance_3y,performance_5y,"
          "average_performance,volatility_1y,volatility_3y,"
          "max_drawdown_1y,max_drawdown_3y,sharpe_1y,sharpe_3y")


def fetch_pure_decimal(client) -> list[dict]:
    """Cas 1 : p1y dans (-1,1) ET vol_1y < 0.5 (deux métriques en format décimal)."""
    rows, offset = [], 0
    while True:
        batch = (
            client.table("investissement_funds").select(FIELDS)
            .not_.is_("performance_1y", "null")
            .lt("performance_1y", 1.0).gt("performance_1y", -1.0)
            .not_.is_("volatility_1y", "null")
            .lt("volatility_1y", 0.5)
            .range(offset, offset + 999)
            .execute().data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def fetch_mixed(client) -> list[dict]:
    """Cas 2 : p1y dans (-1,1) ET vol_1y ≥ 5 (performance décimale, vol en %)."""
    rows, offset = [], 0
    while True:
        batch = (
            client.table("investissement_funds").select(FIELDS)
            .not_.is_("performance_1y", "null")
            .lt("performance_1y", 1.0).gt("performance_1y", -1.0)
            .not_.is_("volatility_1y", "null")
            .gte("volatility_1y", 5.0)
            .range(offset, offset + 999)
            .execute().data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def run(apply: bool):
    print("=" * 60)
    print("  Fix Decimal Metrics — migration format décimal → %")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # ── Cas 1 : Format entièrement décimal (vol_1y < 0.5) ────────────────
    print("  Cas 1 — Format entièrement décimal (vol_1y < 0.5)...")
    pure_decimal = fetch_pure_decimal(client)
    print(f"    → {len(pure_decimal)} enregistrements à corriger")

    updates_1: list[dict] = []
    for row in pure_decimal:
        isin = row["isin"]
        upd: dict = {"isin": isin}

        for perf_field in ("performance_1y", "performance_3y", "performance_5y",
                           "average_performance"):
            upd[perf_field] = fix_value(row.get(perf_field), 100)

        for risk_field in ("volatility_1y", "volatility_3y"):
            v = row.get(risk_field)
            if v is not None and float(v) < 0.5:
                upd[risk_field] = fix_value(v, 100)

        for dd_field in ("max_drawdown_1y", "max_drawdown_3y"):
            v = row.get(dd_field)
            # max_drawdown est négatif; if < 0 and > -1 → format décimal
            if v is not None and -1.0 < float(v) <= 0:
                upd[dd_field] = fix_value(v, 100)

        updates_1.append(upd)

    # ── Cas 2 : Format mixte (vol_1y ≥ 5, perf < 1) ────────────────────
    print("  Cas 2 — Format mixte (vol_1y ≥ 5%, perf_1y < 1)...")
    mixed = fetch_mixed(client)
    print(f"    → {len(mixed)} enregistrements à corriger (performance seulement)")

    updates_2: list[dict] = []
    for row in mixed:
        isin = row["isin"]
        upd: dict = {"isin": isin}

        # Corriger performance_1y (toujours décimale ici)
        upd["performance_1y"] = fix_value(row.get("performance_1y"), 100)

        # performance_3y / 5y : corriger seulement si encore < 1
        for perf_field in ("performance_3y", "performance_5y", "average_performance"):
            v = row.get(perf_field)
            if v is not None and abs(float(v)) < 1.0:
                upd[perf_field] = fix_value(v, 100)

        updates_2.append(upd)

    # ── Application ──────────────────────────────────────────────────────
    total = len(updates_1) + len(updates_2)
    print(f"\n  Total : {total} enregistrements à mettre à jour")

    if not apply:
        print("\n  [DRY-RUN] Aperçu des 5 premières corrections (cas 1) :")
        for r in updates_1[:5]:
            isin = r["isin"]
            orig = next((x for x in pure_decimal if x["isin"] == isin), {})
            print(f"    {isin}")
            print(f"      p1y : {orig.get('performance_1y')!s:12} → {r.get('performance_1y')}")
            print(f"      vol : {orig.get('volatility_1y')!s:12} → {r.get('volatility_1y')}")
        print()
        print("  [DRY-RUN] Aperçu des 3 premières corrections (cas 2) :")
        for r in updates_2[:3]:
            isin = r["isin"]
            orig = next((x for x in mixed if x["isin"] == isin), {})
            print(f"    {isin}")
            print(f"      p1y : {orig.get('performance_1y')!s:12} → {r.get('performance_1y')}")
        return

    ok = fail = 0
    all_updates = updates_1 + updates_2

    for i in range(0, len(all_updates), BATCH_SIZE):
        batch = all_updates[i : i + BATCH_SIZE]
        for row in batch:
            isin = row["isin"]
            fields = {k: v for k, v in row.items() if k != "isin" and v is not None}
            fields["updated_at"] = datetime.now(timezone.utc).isoformat()
            try:
                client.table("investissement_funds") \
                    .update(fields).eq("isin", isin).execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 5:
                    print(f"  ✗ {isin} : {e}")

        pct = min(i + BATCH_SIZE, len(all_updates)) / len(all_updates) * 100
        print(f"  [{i + len(batch):5d}/{len(all_updates)}] {pct:.0f}%  ✓{ok}  ✗{fail}")

    print(f"\n  → {ok} corrigés, {fail} erreurs")
    log_run("fix-decimal-metrics", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fix decimal-format financial metrics")
    parser.add_argument("--apply", action="store_true", help="Écrire les corrections")
    args = parser.parse_args()
    run(apply=args.apply)
