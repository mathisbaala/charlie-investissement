#!/usr/bin/env python3
"""
av-fr-asac-fapes-catalog.py — Référencement ASAC-FAPES (AV/PER France,
association d'épargnants fonctionnaires)
===========================================================================
Source : annexes financières / notices d'information PDF publiques
(asac-fapes.fr/media/…/download), une par contrat.

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, et
uniquement pour les ISIN déjà en base. Cf. _av_pdf_common.

Usage :
    python3 scripts/scrapers/av-fr-asac-fapes-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-asac-fapes-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "Asac Fapes"

CONTRACTS = [
    {"contract": "Asac Épargne Fidélité",
     "pdf_url": "https://www.asac-fapes.fr/media/847/download/Asac%20Epargne%20Fid%C3%A9lit%C3%A9%20NI-%20Annexe%20Support%20-%20conditions%20g%C3%A9n%C3%A9rales.pdf?v=1"},
    {"contract": "Asac-Fapes PER",
     "pdf_url": "https://www.asac-fapes.fr/media/1755/download/ASAC-FAPES_PER_9405_Annexefinanciere.pdf?v=3"},
    {"contract": "Solid'R Vie",
     "pdf_url": "https://www.asac-fapes.fr/media/468/download/NI%20Solid'R%20Vie..pdf?v=1"},
]


def main():
    ap = argparse.ArgumentParser(description="Asac Fapes AV/PER catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-asac-fapes-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
