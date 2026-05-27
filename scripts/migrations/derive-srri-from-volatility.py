#!/usr/bin/env python3
"""
derive-srri-from-volatility.py — Calcule SRRI depuis volatilité annualisée
===========================================================================
Pour les fonds avec volatility_1y (ou volatility_3y) mais sans SRRI,
applique les seuils ESMA pour dériver le SRRI (1-7).

Seuils ESMA (volatilité annualisée en %) :
  < 0.5%  → 1
  0.5-2%  → 2
  2-5%    → 3
  5-10%   → 4
  10-15%  → 5
  15-25%  → 6
  ≥ 25%   → 7

Priorité : volatility_1y > volatility_3y

Usage :
    python3 scripts/migrations/derive-srri-from-volatility.py [--apply]
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH_SIZE = 500


def vol_to_srri(vol: float) -> int:
    if vol < 0.5:
        return 1
    elif vol < 2.0:
        return 2
    elif vol < 5.0:
        return 3
    elif vol < 10.0:
        return 4
    elif vol < 15.0:
        return 5
    elif vol < 25.0:
        return 6
    else:
        return 7


def run(apply: bool):
    print("=" * 60)
    print("  Dérivation SRRI depuis volatilité (ESMA)")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Fonds avec volatility mais sans SRRI
    funds: list[dict] = []
    seen: set[str] = set()

    for vol_field in ("volatility_1y", "volatility_3y"):
        offset = 0
        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin,volatility_1y,volatility_3y")
                .not_.is_(vol_field, "null")
                .is_("srri", "null")
                .range(offset, offset + 999)
                .execute().data or []
            )
            for row in batch:
                if row["isin"] not in seen:
                    seen.add(row["isin"])
                    funds.append(row)
            if len(batch) < 1000:
                break
            offset += 1000

    print(f"  {len(funds)} fonds à traiter\n")

    if not apply:
        dist = {i: 0 for i in range(1, 8)}
        for f in funds:
            vol = f.get("volatility_1y") or f.get("volatility_3y")
            if vol:
                dist[vol_to_srri(float(vol))] += 1
        print("  Distribution SRRI calculée :")
        for k, v in dist.items():
            print(f"    SRRI {k} : {v} fonds")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i in range(0, len(funds), BATCH_SIZE):
        batch = funds[i: i + BATCH_SIZE]
        for fund in batch:
            vol = fund.get("volatility_1y") or fund.get("volatility_3y")
            if not vol:
                continue
            srri = vol_to_srri(float(vol))
            try:
                client.table("investissement_funds") \
                    .update({"srri": srri, "updated_at": now}) \
                    .eq("isin", fund["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"  ✗ {fund['isin']} : {e}")

        pct = min(i + len(batch), len(funds)) / len(funds) * 100
        print(f"  [{i + len(batch):5d}/{len(funds)}] {pct:.0f}%  ✓{ok}  ✗{fail}")

    print(f"\n  → {ok} SRRI dérivés, {fail} erreurs")
    log_run("derive-srri-from-volatility", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
