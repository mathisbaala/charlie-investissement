#!/usr/bin/env python3
"""
yahoo-finance-aum.py — AUM + perf via Yahoo Finance (yfinance)
==============================================================
Pour les ETFs et OPCVM internationaux sans aum_eur, utilise Yahoo Finance
pour récupérer les actifs sous gestion (totalAssets) et les performances.

Strategy :
  1. Recherche le ticker Yahoo Finance par ISIN (API search v1/finance/search)
  2. Récupère les données du fonds via yfinance.Ticker.info
  3. Pour la performance 1Y, calcule depuis l'historique de prix si absente

Cible principale : ETFs (IE*, LU*, DE*, FR* ETF) sans aum_eur.

Usage :
    python3 scripts/scrapers/yahoo-finance-aum.py [--apply] [--limit N]
    python3 scripts/scrapers/yahoo-finance-aum.py --apply --etf-only
"""

import re
import sys
import time
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

try:
    import yfinance as yf
except ImportError:
    print("ERREUR : yfinance non installé — pip install yfinance")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS        = 5
RATE_LIMIT_SEC = 0.5
TIMEOUT        = 12

HEADERS = {
    "User-Agent":  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":      "application/json",
}

YF_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"


# ─── Recherche du ticker ───────────────────────────────────────────────────────

def find_yahoo_ticker(session: FetcherSession, isin: str) -> str | None:
    """Cherche le ticker Yahoo Finance correspondant à un ISIN."""
    try:
        page = session.get(
            YF_SEARCH_URL,
            params={"q": isin, "quotesCount": 5, "newsCount": 0, "enableFuzzyQuery": False},
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if page.status != 200:
            return None
        data = json.loads(page.body.decode("utf-8"))
        quotes = data.get("quotes", [])
        # Prioriser ETF et fonds mutuels
        for q in quotes:
            qtype = q.get("quoteType", "")
            if qtype in ("ETF", "MUTUALFUND") and q.get("symbol"):
                return q["symbol"]
        # Fallback : premier résultat
        if quotes and quotes[0].get("symbol"):
            return quotes[0]["symbol"]
    except (Exception, ValueError, KeyError):
        pass
    return None


# ─── Extraction des données ────────────────────────────────────────────────────

def fetch_yahoo_data(session: FetcherSession, isin: str) -> dict:
    """
    Récupère AUM, perf 1Y, TER depuis Yahoo Finance via yfinance.
    Retourne un dict vide si aucune donnée utilisable.
    """
    ticker_sym = find_yahoo_ticker(session, isin)
    if not ticker_sym:
        return {}

    try:
        t = yf.Ticker(ticker_sym)
        info = t.info

        if not info or info.get("regularMarketPrice") is None:
            return {}

        result: dict = {}

        # ── AUM / Total Assets ──────────────────────────────────────────
        total_assets = info.get("totalAssets")
        if total_assets and isinstance(total_assets, (int, float)) and total_assets > 100_000:
            result["aum_eur"] = int(total_assets)

        # ── TER / Expense Ratio ─────────────────────────────────────────
        for key in ("annualReportExpenseRatio", "netExpenseRatio", "totalExpenseRatio"):
            er = info.get(key)
            if er and isinstance(er, (int, float)) and 0 < er < 0.20:
                result["ter"] = round(float(er), 6)
                result["ongoing_charges"] = round(float(er), 6)
                break

        # ── Performance 1Y depuis historique ──────────────────────────────
        try:
            hist = t.history(period="1y")
            if hist is not None and not hist.empty and len(hist) > 50:
                first_close = float(hist["Close"].iloc[0])
                last_close  = float(hist["Close"].iloc[-1])
                if first_close > 0:
                    perf_1y = round((last_close / first_close - 1) * 100, 2)
                    if -80 < perf_1y < 500:
                        result["performance_1y"] = perf_1y
        except Exception:
            pass

        # ── Morningstar rating (si disponible) ─────────────────────────
        ms_rating = info.get("morningStarOverallRating") or info.get("morningStarRiskRating")
        if ms_rating and isinstance(ms_rating, (int, float)) and 1 <= ms_rating <= 5:
            result["morningstar_rating"] = int(ms_rating)

        return result

    except Exception:
        return {}


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, etf_only: bool):
    print("=" * 60)
    print("  Yahoo Finance AUM — Actifs + Perf via yfinance")
    print("=" * 60)
    print(f"  Mode     : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  ETF only : {etf_only}")
    if limit:
        print(f"  Limite   : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    type_filter = ["etf"] if etf_only else ["etf", "opcvm"]

    # Union : fonds sans AUM + fonds sans perf_1y
    funds: list[dict] = []
    seen: set = set()
    page_size = 1000

    for null_field in ("aum_eur", "performance_1y"):
        offset = 0
        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin, name, product_type")
                .in_("product_type", type_filter)
                .is_(null_field, "null")
                .order("isin")
                .range(offset, offset + page_size - 1)
                .execute().data or []
            )
            for row in batch:
                if row["isin"] not in seen:
                    seen.add(row["isin"])
                    funds.append(row)
            if len(batch) < page_size:
                break
            if limit and len(funds) >= limit * 2:
                break
            offset += page_size

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} fonds sans AUM à traiter\n")

    found   = 0
    no_data = 0
    lock    = threading.Lock()
    now_str = datetime.now(timezone.utc).isoformat()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, no_data
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT_SEC)
        data = fetch_yahoo_data(session, isin)

        with lock:
            if data.get("aum_eur") or data.get("performance_1y"):
                found += 1
                if apply:
                    try:
                        update_fields = {k: v for k, v in data.items() if v is not None}
                        update_fields["updated_at"] = now_str
                        client.table("investissement_funds") \
                            .update(update_fields) \
                            .eq("isin", isin) \
                            .execute()
                    except Exception as e:
                        if found <= 3:
                            print(f"  ✗ DB {isin}: {e}")

                if i <= 30 or i % 200 == 0:
                    aum_m = f"{data['aum_eur']/1e6:.0f}M€" if data.get("aum_eur") else "N/A"
                    p1    = f"{data['performance_1y']:+.1f}%" if data.get("performance_1y") is not None else "N/A"
                    ter   = f"{data['ter']*100:.2f}%"         if data.get("ter") else "N/A"
                    print(f"  ✓ [{i:5d}] {isin} | AUM:{aum_m:9} | perf:{p1:7} | TER:{ter} | {name}")
            else:
                no_data += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ✗ [{i:5d}] {isin} | no data | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} fonds enrichis, {no_data} sans données")

    if apply:
        log_run("yahoo-finance-aum", "success", found, no_data, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Yahoo Finance AUM enricher")
    parser.add_argument("--apply",    action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",    type=int,            help="Limiter à N fonds")
    parser.add_argument("--etf-only", action="store_true", help="Ne traiter que les ETFs")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, etf_only=args.etf_only)
