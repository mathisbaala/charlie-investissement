#!/usr/bin/env python3
"""
av-fr-gmf-catalog.py — Référencement GMF Vie / groupe Covéa (AV France)
=======================================================================
Source : « Guide de présentation des supports » PDF du contrat GMF Multéo
(série 2). Assureur : GMF Vie (groupe Covéa). Complète MAAF et MMA (déjà
câblés) pour couvrir l'ensemble du groupe Covéa.

⚠️ CAVEAT SOURCE : gmf.fr est entièrement verrouillé par DataDome (403 sur tout
chemin) et aucun sous-domaine documentaire ouvert n'a été trouvé (≠ MMA, qui a
cap.mma.fr). La seule source PDF scriptable est un MIROIR tiers (courtier
cleerly.fr), daté de 2022 → il peut se périmer. L'orchestrateur étant non-fatal,
un 404 futur ne casse pas le job ; il faudra alors re-sonder une URL GMF de
première main. À ce stade le miroir reste valide (HTTP 200, ISIN Luhn-valides).
Note : GMF « Compte Libre Croissance » est monosupport (sans UC) — seul Multéo
porte des unités de compte.

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common).

Usage :
    python3 scripts/scrapers/av-fr-gmf-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-gmf-catalog.py --apply
"""
import argparse

from _av_pdf_common import run_eligibility

COMPANY = "GMF Vie"

CONTRACTS = [
    {"contract": "Multéo",
     "pdf_url": "https://cleerly.fr/wp-content/uploads/2022/09/"
                "Supports-assurance-vie-Multeo-GMF.pdf"},
]


def main():
    ap = argparse.ArgumentParser(description="GMF Vie AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    run_eligibility(COMPANY, CONTRACTS, scraper_name="av-fr-gmf-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
