#!/usr/bin/env python3
"""
av-fr-caar-catalog.py — PER Crédit Agricole Assurances Retraite (ex-Predica)
=============================================================================
Fin 2022, tous les engagements retraite de Predica (18,1 Md€) ont été transférés
au FRPS **Crédit Agricole Assurances Retraite** (CAAR — avis JORF
JORFTEXT000046037266) : les PER ne sont PAS sur predica.com. Le site
ca-assurances-retraite.com est un clone WordPress de predica.com (même CPT
`publication`, même API REST) → même mécanique de découverte que
av-fr-predica-catalog.py, avec deux différences :
  - les titres PER utilisent « informations sur les actifs du plan d'épargne
    retraite » (pas le gabarit AV « supports en unités de compte ») ;
  - assureur à référencer : « Crédit Agricole Assurances Retraite ».

Contrats attendus (repérage 2026-07-16) : Perspective (« PER Assurance »,
réseau CA, ~156 ISIN) et LCL Retraite PER (~237 ISIN). Les PERP/Madelin fermés
(Accordance, Lion Retraite, Pro Lignes de Vie…) sont mono-euro : pas de liste
d'UC publiée. Bonus : les PDF incluent frais UC et taux de rétrocessions.

ÉLIGIBILITÉ-ONLY (cf. _av_pdf_common).

Usage :
    python3 scripts/scrapers/av-fr-caar-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-caar-catalog.py --apply
"""
import re
import argparse

from _av_pdf_common import run_eligibility, make_session

COMPANY = "Crédit Agricole Assurances Retraite"
WP_API = "https://www.ca-assurances-retraite.com/wp-json/wp/v2/publication"
PDF_RE = re.compile(r"https://www\.ca-assurances-retraite\.com/wp-content/uploads/[^\"'\s]+?\.pdf")

# Publications visées : « Informations sur les supports en unité(s) de compte »
# ou « Informations sur les actifs » (gabarit PER).
TITLE_RE = re.compile(r"informations?\s+sur\s+les\s+(supports|actifs)", re.I)

_ACRONYMS = {"LCL", "PER", "PERP", "CA"}

# Nom commercial complet quand le titre de la publication est trop court.
# ⚠ « Perspective » seul ne serait pas tagué `per` par l'heuristique de type de
# contrat (regex retraite|per|… sur le nom, migration 20260611270000).
_RENAME = {"Perspective": "PER Assurance Perspective"}


def _clean_title(raw: str) -> str:
    """'LCL RETRAITE PER_ Informations sur les actifs…' → 'LCL Retraite PER'."""
    t = re.sub(r"&rsquo;", "'", raw)
    t = re.sub(r"&amp;", "&", t)
    t = t.split("_")[0].strip()
    if t.isupper():
        t = " ".join(w if w in _ACRONYMS else w.title() for w in t.split())
    return _RENAME.get(t, t)


def discover(session) -> list[dict]:
    """[{contract, pdf_url, source_url}] dédupliqués par contrat."""
    pubs: list[tuple[str, str]] = []
    page, total_pages = 1, 1
    while page <= total_pages:
        url = f"{WP_API}?per_page=100&page={page}&_fields=id,title,link"
        r = session.get(url, timeout=45)
        if r.status_code != 200:
            print(f"  ⚠ WP REST page {page} HTTP {r.status_code}")
            break
        total_pages = int(r.headers.get("X-WP-TotalPages", total_pages))
        for it in r.json():
            title = (it.get("title") or {}).get("rendered", "")
            if TITLE_RE.search(title):
                pubs.append((title, it.get("link", "")))
        page += 1

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
        pdf = next((p for p in pdfs if re.search(r"support|unite|actif", p, re.I)), None)
        pdf = pdf or (pdfs[0] if pdfs else None)
        if not pdf:
            print(f"  ⚠ aucun PDF sur {link[:60]}")
            continue
        seen.add(contract)
        out.append({"contract": contract, "pdf_url": pdf, "source_url": link})
    return out


def main():
    ap = argparse.ArgumentParser(description="CAAR (ex-Predica) — PER catalog")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = ap.parse_args()

    session = make_session()
    contracts = discover(session)
    print(f"  Contrats CAAR découverts : {len(contracts)}")
    run_eligibility(COMPANY, contracts, scraper_name="av-fr-caar-catalog",
                    apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    main()
