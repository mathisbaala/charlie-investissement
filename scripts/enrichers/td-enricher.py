#!/usr/bin/env python3
"""
td-enricher.py — Tracking difference des ETF
================================================================================
Le TER ne mesure pas le coût réel d'un ETF. Ce script calcule la TRACKING
DIFFERENCE (TD) : l'écart de performance annualisé entre un ETF et son indice
de référence total return, sur des fenêtres alignées (1Y / 3Y / 5Y).

    TD = perf ETF − perf indice TR   (négatif = sous-performance / coût implicite)

Pipeline en deux temps :
  1. --refresh-indices : récupère les séries des indices de référence (Yahoo)
     dans investissement_index_prices.
  2. (défaut) : pour chaque ETF mappé à un indice, lit ses VL
     (investissement_fund_prices) + la série de l'indice, aligne sur les dates
     communes, calcule la TD 1Y/3Y/5Y et écrit le résultat dans
     investissement_funds (fill/recompute, jamais d'insert).

⚠️ Couverture indices NET total return : partielle. Les indices net TR (MSCI,
   FTSE…) sont propriétaires et peu disponibles en source gratuite. On utilise
   les meilleurs tickers Yahoo disponibles, et on STOCKE la variante employée
   (net / gross / price) dans benchmark_variant pour rester transparent. Élargir
   INDEX_CATALOG au fil des sources.

Usage :
    python3 scripts/enrichers/td-enricher.py --refresh-indices [--apply]
    python3 scripts/enrichers/td-enricher.py [--apply] [--limit N] [--isin ISIN]

Cron recommandé : mensuel, après ft-full-sweep + compute-metrics.
"""

import sys
import bisect
import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, update_funds_bulk, log_run, reset_client, now_iso

# ─── Fenêtres temporelles (alignées sur compute-metrics.py) ─────────────────────

TODAY    = date.today()
DATE_1Y  = (TODAY - timedelta(days=365)).isoformat()
DATE_3Y  = (TODAY - timedelta(days=365 * 3)).isoformat()
DATE_5Y  = (TODAY - timedelta(days=365 * 5)).isoformat()

MIN_POINTS_1Y = 26
MIN_POINTS_3Y = 78
MIN_POINTS_5Y = 130
MIN_SPAN_1Y = 300
MIN_SPAN_3Y = 365 * 3 - 90
MIN_SPAN_5Y = 365 * 5 - 120

TD_MAX = 9999.9999  # plafond numeric(8,4)

# ─── Catalogue d'indices de référence ───────────────────────────────────────────
# code interne → (libellé, ticker Yahoo, variante, mots-clés de détection).
# `variant` ∈ {net, gross, price} : qualité de l'indice comme référence de coût.
#   - net   : reinvestit les dividendes NETS de retenue à la source → référence idéale.
#   - gross : dividendes BRUTS → surévalue légèrement l'indice (TD un peu pessimiste).
#   - price : hors dividendes → NE PAS conclure sur le coût (signalé comme approx.).
# On reste conservateur : on ne mappe que sur signal clair (mots-clés présents
# dans la catégorie/le nom de l'ETF), pour ne jamais attribuer un mauvais indice.
INDEX_CATALOG: dict[str, dict] = {
    "sp500":      {"label": "S&P 500",            "ticker": "^SP500TR",  "variant": "gross", "kw": ["s&p 500", "sp 500", "s&p500", "sp500"]},
    "nasdaq100":  {"label": "Nasdaq 100",         "ticker": "^XNDX",     "variant": "gross", "kw": ["nasdaq 100", "nasdaq-100", "nasdaq100"]},
    "eurostoxx50":{"label": "EURO STOXX 50",      "ticker": "^SX5T",     "variant": "net",   "kw": ["euro stoxx 50", "eurostoxx 50", "euro stoxx50"]},
    "stoxx600":   {"label": "STOXX Europe 600",   "ticker": "^SXXR",     "variant": "net",   "kw": ["stoxx europe 600", "stoxx 600", "stoxx600"]},
    "dax":        {"label": "DAX",                "ticker": "^GDAXI",    "variant": "gross", "kw": ["dax 40", " dax ", "dax index"]},
    "cac40":      {"label": "CAC 40",             "ticker": "^FCHI",     "variant": "price", "kw": ["cac 40", "cac40"]},
    "ftse100":    {"label": "FTSE 100",           "ticker": "^FTSE",     "variant": "price", "kw": ["ftse 100", "ftse100"]},
    "nikkei225":  {"label": "Nikkei 225",         "ticker": "^N225",     "variant": "price", "kw": ["nikkei 225", "nikkei225"]},
}


def map_index(fund: dict) -> str | None:
    """Détecte l'indice de référence d'un ETF via sa catégorie / son nom.

    Conservateur : ne renvoie un code que si un mot-clé d'indice est trouvé.
    Les indices très génériques (MSCI World/EM…) sans ticker net TR gratuit
    fiable sont volontairement absents du catalogue pour l'instant."""
    hay = " ".join(
        str(fund.get(k) or "") for k in ("category", "category_normalized", "name")
    ).lower()
    hay = f" {hay} "
    for code, meta in INDEX_CATALOG.items():
        if any(kw in hay for kw in meta["kw"]):
            return code
    return None


# ─── Calculs ─────────────────────────────────────────────────────────────────────

def perf_total(pairs: list[tuple[str, float]]) -> float | None:
    if len(pairs) < 2 or pairs[0][1] <= 0:
        return None
    p = pairs[-1][1] / pairs[0][1] - 1
    return p if p > -1.0 else None  # perte > 100% = VL aberrante


def annualize(total: float | None, span_days: int) -> float | None:
    if total is None or span_days <= 0:
        return None
    years = span_days / 365.25
    if years <= 0:
        return None
    try:
        return (1 + total) ** (1 / years) - 1
    except (ValueError, ZeroDivisionError):
        return None


def _clamp(v: float | None) -> float | None:
    if v is None:
        return None
    return round(max(-TD_MAX, min(TD_MAX, v)), 4)


def span_days(pairs: list[tuple[str, float]]) -> int:
    if len(pairs) < 2:
        return 0
    return (date.fromisoformat(pairs[-1][0]) - date.fromisoformat(pairs[0][0])).days


class IndexSeries:
    """Série d'indice indexée par date, avec lookup « dernière valeur ≤ date »
    (forward-fill) pour aligner un indice quotidien sur des VL hebdomadaires."""

    def __init__(self, rows: list[dict]):
        clean = sorted(
            (r["price_date"], float(r["value"]))
            for r in rows
            if r.get("value") is not None
        )
        self._dates = [d for d, _ in clean]
        self._vals = [v for _, v in clean]

    def __len__(self) -> int:
        return len(self._dates)

    def at(self, d: str) -> float | None:
        """Valeur de l'indice à la date d (sinon dernière connue avant d)."""
        i = bisect.bisect_right(self._dates, d) - 1
        return self._vals[i] if i >= 0 else None


def td_for_window(fund_pairs: list[tuple[str, float]], idx: IndexSeries,
                  cutoff: str, min_points: int, min_span: int,
                  annualized: bool) -> float | None:
    """TD sur une fenêtre : (perf ETF − perf indice) sur les MÊMES bornes de dates."""
    win = [(d, p) for d, p in fund_pairs if d >= cutoff]
    sd = span_days(win)
    if len(win) < min_points or sd < min_span:
        return None

    fund_total = perf_total(win)
    if fund_total is None:
        return None

    # Indice évalué aux mêmes dates de début / fin que l'ETF (équité de période).
    v_start, v_end = idx.at(win[0][0]), idx.at(win[-1][0])
    if not v_start or not v_end or v_start <= 0:
        return None
    idx_total = v_end / v_start - 1

    if annualized:
        f = annualize(fund_total, sd)
        x = annualize(idx_total, sd)
        if f is None or x is None:
            return None
        return _clamp((f - x) * 100)
    return _clamp((fund_total - idx_total) * 100)


# ─── Lecture des séries ──────────────────────────────────────────────────────────

def fetch_fund_prices(client, isin: str) -> list[tuple[str, float]]:
    """VL d'un fonds depuis 5 ans, triées, paginées (plafond PostgREST 1000)."""
    rows: list[dict] = []
    offset, page = 0, 1000
    while True:
        chunk = client.table("investissement_fund_prices") \
            .select("price_date, nav") \
            .eq("isin", isin) \
            .gte("price_date", DATE_5Y) \
            .order("price_date", desc=False) \
            .range(offset, offset + page - 1) \
            .execute().data or []
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    out: list[tuple[str, float]] = []
    for r in rows:
        if r.get("nav") is not None:
            try:
                out.append((r["price_date"], float(r["nav"])))
            except (ValueError, TypeError):
                pass
    return out


def fetch_index_series(client, code: str) -> IndexSeries:
    rows: list[dict] = []
    offset, page = 0, 1000
    while True:
        chunk = client.table("investissement_index_prices") \
            .select("price_date, value") \
            .eq("index_code", code) \
            .gte("price_date", DATE_5Y) \
            .order("price_date", desc=False) \
            .range(offset, offset + page - 1) \
            .execute().data or []
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return IndexSeries(rows)


# ─── Étape 1 : rafraîchir les séries d'indices (Yahoo) ──────────────────────────

def refresh_indices(apply: bool) -> None:
    try:
        import yfinance as yf
    except ImportError:
        print("  ✗ yfinance non installé — pip install yfinance")
        return

    client = get_client()
    start = (TODAY - timedelta(days=365 * 6)).isoformat()
    for code, meta in INDEX_CATALOG.items():
        ticker = meta["ticker"]
        print(f"  · {code:12} {ticker:10} ({meta['variant']}) …", end=" ", flush=True)
        try:
            df = yf.download(ticker, start=start, interval="1d",
                             progress=False, auto_adjust=False)
        except Exception as e:
            print(f"échec téléchargement : {str(e)[:60]}")
            continue
        if df is None or df.empty:
            print("aucune donnée")
            continue

        # yficance renvoie un MultiIndex de colonnes pour un seul ticker depuis
        # la v0.2.28 (« Price »/« Ticker ») : on aplatit au niveau 0 pour
        # retrouver une colonne « Close » scalaire.
        if getattr(df.columns, "nlevels", 1) > 1:
            df.columns = df.columns.get_level_values(0)
        if "Close" not in df.columns:
            print("colonne Close absente")
            continue

        rows = []
        for ts, val in df["Close"].dropna().items():
            rows.append({"index_code": code, "price_date": ts.date().isoformat(),
                         "value": float(val), "source": f"yahoo:{ticker}"})
        print(f"{len(rows)} points", end="")

        if apply and rows:
            ok = 0
            for i in range(0, len(rows), 500):
                batch = rows[i:i + 500]
                for attempt in range(3):
                    try:
                        client.table("investissement_index_prices") \
                            .upsert(batch, on_conflict="index_code,price_date") \
                            .execute()
                        ok += len(batch)
                        break
                    except Exception:
                        if attempt == 2:
                            print(f"  ✗ upsert {code} batch {i}")
            print(f" → {ok} écrits")
        else:
            print(" (dry-run)")


# ─── Étape 2 : calcul de la TD par ETF ──────────────────────────────────────────

def run(apply: bool, limit: int | None, isin_filter: str | None) -> None:
    print("=" * 60)
    print("  TD Enricher — Tracking difference des ETF")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}\n")

    started = datetime.now(timezone.utc)
    client = get_client()

    # ETF candidats (passifs/indiciels) avec catégorie pour le mapping d'indice.
    q = client.table("investissement_funds") \
        .select("isin, name, category, category_normalized, product_type, management_style") \
        .eq("product_type", "etf")
    if isin_filter:
        q = q.eq("isin", isin_filter)
    funds = q.execute().data or []
    if limit:
        funds = funds[:limit]
    print(f"  {len(funds)} ETF à examiner")

    # Pré-charge les séries d'indices utilisées (une fois chacune).
    idx_cache: dict[str, IndexSeries] = {}
    updates: list[dict] = []
    mapped = unmapped = computed = 0

    for i, fund in enumerate(funds, 1):
        if i % 1500 == 0:
            client = reset_client()

        code = map_index(fund)
        if not code:
            unmapped += 1
            continue
        mapped += 1

        if code not in idx_cache:
            idx_cache[code] = fetch_index_series(client, code)
        idx = idx_cache[code]
        if len(idx) == 0:
            continue  # indice pas encore rafraîchi

        try:
            fp = fetch_fund_prices(client, fund["isin"])
        except Exception as e:
            print(f"  ↻ reconnexion ({fund['isin']}) : {str(e)[:60]}")
            client = reset_client()
            fp = fetch_fund_prices(client, fund["isin"])
        if len(fp) < MIN_POINTS_1Y:
            continue

        td1 = td_for_window(fp, idx, DATE_1Y, MIN_POINTS_1Y, MIN_SPAN_1Y, annualized=False)
        td3 = td_for_window(fp, idx, DATE_3Y, MIN_POINTS_3Y, MIN_SPAN_3Y, annualized=True)
        td5 = td_for_window(fp, idx, DATE_5Y, MIN_POINTS_5Y, MIN_SPAN_5Y, annualized=True)
        if td1 is None and td3 is None and td5 is None:
            continue

        meta = INDEX_CATALOG[code]
        updates.append({
            "isin": fund["isin"],
            "benchmark_index": meta["label"],
            "benchmark_code": code,
            "benchmark_variant": meta["variant"],
            "tracking_diff_1y": td1,
            "tracking_diff_3y": td3,
            "tracking_diff_5y": td5,
            "tracking_diff_computed_at": now_iso(),
        })
        computed += 1
        if i % 200 == 0:
            print(f"  [{i:5d}/{len(funds)}] mappés:{mapped} calculés:{computed}")

    print(f"\n  → {mapped} ETF mappés à un indice, {unmapped} non mappés, "
          f"{computed} TD calculées")

    if apply and updates:
        print(f"  Écriture dans Supabase ({len(updates)} ETF)…", end=" ", flush=True)
        ok, fail = update_funds_bulk(updates, batch_size=200)
        print(f"✓ {ok} OK, {fail} échec")
        log_run(scraper="td-enricher", status="success",
                records_processed=ok, records_failed=fail, started_at=started)
    elif not apply and updates:
        print("\n  Aperçu (5 premiers) :")
        for r in updates[:5]:
            print(f"  {r['isin']} | {r['benchmark_index']:16} ({r['benchmark_variant']}) | "
                  f"TD 1Y:{r['tracking_diff_1y']} 3Y:{r['tracking_diff_3y']} 5Y:{r['tracking_diff_5y']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tracking difference des ETF")
    parser.add_argument("--refresh-indices", action="store_true",
                        help="Récupère les séries d'indices (Yahoo) avant calcul")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N ETF")
    parser.add_argument("--isin", type=str, help="Un seul ISIN (test)")
    args = parser.parse_args()

    if args.refresh_indices:
        print("── Rafraîchissement des indices ──")
        refresh_indices(apply=args.apply)
        print()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
