#!/usr/bin/env python3
"""
justetf-nav.py — VL (cours) des ETF via l'API publique JustETF
===============================================================
Source de prix de SECOURS pour les ETF que Financial Times ne couvre pas
(≈ 43 % du top par encours : gros ETF type Amundi MSCI World, BNP S&P 500,
restés figés sur des VL Yahoo périmées faute de source vivante).

L'API chart de JustETF renvoie, sans authentification, le dernier cours +
la série quotidienne complète d'un ETF par ISIN :

  https://www.justetf.com/api/etfs/{ISIN}/performance-chart
      ?locale=fr&currency=EUR&valuesType=MARKET_VALUE&reduceData=false
      &includeDividends=false&features=DIVIDENDS

  → { "latestQuote": {"raw": 23.24}, "latestQuoteDate": "2026-06-08",
      "series": [ {"date": "2013-09-16", "value": {"raw": 4.16}}, … ] }

Écriture FILL/ADDITIVE et INCRÉMENTALE dans investissement_fund_prices
(source='justetf') :
  - si l'ISIN a déjà des VL : on n'écrit que les points POSTÉRIEURS à sa
    dernière date connue (rafraîchissement bon marché) ;
  - sinon : on backfille la série complète (bornée à LOOKBACK_YEARS) pour
    que compute-metrics ait de l'historique.
L'upsert (conflit isin,price_date) est idempotent : aucune VL existante
n'est écrasée par une autre source.

⚠️  JustETF limite les requêtes : UN scraper JustETF à la fois, délai
    conseillé ≥ 1 s. En cas de 403 répété, attendre quelques heures.

Cible par défaut : ETF (product_type='etf') sans VL fraîche (aucune VL, ou
dernière VL connue > STALE_DAYS jours), priorité aux plus gros encours.

Usage :
    python3 scripts/scrapers/justetf-nav.py --isin FR0011550680   (test 1 ISIN)
    python3 scripts/scrapers/justetf-nav.py --limit 50            (dry-run)
    python3 scripts/scrapers/justetf-nav.py --apply --limit 500   (écrit)
    python3 scripts/scrapers/justetf-nav.py --apply               (tous les ETF périmés)
    python3 scripts/scrapers/justetf-nav.py --apply --offset 5000 --limit 5000  (rotation)
"""

import re
import sys
import time
import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_prices, log_run

# ─── Config ──────────────────────────────────────────────────────────────────

SOURCE         = "justetf"
API_URL        = "https://www.justetf.com/api/etfs/{isin}/performance-chart"
API_PARAMS     = {
    "locale": "fr", "currency": "EUR", "valuesType": "MARKET_VALUE",
    "reduceData": "false", "includeDividends": "false", "features": "DIVIDENDS",
}
HEADERS        = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.justetf.com/",
}
RATE_LIMIT_SEC = 1.0    # ≥ 1 s entre requêtes (JustETF est sensible au rate limit)
# Seuil de péremption d'une VL. 5 j (< cadence hebdo de 7 j) : un ETF que FT
# vient de rafraîchir (VL à 1-2 j) est ignoré → pas de mélange de sources sur la
# série ; un ETF couvert UNIQUEMENT par JustETF (VL à 7 j) est re-traité chaque
# semaine → reste frais. Voir weekly-pipeline.py (justetf-nav après ft-enricher).
STALE_DAYS     = 5
LOOKBACK_YEARS = 5      # backfill borné pour les ETF sans historique
TIMEOUT        = 25
ISIN_RE        = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


# ─── Sélection des cibles ──────────────────────────────────────────────────────

def _coverage_map(client, isins: list[str]) -> dict:
    """{isin: last_price_date 'YYYY-MM-DD'} pour les ISIN ayant déjà des VL."""
    out = {}
    for i in range(0, len(isins), 300):
        chunk = isins[i:i + 300]
        try:
            r = (client.table("investissement_fund_price_coverage")
                 .select("isin,last_price_date").in_("isin", chunk).execute())
            for row in (r.data or []):
                out[row["isin"]] = row.get("last_price_date")
        except Exception as e:
            print(f"  ⚠️  lecture coverage : {e}")
    return out


def select_targets(client, limit: int | None, offset: int = 0,
                   stale_days: int = STALE_DAYS):
    """ETF avec ISIN valide dont la VL est absente ou périmée (> stale_days),
    triés par encours décroissant. Renvoie [{isin, last}] où `last` est la
    dernière date de VL connue (None si aucune)."""
    cutoff = (date.today() - timedelta(days=stale_days)).isoformat()
    targets, page, size, skipped = [], 0, 1000, 0
    while True:
        rows = (client.table("investissement_funds")
                .select("isin")
                .eq("product_type", "etf")
                .order("aum_eur", desc=True, nullsfirst=False)
                .range(page * size, page * size + size - 1)
                .execute().data or [])
        if not rows:
            break
        page_isins = [(r.get("isin") or "").strip() for r in rows]
        page_isins = [i for i in page_isins if ISIN_RE.match(i)]
        cov = _coverage_map(client, page_isins)
        for isin in page_isins:
            last = cov.get(isin)
            if last is not None and last >= cutoff:
                continue  # déjà frais
            if skipped < offset:
                skipped += 1
                continue
            targets.append({"isin": isin, "last": last})
            if limit and len(targets) >= limit:
                return targets
        if len(rows) < size:
            break
        page += 1
    return targets


# ─── Fetch / parse ─────────────────────────────────────────────────────────────

def fetch_series(session: requests.Session, isin: str) -> list[dict]:
    """Renvoie [{date, nav, currency}] depuis l'API chart JustETF, ou []."""
    url = API_URL.format(isin=isin)
    resp = session.get(url, params=API_PARAMS, headers=HEADERS, timeout=TIMEOUT)
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}")
    data = resp.json()
    out = []
    for pt in data.get("series", []):
        d = pt.get("date")
        v = (pt.get("value") or {}).get("raw")
        if d and v is not None:
            out.append({"date": d, "nav": float(v), "currency": "EUR"})
    return out


# ─── Run ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, isin_arg: str | None,
        offset: int = 0, delay: float = RATE_LIMIT_SEC):
    print("=" * 64)
    print("  JustETF NAV — cours ETF via API publique")
    print("=" * 64)
    print(f"  Mode      : {'APPLY' if apply else 'DRY-RUN'}")
    client = get_client()
    started = datetime.now(timezone.utc)

    if isin_arg:
        targets = [{"isin": isin_arg.strip().upper(), "last": None}]
    else:
        print("  Sélection des cibles (ETF sans VL fraîche)…", flush=True)
        targets = select_targets(client, limit, offset=offset)
    print(f"  {len(targets)} ETF à traiter   (délai={delay}s)\n")

    min_backfill = (date.today() - timedelta(days=365 * LOOKBACK_YEARS)).isoformat()
    session = requests.Session()
    ok = prices_total = 0
    errors = []

    for n, t in enumerate(targets, 1):
        isin, last = t["isin"], t.get("last")
        try:
            series = fetch_series(session, isin)
        except Exception as e:
            errors.append({"isin": isin, "error": str(e)[:120]})
            series = []
        if not series:
            if n % 25 == 0 or n == len(targets):
                print(f"  [{n:5d}/{len(targets)}] ok:{ok} VL:{prices_total}", flush=True)
            time.sleep(delay)
            continue

        # Incrémental : seulement les points postérieurs à la dernière VL connue.
        # Sans historique → backfill borné à LOOKBACK_YEARS.
        floor = last if last else min_backfill
        new_points = [p for p in series if p["date"] > floor] if last \
            else [p for p in series if p["date"] >= floor]

        ok += 1
        if new_points:
            latest = max(p["date"] for p in new_points)
            if apply:
                ins, _ = upsert_prices(isin, new_points, SOURCE)
                prices_total += ins
            else:
                prices_total += len(new_points)
            if n <= 5 or n % 200 == 0:
                print(f"    {isin}: +{len(new_points)} VL (→ {latest})"
                      + ("" if apply else "  [dry-run]"))
        if n % 25 == 0 or n == len(targets):
            print(f"  [{n:5d}/{len(targets)}] ok:{ok} VL:{prices_total}", flush=True)
        time.sleep(delay)

    print(f"\n  → {ok}/{len(targets)} ETF résolus sur JustETF | "
          f"{prices_total} VL {'écrites' if apply else '(dry-run)'}")
    if errors:
        print(f"  {len(errors)} erreurs (5 premières) : "
              + ", ".join(f"{e['isin']}:{e['error']}" for e in errors[:5]))

    if apply:
        status = "success" if not errors else "partial"
        log_run(SOURCE, status, records_processed=ok,
                records_failed=len(errors), errors=errors[:50], started_at=started)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="VL des ETF via l'API JustETF")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N ETF")
    ap.add_argument("--offset", type=int, default=0,
                    help="Sauter les N premières cibles (tri encours décroissant) — rotation")
    ap.add_argument("--isin", type=str, help="Un seul ISIN (test)")
    ap.add_argument("--delay", type=float, default=RATE_LIMIT_SEC,
                    help=f"Pause/req en s (défaut {RATE_LIMIT_SEC})")
    a = ap.parse_args()
    sys.exit(run(apply=a.apply, limit=a.limit, isin_arg=a.isin,
                 offset=a.offset, delay=a.delay))
