#!/usr/bin/env python3
"""
ft-enricher.py — Enrichissement depuis Financial Times (markets.ft.com)
=======================================================================
Source : markets.ft.com/data/funds/tearsheet/* (données Morningstar).
Interrogeable par ISIN (clé de notre base). Couverture ~90% des OPCVM testés.

Ce que ce scraper récupère, SANS rendu JS (HTTP brut, rapide) :
  1. Série NAV ~5 ans via l'endpoint growth-10k (rebasée à 1000 → rescalée
     au prix réel courant) → table investissement_fund_prices.
     ⇒ les perf 1Y/3Y/5Y, volatilité, Sharpe, drawdown, SRRI sont ensuite
       calculées par compute-metrics.py (mêmes conventions que le reste).
  2. Frais (ongoing / entrée / sortie) — page summary, rendue serveur.
  3. Catégorie Morningstar + date de lancement.

Écriture FILL-ONLY (safe_fill_funds) : ne JAMAIS écraser une valeur non-NULL.
Les frais sont stockés en FRACTION (0.0145 = 1.45%) conformément aux CHECK
chk_ongoing_fraction / chk_ter_fraction et aux colonnes générées *_pct.

Outre l'enrichissement (fill-only), un mode --refresh-breakdowns rafraîchit les
VENTILATIONS périmées (holdings/secteurs/régions) : sélection par péremption
(updated_at > --max-age-days), remplacement par ISIN UNIQUEMENT si FT renvoie des
données (jamais d'écrasement par du vide). Câblé dans monthly-pipeline (rotation
trimestrielle), miroir de la rotation des cours côté hebdo.

Usage :
    python3 scripts/scrapers/ft-enricher.py --dry-run --limit 10
    python3 scripts/scrapers/ft-enricher.py --apply --limit 500
    python3 scripts/scrapers/ft-enricher.py --apply --isin DE0009848119:EUR
    python3 scripts/scrapers/ft-enricher.py --apply --refresh-breakdowns --limit 1000

Après un --apply, lancer le calcul des métriques sur les ISIN enrichis :
    python3 scripts/enrichers/compute-metrics.py --apply
"""

import re
import sys
import json
import time
import argparse
import threading
from datetime import datetime, date, timezone, timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, safe_fill_funds, upsert_prices, log_run

BASE = "https://markets.ft.com/data/funds/tearsheet"
GROWTH = "https://markets.ft.com/data/funds/ajax/growth-10k-app"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/json,*/*",
    "Accept-Language": "en-GB,en;q=0.9",
}

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

SOURCE = "financial-times"

_print_lock = threading.Lock()


# ─── Parsing ────────────────────────────────────────────────────────────────

def _kv_table(html: str) -> dict:
    """Extrait les paires <th>label</th><td>value</td> de la page summary."""
    out = {}
    for m in re.finditer(r"<th[^>]*>([^<]{2,40})</th>\s*<td[^>]*>([\s\S]{0,220}?)</td>", html):
        label = re.sub(r"\s+", " ", m.group(1)).strip()
        value = re.sub(r"<[^>]+>", " ", m.group(2))
        value = re.sub(r"\s+", " ", value).strip()
        if label and label not in out:
            out[label] = value
    return out


def _pct_to_fraction(s: str):
    """'1.45%' -> 0.0145 ; '--' -> None. Renvoie une fraction."""
    if not s:
        return None
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*%", s)
    if not m:
        return None
    try:
        return round(float(m.group(1)) / 100, 6)
    except ValueError:
        return None


def _parse_launch_date(s: str):
    """'28 Apr 2003' -> '2003-04-28'."""
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})", s or "")
    if not m:
        return None
    day, mon, year = int(m.group(1)), MONTHS.get(m.group(2).title()), int(m.group(3))
    if not mon:
        return None
    try:
        return date(year, mon, day).isoformat()
    except ValueError:
        return None


def _parse_fund_size_eur(s: str):
    """'20.81bn GBP As of ...' -> entier EUR, UNIQUEMENT si devise EUR (pas de FX)."""
    if not s or "EUR" not in s:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(bn|m|k)?\b", s)
    if not m:
        return None
    val = float(m.group(1))
    mult = {"bn": 1e9, "m": 1e6, "k": 1e3, None: 1.0}[m.group(2)]
    return int(val * mult)


def _parse_current_price(html: str):
    """(prix, devise) depuis la barre de cotation overview."""
    i = html.find("mod-tearsheet-overview__quote__bar")
    if i < 0:
        return None, None
    seg = html[i:i + 1200]
    cur = None
    mc = re.search(r"Price \(([A-Z]{3})\)", seg) or re.search(r"Price \(([A-Z]{3})\)", html[:i])
    if mc:
        cur = mc.group(1)
    mv = re.search(r'mod-ui-data-list__value[^>]*>\s*([\d,]+(?:\.\d+)?)', seg)
    if not mv:
        return None, cur
    try:
        return float(mv.group(1).replace(",", "")), cur
    except ValueError:
        return None, cur


def _parse_growth_series(payload: dict):
    """Renvoie [{date, value}] de chartData.fund (rebasé à 1000)."""
    html = payload.get("html") or ""
    m = re.search(r'data-mod-config="([^"]*)"', html)
    if not m:
        return []
    raw = m.group(1).replace("&quot;", '"').replace("&amp;", "&")
    try:
        cfg = json.loads(raw)
    except json.JSONDecodeError:
        return []
    fund = (cfg.get("chartData") or {}).get("fund") or []
    out = []
    for pt in fund:
        d = (pt.get("date") or "")[:10]
        v = pt.get("value")
        if d and v is not None:
            out.append({"date": d, "value": float(v)})
    return out


# ─── Parsing holdings / secteurs / régions (onglet holdings) ─────────────────

# Secteurs Morningstar (global) — sert à distinguer table secteurs vs régions.
SECTOR_SET = {
    "financial services", "energy", "healthcare", "technology",
    "consumer defensive", "consumer cyclical", "basic materials",
    "utilities", "industrials", "real estate", "communication services",
}
TICKER_RE = re.compile(r"\b([A-Z0-9]{1,6}(?:\.[A-Z])?:[A-Z]{2,4})\b")
PCT_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*%")


def _table_rows(html: str):
    """Renvoie [[cellules,...], ...] pour chaque <table> de la page."""
    tables = []
    for tm in re.finditer(r"<table[\s\S]{0,120}?>([\s\S]*?)</table>", html):
        rows = []
        for r in re.finditer(r"<tr[^>]*>([\s\S]*?)</tr>", tm.group(1)):
            cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip()
                     for c in re.findall(r"<t[dh][^>]*>([\s\S]*?)</t[dh]>", r.group(1))]
            cells = [c for c in cells if c != ""]
            if cells:
                rows.append(cells)
        if rows:
            tables.append(rows)
    return tables


def _frac(s: str):
    m = PCT_RE.search(s or "")
    if not m:
        return None
    try:
        return round(float(m.group(1)) / 100, 6)
    except ValueError:
        return None


def parse_holdings_page(html: str) -> dict:
    """Extrait holdings (top 10), secteurs et régions de l'onglet holdings."""
    holdings, sectors, geos = [], [], []
    for rows in _table_rows(html):
        flat = " ".join(c for row in rows for c in row).lower()
        is_asset = "% short" in flat or "% long" in flat or "net assets" in flat
        has_ticker = sum(1 for row in rows if TICKER_RE.search(row[0])) >= 2
        is_sector = sum(1 for row in rows if row[0].lower() in SECTOR_SET) >= 1

        if has_ticker:  # table des positions
            rank = 0
            for row in rows:
                name = row[0]
                tk = TICKER_RE.search(name)
                if not tk:
                    continue
                ticker = tk.group(1)
                clean = name[:tk.start()].strip(" ,-")
                w = _frac(row[-1])  # dernière colonne = poids portefeuille
                if not clean or w is None or not (0 < w <= 1):
                    continue
                rank += 1
                holdings.append({"rank": rank, "position_name": clean[:200],
                                 "ticker": ticker, "weight": w})
                if rank >= 10:
                    break
        elif is_sector and not is_asset:  # table secteurs
            for row in rows:
                if len(row) >= 2 and row[0].lower() in SECTOR_SET:
                    w = _frac(row[1])
                    if w is not None and 0 <= w <= 1:
                        sectors.append({"sector_name": row[0][:80], "weight": w})
        elif not is_asset and not has_ticker:  # candidat régions
            # name | fund% | cat% — exclure en-têtes et lignes non géographiques
            cand = []
            for row in rows:
                if len(row) >= 2 and re.match(r"^[A-Za-z][A-Za-z .&'-]{2,40}$", row[0]):
                    w = _frac(row[1])
                    if w is not None and 0 <= w <= 1:
                        cand.append({"country_label": row[0][:80], "weight": w})
            # heuristique : une vraie table régions a >=2 lignes géographiques
            if len(cand) >= 2:
                geos.extend(cand)
    # dédoublonnage par clé de PK
    geos = list({g["country_label"]: g for g in geos}.values())
    sectors = list({s["sector_name"]: s for s in sectors}.values())
    return {"holdings": holdings, "sectors": sectors, "geos": geos}


# ─── Fetch ──────────────────────────────────────────────────────────────────

def _get(url: str, params=None, as_json=False, retry=3):
    for attempt in range(retry):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                return r.json() if as_json else r.text
            if r.status_code in (429, 503):
                time.sleep(2 ** attempt + 1)
        except requests.RequestException:
            if attempt < retry - 1:
                time.sleep(2 ** attempt)
    return None


def enrich_one(isin: str, currency: str | None, with_holdings: bool = True) -> dict:
    """Récupère et parse FT pour un ISIN. Renvoie un dict résultat."""
    cur = (currency or "EUR").strip().upper()[:3] or "EUR"
    symbol = f"{isin}:{cur}"

    html = _get(f"{BASE}/summary", params={"s": symbol})
    if not html or "Price (" not in html:
        return {"isin": isin, "found": False}

    price, price_cur = _parse_current_price(html)
    kv = _kv_table(html)

    fields = {"isin": isin}
    og = _pct_to_fraction(kv.get("Ongoing charge"))
    if og is not None and 0 <= og <= 0.5:
        fields["ongoing_charges"] = og
    ent = _pct_to_fraction(kv.get("Initial charge"))
    if ent is not None and 0 <= ent <= 1:
        fields["entry_fee_max"] = ent
    ext = _pct_to_fraction(kv.get("Exit charge"))
    if ext is not None and 0 <= ext <= 1:
        fields["exit_fee_max"] = ext
    cat = kv.get("Morningstar category")
    if cat and cat not in ("--", ""):
        fields["category"] = cat
    inc = _parse_launch_date(kv.get("Launch date"))
    if inc:
        fields["inception_date"] = inc
    aum = _parse_fund_size_eur(kv.get("Fund size"))
    if aum:
        fields["aum_eur"] = aum

    # Série NAV rescalée au prix réel
    prices = []
    gp = _get(GROWTH, params={"symbol": symbol}, as_json=True)
    if gp:
        series = _parse_growth_series(gp)
        if series and price and series[-1]["value"]:
            scale = price / series[-1]["value"]
            prices = [
                {"date": p["date"], "nav": round(p["value"] * scale, 6),
                 "currency": (price_cur or cur)[:3]}
                for p in series
            ]

    # Phase 2 : holdings / secteurs / régions (onglet holdings, rendu serveur)
    breakdown = {"holdings": [], "sectors": [], "geos": []}
    if with_holdings:
        hhtml = _get(f"{BASE}/holdings", params={"s": symbol})
        if hhtml:
            breakdown = parse_holdings_page(hhtml)

    return {
        "isin": isin, "found": True, "symbol": symbol,
        "fields": fields, "prices": prices, "breakdown": breakdown,
        "n_fields": len([k for k in fields if k != "isin"]),
        "n_prices": len(prices),
        "n_hold": len(breakdown["holdings"]),
        "n_sect": len(breakdown["sectors"]),
        "n_geo": len(breakdown["geos"]),
    }


# ─── Sélection des cibles ────────────────────────────────────────────────────

def select_targets(client, limit: int | None, refresh: bool = False,
                   offset: int = 0):
    """Fonds OPCVM/ETF avec ISIN valide, priorité aux plus gros encours.

    Par défaut (peuplement) : ceux à qui il manque perf_3y OU des frais.
    En mode refresh : tous (on re-fetche la VL courante pour garder les
    séries de prix fraîches, même sur des fonds déjà complets).

    offset : saute les N premières cibles éligibles (après tri par encours
    décroissant) avant de collecter. Permet le balayage par rotation de la
    longue traîne — voir weekly-pipeline.py."""
    targets, page, size, skipped = [], 0, 1000, 0
    while True:
        q = (client.table("investissement_funds")
             .select("isin,currency,name,performance_3y,ongoing_charges,ter")
             .in_("product_type", ["opcvm", "etf"])
             .order("aum_eur", desc=True, nullsfirst=False)
             .range(page * size, page * size + size - 1))
        if not refresh:
            q = q.or_("performance_3y.is.null,and(ongoing_charges.is.null,ter.is.null)")
        rows = q.execute().data or []
        for r in rows:
            isin = (r.get("isin") or "").strip()
            if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin):
                if skipped < offset:
                    skipped += 1
                    continue
                targets.append({"isin": isin, "currency": r.get("currency")})
                if limit and len(targets) >= limit:
                    return targets
        if len(rows) < size:
            break
        page += 1
    return targets


def select_missing_series_targets(client, limit: int | None, offset: int = 0,
                                  lu_only: bool = False):
    """OPCVM/ETF sans AUCUNE série de prix locale, priorité aux plus gros encours.

    Cible spécifiquement les fonds ABSENTS de la table de couverture
    (investissement_fund_price_coverage) — indépendamment de perf_3y. C'est le
    cas des fonds dont la perf vient d'une source externe (Morningstar EMEA,
    catalogue) mais qui n'ont jamais eu de VL chez nous → non back-testables.
    Le fill-only standard (select_targets) les ignore car perf_3y est non-NULL.

    Écriture additive (upsert_prices) : ne supprime ni n'écrase aucune série.
    lu_only : restreint aux ISIN luxembourgeois (rattrapage assurance-vie)."""
    covered, page, size = set(), 0, 1000
    while True:
        rows = (client.table("investissement_fund_price_coverage")
                .select("isin")
                .range(page * size, page * size + size - 1).execute().data or [])
        covered.update((r.get("isin") or "").strip() for r in rows)
        if len(rows) < size:
            break
        page += 1

    targets, page, skipped = [], 0, 0
    while True:
        rows = (client.table("investissement_funds")
                .select("isin,currency,name,aum_eur")
                .in_("product_type", ["opcvm", "etf"])
                .order("aum_eur", desc=True, nullsfirst=False)
                .range(page * size, page * size + size - 1).execute().data or [])
        for r in rows:
            isin = (r.get("isin") or "").strip()
            if not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin):
                continue
            if lu_only and not isin.startswith("LU"):
                continue
            if isin in covered:
                continue
            if skipped < offset:
                skipped += 1
                continue
            targets.append({"isin": isin, "currency": r.get("currency")})
            if limit and len(targets) >= limit:
                return targets
        if len(rows) < size:
            break
        page += 1
    return targets


def _breakdown_age(client, isins: list[str]) -> dict:
    """Pour chaque ISIN, la date de MAJ la plus récente parmi ses lignes de
    ventilation (holdings/secteurs/régions). ISIN absent → pas de ventilation.

    Les trois tables étant écrites ensemble pour un ISIN donné, leur updated_at
    est cohérent ; on prend le max par sécurité (sources mixtes possibles)."""
    age = {}
    for table in ("investissement_fund_sectors", "investissement_fund_geos",
                  "investissement_fund_holdings"):
        for i in range(0, len(isins), 300):
            chunk = isins[i:i + 300]
            try:
                r = (client.table(table).select("isin,updated_at")
                     .in_("isin", chunk).execute())
                for row in (r.data or []):
                    u = row.get("updated_at")
                    if not u:
                        continue
                    cur = age.get(row["isin"])
                    if cur is None or u > cur:
                        age[row["isin"]] = u
            except Exception as e:
                print(f"  ✗ lecture {table} : {e}")
    return age


def select_breakdown_refresh_targets(client, limit: int | None,
                                     max_age_days: int):
    """Fonds dont les ventilations sont PÉRIMÉES (MAJ la plus récente plus
    vieille que max_age_days), triés par encours décroissant.

    La péremption pilote la rotation à elle seule : un fonds rafraîchi
    redevient « frais » et sort de la sélection ~max_age_days, le temps que
    les autres passent. Pas besoin d'offset (cf. weekly-pipeline) : il suffit
    de prendre les plus vieux par encours à chaque run."""
    cutoff = (datetime.now(timezone.utc)
              - timedelta(days=max_age_days)).isoformat()
    targets, page, size = [], 0, 1000
    scanned = stale_seen = 0
    while True:
        rows = (client.table("investissement_funds")
                .select("isin,currency")
                .in_("product_type", ["opcvm", "etf"])
                .order("aum_eur", desc=True, nullsfirst=False)
                .range(page * size, page * size + size - 1)
                .execute().data or [])
        valid = [r for r in rows
                 if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]",
                                 (r.get("isin") or "").strip())]
        ages = _breakdown_age(client, [r["isin"].strip() for r in valid])
        for r in valid:
            isin = r["isin"].strip()
            updated = ages.get(isin)
            if updated is None:        # pas de ventilation → géré par le fill-only
                continue
            scanned += 1
            if updated >= cutoff:      # encore frais → ignoré
                continue
            stale_seen += 1
            targets.append({"isin": isin, "currency": r.get("currency")})
            if limit and len(targets) >= limit:
                print(f"    {stale_seen} ISIN périmés retenus "
                      f"(sur {scanned} fonds avec ventilation scannés)")
                return targets
        if len(rows) < size:
            break
        page += 1
    print(f"    {stale_seen} ISIN périmés retenus "
          f"(sur {scanned} fonds avec ventilation scannés)")
    return targets


def referenced_counts(client) -> dict:
    """isin → nombre d'assureurs qui référencent le fonds (vue cgp_ref).

    Sert à PRIORISER l'enrichissement vers les fonds réellement distribués en
    assurance-vie : ce sont eux qui alimentent la comparaison / le look-through.
    insurers a pour défaut '{}' → on ne garde que les fonds effectivement
    référencés (liste non vide)."""
    counts, page, size = {}, 0, 1000
    while True:
        rows = (client.table("investissement_funds_cgp_ref")
                .select("isin,insurers")
                .range(page * size, page * size + size - 1)
                .execute().data or [])
        for r in rows:
            ins = r.get("insurers") or []
            if ins:
                counts[(r.get("isin") or "").strip()] = len(ins)
        if len(rows) < size:
            break
        page += 1
    return counts


def select_missing_breakdown_targets(client, limit: int | None,
                                     ref_counts: dict | None = None):
    """Fonds SANS aucune ligne de holdings, à enrichir pour faire GRIMPER la
    couverture look-through (≈ 3 % des fonds primaires aujourd'hui).

    Complète le gap-fill standard, qui ne re-sélectionne PAS un fonds déjà
    complet en perf/frais : sa composition manquante n'y serait jamais comblée.

    Tri par référencement assureur décroissant si ref_counts fourni (les fonds
    distribués en AV d'abord), sinon par encours décroissant."""
    pool, page, size = [], 0, 1000
    while True:
        rows = (client.table("investissement_funds")
                .select("isin,currency,aum_eur")
                .in_("product_type", ["opcvm", "etf"])
                .order("aum_eur", desc=True, nullsfirst=False)
                .range(page * size, page * size + size - 1)
                .execute().data or [])
        for r in rows:
            isin = (r.get("isin") or "").strip()
            if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin):
                pool.append({"isin": isin, "currency": r.get("currency")})
        if len(rows) < size:
            break
        page += 1
    if ref_counts:
        # tri stable : référencement décroissant, encours préservé en départage
        pool.sort(key=lambda t: ref_counts.get(t["isin"], 0), reverse=True)
    # On filtre les ISIN sans holdings en respectant l'ordre de priorité.
    out = []
    for i in range(0, len(pool), 300):
        chunk = pool[i:i + 300]
        existing = _existing_isins(client, "investissement_fund_holdings",
                                   [t["isin"] for t in chunk])
        for t in chunk:
            if t["isin"] not in existing:
                out.append(t)
                if limit and len(out) >= limit:
                    print(f"    {len(out)} fonds sans composition retenus "
                          f"(priorisés {'par référencement' if ref_counts else 'par encours'})")
                    return out
    print(f"    {len(out)} fonds sans composition retenus "
          f"(priorisés {'par référencement' if ref_counts else 'par encours'})")
    return out


# ─── Run ─────────────────────────────────────────────────────────────────────

def _existing_isins(client, table: str, isins: list[str]) -> set:
    """ISINs ayant déjà au moins une ligne dans une table de breakdown."""
    out = set()
    for i in range(0, len(isins), 300):
        chunk = isins[i:i + 300]
        try:
            r = client.table(table).select("isin").in_("isin", chunk).execute()
            for row in (r.data or []):
                out.add(row["isin"])
        except Exception as e:
            print(f"  ✗ lecture {table} : {e}")
    return out


def write_breakdowns(client, results: list[dict], replace: bool = False) -> dict:
    """Écrit holdings/secteurs/régions.

    Mode par défaut — FILL-ONLY : uniquement pour les ISIN qui n'ont AUCUNE
    ligne existante dans la table concernée (peuplement initial).

    Mode replace=True — RAFRAÎCHISSEMENT : pour chaque ISIN, on remplace les
    lignes existantes (delete + reinsert) table par table, MAIS UNIQUEMENT si
    FT a réellement renvoyé des données pour cette dimension. Garde-fou crucial
    (cf. piège ft-metrics-wipe) : une réponse FT vide ne doit JAMAIS effacer une
    ventilation existante — on garde l'ancienne plutôt que de la perdre."""
    stats = {"holdings": 0, "sectors": 0, "geos": 0,
             "replaced_h": 0, "replaced_s": 0, "replaced_g": 0}
    isins = [r["isin"] for r in results if r.get("breakdown")]
    if not isins:
        return stats
    have_h = _existing_isins(client, "investissement_fund_holdings", isins)
    have_s = _existing_isins(client, "investissement_fund_sectors", isins)
    have_g = _existing_isins(client, "investissement_fund_geos", isins)

    def _del(table, isin):
        try:
            client.table(table).delete().eq("isin", isin).execute()
        except Exception as e:
            print(f"  ✗ delete {table} {isin} : {e}")

    h_rows, s_rows, g_rows = [], [], []
    for r in results:
        isin = r["isin"]
        b = r.get("breakdown") or {}
        holdings, sectors, geos = (b.get("holdings", []),
                                   b.get("sectors", []), b.get("geos", []))
        # Holdings
        if isin not in have_h:
            for h in holdings:
                h_rows.append({"isin": isin, **h, "source": SOURCE})
        elif replace and holdings:                 # remplacement seulement si frais
            _del("investissement_fund_holdings", isin)
            for h in holdings:
                h_rows.append({"isin": isin, **h, "source": SOURCE})
            stats["replaced_h"] += 1
        # Secteurs
        if isin not in have_s:
            for s in sectors:
                s_rows.append({"isin": isin, **s, "source": SOURCE})
        elif replace and sectors:
            _del("investissement_fund_sectors", isin)
            for s in sectors:
                s_rows.append({"isin": isin, **s, "source": SOURCE})
            stats["replaced_s"] += 1
        # Régions
        if isin not in have_g:
            for g in geos:
                g_rows.append({"isin": isin, **g, "source": SOURCE})
        elif replace and geos:
            _del("investissement_fund_geos", isin)
            for g in geos:
                g_rows.append({"isin": isin, **g, "source": SOURCE})
            stats["replaced_g"] += 1

    def _flush(rows, table, conflict, key):
        for i in range(0, len(rows), 500):
            batch = rows[i:i + 500]
            try:
                client.table(table).upsert(batch, on_conflict=conflict).execute()
                stats[key] += len(batch)
            except Exception as e:
                print(f"  ✗ upsert {table} : {e}")

    _flush(h_rows, "investissement_fund_holdings", "isin,rank", "holdings")
    _flush(s_rows, "investissement_fund_sectors", "isin,sector_name", "sectors")
    _flush(g_rows, "investissement_fund_geos", "isin,country_label", "geos")
    return stats


def run(apply: bool, limit: int | None, isin_arg: str | None, workers: int,
        delay: float, with_holdings: bool = True, refresh: bool = False,
        offset: int = 0, refresh_breakdowns: bool = False,
        max_age_days: int = 90, fill_breakdowns: bool = False,
        by_referencing: bool = False, missing_series: bool = False,
        lu_only: bool = False):
    # En mode (re)constitution des ventilations, on a forcément besoin de
    # l'onglet holdings (c'est lui qui porte breakdown).
    if refresh_breakdowns or fill_breakdowns:
        with_holdings = True
    print("=" * 64)
    print("  FT Enricher — markets.ft.com (Morningstar)")
    print("=" * 64)
    mode = "APPLY" if apply else "DRY-RUN"
    if missing_series:
        mode += " | BACKFILL SÉRIES MANQUANTES" + (" (LU)" if lu_only else "")
    elif fill_breakdowns:
        mode += " | FILL VENTILATIONS MANQUANTES"
    elif refresh_breakdowns:
        mode += f" | REFRESH VENTILATIONS (périmées > {max_age_days}j)"
    elif refresh:
        mode += " | REFRESH (toutes cibles)"
    if by_referencing and (fill_breakdowns or refresh_breakdowns):
        mode += " | priorité référencement"
    print(f"  Mode    : {mode}")
    client = get_client()
    started = datetime.now(timezone.utc)

    ref_counts = None
    if by_referencing and (fill_breakdowns or refresh_breakdowns):
        print("  Lecture du référencement assureur…", flush=True)
        ref_counts = referenced_counts(client)
        print(f"  {len(ref_counts)} fonds référencés par ≥1 assureur")

    if isin_arg:
        if ":" in isin_arg:
            i, c = isin_arg.split(":", 1)
        else:
            i, c = isin_arg, "EUR"
        targets = [{"isin": i, "currency": c}]
    elif missing_series:
        print("  Sélection des fonds sans série de prix…", flush=True)
        targets = select_missing_series_targets(client, limit, offset=offset,
                                                lu_only=lu_only)
    elif fill_breakdowns:
        print("  Sélection des fonds sans composition…", flush=True)
        targets = select_missing_breakdown_targets(client, limit, ref_counts)
    elif refresh_breakdowns:
        print("  Sélection des ventilations périmées…", flush=True)
        targets = select_breakdown_refresh_targets(client, limit, max_age_days)
        if ref_counts:
            targets.sort(key=lambda t: ref_counts.get(t["isin"], 0), reverse=True)
    else:
        print("  Sélection des cibles…", flush=True)
        targets = select_targets(client, limit, refresh=refresh, offset=offset)
    print(f"  {len(targets)} fonds à traiter   (workers={workers}, delay={delay}s)\n")

    results, found, fields_total, prices_total, errors = [], 0, 0, 0, []
    hold_total = sect_total = geo_total = 0

    def work(t):
        time.sleep(delay)
        try:
            return enrich_one(t["isin"], t.get("currency"), with_holdings=with_holdings)
        except Exception as e:
            return {"isin": t["isin"], "found": False, "error": str(e)[:120]}

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(work, t): t for t in targets}
        for fut in as_completed(futs):
            res = fut.result()
            done += 1
            if res.get("error"):
                errors.append({"isin": res["isin"], "error": res["error"]})
            if res.get("found"):
                found += 1
                fields_total += res.get("n_fields", 0)
                prices_total += res.get("n_prices", 0)
                hold_total += res.get("n_hold", 0)
                sect_total += res.get("n_sect", 0)
                geo_total += res.get("n_geo", 0)
                results.append(res)
            if done % 50 == 0 or done == len(targets):
                with _print_lock:
                    print(f"  [{done:5d}/{len(targets)}] trouvés:{found} "
                          f"champs:{fields_total} prix:{prices_total}", flush=True)

    print(f"\n  → {found}/{len(targets)} résolus sur FT | "
          f"{fields_total} champs, {prices_total} VL extraits")
    if with_holdings:
        print(f"    breakdown extrait : {hold_total} holdings, "
              f"{sect_total} secteurs, {geo_total} régions")

    # Aperçu
    print("\n  Aperçu (5 premiers résolus) :")
    for r in results[:5]:
        f = r["fields"]
        bits = []
        if "ongoing_charges" in f: bits.append(f"og={f['ongoing_charges']*100:.2f}%")
        if "category" in f:        bits.append(f"cat={f['category'][:22]}")
        if "inception_date" in f:  bits.append(f"inc={f['inception_date']}")
        print(f"    {r['symbol']:18} | VL:{r['n_prices']:4} | " + " ".join(bits))

    if not apply:
        print("\n  DRY-RUN : rien écrit. Relancer avec --apply.")
        return

    # Écriture : champs (fill-only) + prix
    print("\n  Écriture fill-only des champs…", flush=True)
    recs = [r["fields"] for r in results if r.get("n_fields", 0) > 0]
    stats = safe_fill_funds(recs, source=SOURCE) if recs else {}
    print(f"    {stats}")

    print("  Écriture des séries NAV…", flush=True)
    ins, fail = 0, 0
    for r in results:
        if r.get("prices"):
            a, b = upsert_prices(r["isin"], r["prices"], source=SOURCE)
            ins += a; fail += b
    print(f"    VL insérées/maj : {ins}  (échecs {fail})")

    if with_holdings:
        label = "remplacement" if refresh_breakdowns else "fill-only"
        print(f"  Écriture {label} des breakdowns…", flush=True)
        bstats = write_breakdowns(client, results, replace=refresh_breakdowns)
        print(f"    {bstats}")

    log_run(
        scraper="ft-enricher",
        status="success" if not errors else "partial",
        records_processed=found,
        records_failed=len(errors),
        errors=errors[:50],
        started_at=started,
    )
    print("\n  ✓ Terminé. Lancez ensuite :")
    print("    python3 scripts/enrichers/compute-metrics.py --apply")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Enrichissement Financial Times")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N fonds")
    ap.add_argument("--isin", type=str, help="Un seul ISIN[:DEVISE] (test)")
    ap.add_argument("--workers", type=int, default=4, help="Threads (défaut 4)")
    ap.add_argument("--delay", type=float, default=0.25, help="Pause/req en s (défaut 0.25)")
    ap.add_argument("--no-holdings", action="store_true",
                    help="Ne pas récupérer holdings/secteurs/régions (1 requête/fonds en moins)")
    ap.add_argument("--refresh", action="store_true",
                    help="Rafraîchir la VL de TOUS les OPCVM/ETF (pas seulement ceux incomplets)")
    ap.add_argument("--offset", type=int, default=0,
                    help="Sauter les N premières cibles (tri encours décroissant) — rotation longue traîne")
    ap.add_argument("--refresh-breakdowns", action="store_true",
                    help="Rafraîchir les VENTILATIONS périmées (holdings/secteurs/régions) : "
                         "remplace par ISIN si FT renvoie des données. Cible par péremption.")
    ap.add_argument("--max-age-days", type=int, default=90,
                    help="Seuil de péremption des ventilations en jours (défaut 90, avec --refresh-breakdowns)")
    ap.add_argument("--fill-breakdowns", action="store_true",
                    help="Combler les VENTILATIONS MANQUANTES : fonds sans aucun holding, "
                         "pour faire grimper la couverture look-through (fill-only).")
    ap.add_argument("--by-referencing", action="store_true",
                    help="Prioriser par nombre d'assureurs référençant le fonds "
                         "(avec --fill-breakdowns ou --refresh-breakdowns).")
    ap.add_argument("--missing-series", action="store_true",
                    help="Backfill des fonds OPCVM/ETF SANS série de prix locale "
                         "(absents de la table de couverture), indépendamment de perf_3y. "
                         "Rattrapage des fonds à perf externe (Morningstar EMEA) non back-testables.")
    ap.add_argument("--lu-only", action="store_true",
                    help="Restreindre aux ISIN luxembourgeois (avec --missing-series).")
    a = ap.parse_args()
    run(apply=a.apply, limit=a.limit, isin_arg=a.isin,
        workers=a.workers, delay=a.delay, with_holdings=not a.no_holdings,
        refresh=a.refresh, offset=a.offset,
        refresh_breakdowns=a.refresh_breakdowns, max_age_days=a.max_age_days,
        fill_breakdowns=a.fill_breakdowns, by_referencing=a.by_referencing,
        missing_series=a.missing_series, lu_only=a.lu_only)
