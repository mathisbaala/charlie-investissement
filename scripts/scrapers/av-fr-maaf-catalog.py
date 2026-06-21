#!/usr/bin/env python3
"""
av-fr-maaf-catalog.py — Référencement MAAF Vie / groupe Covéa (AV France)
==========================================================================
Source : notices d'information PDF publiques MAAF (maaf.fr/fr/files/…), dont
l'annexe « Liste des supports en unités de compte ». Assureur : MAAF Vie
(groupe Covéa).

Périmètre Covéa : MAAF (Winalto), MMA (Multisupports, cf. av-fr-mma-catalog) et
GMF (Multéo, cf. av-fr-gmf-catalog) sont tous câblés depuis le 21/06 (annexe PDF).

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common).

Usage :
    python3 scripts/scrapers/av-fr-maaf-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-maaf-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "MAAF Vie"

BASE = "https://www.maaf.fr/fr/files/live/sites/maaf/files/DOCUMENTS/Epargne/CG"
CONTRACTS = [
    {"contract": "Winalto",
     "pdf_url": f"{BASE}/5133_notice_information_winalto.pdf"},
    {"contract": "PER Winalto Retraite",
     "pdf_url": f"{BASE}/5177_Notice_Information_PER_Winalto_Retraite.pdf"},
    {"contract": "Winalto Pro",
     "pdf_url": f"{BASE}/MAAF_notice_d_information_assurance_epargne_winalto_pro_5152.pdf"},
]


def main():
    ap = argparse.ArgumentParser(description="MAAF Vie AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    # use_proxy : maaf.fr drope les IP datacenter (timeout en CI, vérifié 21/06)
    # → route via proxy résidentiel si AV_PROXY_URL posée.
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-maaf-catalog",
                    apply=args.apply, limit=args.limit, use_proxy=True)


if __name__ == "__main__":
    main()
