#!/usr/bin/env python3
"""
derive-region-from-geos.py — region_normalized depuis la ventilation géo
=========================================================================
Rien n'alimentait `region_normalized` (filtre région du screener) à partir de
`investissement_fund_geos` (pourtant ~40% des OPCVM/ETF y ont une ventilation
pays/région). Ce script agrège les poids par grande zone et pose la région
DOMINANTE — sinon `world` pour un fonds réellement diversifié.

Vocabulaire cible aligné sur l'existant : world / europe / usa / france /
emerging / japan / asia / china / uk / germany / switzerland / india / eurozone.

Précision d'abord : on ne pose une zone SPÉCIFIQUE que si elle domine nettement
(≥ 60 %, ou ≥ 45 % pour un pays unique) ; à défaut de dominante = `world`.

Fill-only strict (n'écrit que si region_normalized est NULL).

Usage :
    python3 scripts/enrichers/derive-region-from-geos.py            # dry-run
    python3 scripts/enrichers/derive-region-from-geos.py --apply
"""

import sys, argparse
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, safe_fill_funds

# country_label (minuscule) → grande zone du vocabulaire region_normalized.
def bucket(label: str) -> str | None:
    l = (label or "").strip().lower()
    if not l:
        return None
    # pays / zones spécifiques
    if l == "france": return "france"
    if l == "germany": return "germany"
    if l == "switzerland": return "switzerland"
    if l == "japan": return "japan"
    if l == "india": return "india"
    if l == "china" or l == "china a shares" or l == "hong kong": return "china"
    if l == "united kingdom": return "uk"
    if l in ("united states", "north america", "canada", "americas"): return "usa"
    if l in ("brazil",): return "emerging"
    # Europe (zone euro + europe développée + pays européens)
    if l in ("europe developed", "greater europe", "eurozone", "europe - ex euro",
             "netherlands", "italy", "belgium", "spain", "finland", "austria",
             "sweden", "portugal", "denmark", "norway", "ireland", "luxembourg",
             "poland", "greece", "european union"):
        return "europe"
    # Asie développée
    if l in ("developed asia", "greater asia", "australasia"):
        return "asia"
    # Émergents
    if l in ("emerging asia", "emerging europe", "middle east", "latin america",
             "africa", "emerging markets", "emerging market"):
        return "emerging"
    return "other"


SPECIFIC = {"france", "germany", "switzerland", "japan", "india", "china", "uk", "usa"}


def decide(weights: dict[str, float]) -> str | None:
    total = sum(weights.values())
    if total <= 0:
        return None
    # ignore le résidu non-mappé ("other"/"cash") pour la dominance
    scored = {k: v / total for k, v in weights.items() if k not in ("other",)}
    if not scored:
        return None
    top, w = max(scored.items(), key=lambda kv: kv[1])
    if w >= 0.60:
        return top
    if w >= 0.45 and top in SPECIFIC:
        return top
    # pas de dominante nette → diversifié
    return "world"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    client = get_client()

    print("  Fonds primaires OPCVM/ETF/action sans region_normalized…")
    targets: list[str] = []
    off = 0
    while True:
        q = (client.table("investissement_funds")
             .select("isin")
             .is_("region_normalized", "null")
             .eq("is_primary_share_class", True)
             .in_("product_type", ["opcvm", "etf", "action"])
             .range(off, off + 999).execute())
        b = q.data or []
        targets.extend(r["isin"] for r in b)
        if len(b) < 1000:
            break
        off += 1000
    print(f"  {len(targets)} cibles")

    # charge les ventilations géo par lots
    geo: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for i in range(0, len(targets), 300):
        chunk = targets[i:i + 300]
        rows = (client.table("investissement_fund_geos")
                .select("isin,country_label,weight")
                .in_("isin", chunk).execute().data or [])
        for r in rows:
            bk = bucket(r.get("country_label"))
            if bk:
                geo[r["isin"]][bk] += float(r.get("weight") or 0)

    records = []
    dist = defaultdict(int)
    for isin in targets:
        if isin not in geo:
            continue
        region = decide(geo[isin])
        if region:
            records.append({"isin": isin, "region_normalized": region})
            dist[region] += 1
    if args.limit:
        records = records[: args.limit]

    print(f"  {len(records)} régions déduites :")
    for k, n in sorted(dist.items(), key=lambda kv: -kv[1]):
        print(f"    {k:12} : {n}")

    if not args.apply:
        print("  DRY-RUN — rien écrit.")
        return
    stats = safe_fill_funds(records, source="geo-dominant")
    print(f"  → {stats['rows_updated']} mis à jour, {stats['fields_filled']} champs, {stats['failed']} échecs")


if __name__ == "__main__":
    main()
