#!/usr/bin/env python3
"""
av-fr-groupama-gan-catalog.py — Référencement Groupama Gan Vie (AV France)
===========================================================================
Source : « Guides des supports » PDF publics hébergés sur webfg.net, un PDF par
contrat, pour les marques Gan Patrimoine, Gan Assurances, Gan Prévoyance et
Groupama. Souscripteur/assureur unique : Groupama Gan Vie.

Découverte dynamique : chaque sous-domaine expose une page /documents/pdf
listant les PDF ; on garde les « Guide des supports - <contrat> » (texte du
lien) et on déduit le nom du contrat.

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common).

Usage :
    python3 scripts/scrapers/av-fr-groupama-gan-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-groupama-gan-catalog.py --apply
"""
import re
import argparse
from urllib.parse import urljoin, quote

from parsel import Selector

from _av_pdf_common import run_eligibility, make_session

COMPANY = "Groupama Gan Vie"

# Sous-domaines webfg (non devinables — câblés en dur).
HOSTS = [
    "https://gan-patrimoine-fonds.webfg.net",
    "https://gan-assurance-web-fonds.webfg.net",
    "https://gan-prevoyance-fonds.webfg.net",
    "https://groupama-fonds.webfg.net",
]
GUIDE_RE = re.compile(r"guide des supports\s*[-–]\s*(.+)", re.I)


def discover(session) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for host in HOSTS:
        index = f"{host}/documents/pdf"
        try:
            r = session.get(index, timeout=45)
        except Exception as e:
            print(f"  ⚠ index {host} : {str(e)[:50]}")
            continue
        if r.status_code != 200:
            print(f"  ⚠ index {host} HTTP {r.status_code}")
            continue
        sel = Selector(r.text)
        for a in sel.css("a"):
            href = a.attrib.get("href", "")
            if not href.lower().endswith(".pdf"):
                continue
            txt = " ".join(a.css("::text").getall()).strip()
            m = GUIDE_RE.search(txt)
            if not m:
                continue
            contract = re.sub(r"\s+", " ", m.group(1)).strip()
            # URL-encoder les espaces dans le nom de fichier
            pdf_url = urljoin(host + "/", quote(href.lstrip("/"), safe="/-._"))
            key = contract.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append({"contract": contract, "pdf_url": pdf_url, "source_url": index})
    return out


def main():
    ap = argparse.ArgumentParser(description="Groupama Gan Vie AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    session = make_session()
    contracts = discover(session)
    print(f"  Contrats Groupama/Gan découverts : {len(contracts)}")
    run_eligibility(COMPANY, contracts, scraper_name="av-fr-groupama-gan-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
