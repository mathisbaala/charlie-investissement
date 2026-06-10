#!/usr/bin/env python3
"""
compute-metrics.py — Calcul des métriques financières depuis les séries de prix
================================================================================
Lit investissement_fund_prices, calcule pour chaque fonds :
  - Performance 1Y, 3Y, 5Y (rendement total)
  - Performance annualisée 3Y, 5Y
  - Volatilité annualisée 1Y, 3Y
  - Ratio de Sharpe 1Y, 3Y  (taux sans risque = taux BCE deposit facility)
  - Max drawdown 1Y, 3Y
  - Track record en années

Met à jour investissement_funds avec ces valeurs.

Usage :
    python3 scripts/enrichers/compute-metrics.py [--apply] [--limit N] [--isin ISIN]

Cron recommandé : chaque lundi 06:00 (après le fetch des VL du lundi 03:00)
"""

import sys
import math
import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, update_funds_bulk, log_run, get_ecb_rate, isins_with_recent_prices, reset_client

# ─── Fenêtres temporelles ──────────────────────────────────────────────────────

TODAY     = date.today()
DATE_1Y   = (TODAY - timedelta(days=365)).isoformat()
DATE_3Y   = (TODAY - timedelta(days=365 * 3)).isoformat()
DATE_5Y   = (TODAY - timedelta(days=365 * 5)).isoformat()
DATE_10Y  = (TODAY - timedelta(days=365 * 10)).isoformat()

# Nombre minimum de points pour calculer une métrique
MIN_POINTS_1Y = 26   # ~26 semaines de données hebdo
MIN_POINTS_3Y = 78   # ~78 semaines
MIN_POINTS_5Y = 130  # ~130 semaines

# Couverture temporelle minimale (en jours) qu'une série doit RÉELLEMENT
# couvrir pour qu'on lui fasse confiance pour la période. Un nombre de points
# suffisant ne garantit pas la durée (26 points hebdo = ~6 mois, pas 1 an) :
# sans ce garde, un fonds jeune se voyait attribuer une perf 3Y/5Y bidon.
MIN_SPAN_1Y = 300            # ~0.82 an
MIN_SPAN_3Y = 365 * 3 - 90  # ~2.75 ans
MIN_SPAN_5Y = 365 * 5 - 120 # ~4.67 ans

# ─── Calculs financiers ────────────────────────────────────────────────────────

def perf_total(prices: list[float]) -> float | None:
    if len(prices) < 2:
        return None
    return (prices[-1] / prices[0]) - 1

def perf_annualized(prices: list[float], years: float) -> float | None:
    p = perf_total(prices)
    if p is None or years <= 0:
        return None
    try:
        return (1 + p) ** (1 / years) - 1
    except (ValueError, ZeroDivisionError):
        return None

PERF_MAX = 9999.9999  # DECIMAL(8,4) ceiling

def _clamp(v: float | None) -> float | None:
    if v is None:
        return None
    return max(-PERF_MAX, min(PERF_MAX, v))


def volatility_annualized(prices: list[float]) -> float | None:
    """Volatilité annualisée des rendements hebdomadaires."""
    if len(prices) < 4:
        return None
    returns = [(prices[i] / prices[i - 1]) - 1 for i in range(1, len(prices))]
    n = len(returns)
    mean = sum(returns) / n
    variance = sum((r - mean) ** 2 for r in returns) / (n - 1)
    weekly_std = math.sqrt(variance)
    # Annualiser (52 semaines pour hebdo, 252 jours pour quotidien)
    return weekly_std * math.sqrt(52)

def sharpe_ratio(prices: list[float], rf_annual: float) -> float | None:
    """Sharpe = (rendement annualisé - taux sans risque) / volatilité."""
    n_weeks = len(prices) - 1
    if n_weeks < MIN_POINTS_1Y:
        return None
    years = n_weeks / 52
    perf  = perf_annualized(prices, years)
    vol   = volatility_annualized(prices)
    if perf is None or vol is None or vol == 0:
        return None
    return round((perf - rf_annual) / vol, 4)

def max_drawdown(prices: list[float]) -> float | None:
    """Max drawdown = pire baisse depuis un sommet."""
    if len(prices) < 2:
        return None
    peak   = prices[0]
    max_dd = 0.0
    for p in prices:
        if p > peak:
            peak = p
        dd = (peak - p) / peak if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd
    return round(-max_dd, 6)  # négatif par convention


def _valid_perf(prices: list[float], min_points: int, span_days: int, min_span: int) -> bool:
    """Une perf n'est fiable que si la série a assez de points ET couvre
    réellement la période ET ne démarre pas sur une VL nulle/négative. Une
    perte > 100% (perf_total <= -1) trahit une VL aberrante : on l'écarte."""
    if len(prices) < min_points or span_days < min_span or prices[0] <= 0:
        return False
    p = perf_total(prices)
    return p is not None and p > -1.0


def compute_fund_metrics(prices_1y, prices_3y, prices_5y, prices_all, rf, spans=None) -> dict:
    metrics = {}
    spans = spans or {"1y": 0, "3y": 0, "5y": 0}

    # Convention : toutes les métriques sont stockées en % (9.82 = 9.82%, -2.7 = -2.7%)
    # Sauf sharpe_1y (adimensionnel)
    # On écrit explicitement None quand une perf n'est pas fiable, pour PURGER
    # les valeurs aberrantes écrites par les scrapers (au lieu de les laisser).

    # ── 1Y ──
    if _valid_perf(prices_1y, MIN_POINTS_1Y, spans["1y"], MIN_SPAN_1Y):
        metrics["performance_1y"]  = _clamp(round(perf_total(prices_1y) * 100, 4))
        dd = max_drawdown(prices_1y)
        if dd is not None:
            metrics["max_drawdown_1y"] = round(dd * 100, 4)
        vol1y = volatility_annualized(prices_1y)
        if vol1y:
            metrics["volatility_1y"] = _clamp(round(vol1y * 100, 4))
        sh1 = sharpe_ratio(prices_1y, rf)
        metrics["sharpe_1y"] = _clamp(sh1) if sh1 is not None else None
    else:
        metrics["performance_1y"] = None

    # ── 3Y ──
    if _valid_perf(prices_3y, MIN_POINTS_3Y, spans["3y"], MIN_SPAN_3Y):
        metrics["performance_3y"]  = _clamp(round(perf_total(prices_3y) * 100, 4))
        dd3 = max_drawdown(prices_3y)
        if dd3 is not None:
            metrics["max_drawdown_3y"] = round(dd3 * 100, 4)
        vol3y = volatility_annualized(prices_3y)
        if vol3y:
            metrics["volatility_3y"] = _clamp(round(vol3y * 100, 4))
        sh3 = sharpe_ratio(prices_3y, rf)
        metrics["sharpe_3y"] = _clamp(sh3) if sh3 is not None else None
    else:
        metrics["performance_3y"] = None

    # ── 5Y ──
    if _valid_perf(prices_5y, MIN_POINTS_5Y, spans["5y"], MIN_SPAN_5Y):
        metrics["performance_5y"] = _clamp(round(perf_total(prices_5y) * 100, 4))
    else:
        metrics["performance_5y"] = None

    # ── Average performance (moyenne des perf 1Y/3Y/5Y en %) ──
    p1 = metrics.get("performance_1y")
    p3 = metrics.get("performance_3y")
    p5 = metrics.get("performance_5y")
    avgs = [v for v in [p1, p3, p5] if v is not None]
    metrics["average_performance"] = _clamp(round(sum(avgs) / len(avgs), 4)) if avgs else None

    # ── Track record ──
    if prices_all:
        metrics["track_record_years"] = round(len(prices_all) / 52, 1)

    # ── SRRI (KIID risk indicator 1-7 from annualized volatility in %) ──
    vol = metrics.get("volatility_3y") or metrics.get("volatility_1y")
    if vol is not None:
        pct = vol  # already in % format
        if pct < 0.5:      srri = 1
        elif pct < 2:      srri = 2
        elif pct < 5:      srri = 3
        elif pct < 10:     srri = 4
        elif pct < 15:     srri = 5
        elif pct < 25:     srri = 6
        else:              srri = 7
        metrics["srri"] = srri

    return metrics


def fetch_prices_for_isin(client, isin: str) -> dict[str, list[float]]:
    """Retourne les séries de prix triées par date pour différentes fenêtres.

    Pagination obligatoire : PostgREST plafonne à 1000 lignes/requête. Les
    sources quotidiennes (ex. financial-times) écrivent ~1300 VL/fonds sur 5 ans ;
    sans pagination, le tri ascendant tronque l'année la plus récente et les
    perf 1Y/3Y deviennent incalculables (fenêtre vide)."""
    rows = []
    offset = 0
    page_size = 1000
    while True:
        page = client.table("investissement_fund_prices") \
            .select("price_date, nav") \
            .eq("isin", isin) \
            .gte("price_date", DATE_5Y) \
            .order("price_date", desc=False) \
            .range(offset, offset + page_size - 1) \
            .execute().data or []
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    all_prices = []
    for r in rows:
        val = r.get("nav") or r.get("close_price")
        if val is not None:
            try:
                all_prices.append((r["price_date"], float(val)))
            except (ValueError, TypeError):
                pass

    def window(cutoff: str) -> list[tuple[str, float]]:
        return [(d, p) for d, p in all_prices if d >= cutoff]

    def span_days(pairs: list[tuple[str, float]]) -> int:
        if len(pairs) < 2:
            return 0
        return (date.fromisoformat(pairs[-1][0]) - date.fromisoformat(pairs[0][0])).days

    w5, w3, w1 = window(DATE_5Y), window(DATE_3Y), window(DATE_1Y)
    return {
        "all":  [p for _, p in all_prices],
        "5y":   [p for _, p in w5],
        "3y":   [p for _, p in w3],
        "1y":   [p for _, p in w1],
        "span": {"5y": span_days(w5), "3y": span_days(w3), "1y": span_days(w1)},
    }


def run(apply: bool, limit: int | None, isin_filter: str | None):
    print("=" * 60)
    print("  Compute Metrics — Sharpe, Volatilité, Performances")
    print("=" * 60)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Taux BCE (risk-free) : ", end="", flush=True)

    rf = get_ecb_rate()
    print(f"{rf*100:.2f}%")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Récupérer les ISINs qui ont des prix (avec pagination complète)
    if isin_filter:
        resp  = client.table("investissement_fund_prices") \
            .select("isin") \
            .eq("isin", isin_filter) \
            .gte("price_date", DATE_1Y) \
            .execute()
        isins = list({r["isin"] for r in (resp.data or [])})
    else:
        # Découverte robuste via RPC keyset (DISTINCT par isin) : la pagination
        # par offset sur ~900k lignes dépassait le statement timeout PostgREST.
        isins = isins_with_recent_prices(since_days=365)

    if limit:
        isins = isins[:limit]

    print(f"  {len(isins)} fonds avec historique de prix à traiter")
    print()

    updates   = []
    computed  = 0
    skipped   = 0

    # Le serveur ferme la connexion HTTP/2 après ~20k streams. À ~2 requêtes
    # par fonds, on reconnecte proactivement, et on retente une fois sur erreur
    # réseau (RemoteProtocolError) en repartant d'une connexion fraîche.
    RECONNECT_EVERY = 1500

    for i, isin in enumerate(isins, 1):
        if i % RECONNECT_EVERY == 0:
            client = reset_client()
        try:
            prices = fetch_prices_for_isin(client, isin)
        except Exception as e:
            print(f"  ↻ reconnexion après erreur réseau sur {isin} : {str(e)[:80]}")
            client = reset_client()
            prices = fetch_prices_for_isin(client, isin)

        if len(prices["1y"]) < MIN_POINTS_1Y:
            skipped += 1
            continue

        metrics = compute_fund_metrics(
            prices_1y=prices["1y"],
            prices_3y=prices["3y"],
            prices_5y=prices["5y"],
            prices_all=prices["all"],
            rf=rf,
            spans=prices["span"],
        )

        if not metrics:
            skipped += 1
            continue

        updates.append({"isin": isin, **metrics})
        computed += 1

        if i % 100 == 0:
            pct = i / len(isins) * 100
            print(f"  [{i:5d}/{len(isins)}] {pct:.0f}% — calculé:{computed} sauté:{skipped}")

    print(f"\n  → {computed} fonds calculés, {skipped} insuffisants")

    if apply and updates:
        print(f"  Écriture dans Supabase ({len(updates)} fonds)...", end=" ", flush=True)
        ok, fail = update_funds_bulk(updates, batch_size=200)
        print(f"✓ {ok} OK, {fail} échec")
        log_run(
            scraper="compute-metrics",
            status="success",
            records_processed=ok,
            records_failed=fail,
            started_at=started,
        )
    elif not apply and updates:
        print("\n  Aperçu (3 premiers) :")
        for r in updates[:3]:
            perf1 = f"{r.get('performance_1y', 0)*100:+.1f}%" if r.get("performance_1y") else "N/A"
            vol   = f"{r.get('volatility_1y', 0)*100:.1f}%"   if r.get("volatility_1y") else "N/A"
            sharpe = f"{r.get('sharpe_1y', 0):.2f}"           if r.get("sharpe_1y") else "N/A"
            print(f"  {r['isin']} | perf1Y:{perf1:8} | vol1Y:{vol:6} | sharpe:{sharpe}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Calcul métriques financières")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    parser.add_argument("--isin",   type=str,            help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
