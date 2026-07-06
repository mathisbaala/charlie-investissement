#!/usr/bin/env python3
"""
av-fr-generali-catalog.py — Référencement Generali Vie (AV France)
==================================================================
Generali Vie (France) était très sous-capté : seuls les contrats distribués
par des courtiers (meilleurtaux Allocation Vie, MonFinancier Vie via opcvm360)
remontaient, alors que ses gros contrats multisupports directs (Himalia,
e-Xaélidia…) pèsent chacun > 1 400 UC.

Source : annexes financières / listes des supports d'investissement PDF, toutes
assurées par Generali Vie :
  • Himalia — annexe financière (liste des UC), la plus riche (~1 750 UC) ;
  • e-Xaélidia — liste des supports (generali.fr, source officielle).

Un seul assureur (« Generali Vie ») ; le contrat distingue les gammes. Les
contrats Luxembourg (Espace Lux Vie, univers global) restent gérés par
av-lux-generali-catalog.py sous « Generali Luxembourg ».

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common) : n'écrit que dans
investissement_av_lux_eligibility, et uniquement pour les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-fr-generali-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-generali-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "Generali Vie"

CONTRACTS = [
    # Himalia — annexe financière (liste des UC). Source distributeur BourseDirect
    # (PDF texte officiel Generali, le plus complet ~1 750 UC).
    {"contract": "Himalia",
     "pdf_url": "https://epargne.boursedirect.fr/uploads/files/products_fin/"
                "e1cf9a0d9a50ca064d2078bab00ec586/Liste%20des%20UC.pdf"},
    # e-Xaélidia — liste des supports (source officielle generali.fr).
    {"contract": "e-Xaélidia",
     "pdf_url": "https://www.generali.fr/sites/default/files-d8/2025-11/"
                "e-Xaelidia-PEP.pdf"},
]


def main():
    ap = argparse.ArgumentParser(description="Generali Vie AV France catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-generali-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
