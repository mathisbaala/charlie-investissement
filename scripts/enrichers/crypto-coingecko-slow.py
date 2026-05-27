#!/usr/bin/env python3
"""
crypto-coingecko-slow.py — Enrichissement crypto via CoinGecko (rate-limited)
==============================================================================
Cible : cryptos non couvertes par Yahoo (PEPE, ARB, JUP, USDD, etc., ~67 fonds).
Source : CoinGecko free tier, days=365 max (le 5y free retourne 401).

Pourquoi un script séparé :
  - Le free tier CoinGecko bloque les requêtes répétées (429 dès 1-2 req/min)
  - On utilise un rate limit ultra-prudent : 30s/req
  - 67 cryptos × 30s = ~35 min

Pour chaque crypto :
  1. Fetch /coins/markets pour mapper SYMBOL → coin_id
  2. Fetch /coins/{id}/market_chart?days=365 (daily)
  3. Stocker prix dans investissement_fund_prices
  4. Calculer vol_1y + sharpe_1y + max_drawdown_1y depuis daily returns
  5. Update investissement_funds

Usage :
    python3 scripts/enrichers/crypto-coingecko-slow.py [--apply] [--limit N]
    nohup python3 scripts/enrichers/crypto-coingecko-slow.py --apply > logs/crypto-cg-slow.log 2>&1 &
"""

import sys
import time
import argparse
import math
from datetime import datetime, timezone, date, timedelta
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_prices, update_funds_bulk, log_run, get_ecb_rate

# ─── Config ────────────────────────────────────────────────────────────────────

COINGECKO_MARKETS = (
    "https://api.coingecko.com/api/v3/coins/markets"
    "?vs_currency=eur&order=market_cap_desc&per_page=250&page={page}"
)
COINGECKO_HISTORY = (
    "https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"
    "?vs_currency=eur&days=365"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
}

# Rate limits CoinGecko free tier (très restrictif depuis 2024)
RATE_LIMIT_SEC = 30.0
MAX_RETRIES    = 3
BACKOFF_429    = 90.0

MIN_DAILY_PTS = 60  # min de points pour calculer vol


# ─── Helpers ───────────────────────────────────────────────────────────────────

def fetch_with_retry(session: FetcherSession, url: str) -> dict | None:
    """GET avec retry exponentiel sur 429."""
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(url, stealthy_headers=True, timeout=30)
            if r.status == 429:
                wait = BACKOFF_429 * (attempt + 1)
                print(f"    ⚠ 429 rate limit → sleep {wait}s")
                time.sleep(wait)
                continue
            if r.status == 401:
                print(f"    ✗ 401 Unauthorized (free tier limit reached)")
                return None
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(10)
            else:
                print(f"    ✗ {type(e).__name__}: {e}")
    return None


def build_symbol_map(session: FetcherSession) -> dict[str, str]:
    """Mapping SYMBOL_UPPER → coin_id (top 500 cryptos)."""
    mapping: dict[str, str] = {}
    for page in (1, 2):
        data = fetch_with_retry(session, COINGECKO_MARKETS.format(page=page))
        if not data:
            break
        for coin in data:
            sym = (coin.get("symbol") or "").upper().strip()
            cid = coin.get("id")
            if sym and cid and sym not in mapping:
                mapping[sym] = cid
        time.sleep(RATE_LIMIT_SEC)
    return mapping


def fetch_daily_history(session: FetcherSession, coin_id: str) -> list[tuple[str, float]]:
    """Retourne [(YYYY-MM-DD, price)] sur 365 jours."""
    data = fetch_with_retry(session, COINGECKO_HISTORY.format(coin_id=coin_id))
    if not data:
        return []
    prices_raw = data.get("prices") or []
    out: list[tuple[str, float]] = []
    seen = set()
    for ts_ms, price in prices_raw:
        if price is None or price <= 0:
            continue
        d = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).date().isoformat()
        if d not in seen:
            seen.add(d)
            out.append((d, float(price)))
    out.sort(key=lambda x: x[0])
    return out


# ─── Calculs ───────────────────────────────────────────────────────────────────

def compute_daily_metrics(prices: list[float], rf_annual: float) -> dict:
    """Vol annualisée, Sharpe, drawdown depuis daily prices (252 jours)."""
    if len(prices) < MIN_DAILY_PTS:
        return {}

    # Returns quotidiens
    returns = [(prices[i] / prices[i - 1]) - 1 for i in range(1, len(prices))]
    if len(returns) < 30:
        return {}

    n = len(returns)
    mean_daily = sum(returns) / n
    var = sum((r - mean_daily) ** 2 for r in returns) / (n - 1)
    daily_std = math.sqrt(var)

    # Annualisations (252 jours bourse pour vol, 365 pour perf calendaire)
    vol_annual = daily_std * math.sqrt(365)
    perf_total = prices[-1] / prices[0] - 1
    years = n / 365
    perf_annual = (1 + perf_total) ** (1 / years) - 1 if years > 0 else None

    # Sharpe
    sharpe = None
    if vol_annual > 0 and perf_annual is not None:
        sharpe = (perf_annual - rf_annual) / vol_annual

    # Drawdown
    peak = prices[0]
    max_dd = 0.0
    for p in prices:
        if p > peak:
            peak = p
        dd = (peak - p) / peak if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd

    metrics = {
        "volatility_1y":   round(vol_annual * 100, 4),
        "performance_1y":  round(perf_total * 100, 4),
        "max_drawdown_1y": round(-max_dd * 100, 4),
    }
    if sharpe is not None:
        metrics["sharpe_1y"] = round(sharpe, 4)

    # SRRI depuis vol_3y absent → on dérive depuis vol_1y
    pct = metrics["volatility_1y"]
    if   pct < 0.5:  srri = 1
    elif pct < 2:    srri = 2
    elif pct < 5:    srri = 3
    elif pct < 10:   srri = 4
    elif pct < 15:   srri = 5
    elif pct < 25:   srri = 6
    else:            srri = 7
    metrics["srri"] = srri

    return metrics


# ─── Main ──────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 68)
    print("  Crypto CoinGecko Slow Enricher — pour cryptos non-Yahoo")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Rate limit : {RATE_LIMIT_SEC}s/req (free tier prudent)")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    rf      = get_ecb_rate()
    print(f"  Taux BCE : {rf * 100:.2f}%")
    print()

    # Cibles : cryptos sans volatility_1y
    cryptos = (
        client.table("investissement_funds")
        .select("isin, name, aum_eur")
        .eq("product_type", "crypto")
        .is_("volatility_1y", "null")
        .order("aum_eur", desc=True, nullsfirst=False)
        .execute()
        .data or []
    )

    if limit:
        cryptos = cryptos[:limit]

    print(f"  {len(cryptos)} cryptos cibles\n")

    # Build symbol→id mapping
    session = FetcherSession(impersonate="chrome")
    print("  [1/2] Construction mapping SYMBOL→coin_id (top 500)…")
    sym_to_id = build_symbol_map(session)
    print(f"    → {len(sym_to_id)} mappings\n")

    # Boucle scan
    print("  [2/2] Fetch + calcul + upsert…")
    updates: list[dict] = []
    not_found = []
    no_data = []
    ok = 0

    for i, crypto in enumerate(cryptos, 1):
        isin = crypto["isin"]
        symbol = isin.replace("CRYPTO_", "").upper()
        name = (crypto.get("name") or symbol)[:30]
        coin_id = sym_to_id.get(symbol)

        if not coin_id:
            not_found.append(isin)
            print(f"    [{i:3d}/{len(cryptos)}] {isin:18} | symbol inconnu CoinGecko | {name}")
            continue

        print(f"    [{i:3d}/{len(cryptos)}] {isin:18} | fetching {coin_id}…", flush=True)
        time.sleep(RATE_LIMIT_SEC)
        history = fetch_daily_history(session, coin_id)

        if len(history) < MIN_DAILY_PTS:
            no_data.append(isin)
            print(f"      ✗ {len(history)} pts insuffisants")
            continue

        if apply:
            price_rows = [{"date": d, "nav": p, "currency": "EUR"} for d, p in history]
            upsert_prices(isin, price_rows, source="coingecko-daily")

        metrics = compute_daily_metrics([p for _, p in history], rf)
        if not metrics:
            no_data.append(isin)
            print(f"      ✗ calcul échoué")
            continue

        updates.append({"isin": isin, **metrics})
        ok += 1

        vol = metrics.get("volatility_1y", 0)
        sh = metrics.get("sharpe_1y")
        sh_str = f"{sh:+.2f}" if sh is not None else "N/A"
        print(f"      ✓ vol1y={vol:.1f}% sh={sh_str} SRRI={metrics.get('srri')}")

    print()

    if apply and updates:
        print(f"  Écriture Supabase ({len(updates)} cryptos)…", end=" ", flush=True)
        succ, fail = update_funds_bulk(updates, batch_size=20)
        print(f"✓ {succ} OK, {fail} échec")
        log_run(
            scraper="crypto-coingecko-slow",
            status="success" if fail == 0 else "partial",
            records_processed=succ,
            records_failed=fail + len(no_data) + len(not_found),
            started_at=started,
        )

    print()
    print(f"  ✓ {ok} cryptos enrichies")
    print(f"  ✗ {len(no_data)} sans données suffisantes")
    print(f"  ✗ {len(not_found)} symboles inconnus de CoinGecko")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Crypto enricher via CoinGecko (slow rate).")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
