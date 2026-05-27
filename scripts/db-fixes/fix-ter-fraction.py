#!/usr/bin/env python3
"""
fix-ter-fraction.py — Corriger TER et ongoing_charges stockés en fraction
=========================================================================
Toutes les valeurs TER et ongoing_charges sont stockées comme fractions décimales
(ex: 0.012 au lieu de 1.2%). Ce script les multiplie par 100.

Règle :
  TER : multiplier × 100 TOUS les enregistrements (tous sont < 0.2)
  OC  : multiplier × 100 uniquement si ongoing_charges < 1.0
        (les SCPIs avec OC=12.0, 9.6, 18.0 sont déjà en %, à ne pas toucher)

Usage :
    python3 scripts/db-fixes/fix-ter-fraction.py          # dry-run
    python3 scripts/db-fixes/fix-ter-fraction.py --apply
"""

import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

BATCH = 500


def fetch_all(client, field: str, max_val: float | None = None) -> list[dict]:
    records = []
    offset = 0
    q = client.table("investissement_funds").select(f"isin,{field}").not_.is_(field, "null").gt(field, 0)
    if max_val is not None:
        q = q.lt(field, max_val)
    while True:
        batch = q.range(offset, offset + 999).execute().data or []
        records.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return records


def apply_updates(client, updates: list[dict], field: str, apply: bool) -> tuple[int, int]:
    ok = fail = 0
    for i in range(0, len(updates), BATCH):
        chunk = updates[i : i + BATCH]
        if not apply:
            ok += len(chunk)
            continue
        for rec in chunk:
            try:
                client.table("investissement_funds").update({field: rec["new_val"]}).eq("isin", rec["isin"]).execute()
                ok += 1
            except Exception as e:
                print(f"  ⚠ {rec['isin']} : {e}")
                fail += 1
    return ok, fail


def run(apply: bool):
    print("=" * 60)
    print("  fix-ter-fraction — TER/OC × 100")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    client = get_client()
    now = datetime.now(timezone.utc)

    # ── TER ──────────────────────────────────────────────────────
    ter_records = fetch_all(client, "ter")
    ter_updates = [{"isin": r["isin"], "old": r["ter"], "new_val": round(r["ter"] * 100, 6)} for r in ter_records]
    print(f"  TER à corriger : {len(ter_updates)}")
    # Quelques exemples
    for r in ter_updates[:5]:
        print(f"    {r['isin']}  {r['old']:.6f} → {r['new_val']:.4f}%")

    ok, fail = apply_updates(client, ter_updates, "ter", apply)
    print(f"  TER mis à jour : {ok} OK, {fail} erreurs")
    print()

    # ── ongoing_charges ──────────────────────────────────────────
    # Uniquement OC < 1.0 (les SCPI avec OC=12.0 etc. sont déjà en %)
    oc_records = fetch_all(client, "ongoing_charges", max_val=1.0)
    oc_updates = [{"isin": r["isin"], "old": r["ongoing_charges"], "new_val": round(r["ongoing_charges"] * 100, 6)} for r in oc_records]
    print(f"  ongoing_charges < 1.0 à corriger : {len(oc_updates)}")
    for r in oc_updates[:5]:
        print(f"    {r['isin']}  {r['old']:.6f} → {r['new_val']:.4f}%")

    ok2, fail2 = apply_updates(client, oc_updates, "ongoing_charges", apply)
    print(f"  OC mis à jour : {ok2} OK, {fail2} erreurs")
    print()

    total_fixed = len(ter_updates) + len(oc_updates)
    print(f"  Total corrigé : {total_fixed} valeurs (TER={len(ter_updates)}, OC={len(oc_updates)})")
    elapsed = (datetime.now(timezone.utc) - now).seconds
    print(f"  Terminé en {elapsed}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
