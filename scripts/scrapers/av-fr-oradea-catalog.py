#!/usr/bin/env python3
"""
av-fr-oradea-catalog.py — Référencement Oradéa Vie (AV France, groupe SG)
=========================================================================
⚠️ RESSUSCITÉ 2026-07-16. L'ancien portail priips.oradea-vie.com est mort
(NXDOMAIN, retiré du job le 13/07) mais la source a en fait DÉMÉNAGÉ sur
l'infra PRIIPS de la maison mère Sogécap (repérée via la CSP frame-ancestors
du portail Sogécap) :
  https://priips.sogecap.com/priips/oradea.html
Même format (arbre HTML statique, <li … cdproduit=… cdisine="<ISIN>">) et
GRANULARITÉ PAR CONTRAT désormais (8 produits, ~1 144 ISIN distincts au
16/07 : Oradéa Multisupport, Multisupport Excellence, Capitalisation ±
variantes, Épargne Handicap) — l'ancienne version n'avait qu'un agrégat
« Oradéa Vie (gamme courtage) » (lignes purgées lors du backfill per-contrat).

Le parsing est partagé avec av-fr-sogecap-catalog.py (même portail, chargé via
importlib car le nom de module contient des tirets).

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-fr-oradea-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-oradea-catalog.py --apply
"""

import argparse
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "av_fr_sogecap_catalog", Path(__file__).parent / "av-fr-sogecap-catalog.py")
_sogecap = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sogecap)

PORTAL_URL = "https://priips.sogecap.com/priips/oradea.html"
COMPANY    = "Oradéa Vie"


def main():
    ap = argparse.ArgumentParser(description="Oradéa Vie — catalogue UC (éligibilité-only)")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()
    _sogecap.run(apply=args.apply, limit=args.limit, portal_url=PORTAL_URL,
                 company=COMPANY, scraper_name="av-fr-oradea-catalog")


if __name__ == "__main__":
    main()
