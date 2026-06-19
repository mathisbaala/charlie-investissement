#!/usr/bin/env python3
"""
td-enricher.py — Benchmark + alpha vs indice (ex « tracking difference »)
================================================================================
Affecte un INDICE DE RÉFÉRENCE à chaque fonds et calcule sa performance vs cet
indice — l'écart fonds − indice, sur des fenêtres alignées (1Y / 3Y / 5Y) :

    alpha = perf fonds − perf indice TR
            (négatif = sous-performance ; pour un ETF passif = coût de réplication)

Généralisé depuis la version ETF-only :
  - Le CATALOGUE d'indices et les RÈGLES d'affectation vivent désormais en base
    (investissement_index_catalog / investissement_benchmark_rules), pas dans le
    code → éditables en SQL.
  - On affecte un benchmark à TOUT fonds primaire (plus seulement les ETF) :
      • match EXACT par mot-clé d'indice (ETF vanille) → benchmark_is_category=false
      • sinon match par CATÉGORIE/RÉGION (fonds actif) → indice de catégorie,
        benchmark_is_category=true (l'UI affiche « indice de catégorie »).
  - On écrit benchmark_perf_{1,3,5}y (rendement indice, cumulé %) et
    alpha_{1,3,5}y (1y cumulé, 3y/5y annualisé %), jamais en écrasant par None
    (gotcha ft-metrics-wipe : un None ne remplace pas une valeur existante).

Pipeline en deux temps :
  1. --refresh-indices : récupère les séries des indices du catalogue (Yahoo /
     MSCI) dans investissement_index_prices.
  2. (défaut) : pour chaque fonds mappé, lit ses VL (investissement_fund_prices)
     + la série de l'indice, aligne sur les dates communes, calcule alpha +
     benchmark_perf et écrit dans investissement_funds (fill/recompute, jamais
     d'insert).

Sources des indices : Yahoo (S&P 500 ^SP500TR, DAX ^GDAXI, Nasdaq-100 ^XNDX) et
MSCI net TR officiels (World, EM, USA, Europe, Japan), servis en EUR natif. La
variante (net/gross/price) est stockée dans benchmark_variant pour transparence.

Usage :
    python3 scripts/enrichers/td-enricher.py --refresh-indices [--apply]
    python3 scripts/enrichers/td-enricher.py [--apply] [--limit N] [--isin ISIN]

Cron : compute (sans --refresh-indices) hebdo après compute-metrics ;
       --refresh-indices mensuel.
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

CLAMP_MAX = 9999.9999  # plafond numeric(8,4)

# Borne de plausibilité de l'alpha, au-delà de laquelle c'est un artefact (série
# NAV éparse, devise erronée, mauvais appariement d'indice) plutôt qu'une vraie
# surperformance → on n'écrit RIEN pour cette fenêtre.
#   - exact (ETF vanille vs SON indice) : la TD est petite → ±5 %/an.
#   - catégorie (fonds actif vs indice de catégorie) : l'alpha actif est
#     légitimement plus large → ±30 %/an.
MAX_ALPHA_EXACT    = 5.0
MAX_ALPHA_CATEGORY = 30.0

# Produits NON 1× (levier/inverse) : jamais comparables à un indice simple.
EXCLUDE_KW = ["2x", "3x", "x2", "x3", "leverag", "levier", "daily lever",
              "short", "inverse", "bear", "ultra"]

# Produits à exposition MODIFIÉE (ESG/facteur/sectoriel/obligataire capté par un
# mot générique). Ils ne répliquent PAS l'indice parent cap-weighted → on refuse
# le match EXACT (qui prétendrait le contraire). Ils restent éligibles au match
# par catégorie (indice de catégorie, is_category=true), où l'écart d'exposition
# fait justement partie de l'alpha mesuré.
NON_VANILLA_KW = [
    "esg", "sri", "sustainab", "socially", "ethical", "climat", "paris",
    "screen", "sociétal", "low carbon", "carbon",
    "value", "momentum", "quality", "min vol", "minimum vol", "volatilit",
    "small cap", "small-cap", "mid cap", "equal weight", "equal-weight",
    "high dividend", "dividend", "buyback", "growth", "factor", "multifactor",
    "sector", " ex ", "ex-usa", "ex-uk", "ex-emu", "ex usa",
    "information technology", "health care", "healthcare", "financials",
    "consumer", "industrials", "materials", "utilities", "energy",
    "communication services", "real estate", "santé", "immobil",
    "bond", "oblig", "govt", "gov ", "govies", "aggregate", "treasur",
    "corporate", "credit",
]

# Sous-classement obligataire par mot-clé du nom (govt vs corp/crédit), pour
# distinguer ce que les règles de catégorie (asset_class + region) ne peuvent pas
# voir. Appliqué UNIQUEMENT aux fonds asset_class='obligation' → aucune collision
# avec un fonds action (« Crédit Agricole Actions » est 'action', jamais ici).
# Le high yield/haut rendement est rangé côté crédit (plus proche de l'IG corpo
# que du souverain — faute d'indice HY dédié).
BOND_CORP_KW = ["corporate", "corp ", "crédit", "credit", "investment grade",
                "high yield", "haut rendement"]
BOND_GOVT_KW = ["govt", "government", "gouvernement", "souverain", "sovereign",
                "état ", "treasury", "trésor", "gilt", "bund", "oat "]

# Devises de parts vers lesquelles on convertit les indices (via change), pour
# comparer un fonds EUR à un indice USD sans contaminer l'alpha par le FX.
FX_TARGETS = ["EUR", "USD", "GBP", "CHF"]

MSCI_ENDPOINT = ("https://app2.msci.com/products/service/index/indexmaster/"
                 "getLevelDataForGraph")
MSCI_VARIANT = {"net": "NETR", "gross": "GRTR", "price": "STRD"}


# ─── Catalogue & règles (chargés depuis la base) ────────────────────────────────

def load_catalog(client) -> dict[str, dict]:
    """Catalogue d'indices depuis investissement_index_catalog (source de vérité)."""
    rows = client.table("investissement_index_catalog") \
        .select("index_code, label, currency, variant, source, ticker, msci_code, keywords") \
        .eq("active", True).execute().data or []
    cat: dict[str, dict] = {}
    for r in rows:
        cat[r["index_code"]] = {
            "label": r["label"],
            "ccy": (r["currency"] or "").upper().strip(),
            "variant": r["variant"],
            "source": r["source"],
            "ticker": r.get("ticker"),
            "msci_code": r.get("msci_code"),
            "kw": [k.lower() for k in (r.get("keywords") or [])],
        }
    return cat


def load_rules(client) -> list[dict]:
    """Règles d'affectation par catégorie, triées par priorité croissante."""
    rows = client.table("investissement_benchmark_rules") \
        .select("priority, match_asset_class, match_region, match_style, "
                "index_code, is_category_proxy") \
        .eq("active", True).order("priority").execute().data or []
    return rows


def map_index(fund: dict, catalog: dict[str, dict],
              rules: list[dict]) -> tuple[str | None, bool]:
    """(index_code, is_category) pour un fonds, ou (None, False) si non mappable.

    1) levier/inverse → jamais.
    2) match EXACT par mot-clé d'indice (hors produit non-vanille) → is_category=False.
    3) sinon, 1re règle de catégorie qui matche (asset_class/region) → is_category=True.
    """
    hay = " ".join(
        str(fund.get(k) or "") for k in ("category", "category_normalized", "name")
    ).lower()
    hay = f" {hay} "
    # « short-term » / « ultra-short » / « short duration » sont des fonds
    # obligataires/monétaires vanille, PAS des produits inverse/levier : on
    # neutralise ces tournures avant le filtre levier (qui contient short/ultra),
    # sinon toute la dette courte serait exclue à tort.
    # On ne neutralise que les tournures OBLIGATAIRES sans ambiguïté (« ultra
    # short term/duration/bond »…) : un « UltraShort <indice action> » (inverse
    # −2x) garde ses « ultra »/« short » et reste exclu.
    hay_lev = hay
    for benign in ("ultra short term", "ultra-short term", "ultra short duration",
                   "ultra short bond", "ultra short dated", "ultra short maturity",
                   "ultrashort term", "ultrashort duration", "ultrashort bond",
                   "short-term", "short term", "shortterm",
                   "short duration", "short-duration",
                   "short dated", "short-dated", "short maturity"):
        hay_lev = hay_lev.replace(benign, " ")
    if any(k in hay_lev for k in EXCLUDE_KW):
        return None, False

    # Un « exact » (is_category=False) n'a de sens que pour un TRACKER (ETF /
    # gestion indicielle) : lui seul réplique vraiment l'indice → écart de
    # réplication, borne ±5 %/an. Un fonds ACTIF dont le nom contient un mot-clé
    # d'indice (« emerging », « msci world »…) n'est PAS un tracker : on le mappe
    # comme indice de CATÉGORIE (alpha, borne ±30 %/an), pas comme réplication.
    style = (fund.get("management_style") or "").lower()
    is_tracker = (fund.get("product_type") == "etf"
                  or style in ("passif", "index", "smart_beta"))

    # 2) Exact : produit vanille uniquement (sinon il réplique un indice DIFFÉRENT
    #    du parent). is_category=False seulement si c'est réellement un tracker.
    if not any(k in hay for k in NON_VANILLA_KW):
        for code, meta in catalog.items():
            if any(kw in hay for kw in meta["kw"]):
                return code, (not is_tracker)

    acb = (fund.get("asset_class_broad") or "").lower()
    reg = (fund.get("region_normalized") or "").lower()

    # 2b) Sous-classement obligataire govt/corp par mot-clé du nom, AVANT la
    #     règle de région (qui ne voit pas la sous-classe). Un fonds euro
    #     « corporate »/« crédit » est comparé à l'IG euro (et non au souverain,
    #     qui gonflerait l'alpha de la prime de crédit). Restreint à 'obligation'.
    if acb == "obligation" and ("eur_corp" in catalog or "eur_govt" in catalog):
        is_euro = reg in ("europe", "france", "eurozone", "germany")
        if any(k in hay for k in BOND_CORP_KW):
            return ("eur_corp" if is_euro and "eur_corp" in catalog
                    else "global_agg"), True
        if is_euro and "eur_govt" in catalog and any(k in hay for k in BOND_GOVT_KW):
            return "eur_govt", True

    # 3) Catégorie : règle par asset_class_broad / region_normalized.
    for r in rules:
        if r["index_code"] not in catalog:
            continue
        if r.get("match_asset_class") and r["match_asset_class"].lower() != acb:
            continue
        if r.get("match_region") and r["match_region"].lower() != reg:
            continue
        if r.get("match_style") and r["match_style"].lower() != style:
            continue
        return r["index_code"], bool(r.get("is_category_proxy", True))
    return None, False


# ─── Calculs ─────────────────────────────────────────────────────────────────────

def perf_total(pairs: list[tuple[str, float]]) -> float | None:
    if len(pairs) < 2 or pairs[0][1] <= 0:
        return None
    p = pairs[-1][1] / pairs[0][1] - 1
    return p if p > -1.0 else None


def annualize(total: float | None, span: int) -> float | None:
    if total is None or span <= 0:
        return None
    years = span / 365.25
    if years <= 0:
        return None
    try:
        return (1 + total) ** (1 / years) - 1
    except (ValueError, ZeroDivisionError):
        return None


def _clamp(v: float | None) -> float | None:
    if v is None:
        return None
    return round(max(-CLAMP_MAX, min(CLAMP_MAX, v)), 4)


def span_days(pairs: list[tuple[str, float]]) -> int:
    if len(pairs) < 2:
        return 0
    return (date.fromisoformat(pairs[-1][0]) - date.fromisoformat(pairs[0][0])).days


class IndexSeries:
    """Série d'indice indexée par date, lookup « dernière valeur ≤ date »."""

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
        i = bisect.bisect_right(self._dates, d) - 1
        return self._vals[i] if i >= 0 else None

    def points(self) -> list[tuple[str, float]]:
        return list(zip(self._dates, self._vals))


def convert_series(base: "IndexSeries", fx: "IndexSeries") -> "IndexSeries":
    pts = []
    for d, v in base.points():
        f = fx.at(d)
        if f:
            pts.append({"price_date": d, "value": v * f})
    return IndexSeries(pts)


def metrics_for_window(fund_pairs: list[tuple[str, float]], idx: IndexSeries,
                       cutoff: str, min_points: int, min_span: int,
                       annualized: bool, max_alpha: float
                       ) -> tuple[float | None, float | None]:
    """(benchmark_perf_cumulé_%, alpha_%) sur une fenêtre, ou (None, None).

    benchmark_perf = rendement de l'indice (cumulé %), aux mêmes bornes de dates
    que le fonds. alpha = écart fonds − indice (cumulé si 1y, annualisé sinon).
    None si données insuffisantes ou alpha hors borne de plausibilité.
    """
    win = [(d, p) for d, p in fund_pairs if d >= cutoff]
    sd = span_days(win)
    if len(win) < min_points or sd < min_span:
        return None, None

    fund_total = perf_total(win)
    if fund_total is None:
        return None, None

    v_start, v_end = idx.at(win[0][0]), idx.at(win[-1][0])
    if not v_start or not v_end or v_start <= 0:
        return None, None
    idx_total = v_end / v_start - 1

    if annualized:
        f = annualize(fund_total, sd)
        x = annualize(idx_total, sd)
        if f is None or x is None:
            return None, None
        alpha = (f - x) * 100
        bench = idx_total * 100  # benchmark_perf reste cumulé (annualisé à la lecture)
    else:
        alpha = (fund_total - idx_total) * 100
        bench = idx_total * 100

    if abs(alpha) > max_alpha:
        return None, None
    return _clamp(bench), _clamp(alpha)


# ─── Lecture des séries ──────────────────────────────────────────────────────────

def fetch_fund_prices(client, isin: str) -> list[tuple[str, float]]:
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


# ─── Étape 1 : rafraîchir les séries d'indices ──────────────────────────────────

def fetch_msci_rows(code: str, meta: dict, start_ymd: str, end_ymd: str) -> list[dict]:
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
        cd = str(lv["calc_date"])
        iso = f"{cd[0:4]}-{cd[4:6]}-{cd[6:8]}"
        rows.append({"index_code": code, "price_date": iso,
                     "value": float(v), "source": src})
    return rows


def refresh_indices(apply: bool) -> None:
    client = get_client()
    catalog = load_catalog(client)
    start_iso = (TODAY - timedelta(days=365 * 6)).isoformat()
    start_ymd = start_iso.replace("-", "")
    end_ymd = TODAY.isoformat().replace("-", "")

    def _yahoo_rows(code: str, ticker: str) -> list[dict]:
        import yfinance as yf
        df = yf.download(ticker, start=start_iso, interval="1d",
                         progress=False, auto_adjust=False)
        if df is None or df.empty:
            return []
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
    for code, meta in catalog.items():
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

    # 2) Séries de change : indice (sa devise) → devises de parts courantes.
    index_ccys = {m["ccy"] for m in catalog.values()}
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


# ─── Étape 2 : calcul alpha / benchmark_perf par fonds ──────────────────────────

def run(apply: bool, limit: int | None, isin_filter: str | None) -> None:
    print("=" * 60)
    print("  Benchmark enricher — alpha vs indice de référence")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}\n")

    started = datetime.now(timezone.utc)
    client = get_client()
    catalog = load_catalog(client)
    rules = load_rules(client)
    print(f"  Catalogue : {len(catalog)} indices · {len(rules)} règles\n")

    # Univers : fonds PRIMAIRES (un représentant par groupe de parts, comme le
    # screener). benchmark_index lu pour purger une affectation devenue obsolète.
    sel = ("isin, name, category, category_normalized, asset_class_broad, "
           "region_normalized, management_style, currency, hedged, benchmark_index")
    funds: list[dict] = []
    if isin_filter:
        funds = client.table("investissement_funds").select(sel) \
            .eq("isin", isin_filter).execute().data or []
    else:
        offset, page = 0, 1000
        while True:
            chunk = client.table("investissement_funds").select(sel) \
                .eq("is_primary_share_class", True) \
                .order("isin").range(offset, offset + page - 1).execute().data or []
            funds.extend(chunk)
            if len(chunk) < page:
                break
            offset += page
    if limit:
        funds = funds[:limit]
    print(f"  {len(funds)} fonds primaires à examiner")

    idx_cache: dict[str, IndexSeries] = {}
    fx_cache: dict[str, IndexSeries | None] = {}
    conv_cache: dict[tuple[str, str], IndexSeries | None] = {}
    updates: list[dict] = []
    clears: list[dict] = []
    mapped = unmapped = computed = mismatch_ccy = exact = category = 0

    def record_clear(fund: dict) -> None:
        if fund.get("benchmark_index") is None:
            return
        clears.append({
            "isin": fund["isin"],
            "benchmark_index": None, "benchmark_code": None, "benchmark_variant": None,
            "benchmark_is_category": None,
            "benchmark_perf_1y": None, "benchmark_perf_3y": None, "benchmark_perf_5y": None,
            "alpha_1y": None, "alpha_3y": None, "alpha_5y": None,
            "benchmark_computed_at": None,
        })

    def index_in_ccy(code: str, ccy: str) -> "IndexSeries | None":
        meta = catalog[code]
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

        code, is_category = map_index(fund, catalog, rules)
        if not code:
            unmapped += 1
            record_clear(fund)
            continue
        meta = catalog[code]
        if meta["variant"] == "price":
            unmapped += 1
            record_clear(fund)
            continue
        if fund.get("hedged") is True:
            unmapped += 1
            record_clear(fund)
            continue
        ccy = (fund.get("currency") or "").upper()
        idx = index_in_ccy(code, ccy)
        if idx is None or len(idx) == 0:
            mismatch_ccy += 1
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

        max_alpha = MAX_ALPHA_CATEGORY if is_category else MAX_ALPHA_EXACT
        b1, a1 = metrics_for_window(fp, idx, DATE_1Y, MIN_POINTS_1Y, MIN_SPAN_1Y, False, max_alpha)
        b3, a3 = metrics_for_window(fp, idx, DATE_3Y, MIN_POINTS_3Y, MIN_SPAN_3Y, True, max_alpha)
        b5, a5 = metrics_for_window(fp, idx, DATE_5Y, MIN_POINTS_5Y, MIN_SPAN_5Y, True, max_alpha)
        if a1 is None and a3 is None and a5 is None:
            continue

        # Non-écrasement par None (gotcha ft-metrics-wipe) : on n'inclut une
        # colonne de fenêtre QUE si elle est calculée. L'identité du benchmark
        # est toujours écrite dès qu'au moins une fenêtre existe.
        row = {
            "isin": fund["isin"],
            "benchmark_index": meta["label"],
            "benchmark_code": code,
            "benchmark_variant": meta["variant"],
            "benchmark_is_category": is_category,
            "benchmark_computed_at": now_iso(),
        }
        if a1 is not None: row["alpha_1y"] = a1; row["benchmark_perf_1y"] = b1
        if a3 is not None: row["alpha_3y"] = a3; row["benchmark_perf_3y"] = b3
        if a5 is not None: row["alpha_5y"] = a5; row["benchmark_perf_5y"] = b5
        updates.append(row)
        computed += 1
        if is_category:
            category += 1
        else:
            exact += 1
        if i % 500 == 0:
            print(f"  [{i:5d}/{len(funds)}] mappés:{mapped} calculés:{computed}")

    print(f"\n  → {mapped} mappés (devise OK), {unmapped} non mappés, "
          f"{mismatch_ccy} écartés (devise ≠ indice), {computed} alpha calculés "
          f"({exact} exacts, {category} catégorie), {len(clears)} à purger")

    if apply:
        if updates:
            print(f"  Écriture dans Supabase ({len(updates)} fonds)…", end=" ", flush=True)
            ok, fail = update_funds_bulk(updates, batch_size=200)
            print(f"✓ {ok} OK, {fail} échec")
            log_run(scraper="benchmark-enricher", status="success",
                    records_processed=ok, records_failed=fail, started_at=started)
        if clears:
            print(f"  Purge des fonds dé-mappés ({len(clears)})…", end=" ", flush=True)
            ok_c, fail_c = update_funds_bulk(clears, batch_size=200)
            print(f"✓ {ok_c} purgés, {fail_c} échec")
    else:
        if updates:
            print("\n  Aperçu (8 premiers) :")
            for r in updates[:8]:
                tag = "cat" if r["benchmark_is_category"] else "exact"
                print(f"  {r['isin']} | {r['benchmark_index']:22} ({tag}) | "
                      f"alpha 1Y:{r.get('alpha_1y')} 3Y:{r.get('alpha_3y')} 5Y:{r.get('alpha_5y')}")
        if clears:
            print(f"\n  {len(clears)} fonds seraient purgés (dé-mappés)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Benchmark + alpha vs indice")
    parser.add_argument("--refresh-indices", action="store_true",
                        help="Récupère les séries d'indices (catalogue) avant calcul")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    parser.add_argument("--isin", type=str, help="Un seul ISIN (test)")
    args = parser.parse_args()

    if args.refresh_indices:
        print("── Rafraîchissement des indices ──")
        refresh_indices(apply=args.apply)
        print()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
