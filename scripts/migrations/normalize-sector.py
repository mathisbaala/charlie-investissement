#!/usr/bin/env python3
"""
normalize-sector.py — Normaliser et inférer le secteur (~12 labels stables)
============================================================================
Deux passes :
  1. Normaliser les valeurs existantes (EN/FR mixte → FR uniforme)
  2. Inférer le secteur pour les fonds avec sector=NULL à partir du nom

~12 secteurs normalisés :
  Technologie | Santé | Finance | Énergie | Immobilier | Industrie |
  Consommation | Matériaux | Communication | Environnement | Infrastructure |
  Utilities | Autres Sectoriels

Usage :
    python3 scripts/migrations/normalize-sector.py
    python3 scripts/migrations/normalize-sector.py --apply
    python3 scripts/migrations/normalize-sector.py --apply --infer-only
    python3 scripts/migrations/normalize-sector.py --apply --normalize-only
"""

import sys
import re
import argparse
from datetime import datetime, timezone
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Mapping normalisation valeurs existantes → label FR ──────────────────────
NORMALIZE_MAP: dict[str, str] = {
    # Technologie
    "technology": "Technologie",
    "technologie": "Technologie",
    "tech": "Technologie",
    "information technology": "Technologie",
    # Santé
    "sante": "Santé",
    "santé": "Santé",
    "health care": "Santé",
    "healthcare": "Santé",
    "health": "Santé",
    "pharma": "Santé",
    "pharmaceutique": "Santé",
    # Finance
    "finance": "Finance",
    "financials": "Finance",
    "financial services": "Finance",
    "banque": "Finance",
    # Énergie
    "energie": "Énergie",
    "énergie": "Énergie",
    "energy": "Énergie",
    # Immobilier
    "immobilier": "Immobilier",
    "real estate": "Immobilier",
    "realestate": "Immobilier",
    "foncier": "Immobilier",
    # Industrie
    "industrie": "Industrie",
    "industrials": "Industrie",
    "industrial": "Industrie",
    # Consommation
    "consommation": "Consommation",
    "consumer discretionary": "Consommation",
    "consumer staples": "Consommation",
    "consumer": "Consommation",
    # Matériaux
    "materiaux": "Matériaux",
    "matériaux": "Matériaux",
    "materials": "Matériaux",
    "material": "Matériaux",
    # Communication
    "communication services": "Communication",
    "communication": "Communication",
    "telecom": "Communication",
    "télécommunication": "Communication",
    # Environnement
    "environnement": "Environnement",
    "climat": "Environnement",
    "climate": "Environnement",
    "green": "Environnement",
    # Utilities
    "utilities": "Utilities",
    "utility": "Utilities",
    # Infrastructure
    "infrastructure": "Infrastructure",
}

# ─── Règles d'inférence depuis le nom du fonds ────────────────────────────────
# Ordre : premier match gagne
INFER_RULES: list[tuple[str, str]] = [
    # Technologie
    (r"technolog|digital|cyber|software|semicond|chip|ai\b|artificial.intel|cloud|data.center"
     r"|fintech|biotech|internet|e-commerce|numériqu", "Technologie"),
    # Santé
    (r"santé|health|pharma|medical|biotech|medtech|oncolog|genomic|biosc"
     r"|médicament|hôpital|diagnostic|life.scienc|well.?being", "Santé"),
    # Finance
    (r"\bbanque\b|\bbank\b|\bfinancial\b|\bfinance\b|\binsurance\b|\bassurance\b"
     r"|financi.*sector|\bcapital.*market|\bfintech\b", "Finance"),
    # Énergie
    (r"\bénergie\b|\benergy\b|\bpetrol\b|\bpétrole\b|\boil\b|\bgas\b|\brenouvelab\b"
     r"|renewable|\bclean.energ|\bnucléaire\b|\belectric.*power", "Énergie"),
    # Immobilier
    (r"\bimmobil\b|\breal.estate\b|\breit\b|\bscpi\b|\bopci\b|\bfoncier\b|\bproperty\b"
     r"|pierre|habitat|\blocal commercial", "Immobilier"),
    # Environnement / Climat
    (r"environn|climat|climate|clean.*tech|impact.*vert|transition.*écolog"
     r"|esg.*sector|eau\b|\bwater\b|eau.et|agriculture|agri\b|\bfood\b"
     r"|reforestat|biodiversit", "Environnement"),
    # Infrastructure
    (r"infrastruct|transport|logistique|logistics|mobility|port\b|\baéroport"
     r"|\bchemin.de.fer|\brail\b|\bfibr", "Infrastructure"),
    # Industrie
    (r"\bindustri\b|\bindustrie\b|\bmanufactur\b|\bingénier\b|\baéronaut\b"
     r"|\bdefense\b|\bdéfense\b|\bmachinery\b|\brobotiq\b|\bautomat\b"
     r"|\baérospatial\b|\badvanced.manuf", "Industrie"),
    # Consommation
    (r"consomm|consumer|luxe\b|\bluxury\b|\bloisir\b|\bsport\b|\btourism"
     r"|\bvoyage\b|\bhôtell|\brestaurant|\balimentation|\bbeauté\b", "Consommation"),
    # Matériaux
    (r"matériau|material|minier|mining|métal|metals?\b|gold\b|or\b.*matiè"
     r"|chimique|chemical|acier|steel|copper|lithium", "Matériaux"),
    # Communication
    (r"télécom|telecom|communic.*service|media\b|entertainment|gaming\b"
     r"|contenu.numérique", "Communication"),
    # Utilities
    (r"\butilities\b|\bélectricité\b|\belectricity\b|\bwater.*utility"
     r"|\bgaz.*distrib\b", "Utilities"),
]

_COMPILED = [(re.compile(p, re.I), cat) for p, cat in INFER_RULES]


def normalize_existing(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower()
    return NORMALIZE_MAP.get(key)


def infer_from_name(name: str | None) -> str | None:
    if not name:
        return None
    for pat, sector in _COMPILED:
        if pat.search(name):
            return sector
    return None


def run(apply: bool, infer_only: bool, normalize_only: bool) -> None:
    print("=" * 68)
    print("  Normalize & Infer Sector → ~12 labels stables")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'} | infer_only={infer_only} | normalize_only={normalize_only}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    to_normalize: list[dict] = []
    to_infer: list[dict] = []
    sector_dist: Counter = Counter()

    # ── Passe 1 : normaliser valeurs existantes ────────────────────────────────
    if not infer_only:
        print("  Passe 1 : normalisation des valeurs existantes...", flush=True)
        offset = 0
        while True:
            batch = client.table("investissement_funds") \
                .select("isin,sector") \
                .not_.is_("sector", "null") \
                .range(offset, offset + 999) \
                .execute().data or []
            for f in batch:
                norm = normalize_existing(f.get("sector"))
                if norm and norm != f.get("sector"):
                    to_normalize.append({"isin": f["isin"], "sector": norm})
            if len(batch) < 1000:
                break
            offset += 1000

        print(f"  → {len(to_normalize)} valeurs à normaliser")

    # ── Passe 2 : inférence depuis le nom ──────────────────────────────────────
    if not normalize_only:
        print("  Passe 2 : inférence secteur depuis nom du fonds...", flush=True)
        offset = 0
        while True:
            batch = client.table("investissement_funds") \
                .select("isin,name,category_normalized") \
                .is_("sector", "null") \
                .range(offset, offset + 999) \
                .execute().data or []
            for f in batch:
                inferred = infer_from_name(f.get("name"))
                if inferred:
                    to_infer.append({"isin": f["isin"], "sector": inferred})
                    sector_dist[inferred] += 1
            if len(batch) < 1000:
                break
            offset += 1000

        print(f"  → {len(to_infer)} secteurs inférés depuis nom")
        print("\n  Distribution secteurs inférés :")
        for s, n in sector_dist.most_common():
            print(f"    {n:5d}  {s}")

    # ── Application ────────────────────────────────────────────────────────────
    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    all_updates = to_normalize + to_infer

    by_sector: dict[str, list[str]] = defaultdict(list)
    for r in all_updates:
        by_sector[r["sector"]].append(r["isin"])

    print("\n  Application en base...", flush=True)
    for sector, isins in by_sector.items():
        for i in range(0, len(isins), 400):
            sub = isins[i:i + 400]
            try:
                client.table("investissement_funds") \
                    .update({"sector": sector, "updated_at": now_ts}) \
                    .in_("isin", sub) \
                    .execute()
                ok += len(sub)
            except Exception as e:
                fail += len(sub)
                print(f"  ✗ [{sector}]: {e}", flush=True)
        print(f"  {sector:30} → {len(isins):5d} OK", flush=True)

    print(f"\n  → {ok} fonds mis à jour, {fail} erreurs")
    log_run("normalize-sector", "success" if fail == 0 else "partial", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Normalise et infère le secteur (~12 labels stables)"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    parser.add_argument("--infer-only", action="store_true", help="Inférer seulement (pas normaliser)")
    parser.add_argument("--normalize-only", action="store_true", help="Normaliser seulement (pas inférer)")
    args = parser.parse_args()
    run(apply=args.apply, infer_only=args.infer_only, normalize_only=args.normalize_only)
