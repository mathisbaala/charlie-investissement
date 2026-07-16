#!/usr/bin/env python3
"""
av-fr-monceau-catalog.py — Référencement Monceau Assurances (AV France)
==========================================================================
Source : annexes financières PDF publiques (monceauassurances.com/wp-content),
une par contrat — « Présentation des supports d'investissement » (Monceau
Épargne) et conditions générales valant notice d'information (Monceau
Multifonds, qui contient sa liste de supports en annexe interne).

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, et
uniquement pour les ISIN déjà en base. Cf. _av_pdf_common.

Usage :
    python3 scripts/scrapers/av-fr-monceau-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-monceau-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "Monceau Assurances"

CONTRACTS = [
    {"contract": "Monceau Épargne",
     "pdf_url": "https://www.monceauassurances.com/wp-content/uploads/2026/04/Presentation-des-supports-dinvestissement-ME.pdf"},
    {"contract": "Monceau Multifonds",
     "pdf_url": "https://www.monceauassurances.com/wp-content/uploads/2024/10/CG-Monceau-Multifonds.pdf"},
]


def main():
    ap = argparse.ArgumentParser(description="Monceau Assurances AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-monceau-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
