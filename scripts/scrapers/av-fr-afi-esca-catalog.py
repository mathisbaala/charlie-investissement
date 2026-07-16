#!/usr/bin/env python3
"""
av-fr-afi-esca-catalog.py — Référencement AFI ESCA (AV France)
==================================================================
Source : « Liste des supports éligibles aux contrats multisupports » PDF
publique, publiée mensuellement (afi-esca.com/wp-content/uploads/…), pour le
contrat Sélection Premium. URL versionnée par mois (millésime MMYY, ex 1225 =
décembre 2025) — re-vérifier sur le site si une source renvoie 0 ISIN (nouveau
millésime publié).

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, et
uniquement pour les ISIN déjà en base. Cf. _av_pdf_common.

Usage :
    python3 scripts/scrapers/av-fr-afi-esca-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-afi-esca-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "Afi Esca"

# Millésime le plus récent vérifié le 15/07/2026.
CONTRACTS = [
    {"contract": "Sélection Premium",
     "pdf_url": "https://www.afi-esca.com/wp-content/uploads/2025/12/LISTE-SUPPORTS_1225.pdf"},
]


def main():
    ap = argparse.ArgumentParser(description="Afi Esca AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-afi-esca-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
