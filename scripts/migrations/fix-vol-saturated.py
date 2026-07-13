#!/usr/bin/env python3
"""
fix-vol-saturated.py — Neutralise les volatilités corrompues
============================================================
La colonne volatility_* est en numeric(8,4), cap 9999.9999. Toute valeur
saturée (>= 9999.9) ou aberrante (> 200 %) est corrompue : on la remet à NULL
plutôt que de laisser un chiffre faux nourrir le screener et le fitScore.

Après --apply : relancer compute-metrics.py sur les ISIN listés
(/tmp/vol-saturated-isins.txt) pour recalculer la vraie volatilité depuis
investissement_fund_prices.

Usage :
    python3 scripts/migrations/fix-vol-saturated.py                     # dry-run
    python3 scripts/migrations/fix-vol-saturated.py --apply
    python3 scripts/migrations/fix-vol-saturated.py --apply --threshold 200
"""
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH = 500


def fetch_over(client, field: str, threshold: float) -> list[dict]:
    rows, offset = [], 0
    while True:
        batch = (
            client.table("investissement_funds").select(f"isin,{field}")
            .not_.is_(field, "null").gt(field, threshold)
            .range(offset, offset + 999).execute().data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def run(apply: bool, threshold: float) -> None:
    print("=" * 60)
    print("  fix-vol-saturated — volatilités corrompues → NULL")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}  seuil > {threshold}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    touched: dict[str, dict] = {}
    for field in ("volatility_1y", "volatility_3y"):
        rows = fetch_over(client, field, threshold)
        print(f"  {field} : {len(rows)} valeurs > {threshold}")
        for r in rows:
            touched.setdefault(r["isin"], {})[field] = None

    isins = sorted(touched)
    print(f"  Total fonds concernés : {len(isins)}")
    Path("/tmp/vol-saturated-isins.txt").write_text("\n".join(isins))
    print("  ISIN listés dans /tmp/vol-saturated-isins.txt (à repasser dans compute-metrics)")

    if not apply:
        for isin in isins[:5]:
            print(f"    {isin} → {list(touched[isin])} = NULL")
        return

    ok = fail = 0
    for i in range(0, len(isins), BATCH):
        for isin in isins[i:i + BATCH]:
            fields = dict(touched[isin])
            fields["updated_at"] = datetime.now(timezone.utc).isoformat()
            try:
                client.table("investissement_funds").update(fields).eq("isin", isin).execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 5:
                    print(f"  ✗ {isin} : {e}")
        print(f"  [{min(i + BATCH, len(isins)):5d}/{len(isins)}]  ✓{ok} ✗{fail}")

    print(f"\n  → {ok} corrigés, {fail} erreurs")
    log_run("fix-vol-saturated", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="NULL sur volatilités saturées/aberrantes")
    p.add_argument("--apply", action="store_true", help="Écrire les corrections")
    p.add_argument("--threshold", type=float, default=200.0, help="Seuil au-dessus duquel NULL")
    args = p.parse_args()
    run(apply=args.apply, threshold=args.threshold)
