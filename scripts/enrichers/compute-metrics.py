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

# Garde de PÉREMPTION : au-delà de ce délai sans nouveau prix, les métriques de
# tendance (perf/vol/Sharpe/drawdown) sont calées sur une fenêtre qui se termine
# il y a > STALE_DAYS jours → périmées et trompeuses (ex. un fonds figé en 2021
# affichant encore +29 % « à 1 an »). On les purge (None). Seuil large (90 j)
# pour ne pas toucher la traîne saine rafraîchie chaque semaine, mais attraper
# les fonds figés/liquidés. SRRI et ancienneté (plus stables) sont conservés.
STALE_DAYS = 90

STALE_PURGE_FIELDS = (
    "performance_1y", "performance_3y", "performance_5y",
    "volatility_1y", "volatility_3y",
    "sharpe_1y", "sharpe_3y",
    "max_drawdown_1y", "max_drawdown_3y",
)

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


# Bornes de plausibilité de la perf CUMULÉE (en %) par classe d'actifs. Une perf
# hors bande trahit une série NAV corrompue (point aberrant en début/fin de
# fenêtre) : on PURGE (écrit None) plutôt que d'écrire une valeur impossible —
# ex. fonds d'État à -95%, monétaire à +820%, ETF actions clampé à ~9999% sur une
# VL corrompue. _valid_perf ne rejette que les pertes ≥ 100% et ignore la classe
# d'actifs, d'où ce garde complémentaire. Les bornes hautes des classes actions
# sont volontairement larges (lèvent seulement le garbage type clamp, pas le
# levier 2x/3x). Lower -100 = neutre (déjà couvert par _valid_perf), conservé
# pour laisser passer les effondrements réels (ETF Russie -99%).
# Pas de borne pour crypto ni action_individuelle (titres vifs) : légitimement
# extrêmes (crypto +5000%, D-Wave +3800%).
PERF_BOUNDS = {
    "monetaire":          (-25.0,   75.0),
    "obligation":         (-65.0,  250.0),
    "diversifie":         (-90.0,  800.0),
    "immobilier":         (-90.0,  800.0),
    "alternatif":         (-95.0,  800.0),
    "matieres_premieres": (-95.0, 1500.0),
    "action":            (-100.0, 3000.0),
}

def _perf_plausible(perf_pct: float | None, asset_class: str | None) -> bool:
    """Vrai si la perf cumulée est plausible pour la classe d'actifs. Sert à
    écarter les séries NAV corrompues sur les classes peu volatiles."""
    if perf_pct is None:
        return False
    bounds = PERF_BOUNDS.get(asset_class or "")
    if bounds is None:
        return True
    lo, hi = bounds
    return lo <= perf_pct <= hi


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


def _track_record_years(inception: str | None, span_days_5y: int) -> float | None:
    """Ancienneté du fonds, en années.

    Source fiable = inception_date (années depuis l'émission). Repli sans
    inception : amplitude réelle de la série de prix (span en jours sur la
    fenêtre 5 ans). On ne compte JAMAIS les points de prix : les VL sont
    quotidiennes (~252/an), len(prices)/52 surévaluait l'ancienneté ~5×
    (ex. 1825 VL / 52 = 35,1 ans pour un fonds réellement âgé de ~10 ans) et
    plafonnait de toute façon à la fenêtre 5 ans."""
    if inception:
        try:
            inc = date.fromisoformat(inception[:10])
            yrs = round((date.today() - inc).days / 365.25, 1)
            if 0 <= yrs <= 100:
                return yrs
        except (ValueError, TypeError):
            pass
    if span_days_5y and span_days_5y > 0:
        return round(span_days_5y / 365.25, 1)
    return None


def _is_stale(last_date: str | None) -> bool:
    """True si le dernier prix date de plus de STALE_DAYS jours."""
    if not last_date:
        return False
    try:
        return (TODAY - date.fromisoformat(last_date[:10])).days > STALE_DAYS
    except (ValueError, TypeError):
        return False


def compute_fund_metrics(prices_1y, prices_3y, prices_5y, prices_all, rf, spans=None,
                         asset_class=None, inception=None, last_date=None) -> dict:
    metrics = {}
    spans = spans or {"1y": 0, "3y": 0, "5y": 0}

    # Garde de péremption : série figée depuis > STALE_DAYS → perf/vol/Sharpe/
    # drawdown trompeuses (fenêtre se terminant dans le passé). On les purge.
    if _is_stale(last_date):
        return {f: None for f in STALE_PURGE_FIELDS}

    # Convention : toutes les métriques sont stockées en % (9.82 = 9.82%, -2.7 = -2.7%)
    # Sauf sharpe_1y (adimensionnel)
    # On écrit explicitement None quand une perf n'est pas fiable, pour PURGER
    # les valeurs aberrantes écrites par les scrapers (au lieu de les laisser).

    # ── 1Y ──
    p1y = _clamp(round(perf_total(prices_1y) * 100, 4)) if _valid_perf(prices_1y, MIN_POINTS_1Y, spans["1y"], MIN_SPAN_1Y) else None
    if _perf_plausible(p1y, asset_class):
        metrics["performance_1y"]  = p1y
        dd = max_drawdown(prices_1y)
        metrics["max_drawdown_1y"] = round(dd * 100, 4) if dd is not None else None
        vol1y = volatility_annualized(prices_1y)
        metrics["volatility_1y"] = _clamp(round(vol1y * 100, 4)) if vol1y else None
        sh1 = sharpe_ratio(prices_1y, rf)
        metrics["sharpe_1y"] = _clamp(sh1) if sh1 is not None else None
    else:
        # Fenêtre invalide (trop courte) ou perf implausible (série corrompue) :
        # AUCUNE métrique 1Y n'est fiable. On purge TOUT le bloc — sinon une
        # volatilité/sharpe/drawdown périmée d'un calcul antérieur (série depuis
        # réparée ou raccourcie) survit en base, et la garde __insane doit la
        # masquer en aval. Un fonds sans fenêtre 1Y valide ne doit avoir aucune
        # métrique de risque 1Y.
        metrics["performance_1y"] = None
        metrics["volatility_1y"] = None
        metrics["sharpe_1y"] = None
        metrics["max_drawdown_1y"] = None

    # ── 3Y ──
    p3y = _clamp(round(perf_total(prices_3y) * 100, 4)) if _valid_perf(prices_3y, MIN_POINTS_3Y, spans["3y"], MIN_SPAN_3Y) else None
    if _perf_plausible(p3y, asset_class):
        metrics["performance_3y"]  = p3y
        dd3 = max_drawdown(prices_3y)
        metrics["max_drawdown_3y"] = round(dd3 * 100, 4) if dd3 is not None else None
        vol3y = volatility_annualized(prices_3y)
        metrics["volatility_3y"] = _clamp(round(vol3y * 100, 4)) if vol3y else None
        sh3 = sharpe_ratio(prices_3y, rf)
        metrics["sharpe_3y"] = _clamp(sh3) if sh3 is not None else None
    else:
        # Idem 1Y : purge complète du bloc 3Y quand la fenêtre est invalide /
        # la perf implausible (un fonds < ~2,75 ans ne doit pas exposer de
        # vol/sharpe/drawdown « 3 ans »).
        metrics["performance_3y"] = None
        metrics["volatility_3y"] = None
        metrics["sharpe_3y"] = None
        metrics["max_drawdown_3y"] = None

    # ── 5Y ──
    p5y = _clamp(round(perf_total(prices_5y) * 100, 4)) if _valid_perf(prices_5y, MIN_POINTS_5Y, spans["5y"], MIN_SPAN_5Y) else None
    if _perf_plausible(p5y, asset_class):
        metrics["performance_5y"] = p5y
    else:
        metrics["performance_5y"] = None

    # ── Track record (ancienneté) ──
    tr = _track_record_years(inception, spans.get("5y", 0))
    if tr is not None:
        metrics["track_record_years"] = tr

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
        "last_date": all_prices[-1][0] if all_prices else None,
    }


def fetch_fund_meta(client, isins: list[str]) -> dict[str, dict]:
    """Map isin → {asset_class_broad, inception_date}, par lots (plafond PostgREST).

    asset_class_broad borne la plausibilité des perfs (cf. PERF_BOUNDS) ;
    inception_date sert au calcul de l'ancienneté (track_record_years)."""
    out: dict[str, dict] = {}
    CHUNK = 500
    for i in range(0, len(isins), CHUNK):
        rows = client.table("investissement_funds") \
            .select("isin, asset_class_broad, inception_date") \
            .in_("isin", isins[i:i + CHUNK]) \
            .execute().data or []
        for r in rows:
            out[r["isin"]] = {
                "asset_class_broad": r.get("asset_class_broad"),
                "inception_date": r.get("inception_date"),
            }
    return out


# Produits dont la perf DÉRIVE de la série de prix → seuls concernés par la
# purge de péremption. crypto (CoinGecko), fonds euros (taux annuels), SCPI
# (métriques trimestrielles) et OPCVM étrangers sans série (Morningstar EMEA)
# tirent leur perf d'ailleurs : une série de prix périmée n'y rend PAS la perf
# obsolète, donc on ne les purge jamais sur ce critère.
PRICE_DERIVED_TYPES = ("opcvm", "etf")


def purge_stale_metrics(client, apply: bool) -> int:
    """Purge les métriques de tendance des fonds au dernier prix périmé.

    Le calcul principal ne visite que les fonds ayant un prix dans les 365 j
    (isins_with_recent_prices) : les fonds figés plus longtemps (liquidés,
    fermés) gardent indéfiniment la perf écrite jadis par un scraper —
    trompeuse (ex. R-CO THEMATIC, dernier prix 2021, affichait +29 % « à 1 an »).
    On les remet à None via la vue de couverture, sans toucher aux produits dont
    la perf ne vient pas de la série de prix (cf. PRICE_DERIVED_TYPES).

    PIÈGE : on exige `n_points > 0`. Une série de prix périmée ne rend la perf
    obsolète que si la perf EST dérivée de cette série. ~1300 opcvm ont un
    `last_price_date` ancien mais AUCUN point réel (perf venue de Morningstar
    EMEA / GECO direct) : purger sur le seul âge effacerait leur perf légitime."""
    cutoff = (TODAY - timedelta(days=STALE_DAYS)).isoformat()

    # 1) ISINs ayant une VRAIE série de prix (n_points>0) mais figée (vue de
    #    couverture). Le n_points>0 exclut les fonds dont la perf vient d'ailleurs.
    stale_isins: list[str] = []
    offset, page_size = 0, 1000
    while True:
        page = client.table("investissement_fund_price_coverage") \
            .select("isin") \
            .lt("last_price_date", cutoff) \
            .gt("n_points", 0) \
            .order("isin") \
            .range(offset, offset + page_size - 1) \
            .execute().data or []
        stale_isins.extend(r["isin"] for r in page)
        if len(page) < page_size:
            break
        offset += page_size

    if not stale_isins:
        print("  Purge péremption : aucun fonds au prix périmé.")
        return 0

    # 2) Ne garder que les produits price-derived ayant ENCORE une métrique non
    #    nulle (sinon écriture inutile). Lecture par lots (plafond PostgREST).
    cols = "isin, product_type, " + ", ".join(STALE_PURGE_FIELDS)
    updates = []
    CHUNK = 300
    for i in range(0, len(stale_isins), CHUNK):
        rows = client.table("investissement_funds") \
            .select(cols) \
            .in_("isin", stale_isins[i:i + CHUNK]) \
            .in_("product_type", list(PRICE_DERIVED_TYPES)) \
            .execute().data or []
        for r in rows:
            if any(r.get(f) is not None for f in STALE_PURGE_FIELDS):
                updates.append({"isin": r["isin"], **{f: None for f in STALE_PURGE_FIELDS}})

    print(f"  Purge péremption : {len(updates)} fonds price-derived au prix > {STALE_DAYS} j")
    if apply and updates:
        ok, fail = update_funds_bulk(updates, batch_size=200)
        print(f"    → {ok} purgés, {fail} échec")
    return len(updates)


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

    # Métadonnées par ISIN : classe d'actifs (garde plausibilité PERF_BOUNDS)
    # + inception_date (ancienneté track_record_years).
    meta_map = fetch_fund_meta(client, isins)
    print(f"  {len(meta_map)} métadonnées chargées (classe d'actifs + inception)")
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

        meta = meta_map.get(isin) or {}
        metrics = compute_fund_metrics(
            prices_1y=prices["1y"],
            prices_3y=prices["3y"],
            prices_5y=prices["5y"],
            prices_all=prices["all"],
            rf=rf,
            spans=prices["span"],
            asset_class=meta.get("asset_class_broad"),
            inception=meta.get("inception_date"),
            last_date=prices.get("last_date"),
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
        # Pas de pipeline_run en mode mono-ISIN (probe ciblée de
        # prune-unenriched-seeds) : évite des centaines de lignes parasites/semaine.
        if not isin_filter:
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

    # Purge des métriques périmées sur tout l'univers price-derived (y compris les
    # fonds figés que la boucle ci-dessus ne visite pas). Sautée en mode ciblé.
    if not isin_filter and not limit:
        print()
        purge_stale_metrics(client, apply)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Calcul métriques financières")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    parser.add_argument("--isin",   type=str,            help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
