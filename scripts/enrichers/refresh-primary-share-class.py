#!/usr/bin/env python3
"""
refresh-primary-share-class.py — Rafraîchit le représentant share-class
=======================================================================
Recalcule `investissement_funds.is_primary_share_class` : dans chaque groupe
de share-classes (même share_class_group_id), un unique représentant est marqué
true — un frère screener-éligible en priorité (data_completeness >= 50 et pas
action/crypto/fps), puis le plus gros encours, puis l'ISIN.

Cette colonne porte la DÉDUP share-class de /api/funds côté base : la route
filtre is_primary_share_class = true, donc OFFSET/LIMIT et count: "exact"
portent directement sur les fonds uniques (pagination + total exacts).

Les encours (aum_eur) et l'appartenance aux groupes évoluant lors des pipelines
d'enrichissement, on relance ce refresh À LA FIN des runs hebdo/mensuel. La
logique vit dans la fonction SQL inv_refresh_primary_share_class() (idempotente,
ne touche que les lignes qui changent → peu de bloat).

Usage :
    python3 scripts/enrichers/refresh-primary-share-class.py [--apply]

Sans --apply : ne fait rien (cohérent avec la convention des autres étapes ;
le calcul est de toute façon un simple UPDATE, il n'y a pas de dry-run partiel).
"""

import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="exécute le refresh (sinon no-op)")
    args = ap.parse_args()

    if not args.apply:
        print("  (dry-run) refresh is_primary_share_class non exécuté — relancer avec --apply")
        return 0

    client = get_client()
    res = client.rpc("inv_refresh_primary_share_class").execute()
    changed = res.data if isinstance(res.data, int) else res.data
    print(f"  ✓ is_primary_share_class rafraîchi — {changed} ligne(s) modifiée(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
