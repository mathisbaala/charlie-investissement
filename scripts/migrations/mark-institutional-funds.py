#!/usr/bin/env python3
"""
mark-institutional-funds.py — Marque is_institutional=true pour les fonds hors-univers CGP.

Deux catégories :
  1. Préfixe CSSF_O* : SIFs luxembourgeois, exclusivement institutionnels.
  2. Source amf-geco + nom contenant "dédié" : fonds dédiés mono-client.

Usage :
    python3 scripts/migrations/mark-institutional-funds.py        # dry-run
    python3 scripts/migrations/mark-institutional-funds.py --apply
"""

import sys, argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH = 500


def fetch_cssf(client) -> list[str]:
    isins, offset = [], 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin") \
            .like("isin", "CSSF_%") \
            .eq("is_institutional", False) \
            .range(offset, offset + 999).execute().data or []
        isins.extend(r["isin"] for r in batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return isins


def fetch_dedies(client) -> list[str]:
    isins, offset = [], 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,name,data_source") \
            .eq("is_institutional", False) \
            .range(offset, offset + 999).execute().data or []
        for r in batch:
            ds = r.get("data_source") or {}
            src = list(ds.keys())[0] if isinstance(ds, dict) and ds else str(ds)
            if src != "amf-geco":
                continue
            if "dédié" in (r.get("name") or "").lower():
                isins.append(r["isin"])
        if len(batch) < 1000:
            break
        offset += 1000
    return isins


def apply_batch(client, isins: list[str], now: str) -> tuple[int, int]:
    updated = skipped = 0
    for i in range(0, len(isins), BATCH):
        chunk = isins[i:i + BATCH]
        try:
            client.table("investissement_funds") \
                .update({"is_institutional": True, "updated_at": now}) \
                .in_("isin", chunk).execute()
            updated += len(chunk)
            pct = (i + len(chunk)) * 100 // len(isins)
            print(f"    [{i + len(chunk):5d}/{len(isins)}] {pct}%  ✓{updated}  ✗{skipped}")
        except Exception as e:
            print(f"  ✗ batch error: {e}")
            skipped += len(chunk)
    return updated, skipped


def run(apply: bool) -> None:
    print("=" * 60)
    print("  Mark Institutional Funds")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")

    started = datetime.now(timezone.utc)
    client = get_client()

    cssf_isins  = fetch_cssf(client)
    dedi_isins  = fetch_dedies(client)
    all_isins   = list(set(cssf_isins + dedi_isins))

    print(f"\n  CSSF_O* non encore institutional : {len(cssf_isins)}")
    print(f"  AMF-GECO 'dédié' non encore institutional : {len(dedi_isins)}")
    print(f"  Total à marquer : {len(all_isins)}")

    if not all_isins:
        print("\n  Rien à faire.")
        return

    print(f"\n  Exemples (5 premiers CSSF) :")
    for isin in cssf_isins[:5]:
        print(f"    {isin}")
    print(f"  Exemples (5 premiers dédiés) :")
    for isin in dedi_isins[:5]:
        print(f"    {isin}")

    if not apply:
        print("\n  DRY-RUN — aucune modification.")
        return

    now = datetime.now(timezone.utc).isoformat()
    print("\n  Application en base...")
    updated, skipped = apply_batch(client, all_isins, now)
    print(f"\n  → {updated} marqués institutional, {skipped} erreurs")

    log_run("mark-institutional-funds", "success" if updated > 0 else "partial",
            updated, skipped, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
