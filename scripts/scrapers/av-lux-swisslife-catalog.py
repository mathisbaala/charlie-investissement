#!/usr/bin/env python3
"""
av-lux-swisslife-catalog.py — Catalogue fonds Swiss Life Luxembourg
====================================================================
Swiss Life Luxembourg publie son catalogue via un fund-screener public :
  https://swisslife-lux.fund-screener.net/

La page retourne une table HTML complète (953 fonds, pas de pagination),
avec colonnes : Name | CCY | ISIN | Type of Fund | SFDR | ...

Usage :
    python3 scripts/scrapers/av-lux-swisslife-catalog.py [--apply] [--limit N]
    python3 scripts/scrapers/av-lux-swisslife-catalog.py --apply
"""

import re
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

SOURCE_URL = "https://swisslife-lux.fund-screener.net/"
COMPANY    = "Swiss Life Luxembourg"
# ⚠ contract_name DOIT différer de company_name : la matview
# investissement_fund_insurers_mv construit contracts[] avec
# FILTER (contract_name <> company_name) — un contrat homonyme de l'assureur
# est invisible dans get_contracts_list (cf. migration 20260710120000 Generali).
CONTRACT   = "Swiss Life Luxembourg Univers Global"

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


def extract_funds_from_html(html: str) -> list[dict]:
    """
    Extrait les fonds depuis la table HTML du fund-screener.
    Colonnes : '', Name, '', CCY, ISIN, Type of Fund, SFDR, ...
    """
    soup = BeautifulSoup(html, "html.parser")
    funds: dict[str, dict] = {}

    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        # Détection des indices de colonnes depuis le header
        headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]
        try:
            name_idx = next(i for i, h in enumerate(headers) if "name" in h)
            isin_idx = next(i for i, h in enumerate(headers) if h == "isin")
            ccy_idx  = next(i for i, h in enumerate(headers) if h in ("ccy", "currency", "devise"))
            sfdr_idx = next(i for i, h in enumerate(headers) if "sfdr" in h)
        except StopIteration:
            # Fallback : indices observés lors du reverse-engineering
            name_idx, ccy_idx, isin_idx, sfdr_idx = 1, 3, 4, 6

        for row in rows[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cells) <= isin_idx:
                continue

            isin = cells[isin_idx].strip().upper()
            if not ISIN_RE.match(isin):
                continue
            if isin in funds:
                continue

            name     = cells[name_idx].strip() if len(cells) > name_idx else None
            currency = cells[ccy_idx].strip()  if len(cells) > ccy_idx  else None
            sfdr_raw = cells[sfdr_idx].strip() if len(cells) > sfdr_idx else ""

            sfdr_article = parse_sfdr(sfdr_raw)

            fund: dict = {
                "isin":            isin,
                "currency":        currency or "EUR",
                "av_lux_eligible": True,
                "data_source":     "swisslife-lux",
            }
            if name:
                fund["name"] = name
            if sfdr_article:
                fund["sfdr_article"] = sfdr_article

            funds[isin] = fund

    return list(funds.values())


def upsert_eligibility(client, isin: str, dry_run: bool) -> bool:
    row = {
        "isin":          isin,
        "company_name":  COMPANY,
        "contract_name": CONTRACT,
        "source_url":    SOURCE_URL,
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
    print("  Swiss Life Luxembourg AV Catalog — HTML Scraper")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)

    print(f"  Téléchargement fund-screener Swiss Life…")
    try:
        r = requests.get(SOURCE_URL, timeout=30)
        if not r.ok:
            print(f"  ERREUR : HTTP {r.status}")
            log_run("av-lux-swisslife-catalog", "failed", 0, 0, started_at=started)
            return
    except Exception as e:
        print(f"  ERREUR réseau : {e}")
        log_run("av-lux-swisslife-catalog", "failed", 0, 0, started_at=started)
        return

    funds = extract_funds_from_html(r.text)
    print(f"  {len(funds)} fonds extraits")

    if limit:
        funds = funds[:limit]

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in funds[:10]:
            sfdr = f"SFDR{f['sfdr_article']}" if f.get("sfdr_article") else ""
            print(f"  {f['isin']}  {f.get('currency','?'):4}  {sfdr:8}  {f.get('name','')[:50]}")
        print(f"\n  Seraient écrits : {len(funds)} fonds + {len(funds)} lignes eligibility")
        return

    client = get_client()

    ok, fail = upsert_funds_bulk(funds, batch_size=100)
    print(f"\n  Upsert investissement_funds : {ok} OK, {fail} échec")

    elig_ok = elig_fail = 0
    for f in funds:
        if upsert_eligibility(client, f["isin"], dry_run=False):
            elig_ok += 1
        else:
            elig_fail += 1

    print(f"  Upsert eligibility : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run("av-lux-swisslife-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Swiss Life Luxembourg AV Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
