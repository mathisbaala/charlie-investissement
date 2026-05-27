#!/usr/bin/env python3
"""
coingecko-crypto.py — Cryptomonnaies via CoinGecko API (gratuite, sans clé)
============================================================================
Collecte les 100 principales cryptomonnaies par market cap et les insère
dans la table investissement_funds avec des identifiants synthétiques.

Identifiants : CRYPTO_{SYMBOL} (ex: CRYPTO_BTC, CRYPTO_ETH)
product_type  : "crypto"
asset_class   : "crypto"
srri / sri    : 7 (risque maximum)
ongoing_charges / ter : 0 (pas de frais)
aum_eur       : market_cap en EUR

Performances :
  - 1y : récupérée directement depuis l'endpoint /markets (price_change_percentage_1y_in_currency)
  - 3y : calculée depuis l'historique (market_chart, 1825 jours) — top 10 uniquement
  - 5y : calculée depuis le même historique — top 10 uniquement

Rate limit CoinGecko free tier : ~10-30 req/min → sleep 2s entre appels historiques.

Usage :
    python3 scripts/scrapers/coingecko-crypto.py [--apply] [--limit N]

Sans --apply : dry-run (affiche sans écrire).
--limit N    : limite à N cryptos (test).
"""

import sys
import json
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

COINGECKO_MARKETS_URL = (
    "https://api.coingecko.com/api/v3/coins/markets"
    "?vs_currency=eur"
    "&order=market_cap_desc"
    "&per_page=100"
    "&page=1"
    "&sparkline=false"
    "&price_change_percentage=1y"
)

COINGECKO_HISTORY_URL = (
    "https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"
    "?vs_currency=eur&days=1825&interval=weekly"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
}

# Nombre de cryptos pour lesquelles on récupère l'historique 3y/5y
HISTORY_TOP_N = 30

# Délai entre les appels historiques (rate limit CoinGecko free tier)
HISTORY_SLEEP_SEC = 2.0

# Nombre de jours pour 3y et 5y (approximatif)
DAYS_3Y = 365 * 3   # 1095
DAYS_5Y = 365 * 5   # 1825


# ─── Helpers ───────────────────────────────────────────────────────────────────

def fetch_markets(session: FetcherSession) -> list[dict]:
    """Récupère les 30 premières cryptos par market cap depuis CoinGecko."""
    try:
        page = session.get(COINGECKO_MARKETS_URL, stealthy_headers=True, timeout=20)
        if page.status != 200:
            raise Exception(f"HTTP {page.status}")
        return json.loads(page.body.decode("utf-8"))
    except Exception as e:
        print(f"  ✗ Erreur fetch markets : {e}")
        return []


def fetch_history(session: FetcherSession, coin_id: str) -> list[list] | None:
    """
    Récupère l'historique de prix hebdomadaire sur 5 ans pour un coin.
    Retourne une liste de [timestamp_ms, price] ou None en cas d'erreur.
    """
    url = COINGECKO_HISTORY_URL.format(coin_id=coin_id)
    try:
        page = session.get(url, stealthy_headers=True, timeout=30)
        if page.status != 200:
            raise Exception(f"HTTP {page.status}")
        data = json.loads(page.body.decode("utf-8"))
        return data.get("prices")  # [[timestamp_ms, price], ...]
    except Exception as e:
        print(f"    ✗ Erreur historique {coin_id} : {e}")
        return None


def calc_perf_from_history(prices: list[list], days_ago: int) -> float | None:
    """
    Calcule la performance (en %) entre le prix il y a ~days_ago jours
    et le prix le plus récent dans la liste.

    Args:
        prices : liste de [timestamp_ms, price] triée chronologiquement
        days_ago : nombre de jours en arrière (ex: 1095 pour 3 ans)

    Returns:
        Performance en pourcentage (ex: 45.2 pour +45.2%), ou None si données insuffisantes.
    """
    if not prices or len(prices) < 2:
        return None

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    target_ms = now_ms - days_ago * 86_400 * 1000

    # Prix actuel = dernier point disponible
    current_price = prices[-1][1]
    if not current_price or current_price <= 0:
        return None

    # Trouver le point le plus proche du target
    best = None
    best_diff = float("inf")
    for ts, price in prices:
        diff = abs(ts - target_ms)
        if diff < best_diff:
            best_diff = diff
            best = (ts, price)

    if best is None:
        return None

    past_ts, past_price = best

    # Vérifier que le point trouvé est raisonnablement proche (±90 jours)
    max_diff_ms = 90 * 86_400 * 1000
    if best_diff > max_diff_ms:
        return None

    # Vérifier que le point est bien dans le passé (pas le point courant)
    if abs(past_ts - prices[-1][0]) < 7 * 86_400 * 1000:
        return None

    if not past_price or past_price <= 0:
        return None

    perf = (current_price - past_price) / past_price * 100
    return round(perf, 2)


def build_record(coin: dict, perf_3y: float | None, perf_5y: float | None, now_str: str) -> dict:
    """Construit le dict prêt pour upsert dans investissement_funds."""
    symbol = coin.get("symbol", "").upper()
    isin   = f"CRYPTO_{symbol}"
    name   = coin.get("name", symbol)

    # Perf 1y depuis l'API markets (en %, peut être None)
    perf_1y_raw = coin.get("price_change_percentage_1y_in_currency")
    perf_1y = round(float(perf_1y_raw), 2) if perf_1y_raw is not None else None

    market_cap = coin.get("market_cap")
    aum_eur    = int(market_cap) if market_cap is not None else None

    record = {
        "isin":             isin,
        "name":             name,
        "product_type":     "crypto",
        "asset_class":      "crypto",
        "currency":         "EUR",
        "aum_eur":          aum_eur,
        "performance_1y":   perf_1y,
        "performance_3y":   perf_3y,
        "performance_5y":   perf_5y,
        "srri":             7,
        "sri":              7,
        "ongoing_charges":  0.0,
        "ter":              0.0,
        "data_source":      "coingecko",
        "updated_at":       now_str,
    }

    # Supprimer les valeurs None pour ne pas écraser des données existantes
    return {k: v for k, v in record.items() if v is not None}


# ─── Main ──────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None = None):
    print("=" * 65)
    print("  CoinGecko Crypto — Top cryptomonnaies par market cap (EUR)")
    print("=" * 65)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limit : {limit}")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()

    # ── Étape 1 : récupérer les 30 premières cryptos ──────────────────────────
    print("  [1/3] Fetch top 100 cryptos depuis CoinGecko markets…")
    coins = fetch_markets(session)
    if not coins:
        print("  ✗ Aucune crypto récupérée, abandon.")
        if apply:
            log_run("coingecko-crypto", "failed", 0, 0, started_at=started)
        return

    if limit:
        coins = coins[:limit]

    print(f"  → {len(coins)} cryptos récupérées")
    print()

    # ── Étape 2 : historique 3y/5y pour les 10 premières ─────────────────────
    history_limit = min(HISTORY_TOP_N, len(coins))
    if limit is not None:
        history_limit = min(history_limit, limit)

    hist_data: dict[str, tuple[float | None, float | None]] = {}

    print(f"  [2/3] Fetch historique 3y/5y pour les {history_limit} premières cryptos…")
    for i, coin in enumerate(coins[:history_limit]):
        coin_id = coin.get("id", "")
        symbol  = coin.get("symbol", "").upper()
        print(f"    [{i+1}/{history_limit}] {symbol} ({coin_id})…", end=" ", flush=True)

        prices = fetch_history(session, coin_id)
        if prices:
            p3y = calc_perf_from_history(prices, DAYS_3Y)
            p5y = calc_perf_from_history(prices, DAYS_5Y)
            hist_data[coin_id] = (p3y, p5y)
            p3y_str = f"{p3y:+.1f}%" if p3y is not None else "N/A"
            p5y_str = f"{p5y:+.1f}%" if p5y is not None else "N/A"
            print(f"3y={p3y_str}  5y={p5y_str}")
        else:
            hist_data[coin_id] = (None, None)
            print("historique indisponible")

        # Rate limit CoinGecko free tier
        if i < history_limit - 1:
            time.sleep(HISTORY_SLEEP_SEC)

    print()

    # ── Étape 3 : upsert dans Supabase ────────────────────────────────────────
    print("  [3/3] Upsert dans investissement_funds…")
    now_str = datetime.now(timezone.utc).isoformat()
    client  = get_client() if apply else None
    ok = fail = 0

    for coin in coins:
        coin_id = coin.get("id", "")
        symbol  = coin.get("symbol", "").upper()
        name    = coin.get("name", symbol)
        isin    = f"CRYPTO_{symbol}"

        p3y, p5y = hist_data.get(coin_id, (None, None))
        record   = build_record(coin, p3y, p5y, now_str)

        # Affichage résumé
        perf_1y = record.get("performance_1y")
        aum     = record.get("aum_eur")
        aum_str = f"{aum/1_000_000_000:.1f}B€" if aum and aum >= 1_000_000_000 else (
                  f"{aum/1_000_000:.0f}M€"   if aum and aum >= 1_000_000 else (
                  f"{aum}€"                  if aum else "N/A"))
        perf_str = f"{perf_1y:+.1f}%" if perf_1y is not None else "N/A"

        print(
            f"  {'→' if apply else '~'} {isin:20} | {name[:28]:28} "
            f"| cap={aum_str:12} | 1y={perf_str}"
        )

        if apply:
            try:
                existing = client.table("investissement_funds").select("isin").eq("isin", isin).execute()
                if existing.data:
                    client.table("investissement_funds").update(record).eq("isin", isin).execute()
                else:
                    record["created_at"] = now_str
                    client.table("investissement_funds").insert(record).execute()
                ok += 1
            except Exception as e:
                print(f"    ✗ DB error ({isin}) : {e}")
                fail += 1

    print()
    if apply:
        status = "success" if fail == 0 else ("partial" if ok > 0 else "failed")
        print(f"  ✓ {ok} cryptos insérées/mises à jour, {fail} erreurs")
        log_run("coingecko-crypto", status, ok, fail, started_at=started)
    else:
        print(f"  Dry-run : {len(coins)} cryptos prêtes à insérer")
        print("  Relancer avec --apply pour écrire dans Supabase.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Collecte les principales cryptomonnaies via CoinGecko et les insère dans investissement_funds."
    )
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase (sans ce flag : dry-run)")
    parser.add_argument("--limit", type=int, default=None, metavar="N", help="Limite à N cryptos (test)")
    args = parser.parse_args()

    run(apply=args.apply, limit=args.limit)
