#!/usr/bin/env python3
"""
euronext-equities-eu.py — Actions européennes via Wikidata + Yahoo Finance
===========================================================================
Étend euronext-equities.py aux actions non-françaises (DE, GB, NL, IT, ES,
BE, CH, AT, SE, DK, NO, FI, LU, PT, IE) pour enrichir la base avec
les grandes capitalisations européennes.

Phase 1 — Wikidata SPARQL :
  Récupère les entreprises européennes cotées avec ISIN (hors FR*)
  Filtre : exclut obligations, fonds, véhicules de placement collectif
  Source : query.wikidata.org/sparql (~800-1200 entreprises européennes)

Phase 2 — Yahoo Finance enrichissement :
  Pour chaque ISIN, résout le ticker, puis récupère :
    - market_cap (→ aum_eur), sector (→ asset_class)
    - currency, performance_1y/3y/5y depuis historique de prix
    - inception_date (firstTradeDateEpoch)

Usage :
    python3 scripts/scrapers/euronext-equities-eu.py [--apply] [--limit N]
    python3 scripts/scrapers/euronext-equities-eu.py --apply --country DE
"""

import sys
import time
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone, date
from pathlib import Path

import json
import requests
from scrapling.fetchers import FetcherSession

try:
    import yfinance as yf
except ImportError:
    print("ERREUR : yfinance non installé — pip install yfinance")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS        = 4
RATE_LIMIT_SEC = 0.8
TIMEOUT        = 15
YF_SEARCH_URL  = "https://query1.finance.yahoo.com/v1/finance/search"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":     "application/json",
}

# Pays européens couverts (code ISO 2 = préfixe ISIN)
EU_COUNTRY_CODES = [
    "DE",  # Allemagne
    "GB",  # Royaume-Uni
    "NL",  # Pays-Bas
    "IT",  # Italie
    "ES",  # Espagne
    "BE",  # Belgique
    "CH",  # Suisse
    "AT",  # Autriche
    "SE",  # Suède
    "DK",  # Danemark
    "NO",  # Norvège
    "FI",  # Finlande
    "PT",  # Portugal
    "IE",  # Irlande
    "LU",  # Luxembourg
]

SECTOR_MAP = {
    "Technology":             "technologie",
    "Financial Services":     "finance",
    "Healthcare":             "sante",
    "Consumer Cyclical":      "consommation_cyclique",
    "Consumer Defensive":     "consommation_defensive",
    "Industrials":            "industrie",
    "Energy":                 "energie",
    "Basic Materials":        "materiaux",
    "Utilities":              "services_collectifs",
    "Real Estate":            "immobilier",
    "Communication Services": "communication",
}


# ─── Phase 1 : Wikidata ───────────────────────────────────────────────────────

def build_wikidata_query(country_codes: list[str]) -> str:
    filters = " ".join(
        f'FILTER(STRSTARTS(?isin, "{cc}"))' for cc in country_codes
    )
    # Utilise un UNION pour les filtres OR
    union_parts = " UNION ".join(
        f'{{ ?company wdt:P946 ?isin . FILTER(STRSTARTS(?isin, "{cc}")) }}'
        for cc in country_codes
    )
    return f"""
SELECT DISTINCT ?isin ?companyLabel WHERE {{
  {{ {union_parts} }}
  FILTER(STRLEN(?isin) = 12)
  FILTER NOT EXISTS {{ ?company wdt:P31/wdt:P279* wd:Q152452 }}
  FILTER NOT EXISTS {{ ?company wdt:P31/wdt:P279* wd:Q484994 }}
  FILTER NOT EXISTS {{ ?company wdt:P31/wdt:P279* wd:Q13479982 }}
  SERVICE wikibase:label {{
    bd:serviceParam wikibase:language 'en,fr,de' .
    ?company rdfs:label ?companyLabel .
  }}
}}
ORDER BY ?isin
LIMIT 3000
"""


def collect_from_wikidata(country_codes: list[str]) -> list[dict]:
    """Collecte les ISINs + noms depuis Wikidata pour les pays ciblés."""
    print(f"  Phase 1 — Wikidata SPARQL ({len(country_codes)} pays)...")
    query = build_wikidata_query(country_codes)
    try:
        r = requests.get(
            WIKIDATA_SPARQL,
            params={"query": query, "format": "json"},
            headers={"User-Agent": "Mozilla/5.0 Charlie-Investissement/1.0 (euronext-equities-eu)"},
            timeout=90,
        )
        if not r.ok:
            print(f"  ✗ Wikidata HTTP {r.status_code}")
            return []

        results = json.loads(r.content.decode("utf-8")).get("results", {}).get("bindings", [])
        seen: dict = {}
        for item in results:
            isin  = item.get("isin", {}).get("value", "")
            name  = item.get("companyLabel", {}).get("value", "")
            if isin and len(isin) == 12 and isin not in seen:
                if not (name and name.startswith("Q")):
                    seen[isin] = {"isin": isin, "name": name or ""}

        by_country: dict[str, int] = {}
        for isin in seen:
            cc = isin[:2]
            by_country[cc] = by_country.get(cc, 0) + 1

        print(f"  → {len(seen)} entreprises européennes")
        for cc, n in sorted(by_country.items()):
            print(f"    {cc}: {n}")
        return list(seen.values())

    except Exception as e:
        print(f"  ✗ Wikidata error: {e}")
        return []


# ─── Phase 2 : Yahoo Finance ──────────────────────────────────────────────────

def find_yahoo_ticker(session: FetcherSession, isin: str) -> str | None:
    try:
        page = session.get(
            YF_SEARCH_URL,
            params={"q": isin, "quotesCount": 5, "newsCount": 0, "enableFuzzyQuery": False},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if page.status != 200:
            return None
        quotes = json.loads(page.body.decode("utf-8")).get("quotes", [])
        # Préférer actions DE/IT/ES/NL sur leurs exchanges natifs
        for q in quotes:
            sym = q.get("symbol", "")
            qt  = q.get("quoteType", "")
            # Exchanges principaux européens : .DE .MI .MC .AS .BR .VX .CO .OL .HE .LS .VI
            if any(sym.endswith(x) for x in (".DE", ".MI", ".MC", ".AS", ".L", ".BR", ".VX",
                                              ".CO", ".OL", ".HE", ".LS", ".VI")) \
               and qt == "EQUITY":
                return sym
        # Fallback : toute équité
        for q in quotes:
            if q.get("quoteType") == "EQUITY" and q.get("symbol"):
                return q["symbol"]
        if quotes and quotes[0].get("symbol"):
            return quotes[0]["symbol"]
    except Exception:
        pass
    return None


def fetch_yahoo_equity(session: FetcherSession, isin: str) -> dict:
    ticker_sym = find_yahoo_ticker(session, isin)
    if not ticker_sym:
        return {}

    try:
        t    = yf.Ticker(ticker_sym)
        info = t.info

        if not info or info.get("quoteType") not in ("EQUITY", "STOCK"):
            return {}

        result: dict = {"product_type": "action"}

        name = info.get("longName") or info.get("shortName", "")
        if name:
            result["name"] = name[:200]

        currency = info.get("currency", "EUR")
        result["currency"] = (currency or "EUR")[:3]

        mcap = info.get("marketCap")
        if mcap and isinstance(mcap, (int, float)) and mcap > 0:
            result["aum_eur"] = int(mcap)

        sector = info.get("sector", "")
        if sector:
            result["asset_class"] = SECTOR_MAP.get(sector, "diversifie")

        first_trade = info.get("firstTradeDateEpochUtc") or info.get("firstTradeDateEpoch")
        if first_trade and isinstance(first_trade, (int, float)):
            try:
                result["inception_date"] = date.fromtimestamp(first_trade).isoformat()
            except Exception:
                pass

        try:
            hist = t.history(period="5y")
            if hist is not None and not hist.empty and len(hist) > 20:
                closes = hist["Close"].dropna()
                last   = float(closes.iloc[-1])
                if len(closes) >= 252:
                    f1 = float(closes.iloc[-252])
                    if f1 > 0:
                        p1 = round((last / f1 - 1) * 100, 2)
                        if -99 <= p1 <= 9999:
                            result["performance_1y"] = p1
                if len(closes) >= 756:
                    f3 = float(closes.iloc[-756])
                    if f3 > 0:
                        p3 = round((last / f3 - 1) * 100, 2)
                        if -99 <= p3 <= 9999:
                            result["performance_3y"] = p3
                if len(closes) >= 1260:
                    f5 = float(closes.iloc[-1260])
                    if f5 > 0:
                        p5 = round((last / f5 - 1) * 100, 2)
                        if -99 <= p5 <= 9999:
                            result["performance_5y"] = p5
        except Exception:
            pass

        if not result.get("name") and not result.get("aum_eur"):
            return {}

        return result

    except Exception:
        return {}


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, country: str | None):
    print("=" * 60)
    print("  Euronext Equities EU — Actions européennes Wikidata + YF")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    if country:
        print(f"  Pays    : {country} uniquement")
    if limit:
        print(f"  Limite  : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    codes = [country.upper()] if country else EU_COUNTRY_CODES

    # Phase 1 : Wikidata
    stocks = collect_from_wikidata(codes)
    if not stocks:
        print("  ✗ Aucune action collectée")
        return

    if limit:
        stocks = stocks[:limit]

    print(f"\n  Phase 2 — Enrichissement Yahoo Finance ({len(stocks)} actions)...")
    print()

    # Filtrer les ISINs déjà en base avec données complètes
    existing_isins: set[str] = set()
    try:
        offset = 0
        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin")
                .eq("product_type", "action")
                .not_.is_("performance_1y", "null")
                .range(offset, offset + 999)
                .execute().data or []
            )
            for row in batch:
                existing_isins.add(row["isin"])
            if len(batch) < 1000:
                break
            offset += 1000
        print(f"  {len(existing_isins)} actions déjà enrichies → ignorées")
    except Exception:
        pass

    stocks_to_process = [s for s in stocks if s["isin"] not in existing_isins]
    print(f"  {len(stocks_to_process)} actions à traiter\n")

    found   = 0
    no_data = 0
    lock    = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, no_data
        i, stock = args
        isin      = stock["isin"]
        name_hint = (stock.get("name") or "")[:40]
        country_  = isin[:2]

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT_SEC)
        data = fetch_yahoo_equity(session, isin)

        with lock:
            if data and (data.get("name") or data.get("aum_eur") or data.get("performance_1y")):
                found += 1
                full_record = {
                    "isin":        isin,
                    **data,
                    "data_source": "wikidata-yahoo-eu",
                }
                if not full_record.get("name") and name_hint:
                    full_record["name"] = name_hint

                if apply:
                    upsert_fund(full_record)

                if i <= 30 or i % 100 == 0:
                    name = (full_record.get("name") or name_hint or "")[:30]
                    mcap = f"{data['aum_eur']/1e9:.1f}B€" if data.get("aum_eur") else "N/A"
                    p1   = f"{data['performance_1y']:+.1f}%" if data.get("performance_1y") is not None else "N/A"
                    ac   = data.get("asset_class", "?")[:10]
                    print(f"  ✓ [{i:4d}] {isin} ({country_}) | MCap:{mcap:8} | perf:{p1:7} | {ac:10} | {name}")
            else:
                no_data += 1
                if i <= 10 or i % 200 == 0:
                    print(f"  ✗ [{i:4d}] {isin} ({country_}) | no data | {name_hint}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(stocks_to_process, 1)))

    print()
    print(f"  ✓ {found} actions enrichies, {no_data} sans données")

    if apply:
        log_run("euronext-equities-eu", "success", found, no_data, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Actions européennes via Wikidata + Yahoo Finance")
    parser.add_argument("--apply",   action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",   type=int,            help="Limiter à N actions")
    parser.add_argument("--country", type=str,            help="Filtrer sur un pays (ex: DE, GB)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, country=args.country)
