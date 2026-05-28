#!/usr/bin/env python3
"""
set-fonds-euros-sri.py — Sri=1 pour fonds euros (capital garanti)
==================================================================
Les fonds euros sont des contrats à capital garanti (rendement net ≥ 0).
Leur profil de risque au sens PRIIPS correspond à SRI=1 (risque le plus faible).
Ce script fixe sri=1 pour tous les fonds_euros sans sri ni srri.

Usage :
    python3 scripts/migrations/set-fonds-euros-sri.py
    python3 scripts/migrations/set-fonds-euros-sri.py --apply
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run


def run(apply: bool) -> None:
    print("=" * 64)
    print("  Set SRI=1 pour fonds euros (capital garanti)")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Fonds euros sans sri ni srri
    funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,name") \
            .eq("product_type", "fonds_euros") \
            .is_("sri", "null") \
            .is_("srri", "null") \
            .range(offset, offset + 999) \
            .execute().data or []
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(funds)} fonds euros sans sri/srri")

    if not apply:
        print("  [DRY-RUN] Ajouteraient sri=1.")
        print("  Ajouter --apply pour persister.")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for fund in funds:
        try:
            client.table("investissement_funds") \
                .update({"sri": 1, "updated_at": now}) \
                .eq("isin", fund["isin"]) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ✗ {fund['isin']}: {e}")

    print(f"\n  → {ok} fonds euros mis à jour (sri=1), {fail} erreurs")
    log_run("set-fonds-euros-sri", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
