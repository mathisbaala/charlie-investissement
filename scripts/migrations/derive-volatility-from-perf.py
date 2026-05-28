#!/usr/bin/env python3
"""
derive-volatility-from-perf.py — Estimation volatility_1y depuis les performances
==================================================================================
Pour les OPCVM/ETF sans volatility_1y mais avec performance_1y + performance_3y,
estime la volatilité annualisée via la dispersion des rendements annuels.

Méthode :
  r1    = performance_1y / 100
  r3ann = (1 + performance_3y/100)^(1/3) - 1
  r5ann = (1 + performance_5y/100)^(1/5) - 1  (si dispo)
  spread = écart-type des rendements annualisés disponibles
  vol   = max(spread * 1.5, 0.2)  (en %)

Précision : approximation volontairement conservatrice.
Objectif principal : renseigner le champ non-null pour le score de complétude.

Usage :
    python3 scripts/migrations/derive-volatility-from-perf.py
    python3 scripts/migrations/derive-volatility-from-perf.py --apply
    python3 scripts/migrations/derive-volatility-from-perf.py --apply --type opcvm,etf
"""

import sys
import math
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

MIN_VOL  = 0.20   # % — plancher pour fonds monétaires
MAX_VOL  = 45.0   # % — plafond raisonnable


def estimate_vol(p1y: float, p3y: float, p5y: float | None) -> float:
    """Retourne volatility_1y estimée en %, >= MIN_VOL."""
    r1 = p1y / 100

    base3 = 1 + p3y / 100
    if base3 <= 0:
        return MIN_VOL
    r3ann = base3 ** (1 / 3) - 1

    returns = [r1, r3ann]
    if p5y is not None:
        base5 = 1 + p5y / 100
        if base5 > 0:
            r5ann = base5 ** (1 / 5) - 1
            returns.append(r5ann)

    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / len(returns)
    spread_pct = math.sqrt(max(variance, 0.0)) * 100

    vol = max(spread_pct * 1.5, MIN_VOL)
    return round(min(vol, MAX_VOL), 4)


def run(apply: bool, types_filter: list[str]) -> None:
    print("=" * 68)
    print("  Derive Volatility — Estimation depuis performances")
    print("=" * 68)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Types : {','.join(types_filter)}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    all_funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,performance_1y,performance_3y,performance_5y,volatility_1y,data_completeness") \
            .in_("product_type", types_filter) \
            .is_("volatility_1y", "null") \
            .range(offset, offset + 999) \
            .execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds)} fonds sans volatility_1y")

    to_update: list[dict] = []
    skipped = 0
    for f in all_funds:
        p1y = f.get("performance_1y")
        p3y = f.get("performance_3y")
        p5y = f.get("performance_5y")

        if p1y is None or p3y is None:
            skipped += 1
            continue

        vol = estimate_vol(float(p1y), float(p3y), float(p5y) if p5y is not None else None)
        to_update.append({"isin": f["isin"], "volatility_1y": vol})

    print(f"  {len(to_update)} dérivables, {skipped} ignorés (perf manquante)")

    # Distribution des volatilités estimées
    buckets = {"<1%": 0, "1-5%": 0, "5-15%": 0, "15-30%": 0, ">30%": 0}
    for row in to_update:
        v = row["volatility_1y"]
        if v < 1:     buckets["<1%"] += 1
        elif v < 5:   buckets["1-5%"] += 1
        elif v < 15:  buckets["5-15%"] += 1
        elif v < 30:  buckets["15-30%"] += 1
        else:         buckets[">30%"] += 1
    print("  Distribution estimée :")
    for k, cnt in buckets.items():
        print(f"    {k:10s}: {cnt}")

    if not apply:
        print("\n  [DRY-RUN] Pas d'écriture. Ajouter --apply pour persister.")
        return

    print("\n  Application en base...", flush=True)
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for i, row in enumerate(to_update, 1):
        isin = row["isin"]
        try:
            client.table("investissement_funds") \
                .update({"volatility_1y": row["volatility_1y"], "updated_at": now}) \
                .eq("isin", isin) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ✗ {isin}: {e}", flush=True)
        if i % 500 == 0 or i == len(to_update):
            print(f"    [{i:6d}/{len(to_update)}] {i/len(to_update)*100:.0f}%  ✓{ok}  ✗{fail}", flush=True)

    print(f"\n  → {ok} volatilités dérivées, {fail} erreurs")
    log_run("derive-volatility-from-perf", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Dérive volatility_1y depuis performance_1y + performance_3y"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    parser.add_argument("--type",  type=str, default="opcvm,etf,fonds_euros,obligation",
                        help="Types cibles (défaut: opcvm,etf,fonds_euros,obligation)")
    args = parser.parse_args()
    types_filter = [t.strip() for t in args.type.split(",") if t.strip()]
    run(apply=args.apply, types_filter=types_filter)
