#!/usr/bin/env python3
"""
fonds-euros-ter-from-name.py — Extrait le TER depuis les noms de fonds euros
=============================================================================
De nombreux fonds euros Quantalys encodent les frais de gestion annuels
directement dans leur nom : "Fonds euro XYZ (0.75%)" ou "(0.6% 100% PB)".

Ce pattern extrait ce pourcentage et le stocke dans ter + ongoing_charges.

Couverture estimée : ~192/276 fonds euros.

Usage :
    python3 scripts/migrations/fonds-euros-ter-from-name.py
    python3 scripts/migrations/fonds-euros-ter-from-name.py --apply
"""

import sys
import re
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# Pattern 1 : "(X% BRUT)" ou "(X% 85% PB)" ou "(X% et 85% PB)"
PAT_MAIN = re.compile(
    r'\((\d+[,.]\d+)\s*%\s*(?:(?:et\s+)?\d+\s*%\s*PB|BRUT)?\s*\)',
    re.IGNORECASE,
)

# Pattern 2 : "XYZ 0.80%" en fin de nom (plafond 2% pour éviter les taux garantis)
PAT_SUFFIX = re.compile(
    r'\b(\d+[,.]\d+)\s*%\s*$',
    re.IGNORECASE,
)

# Pattern 3 : espace avant closing paren "(0.89% )"
PAT_SPACE = re.compile(
    r'\((\d+[,.]\d+)\s*%\s*\)',
    re.IGNORECASE,
)

# Pattern 4 : "0.6% et 85% PB" sans parenthèse
PAT_ET_PB = re.compile(
    r'\b(\d+[,.]\d+)\s*%\s+et\s+\d+\s*%\s*PB',
    re.IGNORECASE,
)

# Pattern secondaire pour "frais de gestion X%"
PAT_ALT = re.compile(
    r'(?:frais?\s+de?\s+gestion|taux)\s+(?:à|de\s+)?(\d+[,.]\d+)\s*%',
    re.IGNORECASE,
)


_MAX_TER = 2.5  # frais de gestion fonds euros plafonnés à 2.5%


def extract_ter(name: str) -> float | None:
    """Retourne le TER en fraction (0.006 pour 0.6%) ou None."""
    if not name:
        return None
    for pat in (PAT_MAIN, PAT_ET_PB, PAT_SPACE, PAT_SUFFIX, PAT_ALT):
        m = pat.search(name)
        if m:
            val = float(m.group(1).replace(",", "."))
            if 0.01 <= val <= _MAX_TER:
                return round(val / 100, 6)
    return None


def run(apply: bool) -> None:
    print("=" * 68)
    print("  Fonds Euros TER — Extraction depuis le nom")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    all_funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,name,ter,ongoing_charges") \
            .eq("product_type", "fonds_euros") \
            .range(offset, offset + 999) \
            .execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds)} fonds euros chargés")

    to_update: list[dict] = []
    already  = 0
    no_match = 0
    ter_dist: Counter = Counter()

    for f in all_funds:
        if f.get("ter") is not None or f.get("ongoing_charges") is not None:
            already += 1
            continue
        ter = extract_ter(f["name"])
        if ter is None:
            no_match += 1
            continue
        to_update.append({"isin": f["isin"], "ter": ter, "ongoing_charges": ter})
        pct_str = f"{ter*100:.2f}%"
        ter_dist[pct_str] += 1

    print(f"  {already} déjà enrichis, {len(to_update)} à enrichir, {no_match} sans match")

    print("\n  Distribution des TER extraits :")
    for val, cnt in sorted(ter_dist.items(), key=lambda x: x[0]):
        print(f"    {val}: {cnt} fonds")

    if not apply:
        print("\n  Exemples :")
        for row in to_update[:5]:
            name_row = next(f["name"] for f in all_funds if f["isin"] == row["isin"])
            print(f"    {row['isin']}: ter={row['ter']*100:.2f}% | {name_row[:60]}")
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    print("\n  Application en base...", flush=True)
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for i, row in enumerate(to_update, 1):
        isin = row["isin"]
        try:
            client.table("investissement_funds") \
                .update({"ter": row["ter"], "ongoing_charges": row["ongoing_charges"], "updated_at": now}) \
                .eq("isin", isin) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ✗ {isin}: {e}", flush=True)

    print(f"\n  → {ok} fonds euros enrichis (TER), {fail} erreurs")
    log_run("fonds-euros-ter-from-name", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Extrait le TER des fonds euros depuis leur nom"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
