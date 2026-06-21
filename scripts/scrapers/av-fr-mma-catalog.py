#!/usr/bin/env python3
"""
av-fr-mma-catalog.py — Référencement MMA Vie / groupe Covéa (AV France)
=======================================================================
Source : « Guide de présentation des supports » PDF public du contrat MMA
Multisupports, hébergé sur le sous-domaine documentaire cap.mma.fr.
Assureur : MMA Vie (groupe Covéa).

⚠️ Découverte 2026-06-21 : www.mma.fr est protégé par DataDome (403) MAIS le
sous-domaine d'hébergement de documents `cap.mma.fr` ne l'est pas — le guide des
supports y est servi en PDF direct (HTTP 200, ~109 pages). C'est ce que la
première version de la spec Tier 3 avait manqué (elle déclarait MMA « non
scriptable »). Complète MAAF (déjà câblé) et GMF pour couvrir tout Covéa.

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common).

Usage :
    python3 scripts/scrapers/av-fr-mma-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-mma-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "MMA Vie"

CONTRACTS = [
    {"contract": "MMA Multisupports",
     "pdf_url": "https://cap.mma.fr/files/live/sites/mmafr/files/documents-pdf/"
                "Priips/1-Agence-MMA-CAP/guidesupportsmmamultisupports"},
]


def main():
    ap = argparse.ArgumentParser(description="MMA Vie AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    # use_proxy : cap.mma.fr est un hôte assureur FR (parent www.mma.fr en DataDome)
    # → route via proxy résidentiel si AV_PROXY_URL posée (anti-blocage IP datacenter CI).
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-mma-catalog",
                    apply=args.apply, limit=args.limit, use_proxy=True)


if __name__ == "__main__":
    main()
