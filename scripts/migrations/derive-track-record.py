#!/usr/bin/env python3
"""
derive-track-record.py — Calcule track_record_years depuis inception_date
=========================================================================
Pour tous les fonds avec inception_date mais sans track_record_years,
calcule le nombre d'années depuis l'émission.

Cible principale : FPS (1033 avec inception mais 0 track_record_years)
Aussi utile pour : obligations, SCPI, fonds_euros, OPCVM.

Usage :
    python3 scripts/migrations/derive-track-record.py
    python3 scripts/migrations/derive-track-record.py --apply
    python3 scripts/migrations/derive-track-record.py --apply --type fps,scpi,obligation
"""

import sys
import argparse
from datetime import datetime, date, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

TODAY = date.today()


def compute_track_years(inception_date_str: str) -> float | None:
    try:
        inc = date.fromisoformat(inception_date_str[:10])
        years = round((TODAY - inc).days / 365.25, 1)
        if years < 0 or years > 100:
            return None
        return years
    except (ValueError, TypeError):
        return None


def run(apply: bool, types_filter: list[str]) -> None:
    print("=" * 68)
    print("  Derive Track Record Years — depuis inception_date")
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
            .select("isin,inception_date,track_record_years") \
            .in_("product_type", types_filter) \
            .not_.is_("inception_date", "null") \
            .is_("track_record_years", "null") \
            .range(offset, offset + 999) \
            .execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds)} fonds avec inception_date mais sans track_record_years")

    to_update: list[dict] = []
    skipped = 0
    for f in all_funds:
        years = compute_track_years(f["inception_date"])
        if years is None:
            skipped += 1
            continue
        to_update.append({"isin": f["isin"], "track_record_years": years})

    print(f"  {len(to_update)} calculables, {skipped} ignorés (date invalide)")

    if not apply:
        if to_update:
            # Quelques exemples
            for row in to_update[:5]:
                print(f"    {row['isin']}: {row['track_record_years']} ans")
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    print("\n  Application en base...", flush=True)
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for i, row in enumerate(to_update, 1):
        isin = row["isin"]
        try:
            client.table("investissement_funds") \
                .update({"track_record_years": row["track_record_years"], "updated_at": now}) \
                .eq("isin", isin) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ✗ {isin}: {e}", flush=True)
        if i % 500 == 0 or i == len(to_update):
            print(f"    [{i:5d}/{len(to_update)}] {i/len(to_update)*100:.0f}%  ✓{ok}  ✗{fail}", flush=True)

    print(f"\n  → {ok} track_record_years dérivés, {fail} erreurs")
    log_run("derive-track-record", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Dérive track_record_years depuis inception_date"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    parser.add_argument("--type",  type=str,
                        default="fps,fpci,fcpr,scpi,obligation,fonds_euros,opcvm,etf",
                        help="Types cibles")
    args = parser.parse_args()
    types_filter = [t.strip() for t in args.type.split(",") if t.strip()]
    run(apply=args.apply, types_filter=types_filter)
