#!/usr/bin/env python3
"""
fix-ter-residual.py — Corriger les TER/OC résiduels encore en fraction
=======================================================================
Le fix initial (fix-ter-fraction.py) ne peut pas être relancé sans borne
supérieure car il re-multiplierait les valeurs déjà corrigées.

Ce script cible uniquement les enregistrements dont la valeur est encore
clairement une fraction :
  - TER < 0.02          → représente un TER de 0% à 2% en fraction
                          (aucun fonds légitime n'a TER < 0.02% dans notre univers)
  - ongoing_charges < 0.02 → même logique

Le seuil 0.02 est conservateur : les ETFs les moins chers de notre base
(money market, Lyxor/Amundi index) ont des TER autour 0.05-0.10%.
Après correction, ces records auraient TER=5-10% — absurde, donc ils ne
sont pas dans la DB comme fractions à ce niveau.

Cas traités :
  - 319 records TER < 0.01 ajoutés après le fix initial (scrapers euronext,
    yahoo-finance, cardif, utmost post-fixe)
  - Race condition utmost-luxembourg : TER=0.0101, 0.0092, etc.

Usage :
    python3 scripts/db-fixes/fix-ter-residual.py         # dry-run
    python3 scripts/db-fixes/fix-ter-residual.py --apply
"""

import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

TER_MAX   = 0.02   # seuil : < 2% en fraction = clairement une fraction
OC_MAX    = 0.02


def fetch_residuals(client, field: str, max_val: float) -> list[dict]:
    records = []
    offset  = 0
    q = (
        client.table("investissement_funds")
        .select(f"isin,{field},data_source")
        .not_.is_(field, "null")
        .gt(field, 0)
        .lt(field, max_val)
    )
    while True:
        batch = q.range(offset, offset + 999).execute().data or []
        records.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return records


def run(apply: bool):
    print("=" * 60)
    print("  fix-ter-residual — TER/OC résiduels × 100")
    print("=" * 60)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Seuil : TER < {TER_MAX}  (= TER exprimé comme fraction < {TER_MAX*100:.0f}%)")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    for field, max_val in [("ter", TER_MAX), ("ongoing_charges", OC_MAX)]:
        records = fetch_residuals(client, field, max_val)
        print(f"  {field} résiduels (< {max_val}) : {len(records)} enregistrements")

        by_source: dict[str, int] = {}
        for r in records:
            src = r.get("data_source") or "?"
            by_source[src] = by_source.get(src, 0) + 1
        for src, n in sorted(by_source.items(), key=lambda x: -x[1]):
            print(f"    {src:35}  {n}")

        if records:
            print(f"  Exemples :")
            for r in records[:8]:
                old = r[field]
                new = round(old * 100, 6)
                print(f"    {r['isin']:14}  {old:.6f} → {new:.4f}%  [{r.get('data_source','')}]")

        ok = fail = 0
        for r in records:
            isin = r["isin"]
            new_val = round(r[field] * 100, 6)
            if apply:
                try:
                    client.table("investissement_funds") \
                        .update({field: new_val}) \
                        .eq("isin", isin) \
                        .execute()
                    ok += 1
                except Exception as e:
                    print(f"    ⚠ {isin} : {e}")
                    fail += 1
            else:
                ok += 1

        verb = "mis à jour" if apply else "seraient mis à jour"
        print(f"  → {ok} {verb}, {fail} erreurs\n")

    elapsed = (datetime.now(timezone.utc) - started).seconds
    print(f"  Terminé en {elapsed}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fix TER/OC résiduels en fraction")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = parser.parse_args()
    run(apply=args.apply)
