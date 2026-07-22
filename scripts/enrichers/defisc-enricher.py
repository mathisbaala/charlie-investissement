#!/usr/bin/env python3
"""
defisc-enricher.py — Attributs de défiscalisation FIP / FCPI / FCPR (CGP FR)
===========================================================================
Enrichit, par RÈGLE statutaire (pas de scraping), les fonds de
défiscalisation français avec les paramètres qu'un CGP recherche :

  - tax_scheme          : fip / fip_corse / fip_outremer / fcpi / fcpr
  - tax_reduction_rate  : réduction d'IR à la souscription (fraction)
        · FIP / FCPI                 → 18 %  (barème 2024+, après expiration du 25 %)
        · FIP Corse / FIP Outre-mer  → 30 %
        · FCPR                       → 0 %   (pas de réduction IR ; régime 150-0 B / 125-0 A sur les gains)
  - tax_lock_up_years   : durée de blocage minimale pour conserver l'avantage (5 ans)
  - vintage_year        : millésime (année de collecte ≈ année d'inception)

Le taux est STATUTAIRE et indicatif (sous réserve de la loi de finances de
l'année de souscription). On ne devine rien de non réglementaire.

Fill-only : n'écrase jamais une valeur déjà présente.

Usage :
    python3 scripts/enrichers/defisc-enricher.py            # dry-run
    python3 scripts/enrichers/defisc-enricher.py --apply
"""

import sys, argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

CORSE_HINTS = ("corse", "corsica")
OM_HINTS = ("outre-mer", "outre mer", "outremer", "ultramarin", "ultra-marin",
            "dom-tom", "dom tom", " dom ", "domien", "pacifique", "réunion",
            "reunion", "antilles", "guadeloupe", "martinique", "guyane",
            "mayotte", "nouvelle-caledonie", "nouvelle-calédonie", "polynesie",
            "polynésie", "outre‑mer")

LOCK_UP_YEARS = 5  # blocage minimal FIP/FCPI pour conserver la réduction IR


def classify_defisc(product_type: str, name: str) -> dict | None:
    nm = (name or "").lower()
    pt = product_type

    if pt == "fip":
        if any(h in nm for h in CORSE_HINTS):
            return {"tax_scheme": "fip_corse", "tax_reduction_rate": 0.30,
                    "tax_lock_up_years": LOCK_UP_YEARS}
        if any(h in nm for h in OM_HINTS):
            return {"tax_scheme": "fip_outremer", "tax_reduction_rate": 0.30,
                    "tax_lock_up_years": LOCK_UP_YEARS}
        return {"tax_scheme": "fip", "tax_reduction_rate": 0.18,
                "tax_lock_up_years": LOCK_UP_YEARS}

    if pt == "fcpi":
        return {"tax_scheme": "fcpi", "tax_reduction_rate": 0.18,
                "tax_lock_up_years": LOCK_UP_YEARS}

    if pt == "fcpr":
        # Pas de réduction IR à l'entrée ; avantage = exonération des plus-values
        # sous conditions (blocage 5 ans). On marque le régime, taux 0.
        return {"tax_scheme": "fcpr", "tax_reduction_rate": 0.0,
                "tax_lock_up_years": LOCK_UP_YEARS}

    return None


def run(apply: bool):
    print("=" * 70)
    print("  Défisc Enricher — FIP / FCPI / FCPR (règle statutaire)")
    print("=" * 70)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}\n")

    client = get_client()
    rows = []
    offset = 0
    while True:
        r = (client.table("investissement_funds")
             .select("isin,name,product_type,inception_date,tax_scheme,"
                     "tax_reduction_rate,tax_lock_up_years,vintage_year")
             .in_("product_type", ["fip", "fcpi", "fcpr"])
             .range(offset, offset + 999).execute())
        if not r.data:
            break
        rows += r.data
        if len(r.data) < 1000:
            break
        offset += 1000

    print(f"  {len(rows)} fonds FIP/FCPI/FCPR chargés\n")

    updates = []
    for f in rows:
        res = classify_defisc(f["product_type"], f.get("name") or "")
        if not res:
            continue
        # millésime = année d'inception
        if f.get("inception_date"):
            try:
                res["vintage_year"] = int(str(f["inception_date"])[:4])
            except (ValueError, TypeError):
                pass
        # fill-only : ne garder que les champs vides en base
        payload = {k: v for k, v in res.items() if f.get(k) is None}
        if payload:
            updates.append({"isin": f["isin"], **payload})

    from collections import Counter
    by_scheme = Counter(u.get("tax_scheme") for u in updates if "tax_scheme" in u)
    fields = Counter(k for u in updates for k in u if k != "isin")
    print(f"  {len(updates)} fonds à enrichir")
    print("  Par régime :")
    for k, n in by_scheme.most_common():
        print(f"    {k:15} : {n}")
    print("  Champs remplis :")
    for k, n in fields.most_common():
        print(f"    {k:20} : {n}")
    print()

    if not apply:
        print("  [DRY-RUN] Ajouter --apply pour persister.")
        return

    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for u in updates:
        isin = u.pop("isin")
        try:
            (client.table("investissement_funds")
             .update({**u, "updated_at": now_ts})
             .eq("isin", isin).execute())
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 5:
                print(f"    ✗ {isin} : {e}")
        if (ok + fail) % 200 == 0:
            print(f"    [{ok + fail}/{len(updates)}] ok={ok} fail={fail}")
    print(f"\n  ✓ {ok} mis à jour, {fail} échecs")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    run(apply=a.apply)
