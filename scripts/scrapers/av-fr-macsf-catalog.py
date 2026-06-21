#!/usr/bin/env python3
"""
av-fr-macsf-catalog.py — Référencement MACSF (AV France)
=========================================================
Source : annexes financières PDF publiques MACSF (URLs stables
macsf.fr/content/download/…), une par contrat. Univers volontairement
restreint (~23 UC, gamme partagée entre les 3 contrats).

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, et
uniquement pour les ISIN déjà en base. Cf. _av_pdf_common.

Usage :
    python3 scripts/scrapers/av-fr-macsf-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-macsf-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "MACSF"

# Annexes financières publiques (en vigueur 2026). URLs stables, contenu mis à
# jour en place → re-fetch périodique (trimestriel) suffit.
CONTRACTS = [
    {"contract": "RES Multisupport",
     "pdf_url": "https://www.macsf.fr/content/download/8063/fichier/Annexe_Financiere_RES_MS_1610225_Z_compressed.pdf"},
    {"contract": "RES Retraite",
     "pdf_url": "https://www.macsf.fr/content/download/16985/fichier/MACSF_Annexe_Financiere_RES_RETRAITE_1610303R.pdf"},
    {"contract": "RES Capitalisation",
     "pdf_url": "https://www.macsf.fr/content/download/43913/fichier/MACSF_Annexe_financiere_RES_Capi_1610402E.pdf"},
]


def main():
    ap = argparse.ArgumentParser(description="MACSF AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-macsf-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
