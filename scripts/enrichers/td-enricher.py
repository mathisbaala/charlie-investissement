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

Sources des indices de référence :
   - Yahoo : S&P 500 (^SP500TR) et DAX (^GDAXI), seuls TR fiables en gratuit.
   - MSCI (app2.msci.com) : indices NET total return officiels (World, EM, USA,
     Europe, Japan), servis en EUR natif → pas de bruit FX pour les ETF EUR.
   On STOCKE la variante employée (net / gross / price) dans benchmark_variant
   pour rester transparent. Élargir INDEX_CATALOG au fil des sources.

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

# Borne de plausibilité : la TD d'un ETF répliquant un indice 1× est petite
# (typiquement -2 % à +0,5 %/an). Au-delà de ±MAX_PLAUSIBLE_TD %, c'est un
# artefact (série NAV éparse, devise erronée, produit non-vanille) et non une
# vraie tracking difference → on n'écrit RIEN plutôt qu'un chiffre trompeur.
MAX_PLAUSIBLE_TD = 5.0

# Marqueurs de produits NON 1× (levier/inverse) : à ne jamais comparer à
# l'indice simple. Détectés dans le nom/catégorie.
EXCLUDE_KW = ["2x", "3x", "x2", "x3", "leverag", "levier", "daily lever",
              "short", "inverse", "bear", "ultra"]

# Marqueurs de produits à exposition MODIFIÉE : ESG/SRI, facteurs (value,
# momentum, quality, min vol…), sectoriels, ou classes d'actifs non-actions
# captées par erreur via un mot générique (« emerging » d'un fonds obligataire).
# Ces produits répliquent un indice DIFFÉRENT de l'indice parent cap-weighted
# net → les comparer à ce dernier transforme un écart d'exposition en faux
# « coût ». Conformément à la philosophie du module (sous-couvrir plutôt que
# publier un chiffre trompeur), on ne mappe PAS quand un de ces termes apparaît.
NON_VANILLA_KW = [
    # exposition durable / éthique
    "esg", "sri", "sustainab", "socially", "ethical", "climat", "paris",
    "screen", "sociétal", "low carbon", "carbon",
    # facteurs / smart beta
    "value", "momentum", "quality", "min vol", "minimum vol", "volatilit",
    "small cap", "small-cap", "mid cap", "equal weight", "equal-weight",
    "high dividend", "dividend", "buyback", "growth", "factor", "multifactor",
    "sector", " ex ", "ex-usa", "ex-uk", "ex-emu", "ex usa",
    # secteurs GICS (un ETF « MSCI World Information Technology » réplique le
    # secteur, pas l'indice parent — son nom ne contient pas le mot « sector »)
    "information technology", "health care", "healthcare", "financials",
    "consumer", "industrials", "materials", "utilities", "energy",
    "communication services", "real estate", "santé", "immobil",
    # non-actions captées par un mot-clé générique
    "bond", "oblig", "govt", "gov ", "govies", "aggregate", "treasur",
    "corporate", "credit",
]

# ─── Catalogue d'indices de référence ───────────────────────────────────────────
# code interne → (libellé, ticker Yahoo, variante, mots-clés de détection).
# `variant` ∈ {net, gross, price} : qualité de l'indice comme référence de coût.
#   - net   : reinvestit les dividendes NETS de retenue à la source → référence idéale.
#   - gross : dividendes BRUTS → surévalue légèrement l'indice (TD un peu pessimiste).
#   - price : hors dividendes → INTERDIT pour la TD (voir garde plus bas).
#
# ⚠️ La TD n'a de sens QUE contre un indice TOTAL RETURN (dividendes réinvestis).
# Contre un indice « price » (hors dividendes), la TD ressort faussement très
# positive (≈ le rendement du dividende) — l'inverse d'une mesure de coût. On ne
# garde donc QUE des indices net/gross issus d'une source TR fiable :
#   - Yahoo : ^SP500TR (S&P 500 gross≈net, US sans retenue) et ^GDAXI (DAX,
#     indice de PERFORMANCE = gross TR). Seuls indices TR fiables en gratuit
#     sur Yahoo ; les variantes TR européennes y renvoient 404 / 1 point.
#   - MSCI (app2.msci.com) : indices NET total return officiels (variant NETR)
#     pour World / Emerging Markets / USA / Europe / Japan, servis en EUR natif.
#     C'est la source net TR licenciée, en accès public — la meilleure référence
#     de coût. Élargir via msci_code (cf. INDEX_CATALOG).
# Restent non couverts faute de source TR gratuite : EURO STOXX 50, STOXX 600,
# CAC 40, FTSE 100, Nasdaq 100 (faibles volumes). On reste conservateur :
# mapping uniquement sur signal clair (mots-clés), jamais un indice approché.
# ⚠️ DEVISE : l'indice est libellé dans UNE devise (`ccy`). Comparer un ETF
# d'une AUTRE devise mesure le change, PAS le coût (un ETF S&P 500 en EUR vs
# l'indice en USD ressort à ±15 % = mouvement EUR/USD). On ne calcule donc la TD
# QUE si la devise de la part de l'ETF == la devise de l'indice.
# `source` ∈ {yahoo, msci} : d'où provient la série.
#   - yahoo : yf.download(ticker). Seuls S&P 500 (gross≈net, US) et DAX (gross)
#     sont fiables en gratuit sur Yahoo (cf. note ci-dessus).
#   - msci  : endpoint public app2.msci.com (getLevelDataForGraph). Fournit les
#     indices NET total return officiels (variant NETR), par code MSCI, et —
#     décisif — SERVIS DIRECTEMENT EN EUR (currency_symbol=EUR). Comme la quasi-
#     totalité des ETF mappés sont en EUR, on lit l'indice en EUR natif et on
#     ÉVITE toute conversion FX (donc le bruit de change). Les rares parts USD
#     repassent par la conversion via change, comme pour les autres indices.
INDEX_CATALOG: dict[str, dict] = {
    "sp500": {"label": "S&P 500", "source": "yahoo", "ticker": "^SP500TR",
              "variant": "gross", "ccy": "USD",
              "kw": ["s&p 500", "sp 500", "s&p500", "sp500"]},
    "dax":   {"label": "DAX", "source": "yahoo", "ticker": "^GDAXI",
              "variant": "gross", "ccy": "EUR",
              "kw": ["dax 40", " dax ", "dax index"]},
    # ── Famille MSCI — indices NET total return, source officielle gratuite ──
    "msci_world":  {"label": "MSCI World", "source": "msci", "msci_code": "990100",
                    "variant": "net", "ccy": "EUR", "kw": ["msci world"]},
    "msci_em":     {"label": "MSCI Emerging Markets", "source": "msci", "msci_code": "891800",
                    "variant": "net", "ccy": "EUR",
                    "kw": ["msci em ", "emerging", "émergent", "emergent"]},
    "msci_usa":    {"label": "MSCI USA", "source": "msci", "msci_code": "984000",
                    "variant": "net", "ccy": "EUR", "kw": ["msci usa"]},
    "msci_europe": {"label": "MSCI Europe", "source": "msci", "msci_code": "990500",
                    "variant": "net", "ccy": "EUR", "kw": ["msci europe"]},
    "msci_japan":  {"label": "MSCI Japan", "source": "msci", "msci_code": "990400",
                    "variant": "net", "ccy": "EUR", "kw": ["msci japan", "msci japon"]},
}

# Devises de parts d'ETF vers lesquelles on convertit les indices (via change),
# pour pouvoir comparer un ETF EUR à un indice USD sans contaminer la TD par le FX.
FX_TARGETS = ["EUR", "USD", "GBP", "CHF"]


def map_index(fund: dict) -> str | None:
    """Détecte l'indice de référence d'un ETF via sa catégorie / son nom.

    Conservateur : ne renvoie un code que si un mot-clé d'indice est trouvé.
    Les indices très génériques (MSCI World/EM…) sans ticker net TR gratuit
    fiable sont volontairement absents du catalogue pour l'instant."""
    hay = " ".join(
        str(fund.get(k) or "") for k in ("category", "category_normalized", "name")
    ).lower()
    hay = f" {hay} "
    if any(k in hay for k in EXCLUDE_KW):
        return None  # levier / inverse : ne réplique pas l'indice 1×
    if any(k in hay for k in NON_VANILLA_KW):
        return None  # ESG / facteur / sectoriel / obligataire : pas l'indice parent net
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

    def points(self) -> list[tuple[str, float]]:
        return list(zip(self._dates, self._vals))


def convert_series(base: "IndexSeries", fx: "IndexSeries") -> "IndexSeries":
    """Convertit une série d'indice dans une autre devise via une série de change
    (fx.at(d) = devise cible pour 1 unité de devise source). Forward-fill du change."""
    pts = []
    for d, v in base.points():
        f = fx.at(d)
        if f:
            pts.append({"price_date": d, "value": v * f})
    return IndexSeries(pts)


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
        td = (f - x) * 100
    else:
        td = (fund_total - idx_total) * 100
    # Borne de plausibilité : au-delà, artefact de données → ne rien afficher.
    if abs(td) > MAX_PLAUSIBLE_TD:
        return None
    return _clamp(td)


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

# Endpoint public MSCI alimentant les graphes de performance de msci.com.
# index_variant : NETR (net TR) / GRTR (gross TR) / STRD (price). On choisit
# selon le `variant` du catalogue. Réponse JSON : indexes.INDEX_LEVELS = liste
# de {level_eod, calc_date(int yyyymmdd)}.
MSCI_ENDPOINT = ("https://app2.msci.com/products/service/index/indexmaster/"
                 "getLevelDataForGraph")
MSCI_VARIANT = {"net": "NETR", "gross": "GRTR", "price": "STRD"}


def fetch_msci_rows(code: str, meta: dict, start_ymd: str, end_ymd: str) -> list[dict]:
    """Série d'un indice MSCI (net/gross/price) dans la devise du catalogue,
    via l'endpoint public app2.msci.com. Lève en cas d'erreur réseau/format."""
    import urllib.request
    import json
    variant = MSCI_VARIANT[meta["variant"]]
    url = (f"{MSCI_ENDPOINT}?currency_symbol={meta['ccy']}"
           f"&index_variant={variant}&start_date={start_ymd}&end_date={end_ymd}"
           f"&data_frequency=DAILY&index_codes={meta['msci_code']}")
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0", "Accept": "application/json",
        "Referer": "https://www.msci.com/"})
    raw = urllib.request.urlopen(req, timeout=30).read().decode()
    levels = json.loads(raw)["indexes"]["INDEX_LEVELS"]
    src = f"msci:{meta['msci_code']}:{variant}"
    rows: list[dict] = []
    for lv in levels:
        v = lv.get("level_eod")
        if v is None:
            continue
        cd = str(lv["calc_date"])  # yyyymmdd
        iso = f"{cd[0:4]}-{cd[4:6]}-{cd[6:8]}"
        rows.append({"index_code": code, "price_date": iso,
                     "value": float(v), "source": src})
    return rows


def refresh_indices(apply: bool) -> None:
    client = get_client()
    start_iso = (TODAY - timedelta(days=365 * 6)).isoformat()
    start_ymd = start_iso.replace("-", "")
    end_ymd = TODAY.isoformat().replace("-", "")

    def _yahoo_rows(code: str, ticker: str) -> list[dict]:
        import yfinance as yf
        df = yf.download(ticker, start=start_iso, interval="1d",
                         progress=False, auto_adjust=False)
        if df is None or df.empty:
            return []
        # yfinance renvoie un MultiIndex de colonnes pour un seul ticker depuis
        # la v0.2.28 : on aplatit au niveau 0 pour retrouver « Close » scalaire.
        if getattr(df.columns, "nlevels", 1) > 1:
            df.columns = df.columns.get_level_values(0)
        if "Close" not in df.columns:
            return []
        return [
            {"index_code": code, "price_date": ts.date().isoformat(),
             "value": float(val), "source": f"yahoo:{ticker}"}
            for ts, val in df["Close"].dropna().items()
        ]

    def _store(code: str, rows: list[dict], label: str) -> None:
        print(f"  · {label:28} {len(rows)} points", end="")
        if apply and rows:
            ok = 0
            for i in range(0, len(rows), 500):
                batch = rows[i:i + 500]
                for attempt in range(3):
                    try:
                        client.table("investissement_index_prices") \
                            .upsert(batch, on_conflict="index_code,price_date").execute()
                        ok += len(batch)
                        break
                    except Exception:
                        if attempt == 2:
                            print(f"  ✗ upsert {code} batch {i}")
            print(f" → {ok} écrits")
        else:
            print(" (dry-run)")

    # 1) Séries d'indices (routées selon la source du catalogue)
    for code, meta in INDEX_CATALOG.items():
        label = f"{code} ({meta['variant']}/{meta.get('source', 'yahoo')})"
        try:
            if meta.get("source") == "msci":
                rows = fetch_msci_rows(code, meta, start_ymd, end_ymd)
            else:
                rows = _yahoo_rows(code, meta["ticker"])
        except Exception as e:
            print(f"  · {label:28} échec : {str(e)[:60]}")
            continue
        _store(code, rows, label)

    # 2) Séries de change : convertir chaque indice (sa devise) vers les devises
    # de parts d'ETF courantes. Ticker Yahoo {SRC}{DST}=X = DST pour 1 SRC →
    # value_DST = value_SRC × fx. Stockées sous index_code "fx:SRCDST". Toujours
    # via Yahoo (les paires de change majeures y sont fiables).
    index_ccys = {m["ccy"] for m in INDEX_CATALOG.values()}
    for src in index_ccys:
        for dst in FX_TARGETS:
            if src == dst:
                continue
            code = f"fx:{src}{dst}"
            try:
                rows = _yahoo_rows(code, f"{src}{dst}=X")
            except Exception as e:
                print(f"  · {code:28} échec : {str(e)[:50]}")
                continue
            _store(code, rows, f"fx {src}→{dst}")


# ─── Étape 2 : calcul de la TD par ETF ──────────────────────────────────────────

def run(apply: bool, limit: int | None, isin_filter: str | None) -> None:
    print("=" * 60)
    print("  TD Enricher — Tracking difference des ETF")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}\n")

    started = datetime.now(timezone.utc)
    client = get_client()

    # ETF candidats (passifs/indiciels) avec catégorie pour le mapping d'indice.
    # Pagination obligatoire : PostgREST plafonne à 1000 lignes/requête et
    # l'univers compte ~2000 ETF (sans ça, la moitié était ignorée).
    funds: list[dict] = []
    sel = "isin, name, category, category_normalized, product_type, management_style, currency, hedged"
    if isin_filter:
        funds = client.table("investissement_funds").select(sel) \
            .eq("product_type", "etf").eq("isin", isin_filter).execute().data or []
    else:
        offset, page = 0, 1000
        while True:
            chunk = client.table("investissement_funds").select(sel) \
                .eq("product_type", "etf") \
                .order("isin").range(offset, offset + page - 1).execute().data or []
            funds.extend(chunk)
            if len(chunk) < page:
                break
            offset += page
    if limit:
        funds = funds[:limit]
    print(f"  {len(funds)} ETF à examiner")

    # Caches : série d'indice native (par code) + série convertie (par code+devise).
    idx_cache: dict[str, IndexSeries] = {}
    fx_cache: dict[str, IndexSeries | None] = {}      # "fx:SRCDST" → série de change
    conv_cache: dict[tuple[str, str], IndexSeries | None] = {}  # (code, ccy) → indice converti
    updates: list[dict] = []
    mapped = unmapped = computed = mismatch_ccy = 0

    def index_in_ccy(code: str, ccy: str) -> "IndexSeries | None":
        """Série de l'indice `code` exprimée dans la devise `ccy` (native ou
        convertie via change). None si indice absent ou change indisponible."""
        meta = INDEX_CATALOG[code]
        if code not in idx_cache:
            idx_cache[code] = fetch_index_series(client, code)
        base = idx_cache[code]
        if len(base) == 0 or not ccy:
            return None
        if ccy == meta["ccy"]:
            return base
        key = (code, ccy)
        if key not in conv_cache:
            fxkey = f"fx:{meta['ccy']}{ccy}"
            if fxkey not in fx_cache:
                s = fetch_index_series(client, fxkey)
                fx_cache[fxkey] = s if len(s) > 0 else None
            fx = fx_cache[fxkey]
            conv_cache[key] = convert_series(base, fx) if fx else None
        return conv_cache[key]

    for i, fund in enumerate(funds, 1):
        if i % 1500 == 0:
            client = reset_client()

        code = map_index(fund)
        if not code:
            unmapped += 1
            continue
        meta = INDEX_CATALOG[code]
        # Garde-fou : jamais de TD contre un indice price-only (TD trompeuse).
        if meta["variant"] == "price":
            unmapped += 1
            continue
        # Parts couvertes en devise (hedged) : le hedge neutralise le FX et fausse
        # la comparaison avec notre indice converti → on s'abstient.
        if fund.get("hedged") is True:
            unmapped += 1
            continue
        # Indice exprimé dans la devise de la part d'ETF (native ou converti via
        # change) : sans ça la TD mesurerait le FX, pas le coût.
        ccy = (fund.get("currency") or "").upper()
        idx = index_in_ccy(code, ccy)
        if idx is None or len(idx) == 0:
            mismatch_ccy += 1   # devise non convertible (change absent) ou indice manquant
            continue
        mapped += 1

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

    print(f"\n  → {mapped} ETF mappés (devise OK), {unmapped} non mappés, "
          f"{mismatch_ccy} écartés (devise ≠ indice), {computed} TD calculées")

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
