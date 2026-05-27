#!/usr/bin/env python3
"""
fetch-nav-yahoo.py — VL historiques et métriques via Yahoo Finance
==================================================================
Lit les ISINs depuis investissement_funds, télécharge 5 ans de VL
hebdomadaires via yfinance (qui accepte les ISINs directement pour
les fonds OPCVM français), calcule les métriques et écrit dans
investissement_fund_prices + met à jour investissement_funds.

Couverture empirique : ~76% des OPCVM français sur Yahoo Finance.

Usage :
    python3 scripts/scrapers/fetch-nav-yahoo.py [--apply] [--limit N]
    python3 scripts/scrapers/fetch-nav-yahoo.py --apply              (tous)
    python3 scripts/scrapers/fetch-nav-yahoo.py --apply --limit 500  (batch)
"""

import math
import sys
import time
import argparse
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

warnings.filterwarnings("ignore")

try:
    import yfinance as yf
except ImportError:
    print("yfinance manquant. Lance : pip install yfinance")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, get_ecb_rate, upsert_fund, upsert_prices, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

BATCH_SIZE     = 50    # ISINs par appel yf.download()
DELAY_BATCH    = 1.5   # secondes entre batches (respecter Yahoo)
DELAY_INFO     = 0.4   # secondes entre appels .info()
LOOKBACK_YEARS = 5
MIN_PRICES     = 4     # minimum de points pour calculer des métriques

RISK_FREE_RATE = get_ecb_rate()

# ─── Calculs financiers ────────────────────────────────────────────────────────

def annualized_return(prices, years):
    if len(prices) < 2 or years <= 0:
        return None
    return (prices[-1] / prices[0]) ** (1 / years) - 1

def annualized_volatility(weekly_returns):
    if len(weekly_returns) < 4:
        return None
    n = len(weekly_returns)
    mean = sum(weekly_returns) / n
    var = sum((r - mean) ** 2 for r in weekly_returns) / (n - 1)
    return math.sqrt(var * 52)

def sharpe_ratio(ann_return, ann_vol):
    if ann_return is None or ann_vol is None or ann_vol == 0:
        return None
    return (ann_return - RISK_FREE_RATE) / ann_vol

def max_drawdown(prices):
    if len(prices) < 2:
        return None
    peak = prices[0]
    dd = 0.0
    for p in prices:
        if p > peak:
            peak = p
        d = (p - peak) / peak
        if d < dd:
            dd = d
    return dd

def srri_from_vol(annual_vol_pct):
    v = annual_vol_pct
    if v < 0.5:  return 1
    if v < 2.0:  return 2
    if v < 5.0:  return 3
    if v < 10.0: return 4
    if v < 15.0: return 5
    if v < 25.0: return 6
    return 7

def compute_metrics(price_history):
    if len(price_history) < MIN_PRICES:
        return {}
    closes = [p["nav"] for p in price_history]
    dates  = [p["date"] for p in price_history]
    now    = datetime.now()

    def since(years):
        cutoff = (now - timedelta(days=years * 365.25)).strftime("%Y-%m-%d")
        return [c for d, c in zip(dates, closes) if d >= cutoff]

    def weekly_rets(prices):
        return [(prices[i] / prices[i-1]) - 1 for i in range(1, len(prices))]

    c1y = since(1.0)
    c3y = since(3.0)
    c5y = since(5.0)

    p1y = annualized_return(c1y, 1.0)
    p3y = annualized_return(c3y, 3.0)
    p5y = annualized_return(c5y, 5.0)
    v1y = annualized_volatility(weekly_rets(c1y)) if len(c1y) >= 4 else None
    v3y = annualized_volatility(weekly_rets(c3y)) if len(c3y) >= 4 else None

    m = {}
    if p1y is not None: m["performance_1y"] = round(p1y * 100, 2)
    if p3y is not None: m["performance_3y"] = round(p3y * 100, 2)
    if p5y is not None: m["performance_5y"] = round(p5y * 100, 2)
    if v1y is not None: m["volatility_1y"]  = round(v1y * 100, 2)
    if v3y is not None: m["volatility_3y"]  = round(v3y * 100, 2)
    if v1y is not None: m["sharpe_1y"]      = round(sharpe_ratio(p1y, v1y) or 0, 3)
    if v3y is not None: m["sharpe_3y"]      = round(sharpe_ratio(p3y, v3y) or 0, 3)
    c1y2 = since(1.0)
    c3y2 = since(3.0)
    if len(c1y2) >= 2: m["max_drawdown_1y"] = round((max_drawdown(c1y2) or 0) * 100, 2)
    if len(c3y2) >= 2: m["max_drawdown_3y"] = round((max_drawdown(c3y2) or 0) * 100, 2)
    if v3y is not None: m["srri"]           = srri_from_vol(v3y * 100)
    perfs = [x for x in [p1y, p3y, p5y] if x is not None]
    if perfs: m["average_performance"]      = round(sum(perfs) / len(perfs) * 100, 2)
    return m


# ─── Fetch prix en batch ───────────────────────────────────────────────────────

def fetch_prices_batch(isins: list[str]) -> dict[str, list[dict]]:
    """Télécharge les VL hebdomadaires pour une liste d'ISINs."""
    start = (datetime.now() - timedelta(days=LOOKBACK_YEARS * 365 + 30)).strftime("%Y-%m-%d")
    results = {}
    try:
        raw = yf.download(
            isins,
            start=start,
            interval="1wk",
            progress=False,
            auto_adjust=True,
            group_by="ticker",
        )
        if raw.empty:
            return {}

        for isin in isins:
            try:
                if len(isins) == 1:
                    series = raw["Close"].dropna()
                elif ("Close", isin) in raw.columns:
                    series = raw["Close"][isin].dropna()
                elif isin in raw.columns.get_level_values(0):
                    series = raw[isin]["Close"].dropna()
                else:
                    continue

                prices = [
                    {"date": str(idx.date()), "nav": round(float(v), 4)}
                    for idx, v in series.items()
                    if not math.isnan(float(v))
                ]
                prices.sort(key=lambda p: p["date"])
                if len(prices) >= MIN_PRICES:
                    results[isin] = prices
            except Exception:
                continue
    except Exception:
        pass
    return results


def fetch_info(isin: str) -> dict:
    """Récupère les métadonnées Yahoo Finance (AUM, Morningstar rating)."""
    try:
        info = yf.Ticker(isin).info
        meta = {}
        if info.get("totalAssets"):
            meta["aum_eur"] = int(info["totalAssets"])
        if info.get("morningStarOverallRating"):
            meta["morningstar_rating"] = int(info["morningStarOverallRating"])
        if info.get("netExpenseRatio"):
            ter = float(info["netExpenseRatio"]) / 100
            if 0 < ter < 0.20:
                meta["ongoing_charges"] = round(ter, 6)
        return meta
    except Exception:
        return {}


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Fetch NAV Yahoo Finance — VL + métriques")
    print("=" * 60)
    print(f"  Mode      : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Lookback  : {LOOKBACK_YEARS} ans")
    print(f"  Taux sans risque (ECB) : {RISK_FREE_RATE*100:.2f}%")
    if limit:
        print(f"  Limite    : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Récupérer tous les fonds OPCVM + ETF avec pagination
    funds = []
    page_size = 1000
    offset    = 0
    while True:
        query = client.table("investissement_funds") \
            .select("isin, name, product_type") \
            .in_("product_type", ["opcvm", "etf"]) \
            .range(offset, offset + page_size - 1)
        resp = query.execute()
        batch = resp.data or []
        funds.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
        if limit and len(funds) >= limit:
            funds = funds[:limit]
            break

    isins = [f["isin"] for f in funds if f.get("isin")]
    print(f"  {len(isins)} fonds à traiter")
    print()

    # Traitement en batches — écriture incrémentale après chaque batch
    n_batches   = math.ceil(len(isins) / BATCH_SIZE)
    total_found = 0
    total_prices_written = 0
    total_funds_written  = 0
    total_fail  = 0

    for i in range(n_batches):
        batch = isins[i * BATCH_SIZE : (i + 1) * BATCH_SIZE]
        pct   = (i + 1) / n_batches * 100
        print(f"  Batch {i+1:4d}/{n_batches} ({pct:5.1f}%)  [{batch[0]}…]", end=" ", flush=True)

        ph = fetch_prices_batch(batch)
        print(f"→ {len(ph):3d}/{len(batch)} avec VL", flush=True)
        total_found += len(ph)

        if not ph:
            time.sleep(DELAY_BATCH)
            continue

        # Phase 2 inline : métadonnées
        meta_map: dict[str, dict] = {}
        for isin in ph:
            meta = fetch_info(isin)
            if meta:
                meta_map[isin] = meta
            time.sleep(DELAY_INFO)

        # Phase 3 inline : écriture Supabase
        if apply:
            for isin, prices in ph.items():
                n_ok, n_fail = upsert_prices(isin, prices, source="yahoo-finance")
                total_prices_written += n_ok
                total_fail += n_fail

                metrics  = compute_metrics(prices)
                meta     = meta_map.get(isin, {})
                fund_row = {
                    "isin":        isin,
                    "data_source": "yahoo-finance",
                    **metrics,
                    **meta,
                }
                upsert_fund(fund_row)
                total_funds_written += 1

        time.sleep(DELAY_BATCH)

        if (i + 1) % 20 == 0:
            print(f"    [Progression : {total_found}/{len(isins)} fonds couverts"
                  + (f", {total_prices_written:,} VL écrites" if apply else "") + "]")

    found_pct = total_found / len(isins) * 100 if isins else 0
    print(f"\n  VL récupérées : {total_found}/{len(isins)} fonds ({found_pct:.0f}%)")

    if apply:
        print(f"  ✓ {total_funds_written} fonds mis à jour")
        print(f"  ✓ {total_prices_written:,} VL insérées dans investissement_fund_prices")
        print(f"  ✗ {total_fail} échecs")
        log_run("fetch-nav-yahoo", "success", total_prices_written, total_fail, started_at=started)
    else:
        print(f"  (dry-run — aucune écriture)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch NAV + métriques via Yahoo Finance")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,           help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
