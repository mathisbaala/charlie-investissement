#!/usr/bin/env python3
"""
reclassify-pe-funds.py — Reclassification des fonds PE (FCPI/FIP/FCPR/FPCI)
============================================================================
Corrige le product_type des fonds de capital-investissement actuellement
stockés comme 'opcvm' en leur type réel.

Types cibles :
  - FCPI  : Fonds Commun de Placement dans l'Innovation (réduction IR 25%)
  - FIP   : Fonds d'Investissement de Proximité (réduction IR 25%)
  - FCPR  : Fonds Commun de Placement à Risques
  - FPCI  : Fonds Professionnel de Capital Investissement (investisseurs pros)
  - FIVG  : Fonds d'Investissement en Venture Growth
  - FCPE  : Fonds Commun de Placement d'Entreprise (épargne salariale)

Méthode : détection par regex dans le nom du fonds.
Règles conservatrices pour minimiser les faux positifs.

Usage :
    python3 scripts/migrations/reclassify-pe-funds.py            # dry-run
    python3 scripts/migrations/reclassify-pe-funds.py --apply    # appliquer
"""

import re
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Règles de détection ──────────────────────────────────────────────────────
# Ordre d'application : du plus spécifique au plus général

RULES = [
    # FCPI — Fonds Commun de Placement dans l'Innovation
    (re.compile(r'\bFCPI\b', re.IGNORECASE), "fcpi"),
    # FPCI — Fonds Professionnel de Capital Investissement
    (re.compile(r'\bFPCI\b', re.IGNORECASE), "fpci"),
    # FCPR — Fonds Commun de Placement à Risques
    (re.compile(r'\bFCPR\b', re.IGNORECASE), "fcpr"),
    # FIP — Fonds d'Investissement de Proximité
    # Règle stricte : FIP suivi/précédé d'un espace ou d'une ponctuation (évite "GEFIP", "FIPL")
    (re.compile(r'(?<![A-Z])FIP(?![A-Z])', re.IGNORECASE), "fip"),
    # FIVG — Fonds d'Investissement en Venture Growth
    (re.compile(r'\bFIVG\b', re.IGNORECASE), "fivg"),
    # FCPE — épargne salariale
    (re.compile(r'\bFCPE\b', re.IGNORECASE), "fcpe"),
    # FPS — Fonds Professionnel Spécialisé (moins courant)
    (re.compile(r'\bFPS\b', re.IGNORECASE), "fps"),
]

# Mots-clés qui annulent la détection (faux positifs connus)
FALSE_POSITIVE_PATTERNS = [
    re.compile(r'GEFIP', re.IGNORECASE),
    re.compile(r'FIPL\b', re.IGNORECASE),
    re.compile(r'FILIPIN', re.IGNORECASE),
    re.compile(r'TIPIAK', re.IGNORECASE),
]


def classify_fund(name: str) -> str | None:
    """Retourne le product_type si le fonds est un PE, None sinon."""
    if not name:
        return None
    # Vérifier les faux positifs d'abord
    for fp_pat in FALSE_POSITIVE_PATTERNS:
        if fp_pat.search(name):
            return None
    # Appliquer les règles
    for pattern, ptype in RULES:
        if pattern.search(name):
            return ptype
    return None


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool):
    print("=" * 60)
    print("  Reclassification PE — FCPI/FIP/FCPR/FPCI/FIVG/FCPE")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    now_str = datetime.now(timezone.utc).isoformat()

    # Charger tous les fonds actuellement 'opcvm' avec leur nom
    # Supabase limite à 1000 lignes par requête
    print("  Chargement des fonds opcvm...")
    funds_to_check: list[dict] = []
    page_size = 1000
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name")
            .eq("product_type", "opcvm")
            .range(offset, offset + page_size - 1)
            .execute().data or []
        )
        funds_to_check.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    print(f"  {len(funds_to_check)} fonds opcvm analysés")
    print()

    # Classifier
    to_update: dict[str, list[str]] = {}  # product_type → [isin, ...]
    for fund in funds_to_check:
        isin = fund.get("isin", "")
        name = fund.get("name", "") or ""
        ptype = classify_fund(name)
        if ptype:
            to_update.setdefault(ptype, []).append(isin)

    # Résumé
    total = sum(len(v) for v in to_update.values())
    print(f"  {total} fonds reclassifiés :")
    for ptype, isins in sorted(to_update.items()):
        print(f"    {ptype:6} : {len(isins):4d} fonds")

    if not total:
        print("  → Rien à faire")
        return

    print()

    if not apply:
        # Aperçu
        print("  Aperçu (5 premiers par type) :")
        for ptype, isins in sorted(to_update.items()):
            print(f"    [{ptype}]")
            # Montrer les noms
            sample_isins = isins[:5]
            name_map = {f["isin"]: f["name"] for f in funds_to_check}
            for isin in sample_isins:
                print(f"      {isin} | {(name_map.get(isin) or '')[:55]}")
        return

    # Appliquer les mises à jour par batches
    ok = fail = 0
    BATCH = 100
    for ptype, isins in to_update.items():
        for i in range(0, len(isins), BATCH):
            batch_isins = isins[i:i + BATCH]
            try:
                client.table("investissement_funds") \
                    .update({"product_type": ptype, "updated_at": now_str}) \
                    .in_("isin", batch_isins) \
                    .execute()
                ok += len(batch_isins)
            except Exception as e:
                print(f"  ✗ Batch {ptype} offset {i}: {e}")
                fail += len(batch_isins)

        print(f"  ✓ {ptype:6} : {len(isins)} fonds mis à jour")

    print()
    print(f"  ✓ {ok} reclassifiés, {fail} erreurs")

    if apply:
        log_run("reclassify-pe-funds", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reclassification fonds PE")
    parser.add_argument("--apply", action="store_true", help="Appliquer en base")
    args = parser.parse_args()
    run(apply=args.apply)
