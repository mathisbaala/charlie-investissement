#!/usr/bin/env python3
"""
av-lux-afi-esca-catalog.py — Catalogue UC AFI ESCA Luxembourg (LPS France)
===========================================================================
AFI ESCA Luxembourg S.A. (groupe Burrus — ne pas confondre avec Afi-Esca S.A.
Strasbourg, entité FRANÇAISE déjà référencée sous « Afi Esca ») commercialise
en France en LPS les contrats Quality Life (vie) et Cap Quality (capitalisation).

La liste des supports France est publiée annuellement (obligation loi PACTE)
dans un PDF « Liste-QLCQ-FRANCE_Loi-PACTE_<année> » (~129 UC : ISIN, SRI, perf,
frais + rétrocessions). L'URL change chaque année → découverte dynamique en
parsant la page https://www.afi-esca.lu/infos-tarification-france/ (repli sur
l'édition 2026 connue si la page change).

Pipeline standard _av_pdf_common (curl_cffi + pdftotext + filtre « en base »).
QLCQ = Quality Life + Cap Quality : même liste de supports → une ligne
d'éligibilité par contrat.

Usage :
    python3 scripts/scrapers/av-lux-afi-esca-catalog.py            # dry-run
    python3 scripts/scrapers/av-lux-afi-esca-catalog.py --apply
"""

import re
import argparse

from _av_pdf_common import make_session, run_eligibility

# ⚠ contract_name DOIT différer de company_name (matview FILTER
#   contract_name <> company_name) — et « AFI ESCA Luxembourg » ≠ « Afi Esca »
#   (entité FR) : deux assureurs distincts dans la liste UI, c'est voulu.
COMPANY = "AFI ESCA Luxembourg"

DISCOVERY_URL = "https://www.afi-esca.lu/infos-tarification-france/"
FALLBACK_PDF  = "https://www.afi-esca.lu/wp-content/uploads/2026/04/Liste-QLCQ-FRANCE_Loi-PACTE_2026.pdf"

PDF_LINK_RE = re.compile(
    r'href="(https?://[^"]*Liste-QLCQ-FRANCE[^"]*\.pdf)"', re.IGNORECASE)


def discover_pdf_url() -> str:
    """URL du PDF loi PACTE courant depuis la page tarification France.

    L'édition change chaque année (…/2026/04/…_2026.pdf) ; en cas d'échec de la
    découverte on retombe sur la dernière URL connue (mieux qu'un run vide).
    """
    session = make_session()
    try:
        r = session.get(DISCOVERY_URL, timeout=45)
        if r.status_code == 200:
            m = PDF_LINK_RE.search(r.text or "")
            if m:
                return m.group(1)
        print(f"  ⚠ découverte PDF : HTTP {r.status_code} ou lien absent → repli édition connue")
    except Exception as e:
        print(f"  ⚠ découverte PDF : {str(e)[:60]} → repli édition connue")
    return FALLBACK_PDF


def main():
    ap = argparse.ArgumentParser(description="AFI ESCA Luxembourg — catalogue UC (éligibilité-only)")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    pdf_url = discover_pdf_url()
    print(f"  Liste loi PACTE : {pdf_url}")
    contracts = [
        {"contract": "Quality Life", "pdf_url": pdf_url, "source_url": DISCOVERY_URL},
        # suffixe « (capitalisation) » : sans lui le contrat serait typé `av`
        # (la détection de type matche `capitalisation|\mcapi` sur le NOM —
        # « Cap Quality » passe à travers, migration 20260611270000).
        {"contract": "Cap Quality (capitalisation)", "pdf_url": pdf_url, "source_url": DISCOVERY_URL},
    ]
    run_eligibility(COMPANY, contracts, scraper_name="av-lux-afi-esca-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
