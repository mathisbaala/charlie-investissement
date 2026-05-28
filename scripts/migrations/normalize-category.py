#!/usr/bin/env python3
"""
normalize-category.py — Normaliser les catégories vers ~20 labels stables
==========================================================================
Les catégories en base viennent de Morningstar (anglais/français mixte)
et de l'AMF (classifications réglementaires françaises). Ce script les
normalise dans la colonne `category_normalized` (texte stable pour le screener).

~158 catégories distinctes → 20 catégories normalisées :
  Monétaire | Obligations | Actions France | Actions Europe | Actions USA |
  Actions Monde | Actions Émergents | Actions Sectorielles | Immobilier |
  Multi-Actifs | Performance Absolue | Private Equity | Infrastructure |
  Matières Premières | Convertibles | Obligations Haut Rendement |
  Obligations Pays Émergents | Innovation/FCPI | Fonds Garantis | Autres

Usage :
    python3 scripts/migrations/normalize-category.py
    python3 scripts/migrations/normalize-category.py --apply
"""

import sys
import re
import argparse
from datetime import datetime, timezone
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# Mapping catégorie brute → catégorie normalisée
# L'ordre compte — premier match gagne
CAT_NORMALIZE: list[tuple[str, str]] = [
    # Monétaire
    (r"monet|money market|tréso|tresor|liquidit|vnav|court\s*term", "Monétaire"),
    # Convertibles
    (r"convertib", "Convertibles"),
    # Obligations Haut Rendement
    (r"haut.rendement|high.yield|junk|specul", "Obligations HY"),
    # Obligations Pays Émergents
    (r"(oblig|bond).*(emergent|emerging|pays.*dev|developing)", "Obligations Émergents"),
    # Obligations
    (r"oblig|bond|fixed.income|titre.de.créance|revenu.fixe|dette|debt|crédit.corp"
     r"|euro.*oblig|bund|btp|gilt|oat|privé.*oblig|diversif.*oblig", "Obligations"),
    # Immobilier
    (r"immob|foncier|reit|real.estate|pierre|scpi|opci", "Immobilier"),
    # Private Equity / Capital risque
    (r"private.equity|capital.risque|fcpr|fip\b|commun.*risques|capital.invest"
     r"|venture|growth.equity|secondar|mezzanine|fpci", "Private Equity"),
    # Infrastructure
    (r"infrastruct", "Infrastructure"),
    # Garantis / Formule
    (r"garantie?|garanti|formule|capital.protégé|protégé|100%", "Fonds Garantis"),
    # Performance Absolue / Alternatif
    (r"absolue|absolute.return|long.short|market.neutral|arbitrage|hedge|multi.strat", "Performance Absolue"),
    # Innovation / FCPI
    (r"\bfcpi\b|innovation|technolog.*inno|fonds.*proximit", "Innovation/FCPI"),
    # Actions France
    (r"action.*franc|action.*fr\b|france.*action|cac|sfef|françaises?.*action", "Actions France"),
    # Actions Europe
    (r"action.*europ|europ.*action|action.*zone.euro|action.*union.europ"
     r"|stoxx|europ.*small|europ.*large|europ.*pmecap", "Actions Europe"),
    # Actions USA
    (r"action.*etats.uni|usa.*action|action.*usa|action.*ameriqu"
     r"|s&p.*500|nasdaq|russell|north.americ.*action", "Actions USA"),
    # Actions Japon
    (r"action.*japon|japon.*action|japan.*equity|nikkei|topix", "Actions Japon"),
    # Actions Asie / Pacifique
    (r"action.*asie|asie.*action|asia.*equity|action.*pacif|pacif.*equity"
     r"|china|chine|hong.kong|taiwan|corée|asean", "Actions Asie"),
    # Actions Émergents
    (r"action.*emergent|emergent.*action|emerging.*equity|bric|action.*inde"
     r"|action.*brésil|action.*russie|action.*afri|action.*latine"
     r"|pays.*emergent.*action", "Actions Émergents"),
    # Actions Sectorielles
    (r"sectori|santé|pharmac|technolog|énergi|energy|financ.*action|immob.*action"
     r"|conso.*cyclique|conso.*déf|industri|matériau|telecom|communication", "Actions Sectorielles"),
    # Actions Monde
    (r"action.*monde|monde.*action|action.*world|world.*equity|global.*equity"
     r"|international.*action|action.*global|action.*inter", "Actions Monde"),
    # Actions (générique si rien de précédent ne match)
    (r"\baction\b|\bactions\b|\bequity\b|\bequities\b|\bstock", "Actions"),
    # Multi-Actifs
    (r"mixte|allocation|flexible|diversifié|multi.asset|balanced|prudent|modéré"
     r"|dynamic|global.alloc|profil|patrimoni", "Multi-Actifs"),
    # Matières premières
    (r"matière.première|commodity|commodi|gold|or\b|énergi.*matiè", "Matières Premières"),
]

_COMPILED = [(re.compile(p, re.I), cat) for p, cat in CAT_NORMALIZE]


def normalize_cat(raw: str | None) -> str | None:
    if not raw:
        return None
    for pat, norm in _COMPILED:
        if pat.search(raw):
            return norm
    return "Autres"


def run(apply: bool) -> None:
    print("=" * 68)
    print("  Normalize Category → ~20 labels stables")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Vérifier si category_normalized existe
    col_exists = True
    try:
        client.table("investissement_funds").select("category_normalized").limit(1).execute()
    except Exception as e:
        if "42703" in str(e) or "does not exist" in str(e):
            col_exists = False
            print("  ⚠️  La colonne category_normalized n'existe pas encore.")
            print("  Exécutez ce SQL dans le Supabase SQL Editor :")
            print("    ALTER TABLE investissement_funds ADD COLUMN IF NOT EXISTS category_normalized text;")
            print()

    # Charger tous les fonds avec category
    all_funds: list[dict] = []
    offset = 0
    select_fields = "isin,category,category_normalized" if col_exists else "isin,category"
    while True:
        batch = client.table("investissement_funds") \
            .select(select_fields) \
            .not_.is_("category", "null") \
            .range(offset, offset + 999) \
            .execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds)} fonds avec category")

    to_update: list[dict] = []
    cat_dist: Counter = Counter()
    no_match = 0

    for f in all_funds:
        raw = f.get("category")
        norm = normalize_cat(raw)
        if norm and norm != f.get("category_normalized"):  # None != norm is True when col absent
            to_update.append({"isin": f["isin"], "category_normalized": norm})
            cat_dist[norm] += 1
        elif not norm:
            no_match += 1

    print(f"  {len(to_update)} à normaliser, {no_match} sans match\n")

    # Diagnostique : montrer les raw → norm insolites
    raw_to_norm: Counter = Counter()
    for f in all_funds[:]:
        raw = f.get("category")
        if raw:
            norm = normalize_cat(raw)
            raw_to_norm[(raw, norm or "?")] += 1

    print("  Distribution catégories normalisées :")
    for cat, n in cat_dist.most_common():
        print(f"    {n:5d}  {cat}")

    print("\n  Exemples de mapping :")
    for (raw, norm), n in sorted(raw_to_norm.items(), key=lambda x: -x[1])[:20]:
        print(f"    {n:3d}  {raw[:45]:<45} → {norm}")

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    if not col_exists:
        print("\n  ✗ Impossible d'appliquer : colonne category_normalized inexistante.")
        print("  Exécutez le SQL ci-dessus dans le Supabase SQL Editor d'abord.")
        return

    print("\n  Application en base (UPDATE par catégorie normalisée)...", flush=True)
    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    by_norm: dict[str, list[str]] = defaultdict(list)
    for r in to_update:
        by_norm[r["category_normalized"]].append(r["isin"])

    for norm, isins in by_norm.items():
        for i in range(0, len(isins), 400):
            sub = isins[i:i + 400]
            try:
                client.table("investissement_funds") \
                    .update({"category_normalized": norm, "updated_at": now_ts}) \
                    .in_("isin", sub) \
                    .execute()
                ok += len(sub)
            except Exception as e:
                fail += len(sub)
                print(f"  ✗ [{norm}]: {e}", flush=True)
        print(f"  {norm:30} → {len(isins):5d} OK", flush=True)

    print(f"\n  → {ok} fonds normalisés, {fail} erreurs")
    log_run("normalize-category", "success" if fail == 0 else "partial", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Normalise category → category_normalized (~20 labels stables)"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
