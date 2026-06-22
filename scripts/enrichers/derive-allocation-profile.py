#!/usr/bin/env python3
"""
derive-allocation-profile.py — Profil d'allocation depuis la composition réelle
================================================================================
Appelle le RPC `inv_fill_allocation_profile_from_composition()` qui dérive
allocation_profile (prudent/equilibre/dynamique) des fonds DIVERSIFIÉS à partir
de la part actions vs oblig/cash de leurs holdings (`asset_type`).

FILL-ONLY strict : ne remplit que les allocation_profile NULL — n'écrase JAMAIS
un mandat déclaré (nom/catégorie) ni un « flexible ». Idempotent.

Pourquoi un script dédié : le nom/la catégorie plafonnent l'heuristique à ~9 %
(la majorité des diversifiés n'exposent leur profil dans aucun champ). La
composition est le seul signal fiable supplémentaire, et il GRANDIT à mesure que
le drain look-through ajoute des holdings typés → ce script est branché en fin de
`holdings-drain-auto.yml` (quotidien) pour re-dériver après chaque tranche drainée.

Lançable à la main :  python3 scripts/enrichers/derive-allocation-profile.py
Cadence réelle : étape finale du workflow `holdings-drain-auto.yml`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client


def main() -> None:
    client = get_client()
    res = client.rpc("inv_fill_allocation_profile_from_composition").execute()
    n = res.data if res.data is not None else 0
    print(f"✓ allocation_profile dérivé de la composition : {n} diversifiés remplis")


if __name__ == "__main__":
    main()
