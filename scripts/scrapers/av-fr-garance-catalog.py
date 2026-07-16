#!/usr/bin/env python3
"""
av-fr-garance-catalog.py — Référencement Garance (AV/PER France, mutuelle)
===========================================================================
Source : tableaux annuels « frais et performances des supports en unité de
compte », publiés par contrat sur la page documentation officielle
(garance.com/documentation-produits-et-publications-en-matiere-de-durabilite).
URLs stables (préfixe /app/uploads/<année-publication>/<mois>/), millésime
« -2025 » = dernier exercice clos disponible mi-2026 ; re-vérifier l'URL sur
la page documentation si une source renvoie 0 ISIN (nouveau millésime publié).

Garance commercialise une dizaine de contrats (Caprele, PER Salva, Pero,
Omega…) ; on couvre ici les 5 contrats phares (épargne + retraite grand
public). Les autres suivent le même gabarit d'URL si besoin d'extension.

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, et
uniquement pour les ISIN déjà en base. Cf. _av_pdf_common.

Usage :
    python3 scripts/scrapers/av-fr-garance-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-garance-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "Garance"

# Tableaux 2025 (dernier exercice clos), vérifiés le 15/07/2026.
CONTRACTS = [
    {"contract": "Garance Épargne",
     "pdf_url": "https://www.garance.com/app/uploads/2026/02/GARANCE-EPARGNE-_Tableau-des-frais-et-performances-des-supports-en-unite-de-compte-2025.pdf"},
    {"contract": "Garance Vivacité",
     "pdf_url": "https://www.garance.com/app/uploads/2026/02/GARANCE-VIVACITE_Tableau-des-frais-et-performances-des-supports-en-unite-de-compte-2025.pdf"},
    {"contract": "Activ' Retraite",
     "pdf_url": "https://www.garance.com/app/uploads/2026/02/ACTIV-RETRAITE_Tableau-des-frais-et-performances-des-supports-en-unite-de-compte-2025.pdf"},
    {"contract": "Celebea Vie",
     "pdf_url": "https://www.garance.com/app/uploads/2026/02/CELEBEA-VIE_Tableau-des-frais-et-performances-des-supports-en-unite-de-compte-2025.pdf"},
    {"contract": "Celebea Retraite",
     "pdf_url": "https://www.garance.com/app/uploads/2026/02/CELEBEA-RETRAITE_Tableau-des-frais-et-performances-des-supports-en-unite-de-compte-2025.pdf"},
]


def main():
    ap = argparse.ArgumentParser(description="Garance AV/PER catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-garance-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
