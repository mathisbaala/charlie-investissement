#!/usr/bin/env python3
"""
normalize-asset-class.py — Dériver asset_class pour tous les fonds
====================================================================
Seuls ~1 046 / 35 988 fonds ont asset_class. Ce script le dérive pour
les fonds manquants à partir de product_type (règle directe) et du champ
category ou du nom (OPCVM/ETF via Morningstar).

Valeurs cibles (enum stable pour le screener) :
  actions | obligations | monetaire | immobilier | multi-actifs |
  euro_garanti | private_equity | infrastructure | crypto | alternatif |
  matieres_premieres

Usage :
    python3 scripts/migrations/normalize-asset-class.py
    python3 scripts/migrations/normalize-asset-class.py --apply
"""

import sys
import re
import argparse
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Règles par product_type (priorité maximale) ──────────────────────────────

TYPE_DIRECT: dict[str, str] = {
    "action":       "actions",
    "fonds_euros":  "euro_garanti",
    "scpi":         "immobilier",
    "crypto":       "crypto",
    "livret":       "monetaire",
    "obligation":   "obligations",
}

# ─── Mapping catégorie → asset_class ─────────────────────────────────────────
# Couvre les catégories AMF (français) + Morningstar EMEA (anglais)

CAT_MAP: list[tuple[str, str]] = [
    # Monétaire
    (r"monet|money market|tréso|tresor|cash|fonds monétaire|vnav", "monetaire"),
    # Obligations
    (r"obligat|bond|fixed.income|titre.de.créance|titres.de.cr|haut.rendement|high.yield"
     r"|revenu.fixe|crédit|credit|dette|debt|convertib", "obligations"),
    # Immobilier
    (r"immobil|immobi|foncier|reit|real estate|pierre|scpi|opci", "immobilier"),
    # Private equity / capital-risque
    (r"private.equity|capital.risque|fcpr|fip\b|fpci|fonds.commun.à.risques"
     r"|capital.investissement|venture|growth.equity|secondar|mezzanine", "private_equity"),
    # Infrastructure
    (r"infrastructure|infrastruc", "infrastructure"),
    # Alternatif / performance absolue
    (r"absolue|absolute.return|long.short|market.neutral|hedge|arbitrage"
     r"|structured.note|formule|garantie|protégé|performance abs", "alternatif"),
    # Matières premières
    (r"matière.première|commodity|commodi|gold|or\b|energie|energie|sectori.*énergi", "matieres_premieres"),
    # Multi-actifs / allocation
    (r"mixte|allocation|flexible|diversifié|diversifie|multi.asset|balanced|équilibré|equilbré"
     r"|prudent|modéré|dinamique|dynamic|global", "multi-actifs"),
    # Actions (large catch-all pour equity)
    (r"action|equity|stock|share|acti[o]n|sectori|growth|value|small.cap|large.cap"
     r"|emergent|emerging|world|monde|europe|etats.uni|usa\b|japan|asia|asie|pacif", "actions"),
]

_CAT_COMPILED = [(re.compile(p, re.I), ac) for p, ac in CAT_MAP]

# ─── Mapping depuis le nom (fallback si pas de catégorie) ─────────────────────

NAME_MAP: list[tuple[str, str]] = [
    (r"\bmonet\b|tréso|tresor|liquidit", "monetaire"),
    (r"\boblig|\bbond\b|fixed.income|haut.rendement|high.yield|dette\b|credit\b|crédit\b", "obligations"),
    (r"\bimmob|\bfoncier\b|\bscpi\b|\bopci\b|real.estate|\bpierre\b", "immobilier"),
    (r"private.equity|capital.risque|\bfcpr\b|\bfip\b|mezzanine|secondar", "private_equity"),
    (r"infrastruct", "infrastructure"),
    (r"absolute.return|performance.absol|long.short|market.neutral|formule", "alternatif"),
    (r"\bor\b|gold\b|commodity|matière.première|energy\b|energie\b", "matieres_premieres"),
    (r"mixte|allocation|flexible|diversi|multi.asset|balanced|équilibré|equilbré|global.alloc", "multi-actifs"),
    (r"\baction\b|\bactions\b|\bequity\b|\bequities\b|\bstock\b|small.cap|large.cap"
     r"|émergent|emerging|europe|monde|world|japan|asie|pacif|sectori", "actions"),
]

_NAME_COMPILED = [(re.compile(p, re.I), ac) for p, ac in NAME_MAP]


def infer_from_category(cat: str | None) -> str | None:
    if not cat:
        return None
    for pat, ac in _CAT_COMPILED:
        if pat.search(cat):
            return ac
    return None


def infer_from_name(name: str | None) -> str | None:
    if not name:
        return None
    for pat, ac in _NAME_COMPILED:
        if pat.search(name):
            return ac
    return None


def infer_asset_class(fund: dict) -> str | None:
    ptype = fund.get("product_type", "")
    # 1. Règle directe par type
    if ptype in TYPE_DIRECT:
        return TYPE_DIRECT[ptype]
    # FPS/FPCI : utiliser la catégorie existante ou dériver du nom
    # OPCVM/ETF : utiliser la catégorie Morningstar, sinon le nom
    ac = infer_from_category(fund.get("category"))
    if ac:
        return ac
    ac = infer_from_name(fund.get("name"))
    if ac:
        return ac
    # Fallback produit
    if ptype in ("fps", "fpci", "fcpr"):
        return "private_equity"
    if ptype in ("opcvm",):
        return "multi-actifs"  # valeur par défaut la plus neutre pour un fonds sans info
    return None


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, types: list[str] | None = None) -> None:
    print("=" * 68)
    print("  Normalize Asset Class — dérivation pour tous les fonds")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Charger tous les fonds sans asset_class
    all_funds: list[dict] = []
    offset = 0
    q_types = types or ["opcvm", "etf", "fps", "fpci", "fcpr", "action",
                        "fonds_euros", "scpi", "crypto", "livret", "obligation"]
    while True:
        q = client.table("investissement_funds") \
            .select("isin,name,product_type,category,asset_class") \
            .in_("product_type", q_types) \
            .is_("asset_class", "null") \
            .range(offset, offset + 999)
        batch = q.execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds)} fonds sans asset_class")

    to_update: list[dict] = []
    ac_dist: Counter = Counter()
    no_match = 0

    for f in all_funds:
        ac = infer_asset_class(f)
        if ac:
            to_update.append({"isin": f["isin"], "asset_class": ac})
            ac_dist[ac] += 1
        else:
            no_match += 1

    print(f"  {len(to_update)} fonds à enrichir, {no_match} sans correspondance\n")
    print("  Distribution :")
    for ac, n in ac_dist.most_common():
        print(f"    {n:6d}  {ac}")

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    print("\n  Application en base (UPDATE par asset_class)...", flush=True)
    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    # Grouper par valeur → un UPDATE IN(...) par asset_class
    from collections import defaultdict
    by_ac: dict[str, list[str]] = defaultdict(list)
    for r in to_update:
        by_ac[r["asset_class"]].append(r["isin"])

    for ac, isins in by_ac.items():
        for i in range(0, len(isins), 400):
            sub = isins[i:i + 400]
            try:
                client.table("investissement_funds") \
                    .update({"asset_class": ac, "updated_at": now_ts}) \
                    .in_("isin", sub) \
                    .execute()
                ok += len(sub)
            except Exception as e:
                fail += len(sub)
                print(f"  ✗ [{ac}]: {e}", flush=True)
        print(f"  {ac:20} → {len(isins):5d} fonds OK", flush=True)

    print(f"\n  → {ok} fonds enrichis, {fail} erreurs")
    log_run("normalize-asset-class", "success" if fail == 0 else "partial", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Dérive asset_class depuis product_type + category + name"
    )
    parser.add_argument("--apply",  action="store_true", help="Écrire en base")
    parser.add_argument("--types",  nargs="+",           help="Types de produits à traiter (défaut: tous)")
    args = parser.parse_args()
    run(apply=args.apply, types=args.types)
