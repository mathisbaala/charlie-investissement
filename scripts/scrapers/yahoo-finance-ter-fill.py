#!/usr/bin/env python3
"""
yahoo-finance-ter-fill.py — TER manquant pour ETFs via Yahoo Finance (yfinance)
================================================================================
Cible les ETFs sans TER. Cherche le ticker Yahoo Finance par ISIN,
extrait netExpenseRatio / annualReportExpenseRatio.

Usage :
    python3 scripts/scrapers/yahoo-finance-ter-fill.py [--apply] [--limit N]
"""

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

WORKERS        = 4
RATE_LIMIT_SEC = 0.5
TIMEOUT        = 10
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
YF_SEARCH_URL  = "https://query1.finance.yahoo.com/v1/finance/search"


def find_ticker(session, isin):
    try:
        r = session.get(YF_SEARCH_URL,
            params={"q": isin, "quotesCount": 5, "newsCount": 0, "enableFuzzyQuery": False},
            stealthy_headers=True, timeout=TIMEOUT)
        if r.status != 200:
            return None
        quotes = json.loads(r.body.decode("utf-8")).get("quotes", [])
        for q in quotes:
            if q.get("quoteType") in ("ETF", "MUTUALFUND") and q.get("symbol"):
                return q["symbol"]
        if quotes and quotes[0].get("symbol"):
            return quotes[0]["symbol"]
    except Exception:
        pass
    return None


def fetch_ter(session, isin):
    sym = find_ticker(session, isin)
    if not sym:
        return None
    try:
        info = yf.Ticker(sym).info
        if not info:
            return None
        for key in ("annualReportExpenseRatio", "netExpenseRatio", "totalExpenseRatio"):
            er = info.get(key)
            if er and isinstance(er, (int, float)) and 0 < er < 0.20:
                return round(float(er), 6)
    except Exception:
        pass
    return None


def run(apply, limit):
    print("=" * 60)
    print("  Yahoo Finance TER Fill — TER pour ETFs via yfinance")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name")
            .eq("product_type", "etf")
            .is_("ter", "null")
            .is_("ongoing_charges", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < 1000:
            break
        if limit and len(funds) >= limit:
            break
        offset += 1000

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} ETFs sans TER\n")

    found = not_found = 0
    lock  = threading.Lock()
    now   = datetime.now(timezone.utc).isoformat()

    def process(args):
        nonlocal found, not_found
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT_SEC)
        ter = fetch_ter(session, isin)

        with lock:
            if ter:
                found += 1
                if i <= 20 or i % 100 == 0:
                    print(f"  ✓ [{i:4d}] {isin} | TER:{ter*100:.2f}% | {name}")
                if apply:
                    try:
                        client.table("investissement_funds") \
                            .update({"ter": ter, "ongoing_charges": ter, "updated_at": now}) \
                            .eq("isin", isin).execute()
                    except Exception as e:
                        if found <= 3:
                            print(f"  ✗ DB {isin}: {e}")
            else:
                not_found += 1
                if i <= 10 or i % 200 == 0:
                    print(f"  ✗ [{i:4d}] {isin} | no TER | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print(f"\n  ✓ {found} TERs trouvés, {not_found} introuvables")
    if apply:
        log_run("yahoo-finance-ter-fill", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply",  action="store_true")
    parser.add_argument("--limit",  type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
