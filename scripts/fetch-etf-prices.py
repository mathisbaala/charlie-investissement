#!/usr/bin/env python3
"""
fetch-etf-prices.py

Fetches real weekly price history for all ETFs in src/data/etfs.json
using Yahoo Finance (free, no API key required).

Also computes real financial metrics from price history:
  performance1Y, performance3YAnnualized, performance5YAnnualized,
  volatility1Y, volatility3Y, sharpe1Y, sharpe3Y, maxDrawdown1Y, maxDrawdown3Y

Usage:
  python3 scripts/fetch-etf-prices.py              # update all
  python3 scripts/fetch-etf-prices.py --dry-run    # print what would be fetched
  python3 scripts/fetch-etf-prices.py --isin IE00B4L5Y983  # single ETF

Requirements:
  pip install yfinance
"""

import json
import math
import sys
import time
import warnings
from datetime import datetime, timedelta
from pathlib import Path

warnings.filterwarnings("ignore")

try:
    import yfinance as yf
except ImportError:
    print("❌  yfinance not installed. Run: pip install yfinance")
    sys.exit(1)

# ─── Paths ────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent
ETFS_PATH = ROOT / "src" / "data" / "etfs.json"

# ─── ISIN → Yahoo Finance ticker mapping ─────────────────────────────────────
# Tickers validated against Yahoo Finance as of 2025.
# Preference order: Euronext Paris (.PA) > Euronext Amsterdam (.AS) > LSE (.L) > XETRA (.DE)

ISIN_TO_YAHOO = {
    # ── World / Global ────────────────────────────────────────────────────────
    "LU2655993207": "CW8.PA",      # Amundi MSCI World II — Euronext Paris
    "IE00B4L5Y983": "IWDA.AS",     # iShares Core MSCI World — Euronext Amsterdam
    "IE00BK5BQT80": "VWCE.DE",     # Vanguard FTSE All-World — XETRA
    "LU0274208692": "XDWD.L",      # Xtrackers MSCI World Swap — LSE
    "IE00B6R52259": "SSAC.L",      # iShares MSCI ACWI — LSE
    "FR0010315770": "EWLD.PA",     # Amundi MSCI World PEA — Euronext Paris

    # ── S&P 500 ───────────────────────────────────────────────────────────────
    "LU1681048804": "PE500.PA",    # Amundi S&P 500 Acc — Euronext Paris
    "IE00B5BMR087": "CSPX.L",      # iShares Core S&P 500 Acc — LSE
    "LU0490618542": "DBPK.DE",     # Xtrackers S&P 500 Swap — XETRA
    "IE00B6YX5C33": "SPY5.L",      # SPDR S&P 500 Dist — LSE
    "LU0496786574": "500.PA",      # Amundi S&P 500 Dist — Euronext Paris

    # ── Nasdaq ────────────────────────────────────────────────────────────────
    "LU1829221024": "ANX.PA",      # Amundi Nasdaq-100 II — Euronext Paris
    "IE0032077012": "EQQQ.L",      # Invesco EQQQ Nasdaq-100 — LSE

    # ── USA ───────────────────────────────────────────────────────────────────
    "LU1681043599": "CU2.PA",      # Amundi MSCI USA — Euronext Paris

    # ── Europe ────────────────────────────────────────────────────────────────
    "LU0908500753": "MEU.PA",      # Amundi STOXX Europe 600 — Euronext Paris
    "IE00B53L3W79": "EXW1.DE",     # iShares Core EURO STOXX 50 — XETRA
    "LU1681043003": "MEUR.PA",     # Amundi MSCI Europe — Euronext Paris
    "LU1803723967": "ESGE.PA",     # Amundi MSCI Europe ESG — Euronext Paris
    "LU1681043755": "EUDV.L",      # Amundi MSCI Europe High Dividend — LSE

    # ── France ────────────────────────────────────────────────────────────────
    "FR0007052782": "C40.PA",      # Amundi CAC 40 ESG — Euronext Paris
    "FR0010150458": "C4D.PA",      # BNP Paribas Easy CAC 40 ESG — Euronext Paris

    # ── Emerging Markets ──────────────────────────────────────────────────────
    "LU1437016972": "AEEM.PA",     # Amundi MSCI Emerging Markets — Euronext Paris
    "IE00BKM4GZ66": "EIMI.L",      # iShares Core MSCI EM IMI — LSE
    "IE00BJ38QD84": "CNYA.L",      # iShares MSCI China — LSE

    # ── Japan ─────────────────────────────────────────────────────────────────
    "LU1781541252": "IJPN.L",      # Amundi MSCI Japan EUR Hedged — LSE
    "IE00B4L5YX21": "IJPA.L",      # iShares Core MSCI Japan IMI — LSE

    # ── SRI / ESG ─────────────────────────────────────────────────────────────
    "LU1861134382": "MWRD.DE",     # Amundi MSCI World SRI — XETRA
    "LU1291109293": "WSRI.PA",     # BNP Paribas Easy MSCI World SRI — Euronext Paris
    "LU1792117340": "ESE.PA",      # Amundi S&P 500 ESG — Euronext Paris
    "LU1553238799": "SREP.PA",     # BNP Paribas Easy MSCI World SRI PAB — Euronext Paris

    # ── Bonds ─────────────────────────────────────────────────────────────────
    "IE00B3F81R35": "IEAC.L",      # iShares Core EUR Corp Bond — LSE
    "IE00B66F4759": "IHYG.L",      # iShares EUR High Yield Corp Bond — LSE
    "LU1829219127": "GAGG.PA",     # Amundi Global Aggregate — Euronext Paris
    "LU2093558982": "CLMA.PA",     # Amundi EUR Corp Green Bond — Euronext Paris
    "LU1670724370": "TIPS.L",      # Amundi US TIPS EUR Hedged — LSE

    # ── Gold / Commodities ────────────────────────────────────────────────────
    "FR0013416716": "CI2.PA",      # Amundi Physical Gold ETC — Euronext Paris
    "GB00BN1DGD90": "PHAU.L",      # WisdomTree Core Physical Gold — LSE

    # ── Money Market ──────────────────────────────────────────────────────────
    "LU1190417599": "CSH.PA",      # Amundi EUR Overnight Return — Euronext Paris

    # ── Small Cap ─────────────────────────────────────────────────────────────
    "LU1681038599": "RS2K.PA",     # Amundi Russell 2000 — Euronext Paris

    # ── Thematic ─────────────────────────────────────────────────────────────
    "IE00B6R52036": "ISAG.L",      # iShares Agribusiness — LSE
    "LU1105284243": "INRG.L",      # Amundi MSCI New Energy ESG — LSE (iShares Clean Energy proxy)
    "LU1861132186": "ROBO.L",      # Amundi MSCI Robotics & AI — LSE

    # ── Sectoral ─────────────────────────────────────────────────────────────
    "LU1681047160": "HLTW.PA",     # Amundi MSCI World Health Care — Euronext Paris
    "LU1681047590": "IUFS.L",      # Amundi MSCI World Financials — LSE

    # ── Real Estate ───────────────────────────────────────────────────────────
    "LU1437018598": "EPRA.PA",     # Amundi FTSE EPRA Nareit Global — Euronext Paris
    "LU1291101555": "IQQP.DE",     # BNP FTSE EPRA Nareit Europe — XETRA

    # ── Factor / Smart Beta ───────────────────────────────────────────────────
    "LU2023678282": "IWMO.L",      # Amundi MSCI World Momentum — LSE
    "LU2023677128": "IWQU.L",      # Amundi MSCI World Quality — LSE
    "LU2023678951": "MVOL.L",      # Amundi MSCI World Min Volatility — LSE

    # ── NOT MAPPED (no Yahoo ticker found) ───────────────────────────────────
    # "LU1829220984": None          # Amundi Euro Gov Bond 10-15Y — not listed on Yahoo
    # "IE000RFHWXY5": None          # iShares iBonds Dec 2027 — too recent
}

# ─── CLI args ─────────────────────────────────────────────────────────────────

args = sys.argv[1:]
DRY_RUN = "--dry-run" in args
SINGLE_ISIN = None
if "--isin" in args:
    idx = args.index("--isin")
    if idx + 1 < len(args):
        SINGLE_ISIN = args[idx + 1]

# ─── Load ETFs ────────────────────────────────────────────────────────────────

with open(ETFS_PATH) as f:
    etfs = json.load(f)

mappable = [e for e in etfs if e["isin"] in ISIN_TO_YAHOO]
unmappable = [e for e in etfs if e["isin"] not in ISIN_TO_YAHOO]

print(f"\n📊 charlie-screener ETF price pipeline (Yahoo Finance)")
print(f"   ETFs total: {len(etfs)}")
print(f"   Avec ticker Yahoo (fetch): {len(mappable)}")
print(f"   Sans ticker (ignorés):     {len(unmappable)}")

if unmappable:
    print(f"\n   ⚠️  Sans mapping:")
    for e in unmappable:
        print(f"      {e['isin']} — {e['name'][:55]}")

if DRY_RUN:
    print(f"\n🔍  DRY RUN — fetch prévu pour:")
    for e in mappable:
        ticker = ISIN_TO_YAHOO[e["isin"]]
        print(f"   {ticker:12s} ← {e['isin']}  {e['name'][:45]}")
    print(f"\n✅  Dry run OK. Lance sans --dry-run pour fetcher.")
    sys.exit(0)

if SINGLE_ISIN:
    if SINGLE_ISIN not in ISIN_TO_YAHOO:
        print(f"❌  Pas de ticker Yahoo pour: {SINGLE_ISIN}")
        sys.exit(1)
    target_isins = [SINGLE_ISIN]
    print(f"\n🎯  Mode ISIN unique: {SINGLE_ISIN} ({ISIN_TO_YAHOO[SINGLE_ISIN]})")
else:
    target_isins = list(ISIN_TO_YAHOO.keys())

# ─── Math helpers ─────────────────────────────────────────────────────────────

try:
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).parent))
    from db import get_ecb_rate as _get_ecb_rate, upsert_fund, upsert_prices, log_run
    RISK_FREE_RATE = _get_ecb_rate()
    _DB_AVAILABLE = True
except Exception:
    RISK_FREE_RATE = 0.035
    _DB_AVAILABLE = False

def annualized_return(prices: list[float], years: float) -> float | None:
    """CAGR from a price series."""
    if len(prices) < 2 or years <= 0:
        return None
    return (prices[-1] / prices[0]) ** (1 / years) - 1

def annualized_volatility(weekly_returns: list[float]) -> float:
    """Annualized volatility from weekly returns (×√52)."""
    if len(weekly_returns) < 4:
        return None
    n = len(weekly_returns)
    mean = sum(weekly_returns) / n
    variance = sum((r - mean) ** 2 for r in weekly_returns) / (n - 1)
    return math.sqrt(variance * 52)

def sharpe(ann_return: float | None, ann_vol: float | None) -> float | None:
    if ann_return is None or ann_vol is None or ann_vol == 0:
        return None
    return (ann_return - RISK_FREE_RATE) / ann_vol

def max_drawdown(prices: list[float]) -> float | None:
    """Maximum drawdown (negative %)."""
    if len(prices) < 2:
        return None
    peak = prices[0]
    max_dd = 0.0
    for p in prices:
        if p > peak:
            peak = p
        dd = (p - peak) / peak
        if dd < max_dd:
            max_dd = dd
    return max_dd

def compute_metrics(price_history: list[dict]) -> dict:
    """Compute financial metrics from weekly price history."""
    if not price_history or len(price_history) < 4:
        return {}

    closes = [p["close"] for p in price_history]
    dates  = [p["date"]  for p in price_history]

    now = datetime.now()
    def prices_since(years: float) -> list[float]:
        cutoff = now - timedelta(days=years * 365.25)
        cutoff_str = cutoff.strftime("%Y-%m-%d")
        subset = [(d, c) for d, c in zip(dates, closes) if d >= cutoff_str]
        return [c for _, c in subset]

    # 1Y data
    closes_1y = prices_since(1.0)
    # 3Y data
    closes_3y = prices_since(3.0)
    # 5Y data
    closes_5y = prices_since(5.0)
    # All (for averagePerformance)
    closes_all = closes

    def weekly_returns(prices):
        return [(prices[i] / prices[i-1]) - 1 for i in range(1, len(prices))]

    metrics = {}

    # Performances
    p1y = annualized_return(closes_1y, 1.0)
    p3y = annualized_return(closes_3y, 3.0)
    p5y = annualized_return(closes_5y, 5.0)

    if p1y is not None:
        metrics["performance1Y"] = round(p1y * 100, 2)
    if p3y is not None:
        metrics["performance3YAnnualized"] = round(p3y * 100, 2)
    if p5y is not None:
        metrics["performance5YAnnualized"] = round(p5y * 100, 2)

    # Average performance (mean of available periods)
    available_perfs = [v for v in [p1y, p3y, p5y] if v is not None]
    if available_perfs:
        metrics["averagePerformance"] = round(sum(available_perfs) / len(available_perfs) * 100, 2)

    # Volatility
    vol_1y = annualized_volatility(weekly_returns(closes_1y)) if len(closes_1y) >= 4 else None
    vol_3y = annualized_volatility(weekly_returns(closes_3y)) if len(closes_3y) >= 4 else None

    if vol_1y is not None:
        metrics["volatility1Y"] = round(vol_1y * 100, 2)
    if vol_3y is not None:
        metrics["volatility3Y"] = round(vol_3y * 100, 2)

    # Sharpe
    s1y = sharpe(p1y, vol_1y)
    s3y = sharpe(p3y, vol_3y)

    if s1y is not None:
        metrics["sharpe1Y"] = round(s1y, 3)
    if s3y is not None:
        metrics["sharpe3Y"] = round(s3y, 3)

    # Max drawdown
    dd_1y = max_drawdown(closes_1y) if len(closes_1y) >= 2 else None
    dd_3y = max_drawdown(closes_3y) if len(closes_3y) >= 2 else None

    if dd_1y is not None:
        metrics["maxDrawdown1Y"] = round(dd_1y * 100, 2)
    if dd_3y is not None:
        metrics["maxDrawdown3Y"] = round(dd_3y * 100, 2)

    # SRRI from 3Y volatility (standard ESMA methodology)
    if vol_3y is not None:
        v = vol_3y * 100
        if v < 0.5:
            srri = 1
        elif v < 2.0:
            srri = 2
        elif v < 5.0:
            srri = 3
        elif v < 10.0:
            srri = 4
        elif v < 15.0:
            srri = 5
        elif v < 25.0:
            srri = 6
        else:
            srri = 7
        metrics["srri"] = srri

    return metrics


# ─── Fetch ────────────────────────────────────────────────────────────────────

print(f"\n🔄  Fetch des cours hebdomadaires (5 ans)...")
start_time = time.time()

prices_by_isin: dict[str, list[dict]] = {}
today = datetime.now()
start_date = (today - timedelta(days=5 * 365 + 30)).strftime("%Y-%m-%d")

for isin in target_isins:
    ticker_sym = ISIN_TO_YAHOO[isin]
    print(f"  Fetching {ticker_sym:12s} ({isin})...", end="", flush=True)
    try:
        raw = yf.download(
            ticker_sym,
            start=start_date,
            interval="1wk",
            progress=False,
            auto_adjust=True,
        )
        if raw.empty:
            print(" ⚠ vide")
            continue

        # yfinance returns multi-level columns when auto_adjust=True
        close_col = ("Close", ticker_sym) if ("Close", ticker_sym) in raw.columns else "Close"
        close_series = raw[close_col].dropna()

        price_history = [
            {"date": str(idx.date()), "close": round(float(val), 4)}
            for idx, val in close_series.items()
            if not math.isnan(val)
        ]
        price_history.sort(key=lambda p: p["date"])

        if len(price_history) < 4:
            print(f" ⚠ trop peu de points ({len(price_history)})")
            continue

        prices_by_isin[isin] = price_history
        print(f" ✓  {len(price_history)} points hebdo")

    except Exception as e:
        print(f" ✗ {e}")

    time.sleep(0.3)   # gentle rate limit

# ─── Update ETFs ──────────────────────────────────────────────────────────────

updated = 0
failed  = 0

updated_etfs = []
for fund in etfs:
    isin = fund["isin"]
    if isin not in target_isins or isin not in prices_by_isin:
        if isin in target_isins:
            failed += 1
            print(f"  ✗ {isin}: pas de données — conserve estimé")
        updated_etfs.append(fund)
        continue

    prices = prices_by_isin[isin]
    metrics = compute_metrics(prices)

    updated_fund = {
        **fund,
        "priceHistory": prices,
        "dataSource": "real",
        **metrics,   # overwrite estimated metrics with real computed values
    }
    updated_etfs.append(updated_fund)
    updated += 1

# ─── Write JSON (rétrocompatibilité frontend pendant transition V1→V2) ─────────

with open(ETFS_PATH, "w") as f:
    json.dump(updated_etfs, f, ensure_ascii=False, indent=2)
    f.write("\n")

# ─── Write Supabase (V2) ──────────────────────────────────────────────────────

_run_started = datetime.now()
_db_inserted = 0
_db_failed   = 0

if _DB_AVAILABLE:
    print(f"\n🔄  Supabase — écriture VL + métriques ETF...")
    for fund in updated_etfs:
        isin = fund["isin"]
        if isin not in prices_by_isin:
            continue
        prices = prices_by_isin[isin]
        prices_for_db = [{"date": p["date"], "nav": p["close"]} for p in prices]
        n_ins, n_fail = upsert_prices(isin, prices_for_db, source="yahoo-finance")
        _db_inserted += n_ins
        _db_failed   += n_fail

        fund_row = {
            "isin":               isin,
            "performance_1y":     fund.get("performance1Y"),
            "performance_3y":     fund.get("performance3YAnnualized"),
            "performance_5y":     fund.get("performance5YAnnualized"),
            "average_performance":fund.get("averagePerformance"),
            "volatility_1y":      fund.get("volatility1Y"),
            "volatility_3y":      fund.get("volatility3Y"),
            "sharpe_1y":          fund.get("sharpe1Y"),
            "sharpe_3y":          fund.get("sharpe3Y"),
            "max_drawdown_1y":    fund.get("maxDrawdown1Y"),
            "max_drawdown_3y":    fund.get("maxDrawdown3Y"),
            "srri":               fund.get("srri"),
            "data_source":        "real",
        }
        upsert_fund(fund_row)

    status = "success" if _db_failed == 0 else "partial" if _db_inserted > 0 else "failed"
    log_run(
        scraper="yahoo-finance-etf",
        status=status,
        records_processed=_db_inserted,
        records_failed=_db_failed,
        started_at=_run_started,
    )
    print(f"   ✅  Supabase : {_db_inserted} VL insérées, {_db_failed} échecs")

elapsed = round(time.time() - start_time, 1)
print(f"\n✅  Terminé en {elapsed}s")
print(f"   Mis à jour (données réelles): {updated} ETFs")
print(f"   Conservés (estimé):           {failed + len(unmappable)} ETFs")
