#!/usr/bin/env python3
"""
av-fr-abeille-catalog.py — Référencement Abeille Assurances (ex-Aviva France)
==============================================================================
Source : page « Annexe financière » d'Abeille Assurances, qui liste un PDF
d'annexe financière par contrat (gammes Lucya Abeille, Abeille Épargne/
Capitalisation Active, Afer, Retraite Plurielle…). Assureur : Abeille Vie.

Découverte dynamique : on lit la page index et on récupère chaque lien
/abdoc/<code>_ANNEXE_FINANCIERE (redirige vers le PDF). Le nom du contrat est
dans l'attribut title du lien (« Lucya Abeille - Annexe… »).

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common).

Usage :
    python3 scripts/scrapers/av-fr-abeille-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-abeille-catalog.py --apply
"""
import re
import html as ihtml
import argparse

from _av_pdf_common import run_eligibility, make_session

COMPANY = "Abeille Vie"
INDEX_URL = ("https://www.abeille-assurances.fr/particulier/epargne/"
             "assurance-vie-retraite/annexe-financiere.html")
# <a href="…/abdoc/C87_ANNEXE_FINANCIERE" … title="Lucya Abeille - Annexe…">
LINK_RE = re.compile(
    r'<a[^>]+href="(https://www\.abeille-assurances\.fr/abdoc/([A-Z0-9]+)_ANNEXE_FINANCIERE)"'
    r'[^>]*?title="([^"]*?)"',
    re.I,
)


def discover(session) -> list[dict]:
    r = session.get(INDEX_URL, timeout=45)
    if r.status_code != 200:
        print(f"  ⚠ index HTTP {r.status_code}")
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for url, code, title in LINK_RE.findall(r.text):
        if code in seen:
            continue
        seen.add(code)
        # title « Lucya Abeille - Annexe financière » → « Lucya Abeille »
        name = ihtml.unescape(title).split(" - ")[0].strip() or f"Contrat Abeille {code}"
        out.append({"contract": name, "pdf_url": url, "source_url": INDEX_URL})
    return out


def main():
    ap = argparse.ArgumentParser(description="Abeille Assurances AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    # use_proxy : Abeille sert une page anti-bot (200 vide) aux IP datacenter
    # (vérifié 21/06) → découverte ET fetch via proxy résidentiel si AV_PROXY_URL posée.
    session = make_session(use_proxy=True)
    contracts = discover(session)
    print(f"  Contrats Abeille découverts : {len(contracts)}")
    run_eligibility(COMPANY, contracts, scraper_name="av-fr-abeille-catalog",
                    apply=args.apply, limit=args.limit, use_proxy=True)


if __name__ == "__main__":
    main()
