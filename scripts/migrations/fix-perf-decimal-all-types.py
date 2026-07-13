#!/usr/bin/env python3
"""
fix-perf-decimal-all-types.py — Corrige les performances en fraction
====================================================================
Certaines perfs sont stockées en fraction (0.35 = 35 %) au lieu de pourcent.
fix-decimal-metrics.py ne couvre que les cas corrélés à une volatilité < 0.5 ;
il reste ~1 900 fonds (audit : perf_decimal) non traités, notamment quand la
volatilité est NULL.

Ce script est PRUDENT. Multiplier aveuglément « toute perf |v|<1 » corromprait
les fonds à performance réellement inférieure à 1 % (une vraie année à +0,4 %
stockée « 0.4 » deviendrait +40 %). On n'agit donc QUE sur les fonds où
l'encodage décimal est corroboré :

  - perf_3y OU perf_5y non nul et |v| < 1  (un cumul 3-5 ans sous 1 % est
    quasi impossible → signal fort d'encodage décimal), OU
  - volatility_1y en décimal (0 < vol < 0.5), OU
  - au moins DEUX champs de perf simultanément non nuls et |v| < 1.

Un fonds avec seulement perf_1y < 1 et aucun autre signal N'EST PAS touché
(perte de rappel volontaire pour éviter toute corruption). Idempotent : après
correction, les champs corroborants passent > 1 → le fonds n'est plus flaggé.

Après --apply : relancer recalc-average-perf.py --apply pour réaligner
average_performance.

Usage :
    python3 scripts/migrations/fix-perf-decimal-all-types.py            # dry-run
    python3 scripts/migrations/fix-perf-decimal-all-types.py --apply
    python3 scripts/migrations/fix-perf-decimal-all-types.py --fields performance_3y,performance_5y --apply
"""
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH = 500
CAP = 9999.9999
PERF_FIELDS = ("performance_1y", "performance_3y", "performance_5y", "average_performance")
SELECT = ("isin,product_type,performance_1y,performance_3y,performance_5y,"
          "average_performance,volatility_1y")


def _f(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def fetch_all(client) -> list[dict]:
    rows, offset = [], 0
    while True:
        batch = (
            client.table("investissement_funds").select(SELECT)
            .range(offset, offset + 999).execute().data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def is_decimal_encoded(r: dict) -> bool:
    p1, p3, p5 = _f(r.get("performance_1y")), _f(r.get("performance_3y")), _f(r.get("performance_5y"))
    vol = _f(r.get("volatility_1y"))
    if p3 is not None and p3 != 0 and abs(p3) < 1:
        return True
    if p5 is not None and p5 != 0 and abs(p5) < 1:
        return True
    if vol is not None and 0 < vol < 0.5:
        return True
    small = sum(1 for v in (p1, p3, p5) if v is not None and v != 0 and abs(v) < 1)
    return small >= 2


def scale(v: float) -> float:
    return max(-CAP, min(CAP, round(v * 100, 4)))


def run(apply: bool, fields: list[str]) -> None:
    print("=" * 60)
    print("  fix-perf-decimal-all-types — perfs fraction → %")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}  champs={','.join(fields)}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()
    rows = fetch_all(client)
    print(f"  {len(rows)} fonds chargés")

    updates: list[tuple[str, dict, dict]] = []
    for r in rows:
        if not is_decimal_encoded(r):
            continue
        upd: dict = {}
        for f in fields:
            v = _f(r.get(f))
            # On ne scale qu'un champ manifestement décimal (|v|<1). Les champs
            # déjà en % (>=1) sont laissés → idempotence + cas mixte préservé.
            if v is not None and v != 0 and abs(v) < 1:
                upd[f] = scale(v)
        if upd:
            updates.append((r["isin"], upd, r))

    print(f"  {len(updates)} fonds corroborés à corriger")

    if not apply:
        for isin, upd, r in updates[:10]:
            before = {f: r.get(f) for f in upd}
            print(f"    {isin} ({r.get('product_type')}) {before} → {upd}")
        print("\n  [DRY-RUN] Vérifie ces échantillons avant --apply.")
        return

    ok = fail = 0
    for i in range(0, len(updates), BATCH):
        for isin, upd, _ in updates[i:i + BATCH]:
            payload = dict(upd)
            payload["updated_at"] = datetime.now(timezone.utc).isoformat()
            try:
                client.table("investissement_funds").update(payload).eq("isin", isin).execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 5:
                    print(f"  ✗ {isin} : {e}")
        print(f"  [{min(i + BATCH, len(updates)):5d}/{len(updates)}]  ✓{ok} ✗{fail}")

    print(f"\n  → {ok} corrigés, {fail} erreurs")
    print("  Puis : recalc-average-perf.py --apply  (réaligne average_performance)")
    log_run("fix-perf-decimal-all-types", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Corrige les performances stockées en fraction")
    p.add_argument("--apply", action="store_true", help="Écrire les corrections")
    p.add_argument("--fields", type=str, default=",".join(PERF_FIELDS),
                   help="Champs à corriger (comma-separated)")
    args = p.parse_args()
    flds = [f.strip() for f in args.fields.split(",") if f.strip() in PERF_FIELDS]
    run(apply=args.apply, fields=flds)
