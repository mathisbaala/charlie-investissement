#!/usr/bin/env python3
"""
euronext-equities.py — Actions françaises cotées sur Euronext Paris
====================================================================
Collecte les actions françaises (ISIN FR*) en deux phases :

Phase 1 — Wikidata SPARQL :
  Récupère la liste des entreprises françaises avec leur ISIN (FR*)
  depuis Wikidata (propriété P946 = ISIN code).
  Filtre : longueur ISIN = 12, exclut obligations et fonds.
  Source : query.wikidata.org/sparql (~300-350 entreprises)

Phase 2 — Yahoo Finance enrichissement :
  Pour chaque ISIN, résout le ticker via l'API de recherche Yahoo Finance
  (query1.finance.yahoo.com/v1/finance/search), puis récupère :
    - market_cap (→ aum_eur), sector (→ asset_class)
    - currency, performance_1y/3y/5y (depuis l'historique de prix)
    - inception_date (firstTradeDateEpoch)

Usage :
    python3 scripts/scrapers/euronext-equities.py [--apply] [--limit N]
    python3 scripts/scrapers/euronext-equities.py --apply  (toutes les actions)
"""

import sys
import time
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone, date
from pathlib import Path

from scrapling.fetchers import FetcherSession

try:
    import yfinance as yf
except ImportError:
    print("ERREUR : yfinance non installé — pip install yfinance")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS        = 4
RATE_LIMIT_SEC = 0.8
TIMEOUT        = 15
YF_SEARCH_URL  = "https://query1.finance.yahoo.com/v1/finance/search"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":     "application/json",
}

WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

SECTOR_MAP = {
    "Technology":            "technologie",
    "Financial Services":    "finance",
    "Healthcare":            "sante",
    "Consumer Cyclical":     "consommation_cyclique",
    "Consumer Defensive":    "consommation_defensive",
    "Industrials":           "industrie",
    "Energy":                "energie",
    "Basic Materials":       "materiaux",
    "Utilities":             "services_collectifs",
    "Real Estate":           "immobilier",
    "Communication Services":"communication",
}


# ─── Phase 1 : Collecte depuis Wikidata ───────────────────────────────────────

WIKIDATA_QUERY = """
SELECT DISTINCT ?isin ?companyLabel ?ticker WHERE {
  ?company wdt:P946 ?isin .
  FILTER(STRSTARTS(?isin, 'FR'))
  FILTER(STRLEN(?isin) = 12)
  FILTER NOT EXISTS { ?company wdt:P31/wdt:P279* wd:Q152452 }
  FILTER NOT EXISTS { ?company wdt:P31/wdt:P279* wd:Q484994 }
  OPTIONAL { ?company wdt:P249 ?ticker . }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language 'fr,en' .
    ?company rdfs:label ?companyLabel .
  }
}
ORDER BY ?isin
LIMIT 500
"""


def collect_from_wikidata() -> list[dict]:
    """Collecte les ISINs + noms depuis Wikidata SPARQL."""
    print("  Phase 1 — Wikidata SPARQL...")
    try:
        r = requests.get(
            WIKIDATA_SPARQL,
            params={"query": WIKIDATA_QUERY, "format": "json"},
            headers={"User-Agent": "Mozilla/5.0 Charlie-Investissement/1.0"},
            timeout=60,
        )
        if not r.ok:
            print(f"  ✗ Wikidata HTTP {r.status}")
            return []

        results = json.loads(r.body.decode("utf-8")).get("results", {}).get("bindings", [])
        seen = {}
        for item in results:
            isin   = item.get("isin", {}).get("value", "")
            name   = item.get("companyLabel", {}).get("value", "")
            ticker = item.get("ticker", {}).get("value", "")
            if isin and isin not in seen:
                # Ignorer les labels Wikidata bruts du type "Q12345"
                if name and not name.startswith("Q") or not name:
                    seen[isin] = {"isin": isin, "name": name or "", "ticker_hint": ticker}

        print(f"  → {len(seen)} entreprises françaises avec ISIN")
        return list(seen.values())

    except Exception as e:
        print(f"  ✗ Wikidata error: {e}")
        return []


# ─── Phase 2 : Enrichissement Yahoo Finance ────────────────────────────────────

def find_yahoo_ticker(session: FetcherSession, isin: str) -> str | None:
    """Résout un ISIN en ticker Yahoo Finance via l'API de recherche."""
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
        # Préférer les équités françaises (.PA)
        for q in quotes:
            sym = q.get("symbol", "")
            if sym.endswith(".PA") and q.get("quoteType") == "EQUITY":
                return sym
        # Fallback : toute équité
        for q in quotes:
            if q.get("quoteType") == "EQUITY" and q.get("symbol"):
                return q["symbol"]
        # Dernier recours
        if quotes and quotes[0].get("symbol"):
            return quotes[0]["symbol"]
    except Exception:
        pass
    return None


def fetch_yahoo_equity(session: FetcherSession, isin: str, ticker_hint: str = "") -> dict:
    """
    Enrichit une action depuis Yahoo Finance.
    Retourne un dict vide si insuffisant.
    """
    ticker_sym = find_yahoo_ticker(session, isin)
    if not ticker_sym:
        return {}

    try:
        t    = yf.Ticker(ticker_sym)
        info = t.info

        if not info or info.get("quoteType") not in ("EQUITY", "STOCK"):
            return {}

        result: dict = {"product_type": "action"}

        # ── Nom ────────────────────────────────────────────────────────
        name = info.get("longName") or info.get("shortName", "")
        if name:
            result["name"] = name[:200]

        # ── Devise ─────────────────────────────────────────────────────
        currency = info.get("currency", "EUR")
        result["currency"] = (currency or "EUR")[:3]

        # ── Market cap → aum_eur ───────────────────────────────────────
        mcap = info.get("marketCap")
        if mcap and isinstance(mcap, (int, float)) and mcap > 0:
            result["aum_eur"] = int(mcap)

        # ── Secteur → asset_class ──────────────────────────────────────
        sector = info.get("sector", "")
        if sector:
            result["asset_class"] = SECTOR_MAP.get(sector, "diversifie")

        # ── Date de première cotation → inception_date ─────────────────
        first_trade = info.get("firstTradeDateEpochUtc") or info.get("firstTradeDateEpoch")
        if first_trade and isinstance(first_trade, (int, float)):
            try:
                result["inception_date"] = date.fromtimestamp(first_trade).isoformat()
            except Exception:
                pass

        # ── Performance depuis l'historique de prix ─────────────────────
        try:
            hist = t.history(period="5y")
            if hist is not None and not hist.empty and len(hist) > 20:
                closes = hist["Close"].dropna()
                last   = float(closes.iloc[-1])

                # 1 an : ~252 jours de trading
                if len(closes) >= 252:
                    first_1y = float(closes.iloc[-252])
                    if first_1y > 0:
                        result["performance_1y"] = round((last / first_1y - 1) * 100, 2)

                # 3 ans : ~756 jours
                if len(closes) >= 756:
                    first_3y = float(closes.iloc[-756])
                    if first_3y > 0:
                        result["performance_3y"] = round((last / first_3y - 1) * 100, 2)

                # 5 ans : ~1260 jours
                if len(closes) >= 1260:
                    first_5y = float(closes.iloc[-1260])
                    if first_5y > 0:
                        result["performance_5y"] = round((last / first_5y - 1) * 100, 2)
        except Exception:
            pass

        # Valider qu'on a au moins un nom ou une performance
        if not result.get("name") and not result.get("aum_eur"):
            return {}

        return result

    except Exception:
        return {}


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Euronext Equities — Actions françaises via Wikidata + YF")
    print("=" * 60)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite: {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Phase 1 : Wikidata
    stocks = collect_from_wikidata()
    if not stocks:
        print("  ✗ Aucune action collectée depuis Wikidata")
        return

    if limit:
        stocks = stocks[:limit]

    print(f"\n  Phase 2 — Yahoo Finance enrichissement ({len(stocks)} actions)...")
    print()

    # Filtrer les ISINs déjà dans la base avec des données complètes
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
        print(f"  {len(existing_isins)} actions déjà enrichies en base → ignorées")
    except Exception:
        pass

    stocks_to_process = [s for s in stocks if s["isin"] not in existing_isins]
    print(f"  {len(stocks_to_process)} actions à traiter\n")

    found    = 0
    no_data  = 0
    lock     = threading.Lock()
    now_str  = datetime.now(timezone.utc).isoformat()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, no_data
        i, stock = args
        isin        = stock["isin"]
        name_hint   = (stock.get("name") or "")[:40]
        ticker_hint = stock.get("ticker_hint", "")

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT_SEC)
        data = fetch_yahoo_equity(session, isin, ticker_hint)

        with lock:
            if data and (data.get("name") or data.get("aum_eur") or data.get("performance_1y")):
                found += 1
                full_record = {"isin": isin, **data, "data_source": "wikidata-yahoo"}
                # Conserver le nom Wikidata si Yahoo n'en a pas
                if not full_record.get("name") and name_hint:
                    full_record["name"] = name_hint

                if apply:
                    upsert_fund(full_record)

                if i <= 30 or i % 100 == 0:
                    name = (full_record.get("name") or name_hint or "")[:30]
                    mcap = f"{data['aum_eur']/1e9:.1f}B€" if data.get("aum_eur") else "N/A"
                    p1   = f"{data['performance_1y']:+.1f}%" if data.get("performance_1y") is not None else "N/A"
                    ac   = data.get("asset_class", "?")[:12]
                    print(f"  ✓ [{i:4d}] {isin} | MCap:{mcap:8} | perf:{p1:7} | {ac:12} | {name}")
            else:
                no_data += 1
                if i <= 10 or i % 200 == 0:
                    print(f"  ✗ [{i:4d}] {isin} | no data | {name_hint}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(stocks_to_process, 1)))

    print()
    print(f"  ✓ {found} actions enrichies, {no_data} sans données")

    if apply:
        log_run("euronext-equities", "success", found, no_data, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Collecte actions françaises Euronext")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N actions")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
