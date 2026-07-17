#!/usr/bin/env python3
"""
pea-selections-catalog.py — Sélections PEA en SSR : Yomoni, Caisse d'Épargne,
Banque Populaire
==============================================================================
Trois pages publiques rendues côté serveur (repérage 2026-07-17), un simple
GET + regex ISIN suffit :
  - Yomoni : /legal/supports-investissement (~200 ISIN tous mandats — on ne
    retient que la page entière : les supports du mandat PEA y figurent, dont
    Yomoni Monde PEA FR0014002RL1 et les ETF synthétiques PEA) ;
  - Caisse d'Épargne : /epargner/selection-de-fonds-pea/ (~46 ISIN, sélection
    officielle curée — pas l'univers négociable complet) ;
  - Banque Populaire : /epargner/selection-fonds-pea/ (~46 ISIN, idem).

ÉLIGIBILITÉ-ONLY via _pea_common ; un contrat par enseigne.

Usage :
    python3 scripts/scrapers/pea-selections-catalog.py            # dry-run
    python3 scripts/scrapers/pea-selections-catalog.py --apply
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _av_pdf_common import make_session, _valid_isin  # noqa: E402
from _pea_common import write_pea_contracts  # noqa: E402

ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
TIMEOUT = 45

# (company, contract, url) — 1 page SSR = 1 contrat.
SOURCES = [
    ("Yomoni", "PEA Yomoni",
     "https://www.yomoni.fr/legal/supports-investissement"),
    ("Caisse d'Épargne", "Sélection fonds PEA Caisse d'Épargne",
     "https://www.caisse-epargne.fr/epargner/selection-de-fonds-pea/"),
    ("Banque Populaire", "Sélection fonds PEA Banque Populaire",
     "https://www.banquepopulaire.fr/epargner/selection-fonds-pea/"),
]


def fetch_isins(session, url: str) -> list[str]:
    try:
        r = session.get(url, timeout=TIMEOUT)
    except Exception as e:
        print(f"  ⚠ {url[:60]} : {str(e)[:60]}")
        return []
    if r.status_code != 200:
        print(f"  ⚠ HTTP {r.status_code} sur {url[:60]}")
        return []
    return sorted({x for x in ISIN_RE.findall(r.text or "") if _valid_isin(x)})


def main():
    ap = argparse.ArgumentParser(description="Sélections PEA SSR (Yomoni/CE/BP) — éligibilité-only")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = ap.parse_args()
    started = datetime.now(timezone.utc)

    print("=" * 64)
    print("  Sélections PEA SSR — Yomoni, Caisse d'Épargne, Banque Populaire")
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    session = make_session()
    # Un write par company (le socle écrit une company à la fois).
    for company, contract, url in SOURCES:
        isins = fetch_isins(session, url)
        print(f"  {company[:24]:24} {contract[:38]:38} {len(isins):4} ISIN")
        write_pea_contracts(company, [(contract, isins, url)],
                            scraper_name="pea-selections-catalog",
                            apply=args.apply, started=started)
        time.sleep(1.0)


if __name__ == "__main__":
    main()
