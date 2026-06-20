#!/usr/bin/env python3
"""
issuer-holdings.py — Composition COMPLÈTE des ETF depuis les fichiers émetteurs
==============================================================================
Chantier A : récupérer l'INTÉGRALITÉ des constituants d'un ETF (et non le top 10)
en téléchargeant directement le fichier de composition publié par l'émetteur.

Tables alimentées (source = 'issuer:<emetteur>') :
  - investissement_fund_holdings  (jusqu'à MAX_HOLDINGS lignes nominatives)
  - investissement_fund_sectors   (agrégé depuis les constituants)
  - investissement_fund_geos      (agrégé depuis les constituants)

Le fait d'écrire AUSSI secteurs+géo protège ces ISIN du clobber par
justetf-holdings-scraper.py (qui ne cible que les ETF « sans secteurs »).

Émetteurs :
  - ishares  : catalogue product-screener (ISIN→productId) + CSV holdings  ✅
  - amundi   : POST /mapi/ProductAPI/getProductsData (résolu par ISIN)      ✅
  - xtrackers: GET /api/pdp/en-gb/etf/<ISIN>/holdings (DWS, résolu par ISIN) ✅
  - invesco  : GET dng-api.invesco.com .../holdings/index (expo réelle)     ✅

Usage :
    python3 scripts/scrapers/issuer-holdings.py --issuer ishares
    python3 scripts/scrapers/issuer-holdings.py --issuer ishares --apply
    python3 scripts/scrapers/issuer-holdings.py --issuer ishares --apply --limit 20
    python3 scripts/scrapers/issuer-holdings.py --issuer ishares --apply --isin IE00B5BMR087
    python3 scripts/scrapers/issuer-holdings.py --issuer ishares --apply --refresh   # ré-écrit même si déjà fait
    python3 scripts/scrapers/issuer-holdings.py --issuer amundi --apply
    python3 scripts/scrapers/issuer-holdings.py --issuer xtrackers --apply
"""

import sys
import csv
import io
import re
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter, defaultdict

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config ───────────────────────────────────────────────────────────────────

MAX_HOLDINGS  = 500          # cap par ETF (cf. décision produit : storage borné)
RATE_LIMIT_S  = 1.5
FETCH_TIMEOUT = 30
INSERT_CHUNK  = 500
ISIN_RE       = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "text/csv,application/json,text/html,*/*",
    "Accept-Language": "en-GB,en;q=0.9,fr;q=0.8",
}

# ─── iShares ────────────────────────────────────────────────────────────────────
# Catalogue complet (ISIN → productId numérique). dcrPath capturé via le navigateur.
ISHARES_CATALOG_URL = (
    "https://www.ishares.com/uk/individual/en/product-screener/product-screener-v3.1.jsn"
    "?dcrPath=/templatedata/config/product-screener-v3/data/en/uk/product-screener/"
    "ishares-product-screener-backend-config&siteEntryPassthrough=true"
)
# Téléchargement CSV holdings : seul le productId du chemin compte (le token .ajax
# est constant pour la locale UK individual ; fileName est cosmétique).
ISHARES_HOLDINGS_URL = (
    "https://www.ishares.com/uk/individual/en/products/{pid}/x/"
    "1506575576011.ajax?fileType=csv&fileName=holdings&dataType=fund"
)

# Noms de pays anglais (colonne « Location » du CSV iShares) → ISO-2.
COUNTRY_CODES: dict[str, str] = {
    "United States": "US", "United Kingdom": "GB", "Japan": "JP", "Germany": "DE",
    "France": "FR", "China": "CN", "Canada": "CA", "Switzerland": "CH",
    "Australia": "AU", "Netherlands": "NL", "South Korea": "KR", "Korea (South)": "KR",
    "Taiwan": "TW", "India": "IN", "Italy": "IT", "Spain": "ES", "Sweden": "SE",
    "Denmark": "DK", "Norway": "NO", "Finland": "FI", "Belgium": "BE", "Austria": "AT",
    "Portugal": "PT", "Ireland": "IE", "Luxembourg": "LU", "Singapore": "SG",
    "Hong Kong": "HK", "Brazil": "BR", "Mexico": "MX", "South Africa": "ZA",
    "Saudi Arabia": "SA", "United Arab Emirates": "AE", "Poland": "PL", "Turkey": "TR",
    "Indonesia": "ID", "Thailand": "TH", "Malaysia": "MY", "Philippines": "PH",
    "Israel": "IL", "New Zealand": "NZ", "Greece": "GR", "Czech Republic": "CZ",
    "Hungary": "HU", "Russia": "RU", "Chile": "CL", "Colombia": "CO", "Peru": "PE",
    "Qatar": "QA", "Kuwait": "KW", "Egypt": "EG", "Vietnam": "VN", "Pakistan": "PK",
}
# Libellés non géographiques à exclure de l'agrégation pays.
NON_COUNTRY = {"-", "", "Cash", "Cash and/or Derivatives", "(Cash)", "N/A", "Other"}

# Reverse ISO-2 → libellé (premier libellé rencontré). Sert aux sources qui ne
# donnent que le code pays (ex. Invesco : pays dérivé du préfixe ISIN du titre).
CODE_TO_LABEL: dict[str, str] = {}
for _lbl, _code in COUNTRY_CODES.items():
    CODE_TO_LABEL.setdefault(_code, _lbl)


def _pct_to_frac(s: str) -> float | None:
    """'7.91' ou '7,91 %' → 0.0791 (fraction, arrondi 6 décimales)."""
    try:
        clean = re.sub(r"[%\s\xa0]", "", str(s)).replace(",", ".")
        return round(float(clean) / 100, 6)
    except (ValueError, AttributeError):
        return None


# ─── iShares : catalogue & parsing ──────────────────────────────────────────────

def ishares_fetch_catalog(session: requests.Session) -> dict[str, str]:
    """Retourne {ISIN: productId} pour tout le catalogue iShares."""
    resp = session.get(ISHARES_CATALOG_URL, timeout=FETCH_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    out: dict[str, str] = {}
    for pid, entry in data.items():
        isin = entry.get("isin")
        if isinstance(isin, str) and ISIN_RE.match(isin):
            out[isin] = str(pid)
    return out


def ishares_parse_csv(text: str) -> list[dict]:
    """Parse le CSV holdings iShares → liste de dicts constituants (poids fraction)."""
    # Le fichier a un préambule (« Fund Holdings as of », ligne vide) avant l'entête.
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    header_idx = None
    for i, r in enumerate(rows[:15]):
        joined = ",".join(r).lower()
        if "weight" in joined and ("ticker" in joined or "name" in joined):
            header_idx = i
            break
    if header_idx is None:
        return []

    header = [h.strip().lower() for h in rows[header_idx]]

    def col(*names):
        for n in names:
            if n in header:
                return header.index(n)
        return None

    i_name   = col("name")
    i_ticker = col("ticker")
    i_sector = col("sector")
    i_asset  = col("asset class")
    i_weight = col("weight (%)", "weight")
    i_loc    = col("location")
    if i_name is None or i_weight is None:
        return []

    out = []
    for r in rows[header_idx + 1:]:
        if len(r) <= i_weight:
            continue
        name = (r[i_name] or "").strip()
        if not name or name.lower() in {"-", "n/a"}:
            continue
        w = _pct_to_frac(r[i_weight])
        if w is None or w == 0:
            continue
        ticker = (r[i_ticker].strip() if i_ticker is not None and i_ticker < len(r) else "") or None
        if ticker in ("-", ""):
            ticker = None
        loc = (r[i_loc].strip() if i_loc is not None and i_loc < len(r) else "") or None
        out.append({
            "position_name": name[:200],
            "ticker":        ticker,
            "asset_type":    (r[i_asset].strip() if i_asset is not None and i_asset < len(r) else None) or None,
            "sector":        (r[i_sector].strip() if i_sector is not None and i_sector < len(r) else None) or None,
            "country":       COUNTRY_CODES.get(loc) if loc else None,
            "country_label": loc,
            "weight":        w,
        })
    # Tri par poids décroissant (le CSV l'est en général, on sécurise).
    out.sort(key=lambda h: h["weight"], reverse=True)
    return out


def ishares_fetch_holdings(session: requests.Session, pid: str) -> list[dict] | None:
    url = ISHARES_HOLDINGS_URL.format(pid=pid)
    try:
        resp = session.get(url, timeout=FETCH_TIMEOUT)
        if resp.status_code != 200 or len(resp.content) < 200:
            return None
        return ishares_parse_csv(resp.text)
    except Exception:
        return None


# ─── Amundi ─────────────────────────────────────────────────────────────────────
# Le widget product-page appelle POST /mapi/ProductAPI/getProductsData en passant
# l'ISIN comme productId. La compo arrive dans products[0].composition.compositionData
# (poids déjà en fraction). Le contexte (objet) est obligatoire (400 sinon).
AMUNDI_API_URL = "https://www.amundietf.fr/mapi/ProductAPI/getProductsData"
AMUNDI_CONTEXT = {
    "countryCode": "FRA", "languageCode": "fr",
    "userProfileName": "INSTIT", "userProfileSlug": "instit",
}
AMUNDI_FIELDS = ["date", "type", "bbg", "isin", "name", "weight",
                 "quantity", "currency", "sector", "country", "countryOfRisk"]
# Types non-titres à exclure de l'agrégation (mais comptés dans Σpoids).
AMUNDI_NON_SECURITY = {"CASH", "CASH_COLLATERAL", "MARGIN"}


def amundi_fetch_holdings(session: requests.Session, isin: str) -> list[dict] | None:
    """POST getProductsData pour un ISIN Amundi → liste de constituants."""
    payload = {
        "context":     AMUNDI_CONTEXT,
        "productIds":  [isin],
        "productType": "PRODUCT",
        "composition": {"compositionFields": AMUNDI_FIELDS},
    }
    try:
        resp = session.post(AMUNDI_API_URL, json=payload, timeout=FETCH_TIMEOUT,
                            headers={"Referer": "https://www.amundietf.fr/"})
        if resp.status_code != 200:
            return None
        products = (resp.json() or {}).get("products") or []
        if not products:
            return None
        comp = products[0].get("composition")
        if not comp:
            return None
        data = comp.get("compositionData") or []
        out = []
        for item in data:
            c = item.get("compositionCharacteristics") or {}
            name = (c.get("name") or "").strip()
            if not name:
                continue
            w = c.get("weight")
            if w is None:
                continue
            w = round(float(w), 6)
            if w == 0:
                continue
            label = (c.get("countryOfRisk") or c.get("country") or "").strip() or None
            tkr = (c.get("bbg") or "").strip() or None
            out.append({
                "position_name": name[:200],
                "ticker":        tkr,
                "asset_type":    (c.get("type") or "").strip() or None,
                "sector":        (c.get("sector") or "").strip() or None,
                "country":       COUNTRY_CODES.get(label) if label else None,
                "country_label": label,
                "weight":        w,
            })
        out.sort(key=lambda h: h["weight"], reverse=True)
        return out
    except Exception:
        return None


# ─── Xtrackers (DWS) ─────────────────────────────────────────────────────────────
# Le PDP appelle GET /api/pdp/en-gb/etf/<ISIN>/holdings. Le slug du chemin est
# ignoré (résolution par ISIN). La compo est dans tables[0].values[] avec des
# colonnes positionnelles décrites par tables[0].columns (on mappe par libellé).
XTRACKERS_HOLDINGS_URL = "https://etf.dws.com/api/pdp/en-gb/etf/{isin}/holdings"


def _xtrackers_col_map(columns: list[dict]) -> dict[str, str]:
    """{role: column_key} depuis les libellés d'entête DWS (robuste à l'ordre)."""
    roles: dict[str, str] = {}
    for c in columns:
        key = c.get("key")
        label = (c.get("value") or "").strip().lower()
        if not key or not label:
            continue
        if label == "isin":
            roles["isin"] = key
        elif label == "name":
            roles["name"] = key
        elif "weight" in label:
            roles["weight"] = key
        elif label == "country":
            roles["country"] = key
        elif label in ("industry", "sector"):
            roles["sector"] = key
        elif label == "asset class":
            roles["asset_type"] = key
    return roles


def xtrackers_fetch_holdings(session: requests.Session, isin: str) -> list[dict] | None:
    """GET holdings DWS pour un ISIN Xtrackers → liste de constituants."""
    url = XTRACKERS_HOLDINGS_URL.format(isin=isin)
    try:
        resp = session.get(url, timeout=FETCH_TIMEOUT,
                           headers={"Accept": "application/json"})
        if resp.status_code != 200:
            return None
        tables = (resp.json() or {}).get("tables") or []
        if not tables:
            return None
        table = tables[0]
        roles = _xtrackers_col_map(table.get("columns") or [])
        wkey = roles.get("weight")
        if not wkey:
            return None
        out = []
        for row in (table.get("values") or []):
            name = (row.get(roles.get("name", ""), {}) or {}).get("value")
            name = (name or "").strip()
            if not name or "invalid identifier" in name.lower():
                continue
            wcell = row.get(wkey, {}) or {}
            w = wcell.get("sortValue")
            if w is None:
                w = _pct_to_frac(wcell.get("value"))
            else:
                w = round(float(w) / 100, 6)  # sortValue est en pourcentage (5.43 → 0.0543)
            if w is None or w == 0:
                continue
            label = ((row.get(roles.get("country", ""), {}) or {}).get("value") or "").strip() or None
            sec = ((row.get(roles.get("sector", ""), {}) or {}).get("value") or "").strip() or None
            atype = ((row.get(roles.get("asset_type", ""), {}) or {}).get("value") or "").strip() or None
            out.append({
                "position_name": name[:200],
                "ticker":        None,  # DWS ne renvoie pas de ticker, seulement l'ISIN du titre
                "asset_type":    atype,
                "sector":        sec,
                "country":       COUNTRY_CODES.get(label) if label else None,
                "country_label": label,
                "weight":        w,
            })
        out.sort(key=lambda h: h["weight"], reverse=True)
        return out
    except Exception:
        return None


# ─── Invesco ──────────────────────────────────────────────────────────────────
# API publique dng-api (back-end AEM headless, découverte 20/06 via inspection
# réseau). holdings/index = constituants de l'INDICE = exposition économique
# RÉELLE, correcte même pour les ETF synthétiques/swap (où holdings/fund ne
# renvoie que le panier substitut, géo trompeuse). Repli sur holdings/fund pour
# les ETF physiques sans bloc index. Champs : name/isin/weight (poids en %).
# Pas de secteur ; pays dérivé du préfixe ISIN du titre (proxy domicile).
INVESCO_HOLDINGS_URL = (
    "https://dng-api.invesco.com/cache/v1/accounts/en_GB/shareclasses/"
    "{isin}/holdings/{variation}?idType=isin"
)


def invesco_fetch_holdings(session: requests.Session, isin: str) -> list[dict] | None:
    """GET dng-api Invesco pour un ISIN → liste de constituants (index d'abord)."""
    # dng-api est protégé par un WAF anti-bot (renvoie 406 sur les rafales) :
    # headers légitimes (Origin/Referer invesco.com + Accept navigateur) pour
    # passer pour un appel XHR de la page produit. Reste à pacer (petits lots).
    inv_headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-GB,en;q=0.9",
        "Origin": "https://www.invesco.com",
        "Referer": "https://www.invesco.com/",
    }
    for variation in ("index", "fund"):
        try:
            resp = session.get(INVESCO_HOLDINGS_URL.format(isin=isin, variation=variation),
                               timeout=FETCH_TIMEOUT, headers=inv_headers)
            if resp.status_code != 200:
                continue
            rows = (resp.json() or {}).get("holdings") or []
        except Exception:
            continue
        out = []
        for h in rows:
            name = (h.get("name") or "").strip()
            w = h.get("weight")
            if not name or w is None:
                continue
            w = round(float(w) / 100, 6)
            if w == 0:
                continue
            hisin = (h.get("isin") or "").strip().upper()
            code = hisin[:2] if len(hisin) >= 2 and hisin[:2].isalpha() else None
            out.append({
                "position_name": name[:200],
                "ticker":        None,
                "asset_type":    None,
                "sector":        None,  # Invesco ne fournit pas le secteur par ligne
                "country":       code,
                "country_label": (CODE_TO_LABEL.get(code, code) if code else None),
                "weight":        w,
            })
        if out:
            out.sort(key=lambda x: x["weight"], reverse=True)
            return out
    return None


# ─── Agrégation secteurs / géo depuis les constituants ──────────────────────────

def aggregate_breakdowns(holdings: list[dict]) -> tuple[list[dict], list[dict]]:
    """Somme les poids (positifs) par secteur et par pays."""
    sec: dict[str, float] = defaultdict(float)
    geo: dict[str, tuple[str, float]] = {}
    geo_w: dict[str, float] = defaultdict(float)
    geo_label: dict[str, str] = {}
    for h in holdings:
        if h["weight"] <= 0:
            continue
        if h.get("sector") and h["sector"].lower() not in ("-", "n/a", "cash and/or derivatives"):
            sec[h["sector"]] += h["weight"]
        code = h.get("country")
        if code:
            geo_w[code] += h["weight"]
            geo_label.setdefault(code, h.get("country_label") or code)
    sectors = [{"sector_name": k, "weight": round(v, 6)} for k, v in sec.items() if v > 0]
    geos = [{"country_code": k, "country_label": geo_label[k], "weight": round(v, 6)} for k, v in geo_w.items() if v > 0]
    sectors.sort(key=lambda x: x["weight"], reverse=True)
    geos.sort(key=lambda x: x["weight"], reverse=True)
    return sectors, geos


# ─── Écriture DB ────────────────────────────────────────────────────────────────

def save_to_db(client, isin: str, holdings: list[dict], sectors: list[dict],
               geos: list[dict], source: str) -> None:
    # Holdings (delete-then-insert, cap déjà appliqué en amont)
    client.table("investissement_fund_holdings").delete().eq("isin", isin).execute()
    rows = []
    for rank, h in enumerate(holdings, 1):
        rows.append({
            "isin": isin, "rank": rank, "source": source,
            "position_name": h["position_name"], "ticker": h["ticker"],
            "asset_type": h["asset_type"], "sector": h["sector"],
            "country": h["country"], "weight": h["weight"],
        })
    for i in range(0, len(rows), INSERT_CHUNK):
        client.table("investissement_fund_holdings").insert(rows[i:i + INSERT_CHUNK]).execute()

    # Secteurs (PK isin,sector_name)
    client.table("investissement_fund_sectors").delete().eq("isin", isin).execute()
    if sectors:
        client.table("investissement_fund_sectors").insert(
            [{"isin": isin, "source": source, "sector_name": s["sector_name"], "weight": s["weight"]}
             for s in sectors]
        ).execute()

    # Géo (PK isin,country_code)
    client.table("investissement_fund_geos").delete().eq("isin", isin).execute()
    if geos:
        client.table("investissement_fund_geos").insert(
            [{"isin": isin, "source": source, "country_code": g["country_code"],
              "country_label": g["country_label"], "weight": g["weight"]}
             for g in geos]
        ).execute()


# ─── Sélection des cibles ───────────────────────────────────────────────────────

# Une ou plusieurs sous-chaînes (ILIKE) qui identifient l'émetteur côté
# management_company. Xtrackers = marque ETF de DWS ; quelques fonds portent
# « xtrackers » sans « dws » dans le nom du gérant → on capte les deux.
ISSUER_FILTERS = {
    "ishares":   ["blackrock"],
    "amundi":    ["amundi"],
    "xtrackers": ["dws", "xtrackers"],
    "invesco":   ["invesco"],
}


def select_targets(client, issuer: str, isin_filter: str | None,
                   refresh: bool) -> list[dict]:
    if isin_filter:
        return [{"isin": isin_filter.upper()}]
    needles = ISSUER_FILTERS[issuer]
    etfs, off = [], 0
    while True:
        d = (client.table("investissement_funds")
             .select("isin,management_company,management_company_normalized,aum_eur")
             .eq("product_type", "etf").not_.is_("isin", "null")
             .order("aum_eur", desc=True).range(off, off + 999).execute().data)
        if not d:
            break
        etfs.extend(d)
        off += 1000
    # Filtrage émetteur côté Python (ILIKE sur 2 colonnes)
    etfs = [e for e in etfs
            if any(n in ((e.get("management_company_normalized") or "") + (e.get("management_company") or "")).lower()
                   for n in needles)
            and ISIN_RE.match(e["isin"] or "")]

    if not refresh:
        done, off = set(), 0
        src = f"issuer:{issuer}"
        while True:
            d = (client.table("investissement_fund_holdings").select("isin")
                 .eq("source", src).range(off, off + 999).execute().data)
            if not d:
                break
            done.update(r["isin"] for r in d)
            off += 1000
        etfs = [e for e in etfs if e["isin"] not in done]
    return etfs


# ─── Run ────────────────────────────────────────────────────────────────────────

def run(issuer: str, apply: bool, limit: int | None, isin_filter: str | None,
        refresh: bool) -> None:
    print("=" * 66)
    print(f"  Issuer Holdings Scraper — {issuer}")
    print("=" * 66)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}  | cap {MAX_HOLDINGS} lignes/ETF")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    session = requests.Session()
    session.headers.update(HEADERS)
    stats   = Counter()

    # iShares résout l'ISIN via un catalogue productId ; Amundi/Xtrackers
    # interrogent leur API directement par ISIN (pas de catalogue à charger).
    catalog: dict[str, str] = {}
    if issuer == "ishares":
        print("  Chargement du catalogue iShares…")
        catalog = ishares_fetch_catalog(session)
        print(f"  Catalogue : {len(catalog)} fonds (ISIN→productId)")

    targets = select_targets(client, issuer, isin_filter, refresh)
    if limit:
        targets = targets[:limit]
    print(f"  ETF cibles : {len(targets)}")
    print()

    for i, etf in enumerate(targets, 1):
        isin = etf["isin"]

        if issuer == "ishares":
            pid = catalog.get(isin)
            if not pid:
                stats["no_catalog"] += 1
                continue
            holdings = ishares_fetch_holdings(session, pid)
        elif issuer == "amundi":
            holdings = amundi_fetch_holdings(session, isin)
        elif issuer == "xtrackers":
            holdings = xtrackers_fetch_holdings(session, isin)
        elif issuer == "invesco":
            holdings = invesco_fetch_holdings(session, isin)
        else:
            print(f"  ⚠ émetteur '{issuer}' inconnu"); return

        time.sleep(RATE_LIMIT_S)
        if not holdings:
            stats["no_data"] += 1
            print(f"  [{i:4d}] {isin} — aucune ligne extraite")
            continue

        # Secteurs/géo agrégés depuis la liste COMPLÈTE (avant troncature) pour
        # rester exacts même quand on ne stocke que les MAX_HOLDINGS premières lignes.
        sectors, geos = aggregate_breakdowns(holdings)
        wsum = sum(h["weight"] for h in holdings)

        total_n = len(holdings)
        if total_n > MAX_HOLDINGS:
            stats["truncated"] += 1
            print(f"  [{i:4d}] {isin} — TRONQUÉ {total_n}→{MAX_HOLDINGS} lignes (breakdowns gardés complets)")
            holdings = holdings[:MAX_HOLDINGS]
        stats["ok"] += 1
        print(f"  [{i:4d}] {isin} — {len(holdings)} lignes, "
              f"{len(sectors)} secteurs, {len(geos)} pays, Σpoids {wsum*100:.1f}%")

        if apply:
            for attempt in range(3):
                try:
                    save_to_db(client, isin, holdings, sectors, geos, f"issuer:{issuer}")
                    break
                except Exception as db_err:
                    if attempt == 2:
                        stats["db_error"] += 1
                        print(f"         DB ERROR (abandon): {db_err}")
                    else:
                        time.sleep(2 * (attempt + 1))
                        try:
                            client = get_client()
                        except Exception:
                            pass

        if i % 25 == 0:
            elapsed = (datetime.now(timezone.utc) - started).total_seconds()
            print(f"  ... {i}/{len(targets)} — {elapsed:.0f}s — {dict(stats)}")

    print()
    print(f"  Résultat : {dict(stats)}")
    log_run(
        scraper=f"issuer-holdings-{issuer}",
        status="success" if apply else "partial",
        records_processed=stats.get("ok", 0),
        records_failed=stats.get("db_error", 0) + stats.get("no_data", 0),
        started_at=started,
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--issuer", choices=list(ISSUER_FILTERS), default="ishares")
    p.add_argument("--apply",   action="store_true")
    p.add_argument("--limit",   type=int, default=None)
    p.add_argument("--isin",    type=str, default=None)
    p.add_argument("--refresh", action="store_true",
                   help="ré-écrire même les ETF déjà dotés de la source issuer")
    a = p.parse_args()
    run(issuer=a.issuer, apply=a.apply, limit=a.limit, isin_filter=a.isin, refresh=a.refresh)
