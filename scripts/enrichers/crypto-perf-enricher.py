#!/usr/bin/env python3
"""
crypto-perf-enricher.py — Enrichissement perf/volatilité/Sharpe pour cryptos
=============================================================================
Cibles : cryptos (product_type='crypto') sans volatility_1y.
Source : Yahoo Finance via yfinance (paires {SYMBOL}-EUR, hebdo, 5y).

Pourquoi yfinance et pas CoinGecko :
  - CoinGecko free tier renvoie 401 sur market_chart days≥365 depuis 2024
  - Rate limit free tier très agressif (429 dès 1-2 req/min)
  - yfinance gratuit, sans clé, daily/hebdo dispo
  - Couverture : ~36/101 cryptos top (BTC/ETH/etc.) — suffisant pour l'essentiel

Pour chaque crypto trouvée sur Yahoo :
  1. Fetch 5 ans hebdo via yf.Ticker(SYMBOL-EUR).history()
  2. Upsert dans investissement_fund_prices (source='yahoo-crypto')
  3. Calcule via compute_fund_metrics (compute-metrics.py) :
       - volatility_1y, volatility_3y
       - sharpe_1y, sharpe_3y
       - max_drawdown_1y, max_drawdown_3y
       - performance_1y, performance_3y, performance_5y
       - srri (dérivé de la volatilité)
  4. Update investissement_funds

Usage :
    python3 scripts/enrichers/crypto-perf-enricher.py [--apply] [--limit N] [--isin CRYPTO_XXX]
"""

import sys
import time
import argparse
import importlib.util
import warnings
from datetime import datetime, timezone, date, timedelta
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    raise ImportError("yfinance non installé — pip install yfinance")

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_prices, update_funds_bulk, log_run, get_ecb_rate

# Helpers depuis compute-metrics.py (import dynamique car nom hyphené)
_spec = importlib.util.spec_from_file_location(
    "compute_metrics",
    Path(__file__).parent / "compute-metrics.py",
)
_cm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cm)
compute_fund_metrics = _cm.compute_fund_metrics
MIN_POINTS_1Y = _cm.MIN_POINTS_1Y

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT_SEC = 0.5    # Yahoo gentle rate limit
HISTORY_PERIOD = "5y"   # 5 ans hebdo


# ─── Yahoo helpers ────────────────────────────────────────────────────────────

def fetch_yahoo_history(symbol: str) -> list[tuple[str, float]] | None:
    """
    Fetch historique hebdo 5 ans depuis Yahoo Finance pour SYMBOL-EUR.
    Retourne [(YYYY-MM-DD, price)] ou None si indisponible.
    """
    ticker_sym = f"{symbol}-EUR"
    try:
        ticker = yf.Ticker(ticker_sym)
        df = ticker.history(period=HISTORY_PERIOD, interval="1wk", auto_adjust=True)
        if df.empty or "Close" not in df.columns:
            return None

        # Index est un DatetimeIndex
        history = []
        for idx, row in df.iterrows():
            close = row["Close"]
            if close is None or close <= 0 or (close != close):  # NaN check
                continue
            d = idx.date().isoformat()
            history.append((d, float(close)))
        history.sort(key=lambda x: x[0])
        return history if history else None
    except Exception as e:
        print(f"    ✗ yfinance {ticker_sym} : {type(e).__name__}: {e}")
        return None


def windows_from_history(history: list[tuple[str, float]]) -> dict[str, list[float]]:
    today = date.today()
    d_1y = (today - timedelta(days=365)).isoformat()
    d_3y = (today - timedelta(days=365 * 3)).isoformat()
    d_5y = (today - timedelta(days=365 * 5)).isoformat()
    return {
        "all": [p for _, p in history],
        "5y":  [p for d, p in history if d >= d_5y],
        "3y":  [p for d, p in history if d >= d_3y],
        "1y":  [p for d, p in history if d >= d_1y],
    }


# ─── Main ──────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, isin_filter: str | None):
    print("=" * 64)
    print("  Crypto Perf Enricher — vol/sharpe/drawdown via Yahoo Finance")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limit : {limit}")
    if isin_filter:
        print(f"  ISIN  : {isin_filter}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    rf      = get_ecb_rate()
    print(f"  Taux sans risque BCE : {rf * 100:.2f}%")
    print()

    # ── Sélection des cryptos cibles ──────────────────────────────────────────
    q = client.table("investissement_funds") \
        .select("isin, name, volatility_1y, performance_5y, aum_eur") \
        .eq("product_type", "crypto") \
        .is_("volatility_1y", "null") \
        .order("aum_eur", desc=True, nullsfirst=False)
    if isin_filter:
        q = q.eq("isin", isin_filter)
    cryptos = q.execute().data or []

    if limit:
        cryptos = cryptos[:limit]

    print(f"  {len(cryptos)} cryptos sans vol_1y à enrichir")
    print()

    updates: list[dict] = []
    no_data: list[str] = []
    ok = 0

    for i, crypto in enumerate(cryptos, 1):
        isin = crypto["isin"]
        symbol = isin.replace("CRYPTO_", "").upper()
        name = (crypto.get("name") or symbol)[:30]

        time.sleep(RATE_LIMIT_SEC)
        history = fetch_yahoo_history(symbol)

        if not history or len(history) < MIN_POINTS_1Y:
            no_data.append(isin)
            n = len(history) if history else 0
            print(f"    [{i:3d}/{len(cryptos)}] {isin:18} | {n:3d} pts insuffisants | {name}")
            continue

        if apply:
            price_rows = [{"date": d, "nav": p, "currency": "EUR"} for d, p in history]
            upsert_prices(isin, price_rows, source="yahoo-crypto")

        windows = windows_from_history(history)
        metrics = compute_fund_metrics(
            prices_1y=windows["1y"],
            prices_3y=windows["3y"],
            prices_5y=windows["5y"],
            prices_all=windows["all"],
            rf=rf,
        )

        # Garde performance_5y existante si déjà remplie par coingecko-crypto
        if crypto.get("performance_5y") is not None:
            metrics.pop("performance_5y", None)

        if metrics.get("volatility_1y") is None:
            no_data.append(isin)
            print(f"    [{i:3d}/{len(cryptos)}] {isin:18} | calcul échoué | {name}")
            continue

        updates.append({"isin": isin, **metrics})
        ok += 1

        vol  = metrics.get("volatility_1y", 0)
        sh1  = metrics.get("sharpe_1y")
        dd   = metrics.get("max_drawdown_1y", 0)
        srri = metrics.get("srri", "?")
        sh_str = f"{sh1:+.2f}" if sh1 is not None else "  N/A"
        print(
            f"    [{i:3d}/{len(cryptos)}] {isin:18} | "
            f"vol1y={vol:6.1f}% | sh1y={sh_str} | dd1y={dd:6.1f}% | SRRI={srri} | {name}"
        )

    print()

    # ── Écriture ─────────────────────────────────────────────────────────────
    if apply and updates:
        print(f"  Écriture Supabase ({len(updates)} cryptos)…", end=" ", flush=True)
        succ, fail = update_funds_bulk(updates, batch_size=50)
        print(f"✓ {succ} OK, {fail} échec")
        status = "success" if fail == 0 else ("partial" if succ > 0 else "failed")
        log_run(
            scraper="crypto-perf-enricher",
            status=status,
            records_processed=succ,
            records_failed=fail + len(no_data),
            started_at=started,
        )

    print()
    print(f"  ✓ {ok} cryptos enrichies")
    print(f"  ✗ {len(no_data)} sans données Yahoo (probablement absentes ou trop récentes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Calcule vol_1y/sharpe/drawdown pour les cryptos via Yahoo Finance."
    )
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase (sans : dry-run)")
    parser.add_argument("--limit", type=int, default=None, help="Limiter à N cryptos (test)")
    parser.add_argument("--isin", type=str, default=None, help="Cibler un ISIN (ex: CRYPTO_BTC)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
