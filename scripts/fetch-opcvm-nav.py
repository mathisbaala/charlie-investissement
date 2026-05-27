#!/usr/bin/env python3
"""
fetch-opcvm-nav.py

Fetches real NAV (valeur liquidative) history for French OPCVM from Yahoo Finance.
Yahoo Finance stores French fund NAV data using ISIN as ticker (no suffix needed).

Coverage (empirical):
  ~76% of funds have full 5Y weekly history
  ~88% have at least 2 data points
  ~80% have real Morningstar ratings
  ~93% have real AUM (totalAssets)

Also fetches via .info():
  - morningStarOverallRating  → real Morningstar stars (1-5)
  - morningStarRiskRating     → real SRRI proxy
  - totalAssets               → real AUM in EUR

Computes from price series (same methodology as ETF script):
  performance1Y/3Y/5Y, volatility1Y/3Y, sharpe1Y/3Y,
  maxDrawdown1Y/3Y, srri (ESMA methodology)

Usage:
  python3 scripts/fetch-opcvm-nav.py                   # all funds
  python3 scripts/fetch-opcvm-nav.py --dry-run          # print stats only
  python3 scripts/fetch-opcvm-nav.py --batch 0 500     # funds 0..499
  python3 scripts/fetch-opcvm-nav.py --resume           # skip already-updated

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

# ─── Config ───────────────────────────────────────────────────────────────────

ROOT       = Path(__file__).parent.parent
FUNDS_PATH = ROOT / "src" / "data" / "funds.json"
PROGRESS_PATH = ROOT / "scripts" / ".opcvm-progress.json"

try:
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).parent))
    from db import get_ecb_rate as _get_ecb_rate, upsert_fund, upsert_prices, log_run
    RISK_FREE_RATE = _get_ecb_rate()
    _DB_AVAILABLE = True
except Exception:
    RISK_FREE_RATE = 0.035   # fallback si db.py non disponible
    _DB_AVAILABLE = False
BATCH_PRICE    = 50      # tickers per yf.download() call
DELAY_BATCH    = 1.5     # seconds between price batches
DELAY_INFO     = 0.4     # seconds between .info() calls

# ─── CLI args ─────────────────────────────────────────────────────────────────

args        = sys.argv[1:]
DRY_RUN     = "--dry-run" in args
RESUME      = "--resume" in args
FORCE       = "--force" in args

BATCH_START, BATCH_END = None, None
if "--batch" in args:
    idx = args.index("--batch")
    BATCH_START = int(args[idx + 1])
    BATCH_END   = int(args[idx + 2])

# ─── Math helpers (identical to fetch-etf-prices.py) ─────────────────────────

def annualized_return(prices, years):
    if len(prices) < 2 or years <= 0:
        return None
    return (prices[-1] / prices[0]) ** (1 / years) - 1

def annualized_volatility(weekly_returns):
    if len(weekly_returns) < 4:
        return None
    n    = len(weekly_returns)
    mean = sum(weekly_returns) / n
    var  = sum((r - mean) ** 2 for r in weekly_returns) / (n - 1)
    return math.sqrt(var * 52)

def sharpe(ann_return, ann_vol):
    if ann_return is None or ann_vol is None or ann_vol == 0:
        return None
    return (ann_return - RISK_FREE_RATE) / ann_vol

def max_drawdown(prices):
    if len(prices) < 2:
        return None
    peak   = prices[0]
    max_dd = 0.0
    for p in prices:
        if p > peak:
            peak = p
        dd = (p - peak) / peak
        if dd < max_dd:
            max_dd = dd
    return max_dd

def srri_from_vol(vol_3y_pct):
    v = vol_3y_pct
    if v < 0.5:   return 1
    if v < 2.0:   return 2
    if v < 5.0:   return 3
    if v < 10.0:  return 4
    if v < 15.0:  return 5
    if v < 25.0:  return 6
    return 7

def compute_metrics(price_history):
    if not price_history or len(price_history) < 4:
        return {}

    closes = [p["close"] for p in price_history]
    dates  = [p["date"]  for p in price_history]
    now    = datetime.now()

    def prices_since(years):
        cutoff = (now - timedelta(days=years * 365.25)).strftime("%Y-%m-%d")
        return [c for d, c in zip(dates, closes) if d >= cutoff]

    def weekly_rets(prices):
        return [(prices[i] / prices[i-1]) - 1 for i in range(1, len(prices))]

    c1y = prices_since(1.0)
    c3y = prices_since(3.0)
    c5y = prices_since(5.0)

    p1y  = annualized_return(c1y, 1.0)
    p3y  = annualized_return(c3y, 3.0)
    p5y  = annualized_return(c5y, 5.0)

    v1y  = annualized_volatility(weekly_rets(c1y)) if len(c1y) >= 4 else None
    v3y  = annualized_volatility(weekly_rets(c3y)) if len(c3y) >= 4 else None

    s1y  = sharpe(p1y, v1y)
    s3y  = sharpe(p3y, v3y)

    dd1y = max_drawdown(c1y) if len(c1y) >= 2 else None
    dd3y = max_drawdown(c3y) if len(c3y) >= 2 else None

    available = [v for v in [p1y, p3y, p5y] if v is not None]

    m = {}
    if p1y  is not None: m["performance1Y"]            = round(p1y  * 100, 2)
    if p3y  is not None: m["performance3YAnnualized"]  = round(p3y  * 100, 2)
    if p5y  is not None: m["performance5YAnnualized"]  = round(p5y  * 100, 2)
    if available:        m["averagePerformance"]        = round(sum(available) / len(available) * 100, 2)
    if v1y  is not None: m["volatility1Y"]             = round(v1y  * 100, 2)
    if v3y  is not None: m["volatility3Y"]             = round(v3y  * 100, 2)
    if s1y  is not None: m["sharpe1Y"]                 = round(s1y, 3)
    if s3y  is not None: m["sharpe3Y"]                 = round(s3y, 3)
    if dd1y is not None: m["maxDrawdown1Y"]            = round(dd1y * 100, 2)
    if dd3y is not None: m["maxDrawdown3Y"]            = round(dd3y * 100, 2)
    if v3y  is not None: m["srri"]                     = srri_from_vol(v3y * 100)

    return m

# ─── Load data ────────────────────────────────────────────────────────────────

with open(FUNDS_PATH) as f:
    funds = json.load(f)

# Load progress cache (ISINs already processed)
progress = {}
if PROGRESS_PATH.exists() and RESUME:
    with open(PROGRESS_PATH) as f:
        progress = json.load(f)
    print(f"♻️   Reprise — {len(progress)} ISINs déjà traités")

# Apply batch slice
target_funds = funds
if BATCH_START is not None:
    target_funds = funds[BATCH_START:BATCH_END]
    print(f"📦  Mode batch: fonds {BATCH_START}–{BATCH_END} ({len(target_funds)} fonds)")

# Skip already-updated in resume mode
if RESUME and not FORCE:
    target_funds = [f for f in target_funds if f["isin"] not in progress]
    print(f"   → {len(target_funds)} restants à traiter")

print(f"\n📊  OPCVM NAV pipeline (Yahoo Finance)")
print(f"   Fonds total: {len(funds)}")
print(f"   Fonds ciblés cette session: {len(target_funds)}")

if DRY_RUN:
    print(f"\n🔍  DRY RUN — estimation couverture sur 50 fonds...")
    sample = target_funds[:50]
    ok, nok = 0, 0
    for fund in sample:
        try:
            d = yf.download(fund["isin"], period="1mo", interval="1wk", progress=False, auto_adjust=True)
            if len(d) >= 1: ok += 1
            else: nok += 1
        except:
            nok += 1
    print(f"   Couverture estimée: {ok}/{len(sample)} ({ok/len(sample)*100:.0f}%)")
    print(f"   Projection sur {len(target_funds)} fonds: ~{int(len(target_funds)*ok/len(sample))} avec données")
    print(f"\n✅  Dry run OK. Lance sans --dry-run pour fetcher.")
    sys.exit(0)

# ─── Phase 1 : Fetch price history in batches ─────────────────────────────────

print(f"\n🔄  Phase 1 — Cours hebdomadaires (5 ans) par batch de {BATCH_PRICE}...")

start_date   = (datetime.now() - timedelta(days=5 * 365 + 30)).strftime("%Y-%m-%d")
prices_by_isin = {}
isins        = [f["isin"] for f in target_funds]
n_batches    = math.ceil(len(isins) / BATCH_PRICE)

for i in range(n_batches):
    batch    = isins[i * BATCH_PRICE : (i + 1) * BATCH_PRICE]
    pct      = (i + 1) / n_batches * 100
    print(f"  Batch {i+1}/{n_batches} ({pct:.0f}%)  [{batch[0]}…]", end=" ", flush=True)

    try:
        raw = yf.download(
            batch,
            start=start_date,
            interval="1wk",
            progress=False,
            auto_adjust=True,
            group_by="ticker",
        )

        ok_count = 0
        for isin in batch:
            try:
                # Multi-ticker: raw["Close"][isin] or raw[isin]["Close"]
                if len(batch) == 1:
                    close_series = raw["Close"].dropna()
                elif ("Close", isin) in raw.columns:
                    close_series = raw["Close"][isin].dropna()
                elif isin in raw.columns.get_level_values(0):
                    close_series = raw[isin]["Close"].dropna()
                else:
                    continue

                ph = [
                    {"date": str(idx.date()), "close": round(float(val), 4)}
                    for idx, val in close_series.items()
                    if not math.isnan(float(val))
                ]
                ph.sort(key=lambda p: p["date"])

                if len(ph) >= 4:
                    prices_by_isin[isin] = ph
                    ok_count += 1
            except Exception:
                continue

        print(f"✓  {ok_count}/{len(batch)} ok")
    except Exception as e:
        print(f"✗  {e}")

    time.sleep(DELAY_BATCH)

print(f"\n   Prix récupérés: {len(prices_by_isin)}/{len(isins)} fonds ({len(prices_by_isin)/len(isins)*100:.0f}%)")

# ─── Phase 2 : Fetch metadata via .info() ─────────────────────────────────────

print(f"\n🔄  Phase 2 — Metadata (Morningstar, AUM) pour {len(prices_by_isin)} fonds...")

meta_by_isin = {}
fetched_info = 0

for isin in prices_by_isin:
    try:
        t    = yf.Ticker(isin)
        info = t.info
        meta = {}

        ms_rating = info.get("morningStarOverallRating")
        if ms_rating and ms_rating > 0:
            meta["morningstarRating"] = int(ms_rating)

        ms_risk = info.get("morningStarRiskRating")
        if ms_risk and ms_risk > 0:
            meta["srriMorningstar"] = int(ms_risk)

        total_assets = info.get("totalAssets")
        if total_assets and total_assets > 0:
            meta["aumEur"] = int(total_assets)

        if meta:
            meta_by_isin[isin] = meta
            fetched_info += 1

    except Exception:
        pass

    time.sleep(DELAY_INFO)

print(f"   Metadata récupérée: {fetched_info}/{len(prices_by_isin)} fonds")

# ─── Phase 3 : Merge + compute metrics ────────────────────────────────────────

print(f"\n⚙️   Phase 3 — Calcul des métriques réelles...")

updated = 0
unchanged = 0
fund_map = {f["isin"]: f for f in funds}

for isin, ph in prices_by_isin.items():
    if isin not in fund_map:
        continue

    fund    = fund_map[isin]
    metrics = compute_metrics(ph)
    meta    = meta_by_isin.get(isin, {})

    updated_fund = {
        **fund,
        "priceHistory": ph,
        "dataSource": "real",
        **metrics,
        **meta,
    }

    # SRRI: prefer computed from vol; fallback to Morningstar risk rating
    if "srri" not in updated_fund and "srriMorningstar" in meta:
        updated_fund["srri"] = meta["srriMorningstar"]
    updated_fund.pop("srriMorningstar", None)

    fund_map[isin] = updated_fund
    progress[isin] = True
    updated += 1

unchanged = len(target_funds) - updated
print(f"   Mis à jour: {updated} fonds")
print(f"   Non trouvés: {unchanged} fonds (conservent données estimées)")

# ─── Write JSON (rétrocompatibilité frontend pendant transition V1→V2) ─────────

updated_funds = [fund_map.get(f["isin"], f) for f in funds]
with open(FUNDS_PATH, "w") as fp:
    json.dump(updated_funds, fp, ensure_ascii=False, indent=2)
    fp.write("\n")

# Save progress cache
with open(PROGRESS_PATH, "w") as fp:
    json.dump(progress, fp)

# ─── Write Supabase (V2) ──────────────────────────────────────────────────────

_run_started = datetime.now()
_db_inserted = 0
_db_failed   = 0

if _DB_AVAILABLE and not DRY_RUN:
    print(f"\n🔄  Supabase — écriture VL + métriques...")

    for isin, ph in prices_by_isin.items():
        if isin not in fund_map:
            continue

        # Écrire les VL dans investissement_fund_prices
        # Yahoo Finance retourne des prix de marché hebdomadaires
        prices_for_db = [{"date": p["date"], "nav": p["close"]} for p in ph]
        n_ins, n_fail = upsert_prices(isin, prices_for_db, source="yahoo-finance")
        _db_inserted += n_ins
        _db_failed   += n_fail

        # Mettre à jour les métriques dans investissement_funds
        fund  = fund_map[isin]
        meta  = meta_by_isin.get(isin, {})
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
            "aum_eur":            meta.get("aumEur") or fund.get("aumEur"),
            "morningstar_rating": meta.get("morningstarRating"),
            "data_source":        "real",
        }
        upsert_fund(fund_row)

    # Log le run
    status = "success" if _db_failed == 0 else "partial" if _db_inserted > 0 else "failed"
    log_run(
        scraper="yahoo-finance",
        status=status,
        records_processed=_db_inserted,
        records_failed=_db_failed,
        started_at=_run_started,
    )
    print(f"   ✅  Supabase : {_db_inserted} VL insérées, {_db_failed} échecs")
elif not _DB_AVAILABLE:
    print(f"\n⚠️  db.py non disponible — seul funds.json mis à jour")

real_total = sum(1 for f in updated_funds if f.get("dataSource") == "real")
print(f"\n✅  Terminé")
print(f"   dataSource=real dans funds.json: {real_total}/{len(funds)} fonds")
print(f"   Cache de progression: scripts/.opcvm-progress.json")
