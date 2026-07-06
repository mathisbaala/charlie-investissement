#!/usr/bin/env python3
"""
derive-geography.py — Dériver region_normalized depuis nom/catégorie
=====================================================================
Champ `region_normalized` (existant) : zone géographique principale.
Valeurs déjà présentes : usa | world | europe | emerging | china | asia | brazil

Valeurs cibles (alignées sur l'existant, English lowercase) :
  france | europe | eurozone | usa | japan | asia | emerging | world | others

S'appuie sur :
  1. category (Morningstar ou AMF, souvent explicit)
  2. name (patterns courants : "France", "Euro", "US", "Japan", etc.)

Usage :
    python3 scripts/migrations/derive-geography.py
    python3 scripts/migrations/derive-geography.py --apply
"""

import sys
import re
import argparse
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Mapping catégorie → géographie ──────────────────────────────────────────

CAT_MAP: list[tuple[str, str]] = [
    # Très spécifiques en premier (aligner sur valeurs existantes en base)
    (r"françai|france|french|cac|sfef|france\b", "france"),
    (r"zone euro|eurozone|euro.bond|euro.action|de la zone euro|euro\s+corp|euro\s+gov", "eurozone"),
    (r"états.uni|usa\b|u\.s\.\b|united.states|s&p|nasdaq|russell|dow.jones|north.america|amérique.du.nord", "usa"),
    (r"japon|japan(ese)?|nikkei|topix", "japan"),
    (r"chine|china|chinese|hong.kong|hang.seng", "china"),
    (r"asie.pacif|asie ex|asia ex|asia pac|pacific rim|asean|corée|taiwan|australi", "asia"),
    (r"emergent|emerging market|pays.émergent|marchés.émergent|bric|brésil|inde|russie", "emerging"),
    (r"\bafriqu|\bmoyen.orient|\bafrique.du|MENA\b", "emerging"),
    (r"amérique.latine|latin.americ|brésil", "emerging"),
    (r"\beurope\b|européen|european|stoxx|ftse.100|dax\b|btp\b|gilt|bund|oat\b|bel20", "europe"),
    (r"\bmonde\b|\bworld\b|\bglobal\b|\binternational\b|global.bond|international.bond"
     r"|monde.divers|world.alloc", "world"),
]

_CAT_COMPILED = [(re.compile(p, re.I), geo) for p, geo in CAT_MAP]

NAME_MAP: list[tuple[str, str]] = [
    (r"france\b|français|franci|\bfr\b.*actions|cac[_ ]40|sfef", "france"),
    (r"eurozone|euro.zone|zone euro", "eurozone"),
    (r"\busa\b|\bus\b|\bu\.s\b|états.unis|america\b|s&p|nasdaq|russell", "usa"),
    (r"japan|japon|nikkei|topix|\bjp\b", "japan"),
    (r"china|chine|hang.seng|shanghai", "china"),
    (r"asia|asie|pac.rim|asean|korea|taiwan|hong.kong|india", "asia"),
    (r"emerg|émergent|\bbric\b|latin|afric|moyen.orient|brazil", "emerging"),
    (r"\beurope\b|european|europ[eé]|stoxx|dax\b|ftse|bund\b|btp\b", "europe"),
    (r"\beuro\b|eurozon|zone.euro|europ.*oblig", "eurozone"),
    (r"\bmonde\b|\bworld\b|\bglobal\b|\binternational\b", "world"),
]

_NAME_COMPILED = [(re.compile(p, re.I), geo) for p, geo in NAME_MAP]

# Product types pour lesquels la géographie a du sens
GEO_TYPES = {"opcvm", "etf", "action", "obligation"}

# Classes d'actifs SANS géographie réelle : la trésorerie (monétaire, fonds euros)
# n'a aucune exposition géographique. Sans ce garde-fou, un nom comme « GLOBAL
# LIQUIDITY », « MONEY MARKET » ou « La Mondiale » matche global/mondial → 'world'
# et pollue les recherches « Monde »/« Europe » avec du cash (cf. Lyxor Euro
# Overnight remonté n°1 sur « fond monde peu risqué »).
NON_GEO_ASSET_CLASSES = {"monetaire", "fonds_euros"}


def infer_geography(fund: dict) -> str | None:
    ptype = fund.get("product_type", "")
    if ptype not in GEO_TYPES:
        return None
    if (fund.get("asset_class_broad") or "") in NON_GEO_ASSET_CLASSES:
        return None

    cat  = fund.get("category") or ""
    name = fund.get("name") or ""

    for pat, geo in _CAT_COMPILED:
        if pat.search(cat):
            return geo

    for pat, geo in _NAME_COMPILED:
        if pat.search(name):
            return geo

    # Actions sans info géo : probablement monde
    if ptype == "action":
        return "world"

    return None


def run(apply: bool) -> None:
    print("=" * 68)
    print("  Derive Geography — zone géographique des fonds")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Charger tous les fonds des types concernés (sans geography déjà set)
    # NB : si la colonne geography n'existe pas encore → créer via ALTER TABLE
    all_funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,name,product_type,category,asset_class_broad,region_normalized") \
            .in_("product_type", list(GEO_TYPES)) \
            .is_("region_normalized", "null") \
            .range(offset, offset + 999) \
            .execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds)} fonds sans geography")

    to_update: list[dict] = []
    geo_dist: Counter = Counter()
    no_match = 0

    for f in all_funds:
        geo = infer_geography(f)
        if geo:
            to_update.append({"isin": f["isin"], "region_normalized": geo})
            geo_dist[geo] += 1
        else:
            no_match += 1

    print(f"  {len(to_update)} à enrichir, {no_match} sans match\n")
    print("  Distribution :")
    for geo, n in geo_dist.most_common():
        print(f"    {n:6d}  {geo}")

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    print("\n  Application en base (UPDATE par région)...", flush=True)
    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    from collections import defaultdict
    by_geo: dict[str, list[str]] = defaultdict(list)
    for r in to_update:
        by_geo[r["region_normalized"]].append(r["isin"])

    for geo, isins in by_geo.items():
        for i in range(0, len(isins), 400):
            sub = isins[i:i + 400]
            try:
                client.table("investissement_funds") \
                    .update({"region_normalized": geo, "updated_at": now_ts}) \
                    .in_("isin", sub) \
                    .execute()
                ok += len(sub)
            except Exception as e:
                fail += len(sub)
                print(f"  ✗ [{geo}]: {e}", flush=True)
        print(f"  {geo:15} → {len(isins):5d} fonds OK", flush=True)

    print(f"\n  → {ok} fonds enrichis, {fail} erreurs")
    log_run("derive-region-normalized", "success" if fail == 0 else "partial", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Dérive la géographie d'investissement depuis catégorie + nom"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
