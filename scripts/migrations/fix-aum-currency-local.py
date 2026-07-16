#!/usr/bin/env python3
"""
fix-aum-currency-local.py — Neutralise les AUM en devise locale
===============================================================
aum_eur est censé être en EUROS. Une valeur > 1 000 Mrd€ (> 1e12) est presque
toujours un montant laissé en devise locale (IDR, CLP, KRW…). Approche
conservatrice : on remet ces AUM à NULL (mieux qu'un chiffre faux) et on liste
les ISIN pour un re-fetch ciblé (market cap × FX) par les enrichers.

Usage :
    python3 scripts/migrations/fix-aum-currency-local.py                # dry-run
    python3 scripts/migrations/fix-aum-currency-local.py --apply
    python3 scripts/migrations/fix-aum-currency-local.py --apply --threshold 1e12
"""
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH = 500


def fetch_over(client, threshold: float) -> list[dict]:
    rows, offset = [], 0
    while True:
        batch = (
            client.table("investissement_funds").select("isin,aum_eur,currency,product_type")
            .not_.is_("aum_eur", "null").gt("aum_eur", threshold)
            .range(offset, offset + 999).execute().data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def run(apply: bool, threshold: float) -> None:
    print("=" * 60)
    print("  fix-aum-currency-local — AUM aberrant → NULL")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}  seuil > {threshold:.0f}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()
    rows = fetch_over(client, threshold)
    print(f"  {len(rows)} fonds avec aum_eur > {threshold:.0f}")

    Path("/tmp/aum-currency-isins.txt").write_text(
        "\n".join(f"{r['isin']}\t{r.get('currency')}\t{r.get('aum_eur')}" for r in rows)
    )
    print("  Détail dans /tmp/aum-currency-isins.txt (à re-fetch via enrichers)")

    if not apply:
        for r in rows[:8]:
            print(f"    {r['isin']} ({r.get('currency')}) {r.get('aum_eur')} → NULL")
        return

    ok = fail = 0
    isins = [r["isin"] for r in rows]
    for i in range(0, len(isins), BATCH):
        for isin in isins[i:i + BATCH]:
            try:
                client.table("investissement_funds").update(
                    {"aum_eur": None, "updated_at": datetime.now(timezone.utc).isoformat()}
                ).eq("isin", isin).execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 5:
                    print(f"  ✗ {isin} : {e}")
        print(f"  [{min(i + BATCH, len(isins)):5d}/{len(isins)}]  ✓{ok} ✗{fail}")

    print(f"\n  → {ok} neutralisés, {fail} erreurs")
    log_run("fix-aum-currency-local", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="NULL sur AUM en devise locale (> seuil)")
    p.add_argument("--apply", action="store_true", help="Écrire les corrections")
    p.add_argument("--threshold", type=float, default=1e12, help="Seuil aum_eur (défaut 1e12)")
    args = p.parse_args()
    run(apply=args.apply, threshold=args.threshold)
