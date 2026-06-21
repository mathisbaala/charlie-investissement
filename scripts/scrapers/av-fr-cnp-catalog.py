#!/usr/bin/env python3
"""
av-fr-cnp-catalog.py — Référencement CNP Assurances (AV France)
================================================================
Source : annexes / listes de supports PDF publiques, toutes assurées par
CNP Assurances (groupe La Banque Postale) :
  • PDF officiels CNP « tableaux de performances des supports » (gamme Nuances,
    cnp.fr/content/download/…) ;
  • listes de supports des contrats distribués & assurés par CNP : Lucya CNP
    (assurancevie.com) et EasyVie (EasyBourse).

Un seul assureur (« CNP Assurances ») ; le contrat distingue les gammes.

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common) : n'écrit que dans
investissement_av_lux_eligibility, et uniquement pour les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-fr-cnp-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-cnp-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "CNP Assurances"

DL = "https://www.cnp.fr/cnp/content/download"
CONTRACTS = [
    # ── Contrats distribués & assurés par CNP (les plus riches) ──────────────
    {"contract": "Lucya CNP",
     "pdf_url": "https://lucya.com/app/uploads/2026/04/liste-supports-lucya-cnp.pdf"},
    {"contract": "EasyVie",
     "pdf_url": "https://documents.easybourse.com/supports-eligibles-easyvie-assurance-vie.pdf"},
    # ── Gamme Nuances (PDF officiels CNP « tableaux de performances ») ────────
    {"contract": "Nuances Privilège",
     "pdf_url": f"{DL}/6213/file/Tableaux-complets_Nuances-Privilege.pdf"},
    {"contract": "Nuances Plus",
     "pdf_url": f"{DL}/6211/file/Tableau-complet_Nuances-Plus.pdf"},
    {"contract": "Nuances Capi",
     "pdf_url": f"{DL}/6209/file/Tableau-complet_Nuances-Capi.pdf"},
    {"contract": "Nuances 3D",
     "pdf_url": f"{DL}/6208/file/Tableau-complet_Nuances-3D.pdf"},
    {"contract": "Nuances Grenadine",
     "pdf_url": f"{DL}/6210/file/Tableau-complet_Nuances-Grenadine.pdf"},
]


def main():
    ap = argparse.ArgumentParser(description="CNP Assurances AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-cnp-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
