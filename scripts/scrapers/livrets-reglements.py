#!/usr/bin/env python3
"""
livrets-reglements.py — Livrets réglementés français (données statiques)
========================================================================
Insère les livrets réglementés français dans investissement_funds.
Ces produits n'ont pas d'ISIN : on utilise des identifiants synthétiques.

Supports couverts (source : Banque de France + légifrance.gouv.fr) :
  - Livret A         : taux 3.0%  (au 02/2024), SRRI=1, plafond 22 950 €
  - LDDS             : taux 3.0%  (même taux que Livret A), plafond 12 000 €
  - LEP              : taux 4.0%  (Livret Épargne Populaire, revenus modestes), plafond 10 000 €
  - Livret Jeune     : taux ≥3.0% (établi par chaque banque), plafond 1 600 €
  - PEL              : taux 2.25% (PEL ouvert depuis 01/01/2024), plafond 61 200 €
  - CEL              : taux 2.0%  (Compte Épargne Logement), plafond 15 300 €
  - Livret Entreprise: taux variable (EONIA ou équivalent) — non inclus

Ces données sont révisées périodiquement (Banque de France).
Dernière mise à jour des taux : mai 2026.

Usage :
    python3 scripts/scrapers/livrets-reglements.py [--apply]
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Données statiques — mai 2026 ─────────────────────────────────────────────
# taux_annuel en % (ex: 3.0 = 3.0% par an)
# Plafond de dépôt en euros (hors intérêts capitalisés)

LIVRETS = [
    {
        "isin":               "FR_LIVRET_A",
        "name":               "Livret A",
        "product_type":       "livret",
        "asset_class":        "monetaire",
        "currency":           "EUR",
        "srri":               1,
        "sri":                1,
        "ongoing_charges":    0.0,
        "ter":                0.0,
        "performance_1y":     3.0,    # taux annuel en %
        "performance_3y":     None,   # variable selon les révisions passées
        "performance_5y":     None,
        "aum_eur":            650_000_000_000,   # ~650 Mds€ d'encours total (Banque de France)
        "sfdr_article":       None,
        "management_company": "Banque de France",
        "data_source":        "statique-banque-de-france",
        "distributor_france": True,
        "pea_eligible":       False,
    },
    {
        "isin":               "FR_LDDS",
        "name":               "LDDS (Livret de Développement Durable et Solidaire)",
        "product_type":       "livret",
        "asset_class":        "monetaire",
        "currency":           "EUR",
        "srri":               1,
        "sri":                1,
        "ongoing_charges":    0.0,
        "ter":                0.0,
        "performance_1y":     3.0,
        "aum_eur":            140_000_000_000,   # ~140 Mds€
        "sfdr_article":       None,
        "management_company": "Banque de France",
        "data_source":        "statique-banque-de-france",
        "distributor_france": True,
        "pea_eligible":       False,
    },
    {
        "isin":               "FR_LEP",
        "name":               "LEP (Livret d'Épargne Populaire)",
        "product_type":       "livret",
        "asset_class":        "monetaire",
        "currency":           "EUR",
        "srri":               1,
        "sri":                1,
        "ongoing_charges":    0.0,
        "ter":                0.0,
        "performance_1y":     4.0,    # taux LEP supérieur au Livret A
        "aum_eur":            80_000_000_000,    # ~80 Mds€
        "sfdr_article":       None,
        "management_company": "Banque de France",
        "data_source":        "statique-banque-de-france",
        "distributor_france": True,
        "pea_eligible":       False,
    },
    {
        "isin":               "FR_LIVRET_JEUNE",
        "name":               "Livret Jeune",
        "product_type":       "livret",
        "asset_class":        "monetaire",
        "currency":           "EUR",
        "srri":               1,
        "sri":                1,
        "ongoing_charges":    0.0,
        "ter":                0.0,
        "performance_1y":     3.0,    # minimum légal (certaines banques servent plus)
        "aum_eur":            None,
        "sfdr_article":       None,
        "management_company": "Banque de France",
        "data_source":        "statique-banque-de-france",
        "distributor_france": True,
        "pea_eligible":       False,
    },
    {
        "isin":               "FR_PEL",
        "name":               "PEL (Plan d'Épargne Logement)",
        "product_type":       "livret",
        "asset_class":        "monetaire",
        "currency":           "EUR",
        "srri":               1,
        "sri":                1,
        "ongoing_charges":    0.0,
        "ter":                0.0,
        "performance_1y":     2.25,   # taux PEL ouvert depuis 01/01/2024
        "aum_eur":            300_000_000_000,   # ~300 Mds€ (encours total PEL)
        "sfdr_article":       None,
        "management_company": "Banque de France",
        "data_source":        "statique-banque-de-france",
        "distributor_france": True,
        "pea_eligible":       False,
    },
    {
        "isin":               "FR_CEL",
        "name":               "CEL (Compte Épargne Logement)",
        "product_type":       "livret",
        "asset_class":        "monetaire",
        "currency":           "EUR",
        "srri":               1,
        "sri":                1,
        "ongoing_charges":    0.0,
        "ter":                0.0,
        "performance_1y":     2.0,
        "aum_eur":            None,
        "sfdr_attribute":     None,
        "management_company": "Banque de France",
        "data_source":        "statique-banque-de-france",
        "distributor_france": True,
        "pea_eligible":       False,
    },
    {
        "isin":               "FR_LIVRET_B",
        "name":               "Livret B (Livret d'Épargne Ordinaire)",
        "product_type":       "livret",
        "asset_class":        "monetaire",
        "currency":           "EUR",
        "srri":               1,
        "sri":                1,
        "ongoing_charges":    0.0,
        "ter":                0.0,
        "performance_1y":     2.0,    # taux moyen marché (varie selon les banques, ~EONIA+)
        "aum_eur":            None,
        "sfdr_article":       None,
        "management_company": None,   # chaque banque fixe son taux
        "data_source":        "statique-banque-de-france",
        "distributor_france": True,
        "pea_eligible":       False,
    },
]


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool):
    print("=" * 60)
    print("  Livrets Réglementés — Données statiques Banque de France")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  {len(LIVRETS)} livrets à insérer")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    now_str = datetime.now(timezone.utc).isoformat()

    ok = fail = 0
    for livret in LIVRETS:
        isin = livret["isin"]
        name = livret["name"]
        rate = livret.get("performance_1y", 0)

        print(f"  {'→' if apply else '~'} {isin:25} | {name[:45]:45} | taux={rate:.2f}%")

        if apply:
            record = {k: v for k, v in livret.items() if v is not None}
            record["updated_at"] = now_str

            try:
                # Upsert direct (ces ISINs ne sont pas des vrais ISIN → on fait un upsert manuel)
                existing = client.table("investissement_funds").select("isin").eq("isin", isin).execute()
                if existing.data:
                    client.table("investissement_funds").update(record).eq("isin", isin).execute()
                else:
                    record["created_at"] = now_str
                    client.table("investissement_funds").insert(record).execute()
                ok += 1
            except Exception as e:
                print(f"    ✗ DB error: {e}")
                fail += 1

    print()
    if apply:
        print(f"  ✓ {ok} livrets insérés/mis à jour, {fail} erreurs")
        log_run("livrets-reglements", "success", ok, fail, started_at=started)
    else:
        print(f"  Dry-run : {len(LIVRETS)} livrets prêts à insérer")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Livrets réglementés français")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = parser.parse_args()
    run(apply=args.apply)
