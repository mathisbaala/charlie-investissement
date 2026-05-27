#!/usr/bin/env python3
"""
amf-geco-foreign.py — OPCVM étrangers distribués en France (LU, IE, DE, CH...)
===============================================================================
L'AMF GECO liste aussi les fonds étrangers autorisés à la commercialisation
en France. Ils représentent ~40% des fonds distribués en France (Amundi LU,
BNP Paribas Funds, BlackRock, Vanguard, Pictet, Carmignac, etc.)

API GECO : même endpoint que amf-geco-full.py mais avec productType != FR.
On itère sur les pays d'origine principaux : LU, IE, DE, CH, GB, SE.

Usage :
    python3 scripts/scrapers/amf-geco-foreign.py [--apply] [--limit N]
    python3 scripts/scrapers/amf-geco-foreign.py --apply
"""

import json
import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

GECO_URL     = "https://geco.amf-france.org/back-office/funds/getCompartmentsBycriteria"
PAGE_SIZE    = 200
RATE_LIMIT   = 0.8
MAX_EMPTY    = 3
BATCH_SIZE   = 200

HEADERS = {
    "Content-Type":  "application/json",
    "Accept":        "application/json",
    "User-Agent":    "Mozilla/5.0 (compatible; Charlie-Investissement/1.0)",
    "Referer":       "https://geco.amf-france.org/",
    "Origin":        "https://geco.amf-france.org",
}

# Pays à scanner (ceux qui ont des milliers de fonds distribués en France)
FOREIGN_COUNTRIES = ["LU", "IE", "DE", "GB", "CH", "SE", "BE", "NL", "AT", "IT", "ES"]

CATEGORY_MAP = {
    "Actions":       "actions",
    "Obligations":   "obligations",
    "Monétaire":     "monetaire",
    "Diversifié":    "diversifie",
    "Alternatif":    "alternatif",
    "Immobilier":    "immobilier",
    "Fonds de fonds":"diversifie",
    "Trésorerie":    "monetaire",
}

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


def geco_category_to_asset_class(cat: str | None) -> str:
    if not cat:
        return "diversifie"
    for key, val in CATEGORY_MAP.items():
        if key.lower() in (cat or "").lower():
            return val
    return "diversifie"


def parse_inception_date(val: str | None) -> str | None:
    if not val:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(val.strip(), fmt).date().isoformat()
        except (ValueError, AttributeError):
            pass
    return None


def map_geco_record(r: dict) -> dict | None:
    def _valid_isin(s):
        if s and ISIN_RE.match(str(s).strip()):
            return str(s).strip()
        return None

    isin = (
        _valid_isin(r.get("cmpIsin"))
        or next((_valid_isin(s) for s in (r.get("sharesIsins") or []) if s), None)
        or _valid_isin(r.get("cmpCodeParPrincp"))
    )
    if not isin:
        return None

    name = (r.get("cmpNom") or r.get("nomFonds") or "").strip()
    if not name:
        return None

    sgp = (r.get("gestionnaire") or r.get("societeGestion") or "").strip()
    category_raw = (r.get("cmpClssFndAmfLib") or r.get("categorie") or "").strip()
    asset_class = geco_category_to_asset_class(category_raw)
    inception_date = parse_inception_date(r.get("cmpDateCreation") or r.get("dateCreation") or "")

    return {
        "isin":               isin,
        "name":               name,
        "product_type":       "opcvm",
        "management_company": sgp or None,
        "category":           category_raw or None,
        "asset_class":        asset_class,
        "currency":           "EUR",
        "inception_date":     inception_date,
        "distributor_france": True,
        "data_source":        "amf-geco",
    }


def fetch_page(session: FetcherSession, country: str, offset: int) -> list[dict]:
    payload = {
        "first":        offset,
        "rows":         PAGE_SIZE,
        "sortOrder":    1,
        "filters":      {},
        "globalFilter": None,
    }
    url = f"{GECO_URL}?productType={country}"
    for attempt in range(4):
        try:
            resp = session.post(url, json=payload, stealthy_headers=True, timeout=30)
            if resp.status == 200:
                data = json.loads(resp.body.decode("utf-8"))
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return (
                        data.get("compartmentDtos") or
                        data.get("data") or
                        data.get("compartiments") or
                        data.get("results") or
                        []
                    )
            elif resp.status in (429, 503):
                wait = 15 * (attempt + 1)
                print(f"    Rate-limited ({resp.status}) — attente {wait}s...")
                time.sleep(wait)
            else:
                return []
        except Exception as e:
            wait = 5 * (attempt + 1)
            print(f"    Erreur réseau (tentative {attempt+1}) : {e} — attente {wait}s")
            time.sleep(wait)
    return []


def collect_country(session: FetcherSession, country: str, limit: int | None, apply: bool) -> int:
    """Collecte tous les fonds d'un pays donné."""
    print(f"\n  [{country}] Collecte...")
    all_rows   = []
    seen_isins = set()
    offset     = 0
    empty_streak = 0
    total = 0

    while True:
        if limit and total >= limit:
            break

        time.sleep(RATE_LIMIT)
        raw = fetch_page(session, country, offset)

        if not raw:
            empty_streak += 1
            if empty_streak >= MAX_EMPTY:
                break
            offset += PAGE_SIZE
            continue

        empty_streak = 0
        mapped = [map_geco_record(r) for r in raw]
        valid  = [m for m in mapped if m and m["isin"] not in seen_isins]
        for row in valid:
            seen_isins.add(row["isin"])
            all_rows.append(row)
        total += len(valid)
        offset += PAGE_SIZE

        if offset % 2000 == 0:
            print(f"    {country}: {total} fonds collectés (offset={offset})")

        if apply and len(all_rows) >= BATCH_SIZE:
            batch = list({r["isin"]: r for r in all_rows[:BATCH_SIZE]}.values())
            ok, fail = upsert_funds_bulk(batch)
            print(f"    Upsert {len(batch)} fonds {country} : {ok} OK, {fail} échec")
            all_rows = all_rows[BATCH_SIZE:]

    # Flush
    if apply and all_rows:
        batch = list({r["isin"]: r for r in all_rows}.values())
        ok, fail = upsert_funds_bulk(batch)
        print(f"    Flush {len(batch)} fonds {country} : {ok} OK, {fail} échec")

    print(f"  [{country}] → {total} fonds collectés")
    return total


def run(apply: bool, limit: int | None, countries: list[str]):
    print("=" * 60)
    print("  AMF GECO — OPCVM Étrangers")
    print("=" * 60)
    print(f"  Mode    : {'APPLY (écriture Supabase)' if apply else 'DRY-RUN'}")
    print(f"  Pays    : {', '.join(countries)}")
    if limit:
        print(f"  Limite  : {limit} par pays")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()
    grand_total = 0

    for country in countries:
        try:
            n = collect_country(session, country, limit, apply)
            grand_total += n
        except Exception as e:
            print(f"  ✗ Erreur pour {country}: {e}")

    print()
    print(f"  ✓ Total : {grand_total} fonds étrangers collectés")

    if apply:
        log_run(
            scraper="amf-geco-foreign",
            status="success",
            records_processed=grand_total,
            started_at=started,
        )
        print("  Pipeline run loggé.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMF GECO — OPCVM étrangers")
    parser.add_argument("--apply",    action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",    type=int,            help="Limiter à N fonds par pays")
    parser.add_argument("--countries",type=str, default="LU,IE,DE,GB,CH,SE",
                        help="Pays séparés par virgule (défaut: LU,IE,DE,GB,CH,SE)")
    args = parser.parse_args()
    countries = [c.strip().upper() for c in args.countries.split(",")]
    run(apply=args.apply, limit=args.limit, countries=countries)
