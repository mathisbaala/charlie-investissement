#!/usr/bin/env python3
"""
refresh-insurer-mv.py — Rafraîchit la matview de référencement assureur
=======================================================================
Recalcule `investissement_fund_insurers_mv` : pour chaque fonds, l'union des
assureurs / contrats (clé `Assureur::Contrat`) qui le référencent, PROPAGÉE à
toutes les share-classes de son groupe (la MV n'est lue que sur la primaire,
cf. migration 20260611200000). Alimente les colonnes `insurers[]`/`contracts[]`
de la vue investissement_funds_cgp_ref → filtres screener `insurer`/`contracts`.

À relancer :
  • après un scraper d'éligibilité (nouvelles lignes av_lux_eligibility) ;
  • à LA FIN des pipelines hebdo/mensuel, car ils recalculent
    is_primary_share_class / data_completeness dont dépend la propagation.

La logique vit dans le RPC SQL inv_refresh_fund_insurers_mv() (REFRESH simple ;
pour un refresh non bloquant ponctuel, lancer manuellement
`REFRESH MATERIALIZED VIEW CONCURRENTLY investissement_fund_insurers_mv;`).

Usage :
    python3 scripts/enrichers/refresh-insurer-mv.py [--apply]

Sans --apply : no-op (convention des autres étapes de pipeline).
"""

import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import refresh_fund_insurers_mv


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="exécute le refresh (sinon no-op)")
    args = ap.parse_args()

    if not args.apply:
        print("  (dry-run) refresh matview référencement non exécuté — relancer avec --apply")
        return 0

    ok = refresh_fund_insurers_mv()
    if ok:
        print("  ✓ matview investissement_fund_insurers_mv rafraîchie")
        return 0
    print("  ⚠️  refresh matview référencement en échec")
    return 1


if __name__ == "__main__":
    sys.exit(main())
