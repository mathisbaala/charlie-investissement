#!/usr/bin/env python3
"""
av-lux-wealins-catalog.py — Catalogue fonds Wealins Luxembourg
===============================================================
Wealins (anciennement ING Life Luxembourg) publie sa liste de supports
en HTML paginé sur https://wealins.com/fr/liste-des-fonds/

Structure : 10 fonds par page × ~119 pages
Colonnes  : Nom | ISIN | Val.date | Devise | NAV | SFDR article

Contract Wealins : catalogue global (pas de per-contrat public disponible).
On stocke sous company_name="Wealins", contract_name="Wealins Luxembourg".

Usage :
    python3 scripts/scrapers/av-lux-wealins-catalog.py [--apply] [--limit N]
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

BASE_URL    = "https://wealins.com/fr/liste-des-fonds/"
PAGE_URL    = "https://wealins.com/fr/liste-des-fonds/page/{page}/"
RATE_LIMIT  = 1.2
COMPANY     = "Wealins"
CONTRACT    = "Wealins Luxembourg"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept":          "text/html,application/xhtml+xml",
}

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


def parse_sfdr(text: str) -> int | None:
    if not text:
        return None
    m = re.search(r"\b([689])\b", str(text))
    return int(m.group(1)) if m else None


def parse_page(html: str) -> list[dict]:
    """Extrait les fonds d'une page Wealins."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return []

    funds = []
    rows = table.find_all("tr")
    for row in rows[1:]:  # skip header
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        texts = [c.get_text(strip=True) for c in cells]
        # Columns: Nom, ISIN, Val.date, Devise, Actuel, SFDR, [Détails]
        if len(texts) >= 2:
            name = texts[0].strip()
            isin = texts[1].strip().upper()
            if not ISIN_RE.match(isin):
                continue

            currency    = texts[3].strip() if len(texts) > 3 else None
            sfdr_text   = texts[5].strip() if len(texts) > 5 else ""
            sfdr_article = parse_sfdr(sfdr_text)

            fund = {
                "isin":            isin,
                "name":            name or None,
                "currency":        currency or "EUR",
                "av_lux_eligible": True,
                "data_source":     "wealins",
            }
            if sfdr_article:
                fund["sfdr_article"] = sfdr_article

            funds.append({"fund": fund, "isin": isin})

    return funds


def get_last_page(html: str) -> int:
    """Détecte le numéro de la dernière page depuis la pagination."""
    pages = re.findall(r"/liste-des-fonds/page/(\d+)/", html)
    if pages:
        return max(int(p) for p in pages)
    return 1


def upsert_eligibility(client, isin: str, dry_run: bool) -> bool:
    row = {
        "isin":          isin,
        "company_name":  COMPANY,
        "contract_name": CONTRACT,
        "source_url":    BASE_URL,
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }
    if dry_run:
        return True
    try:
        client.table("investissement_av_lux_eligibility") \
            .upsert(row, on_conflict="isin,contract_name") \
            .execute()
        return True
    except Exception as e:
        if "42P01" in str(e) or "does not exist" in str(e).lower():
            return False
        print(f"    ⚠ eligibility {isin} : {e}")
        return False


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Wealins AV Catalog — HTML Scraper")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()

    # Page 1 — détecte le nombre total de pages
    r = session.get(BASE_URL, stealthy_headers=True, timeout=20)
    if r.status != 200:
        print(f"  ERREUR : {r.status}")
        log_run("av-lux-wealins-catalog", "failed", 0, 0, started_at=started)
        return

    last_page = get_last_page(r.body.decode("utf-8"))
    print(f"  {last_page} pages détectées")

    all_funds: dict[str, dict] = {}
    page_htmls = {1: r.body.decode("utf-8")}

    for page_num in range(1, last_page + 1):
        html = page_htmls.get(page_num)
        if html is None:
            time.sleep(RATE_LIMIT)
            page = session.get(PAGE_URL.format(page=page_num), stealthy_headers=True, timeout=20)
            if page.status != 200:
                print(f"  ⚠ page {page_num} : {page.status}")
                continue
            html = page.body.decode("utf-8")

        items = parse_page(html)
        for item in items:
            isin = item["isin"]
            if isin not in all_funds:
                all_funds[isin] = item["fund"]

        if page_num % 20 == 0:
            print(f"  [{page_num:3d}/{last_page}] {len(all_funds)} fonds collectés")

        if limit and len(all_funds) >= limit:
            break

    unique = list(all_funds.keys())
    if limit:
        unique = unique[:limit]

    print(f"\n  Total : {len(unique)} fonds ISIN uniques")

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for isin in unique[:10]:
            fund = all_funds[isin]
            sfdr = f"SFDR{fund.get('sfdr_article')}" if fund.get("sfdr_article") else ""
            print(f"  {isin}  {fund.get('currency','?'):4}  {sfdr:8}  {fund.get('name','')[:50]}")
        print(f"\n  Seraient écrits : {len(unique)} fonds + {len(unique)} lignes eligibility")
        return

    client = get_client()

    # Upsert fonds
    funds_list = [all_funds[isin] for isin in unique]
    ok, fail = upsert_funds_bulk(funds_list, batch_size=100)
    print(f"\n  Upsert investissement_funds : {ok} OK, {fail} échec")

    # Upsert eligibility
    elig_ok = elig_fail = 0
    for isin in unique:
        if upsert_eligibility(client, isin, dry_run=False):
            elig_ok += 1
        else:
            elig_fail += 1

    print(f"  Upsert eligibility : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run("av-lux-wealins-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Wealins AV Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
