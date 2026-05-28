#!/usr/bin/env python3
"""
normalize-region.py — Inférer region_normalized depuis name / category / category_normalized
=============================================================================================
Les ~23 000 fonds sans région sont enrichis par regex sur le nom du fonds,
puis la catégorie brute, puis la catégorie normalisée (priorité décroissante).

Valeurs légitimes : world, europe, usa, france, emerging, japan, china,
                    asia, switzerland, india, uk, germany

Usage :
    python3 scripts/migrations/normalize-region.py
    python3 scripts/migrations/normalize-region.py --apply
"""

import sys
import re
import argparse
from datetime import datetime, timezone
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# Ordre = priorité, premier match gagne
REGION_PATTERNS: list[tuple[str, str]] = [
    # Monde
    (r"world|global|intern(ation)?|monde|mondial|universel|all.countr|cross.border", "world"),
    # USA / Amérique du Nord  — \bUS\b seul trop ambigu (OPTIMUS, AUTOFOCUS...) → exiger contexte
    (r"\busa\b|u\.s\.a?\.?|united.states?|amérique.nord|north.ameri"
     r"|s&p.?500|nasdaq|dow.jones|\brussell\b|\bnyse\b"
     r"|etats.unis|états.unis|américain|american|améric", "usa"),
    # France — avant Europe pour que CAC 40 → france (CAC est l'indice parisien)
    # FCPI/FIP = instruments d'investissement obligatoirement français par la loi
    # ACTION [company] seul = FCPE mono-action pour société française cotée (hors indicateurs géo)
    (r"franc(e|ais|aise)|\bparis\b|cac.?40|pme.*france|france.*pme|sma.france"
     r"|\bFCPI\b|\bFIP\b|\bFIP\s*\d|\bproximité\b"
     r"|^action\s+(?!mond|europ|ameri|usa\b|etats|japan|japon|asie|émerg|intern|global|world)", "france"),
    # Europe
    (r"europ|euro.zone|zone.euro|euroland|stoxx|eurostoxx"
     r"|ftse.europ|\bcac\b|\bmib\b|\bibex\b|\baex\b|euronext|\beu\b", "europe"),
    # Japon
    (r"\bjapon\b|\bjapan\b|nikkei|topix|\btokyo\b", "japan"),
    # Chine
    (r"chin(e|a|ois)|hong.kong|shanghai|shenzhen|hang.seng|\bcsi\b", "china"),
    # Inde  — \bNSE\b seul dangereux (AUXENSE...) → exiger contexte
    (r"\bindia\b|\binde\b|\bindien\b|\bindienne\b|nifty|\bsensex\b|\bbse\b", "india"),
    # Asie / Pacifique
    (r"\basie\b|\basia\b|asiatiq|pacif|asean|\bcorée\b|\bkorea\b|taiwan|australi|singapur|singapore", "asia"),
    # Émergents
    (r"emerg(ent|ing)|\bbric\b|latine|latin|\bbrés|brazil|\brussie\b|\brussia\b"
     r"|\bafrique\b|\bafri[ck]|\bturquie\b|turkey|mexique|mexico|pays.en.dév", "emerging"),
    # UK
    (r"royaume.uni|united.kingdom|\buk\b|\bgbp\b|\blondon\b|\bftse\b|sterling|british", "uk"),
    # Allemagne
    (r"allemagne|germany|deutsch|\bdax\b", "germany"),
    # Suisse
    (r"suisse|switzerland|\bswiss\b|\bzurich\b|\bchf\b", "switzerland"),
]

_COMPILED = [(re.compile(p, re.I | re.UNICODE), region) for p, region in REGION_PATTERNS]


def infer_region(name: str | None, category: str | None, category_normalized: str | None) -> str | None:
    """Tente d'inférer la région depuis name → category → category_normalized."""
    for field in (name, category, category_normalized):
        if not field:
            continue
        for pat, region in _COMPILED:
            if pat.search(field):
                return region
    return None


def run(apply: bool) -> None:
    print("=" * 68)
    print("  Normalize Region → 12 labels stables")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Vérifier que la colonne region_normalized existe
    col_exists = True
    try:
        client.table("investissement_funds").select("region_normalized").limit(1).execute()
    except Exception as e:
        if "42703" in str(e) or "does not exist" in str(e):
            col_exists = False
            print("  La colonne region_normalized n'existe pas encore.")
            print("  Exécutez ce SQL dans le Supabase SQL Editor :")
            print("    ALTER TABLE investissement_funds ADD COLUMN IF NOT EXISTS region_normalized text;")
            print()

    # Charger les fonds sans région
    all_funds: list[dict] = []
    offset = 0
    print("  Chargement des fonds avec region_normalized IS NULL...", flush=True)
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin,name,category,category_normalized")
            .is_("region_normalized", "null")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
        print(f"    {len(all_funds)} chargés...", flush=True)

    print(f"  {len(all_funds)} fonds sans region_normalized\n")

    to_update: list[dict] = []
    region_dist: Counter = Counter()
    no_match = 0

    for f in all_funds:
        region = infer_region(
            f.get("name"),
            f.get("category"),
            f.get("category_normalized"),
        )
        if region:
            to_update.append({"isin": f["isin"], "region_normalized": region})
            region_dist[region] += 1
        else:
            no_match += 1

    print(f"  {len(to_update)} à enrichir, {no_match} sans match (restent NULL)\n")

    print("  Distribution régions inférées :")
    for region, n in region_dist.most_common():
        bar = "#" * (n // 50)
        print(f"    {region:15}  {n:6d}  {bar}")

    # Exemples de mapping pour diagnostic
    print("\n  Exemples de mapping (name → région) :")
    shown = 0
    for f in all_funds:
        if shown >= 20:
            break
        region = infer_region(f.get("name"), f.get("category"), f.get("category_normalized"))
        if region:
            name_trunc = (f.get("name") or "")[:50]
            print(f"    {name_trunc:<50} → {region}")
            shown += 1

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    if not col_exists:
        print("\n  Impossible d'appliquer : colonne region_normalized inexistante.")
        print("  Exécutez le SQL ci-dessus dans le Supabase SQL Editor d'abord.")
        return

    print("\n  Application en base (UPDATE par région, lots de 400)...", flush=True)
    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    by_region: dict[str, list[str]] = defaultdict(list)
    for r in to_update:
        by_region[r["region_normalized"]].append(r["isin"])

    for region, isins in sorted(by_region.items(), key=lambda x: -len(x[1])):
        for i in range(0, len(isins), 400):
            sub = isins[i : i + 400]
            try:
                client.table("investissement_funds") \
                    .update({"region_normalized": region, "updated_at": now_ts}) \
                    .in_("isin", sub) \
                    .execute()
                ok += len(sub)
            except Exception as e:
                fail += len(sub)
                print(f"  [{region}] ERREUR lot {i//400}: {e}", flush=True)
        print(f"  {region:15} → {len(isins):6d} OK", flush=True)

    # Calculer le nouveau taux de couverture
    print("\n  Calcul du nouveau taux de couverture...", flush=True)
    try:
        total_res = client.table("investissement_funds").select("isin", count="exact").execute()
        total = total_res.count or 0
        covered_res = (
            client.table("investissement_funds")
            .select("isin", count="exact")
            .not_.is_("region_normalized", "null")
            .execute()
        )
        covered = covered_res.count or 0
        pct = 100 * covered / total if total > 0 else 0
        print(f"\n  Couverture region_normalized : {covered}/{total} fonds ({pct:.1f}%)")
    except Exception as e:
        print(f"  (Impossible de calculer le taux : {e})")

    print(f"\n  → {ok} fonds enrichis, {fail} erreurs")
    log_run("normalize-region", "success" if fail == 0 else "partial", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Normalise region_normalized par regex sur name/category (12 valeurs)"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
