#!/usr/bin/env python3
"""
av-fr-predica-catalog.py — Référencement Predica / Crédit Agricole Assurances
==============================================================================
Source : site institutionnel predica.com, publications réglementaires
« Informations sur les supports en unités de compte du contrat » (L.522-5),
un PDF par contrat (gammes Floriane, Predissime, Anae, Oriance, Eloquence,
LCL Vie, Carissime…). Assureur : Predica.

Découverte dynamique (robuste au changement de slug PDF) :
  1. API WP REST publique /wp-json/wp/v2/publication (paginée) → titres + liens
     des publications « supports en unités de compte ».
  2. Pour chaque publication : fetch la page HTML → extraire l'URL exacte du PDF
     (le nom de fichier n'est PAS devinable : _2026.pdf vs _010126.pdf).

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common).

Usage :
    python3 scripts/scrapers/av-fr-predica-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-predica-catalog.py --apply
"""
import re
import argparse

from _av_pdf_common import run_eligibility, make_session

COMPANY = "Predica"
WP_API = "https://www.predica.com/wp-json/wp/v2/publication"
PDF_RE = re.compile(r"https://www\.predica\.com/wp-content/uploads/[^\"'\s]+?\.pdf")


# Acronymes à garder en capitales après title-casing (sinon « LCL » → « Lcl »).
_ACRONYMS = {"LCL", "VIP", "PER", "PEP", "UFF", "IFC", "S2"}


def _clean_title(raw: str) -> str:
    """'FLORIANE 2_ Informations sur les supports…' → 'Floriane 2'."""
    t = re.sub(r"&rsquo;", "'", raw)
    t = re.sub(r"&amp;", "&", t)
    t = t.split("_")[0].strip()
    # Titres en capitales → casse titre lisible (en préservant les acronymes)
    if t.isupper():
        t = " ".join(w if w in _ACRONYMS else w.title() for w in t.split())
    return t


def discover(session) -> list[dict]:
    """Retourne [{contract, pdf_url, source_url}] dédupliqués par contrat."""
    # 1) Énumérer toutes les publications (pagination via X-WP-TotalPages).
    pubs: list[tuple[str, str]] = []  # (title, page_link)
    page = 1
    total_pages = 1
    while page <= total_pages:
        url = f"{WP_API}?per_page=100&page={page}&_fields=id,title,link"
        r = session.get(url, timeout=45)
        if r.status_code != 200:
            print(f"  ⚠ WP REST page {page} HTTP {r.status_code}")
            break
        total_pages = int(r.headers.get("X-WP-TotalPages", total_pages))
        for it in r.json():
            title = (it.get("title") or {}).get("rendered", "")
            if re.search(r"support", title, re.I) and re.search(r"unit", title, re.I):
                pubs.append((title, it.get("link", "")))
        page += 1

    # 2) Résoudre le PDF de chaque publication (dédup par nom de contrat).
    out: list[dict] = []
    seen: set[str] = set()
    for title, link in pubs:
        contract = _clean_title(title)
        if not contract or contract in seen or not link:
            continue
        try:
            rr = session.get(link, timeout=45)
        except Exception as e:
            print(f"  ⚠ page {link[:60]} : {str(e)[:50]}")
            continue
        pdfs = PDF_RE.findall(rr.text)
        # Préférer le PDF « support / unite » s'il y en a plusieurs.
        pdf = next((p for p in pdfs if re.search(r"support|unite", p, re.I)), None)
        pdf = pdf or (pdfs[0] if pdfs else None)
        if not pdf:
            print(f"  ⚠ aucun PDF sur {link[:60]}")
            continue
        seen.add(contract)
        out.append({"contract": contract, "pdf_url": pdf, "source_url": link})
    return out


def main():
    ap = argparse.ArgumentParser(description="Predica / CA AV catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    session = make_session()
    contracts = discover(session)
    print(f"  Contrats Predica découverts : {len(contracts)}")
    run_eligibility(COMPANY, contracts, scraper_name="av-fr-predica-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
