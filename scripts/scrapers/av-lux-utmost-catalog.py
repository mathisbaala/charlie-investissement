#!/usr/bin/env python3
"""
av-lux-utmost-catalog.py — Catalogue UC Utmost Luxembourg S.A. (ex-Lombard Int'l)
================================================================================
Utmost Luxembourg publie mensuellement le PDF de ses UC externes pour le contrat
"Liberté" (code 2626) :
  https://www.utmostwealthdocs.com/mb/D2UfYL   (short-link stable d'un mois à l'autre)

⚠️ Simplifié 2026-06-21 (était au backlog « rend 0 par intermittence ») :
  - Passe par le socle commun `_av_pdf_common.run_eligibility` (curl_cffi +
    pdftotext + dédup), comme les scrapers av-fr-*.
  - ÉLIGIBILITÉ-ONLY : on n'extrait QUE les ISIN (regex robuste) et on n'écrit que
    le lien (isin, contrat) dans investissement_av_lux_eligibility, filtré sur les
    ISIN déjà en base. L'ancienne version faisait un parsing de nom/SRI/TER/perf
    PAR POSITION de colonne (`line[20:40]`, offsets « SRI+36 »…) puis un
    upsert_funds_bulk — fragile (d'où les « 0 intermittents » au moindre décalage
    de layout) ET non conforme (écrasait des fonds). Supprimé : l'extraction par
    ISIN ne dépend plus de la mise en page.

Usage :
    python3 scripts/scrapers/av-lux-utmost-catalog.py            # dry-run
    python3 scripts/scrapers/av-lux-utmost-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "Utmost Luxembourg S.A."

CONTRACTS = [
    {"contract": "Utmost Liberté Luxembourg",
     "pdf_url": "https://www.utmostwealthdocs.com/mb/D2UfYL"},
]


def main():
    ap = argparse.ArgumentParser(description="Utmost Luxembourg AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-lux-utmost-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
