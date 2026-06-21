#!/usr/bin/env python3
"""
av-fr-acm-catalog.py — Référencement ACM Vie / Crédit Mutuel (AV France)
=========================================================================
Source : hub réglementaire ACM (acm.fr), qui liste une page par contrat
« Informations précontractuelles … supports en unités de compte » (L.522-5).
Chaque page pointe plusieurs millésimes de PDF ; on prend le plus récent.
Assureur : ACM Vie SA (assure aussi les contrats distribués par CIC).

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common).

Usage :
    python3 scripts/scrapers/av-fr-acm-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-acm-catalog.py --apply
"""
import re
import html as ihtml
import argparse
from urllib.parse import urljoin, quote

from parsel import Selector

from _av_pdf_common import run_eligibility, make_session

COMPANY = "ACM Vie"
BASE = "https://www.acm.fr"
HUB = (f"{BASE}/fr/informations-reglementaires/"
       "informations-reglementaires-assurance-vie-capitalisation-retraite.html")
PAGE_RE = re.compile(r'href="([^"]*precontractuelles[^"]*\.html)"', re.I)
PDF_RE = re.compile(r'href="([^"]+\.pdf)"', re.I)
DATE_RE = re.compile(r"(\d{2})[-.](20\d{2})")  # MM-YYYY dans le nom de fichier


def _date_key(url: str) -> tuple[int, int]:
    """Clé de tri (année, mois) du PDF le plus récent ; (0,0) si introuvable."""
    best = (0, 0)
    for mm, yyyy in DATE_RE.findall(url):
        best = max(best, (int(yyyy), int(mm)))
    return best


def _contract_name(page_html: str, page_url: str) -> str:
    sel = Selector(page_html)
    title = (sel.css("title::text").get() or "").strip()
    m = re.search(r"contrat\s+(.+?)\s*[|]", title, re.I)
    if m:
        return ihtml.unescape(m.group(1)).strip()
    # repli : slug d'URL « …-du-contrat-plan-assurance-vie.html »
    slug = re.search(r"contrat-([a-z0-9-]+)\.html", page_url)
    return slug.group(1).replace("-", " ").title() if slug else page_url


def discover(session) -> list[dict]:
    r = session.get(HUB, timeout=45)
    if r.status_code != 200:
        print(f"  ⚠ hub HTTP {r.status_code}")
        return []
    pages = sorted(set(PAGE_RE.findall(r.text)))
    out: list[dict] = []
    for href in pages:
        page_url = href if href.startswith("http") else urljoin(BASE, href)
        try:
            rr = session.get(page_url, timeout=45)
        except Exception as e:
            print(f"  ⚠ page {page_url[:60]} : {str(e)[:50]}")
            continue
        pdfs = PDF_RE.findall(rr.text)
        if not pdfs:
            continue
        # PDF le plus récent (millésime dans le nom de fichier)
        best = max(pdfs, key=_date_key)
        pdf_url = urljoin(BASE, quote(best, safe="/-._%"))
        name = _contract_name(rr.text, page_url)
        out.append({"contract": name, "pdf_url": pdf_url, "source_url": page_url})
    return out


def main():
    ap = argparse.ArgumentParser(description="ACM Vie / Crédit Mutuel AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    session = make_session()
    contracts = discover(session)
    print(f"  Contrats ACM découverts : {len(contracts)}")
    run_eligibility(COMPANY, contracts, scraper_name="av-fr-acm-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
