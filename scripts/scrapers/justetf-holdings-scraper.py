#!/usr/bin/env python3
"""
justetf-holdings-scraper.py — Composition ETF via JustETF (requests + BS4)
===========================================================================
Scrape les top holdings, la répartition sectorielle et géographique
des ETFs depuis justetf.com (HTML server-side rendered, pas de JS requis).

Tables alimentées :
  - investissement_fund_holdings  (top 10 positions)
  - investissement_fund_sectors   (répartition sectorielle)
  - investissement_fund_geos      (répartition géographique)

Usage :
    python3 scripts/scrapers/justetf-holdings-scraper.py
    python3 scripts/scrapers/justetf-holdings-scraper.py --apply
    python3 scripts/scrapers/justetf-holdings-scraper.py --apply --limit 50
    python3 scripts/scrapers/justetf-holdings-scraper.py --apply --isin IE00B5BMR087
"""

import sys
import re
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config ───────────────────────────────────────────────────────────────────

BASE_URL      = "https://www.justetf.com/fr/etf-profile.html?isin={isin}"
RATE_LIMIT_S  = 4.0
FETCH_TIMEOUT = 25
BATCH_SIZE    = 200

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection":      "keep-alive",
}

# Mots-clés pour identifier les sections répartition
SECTOR_KEYWORDS = ["secteur", "sector", "industry", "allocation sectorielle", "sector allocation"]
GEO_KEYWORDS    = ["pays", "country", "countries", "répartition géographique", "geographic allocation"]

# Regex pour ISINs valides
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

# Mapping noms de pays FR → ISO-2 (JustETF localisation française)
COUNTRY_CODES: dict[str, str] = {
    "États-Unis": "US", "Etats-Unis": "US", "USA": "US", "United States": "US",
    "Royaume-Uni": "GB", "United Kingdom": "GB",
    "Japon": "JP", "Japan": "JP",
    "Allemagne": "DE", "Germany": "DE",
    "France": "FR",
    "Chine": "CN", "China": "CN",
    "Canada": "CA",
    "Suisse": "CH", "Switzerland": "CH",
    "Australie": "AU", "Australia": "AU",
    "Pays-Bas": "NL", "Netherlands": "NL",
    "Corée du Sud": "KR", "South Korea": "KR",
    "Taïwan": "TW", "Taiwan": "TW",
    "Inde": "IN", "India": "IN",
    "Italie": "IT", "Italy": "IT",
    "Espagne": "ES", "Spain": "ES",
    "Suède": "SE", "Sweden": "SE",
    "Danemark": "DK", "Denmark": "DK",
    "Norvège": "NO", "Norway": "NO",
    "Finlande": "FI", "Finland": "FI",
    "Belgique": "BE", "Belgium": "BE",
    "Autriche": "AT", "Austria": "AT",
    "Portugal": "PT",
    "Irlande": "IE", "Ireland": "IE",
    "Luxembourg": "LU",
    "Singapour": "SG", "Singapore": "SG",
    "Hong Kong": "HK",
    "Brésil": "BR", "Brazil": "BR",
    "Mexique": "MX", "Mexico": "MX",
    "Afrique du Sud": "ZA", "South Africa": "ZA",
    "Russie": "RU", "Russia": "RU",
    "Arabie saoudite": "SA", "Saudi Arabia": "SA",
    "Émirats arabes unis": "AE", "UAE": "AE",
    "Pologne": "PL", "Poland": "PL",
    "Turquie": "TR", "Turkey": "TR",
    "Indonésie": "ID", "Indonesia": "ID",
    "Thaïlande": "TH", "Thailand": "TH",
    "Malaisie": "MY", "Malaysia": "MY",
    "Philippines": "PH",
    "Israël": "IL", "Israel": "IL",
    "Nouvelle-Zélande": "NZ", "New Zealand": "NZ",
    "Grèce": "GR", "Greece": "GR",
    "République tchèque": "CZ", "Czech Republic": "CZ",
    "Hongrie": "HU", "Hungary": "HU",
    "Autre": None, "Other": None, "Autres": None,
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _pct_to_float(s: str) -> float | None:
    """Convertit '7,57 %' ou '7.57%' en 0.0757."""
    try:
        clean = re.sub(r"[%\s\xa0]", "", s).replace(",", ".")
        v = float(clean)
        return round(v / 100, 6)
    except (ValueError, AttributeError):
        return None


def _is_pct_table(rows) -> bool:
    """Retourne True si la table contient au moins 3 lignes avec un pourcentage."""
    count = 0
    for row in rows[:12]:
        texts = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
        if any("%" in t for t in texts):
            count += 1
    return count >= 3


def _extract_name_weight_rows(rows) -> list[dict]:
    """Extrait les paires (name, weight) depuis les lignes d'une table."""
    result = []
    for row in rows:
        cells = row.find_all(["td", "th"])
        texts = [c.get_text(strip=True) for c in cells]
        if len(texts) < 2:
            continue
        weight_str = next((t for t in reversed(texts) if "%" in t), None)
        if not weight_str:
            continue
        weight = _pct_to_float(weight_str)
        if weight is None or weight <= 0 or weight > 1:
            continue
        name = texts[0] if texts[0] else None
        if not name or len(name) < 2 or name.startswith("#"):
            continue
        result.append({"name": name[:200], "weight": weight})
    return result


def _find_section_table_bs(soup, keywords: list[str]):
    """Cherche une section par mots-clés et retourne les <tr> de la table la plus proche."""
    kw_pattern = re.compile("|".join(keywords), re.I)
    for tag in soup.find_all(string=kw_pattern):
        parent = tag.parent
        # Remonter jusqu'à 5 niveaux pour trouver une table
        for _ in range(5):
            if parent is None:
                break
            table = parent.find("table")
            if table:
                rows = table.find_all("tr")
                if len(rows) > 2:
                    return rows
            parent = parent.parent
    return None


def fetch_html(isin: str) -> BeautifulSoup | None:
    """Télécharge la page JustETF et retourne le soup, ou None si ISIN absent."""
    url = BASE_URL.format(isin=isin)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=FETCH_TIMEOUT, allow_redirects=True)
        # Redirection vers search = ISIN absent de JustETF
        if "search" in resp.url or resp.status_code == 404:
            return None
        if resp.status_code != 200:
            return None
        return BeautifulSoup(resp.text, "html.parser")
    except Exception:
        return None


def scrape_etf(isin: str) -> dict | None:
    """Retourne un dict avec holdings / sectors / geos ou None si échec."""
    soup = fetch_html(isin)
    if soup is None:
        return None

    result = {"holdings": [], "sectors": [], "geos": []}

    # ─── Holdings ─────────────────────────────────────────────────────────────
    try:
        bad_kw = re.compile(r"volatilit|rendement|perform|ann[eé]e|1 an|3 ans|mois|semaine|an courant|cotation|place|ticker|bloomberg|reut|\d{4}", re.I)
        for table in soup.find_all("table"):
            rows = table.find_all("tr")
            if 5 <= len(rows) <= 25 and _is_pct_table(rows):
                items = _extract_name_weight_rows(rows)
                if len(items) >= 3:
                    if not any(bad_kw.search(it["name"]) for it in items[:3]):
                        for i, it in enumerate(items[:10], 1):
                            result["holdings"].append({
                                "rank":          i,
                                "position_name": it["name"],
                                "weight":        it["weight"],
                            })
                        break
    except Exception:
        pass

    # ─── Secteurs ─────────────────────────────────────────────────────────────
    try:
        rows = _find_section_table_bs(soup, SECTOR_KEYWORDS)
        if rows:
            items = _extract_name_weight_rows(rows)
            for it in items[:15]:
                result["sectors"].append({"label": it["name"], "weight": it["weight"]})
    except Exception:
        pass

    # ─── Géographies ──────────────────────────────────────────────────────────
    try:
        rows = _find_section_table_bs(soup, GEO_KEYWORDS)
        if rows:
            items = _extract_name_weight_rows(rows)
            for it in items[:20]:
                result["geos"].append({"label": it["name"], "weight": it["weight"]})
    except Exception:
        pass

    if not result["holdings"] and not result["sectors"] and not result["geos"]:
        return None
    return result


def save_to_db(client, isin: str, data: dict) -> dict:
    counts = {"holdings": 0, "sectors": 0, "geos": 0}

    if data["holdings"]:
        client.table("investissement_fund_holdings").delete().eq("isin", isin).execute()
        rows = [{"isin": isin, "source": "justetf", **h} for h in data["holdings"]]
        client.table("investissement_fund_holdings").insert(rows).execute()
        counts["holdings"] = len(rows)

    if data["sectors"]:
        client.table("investissement_fund_sectors").delete().eq("isin", isin).execute()
        rows = [{"isin": isin, "source": "justetf", "sector_name": s["label"], "weight": s["weight"]} for s in data["sectors"]]
        client.table("investissement_fund_sectors").insert(rows).execute()
        counts["sectors"] = len(rows)

    if data["geos"]:
        client.table("investissement_fund_geos").delete().eq("isin", isin).execute()
        rows = []
        for g in data["geos"]:
            label = g["label"]
            code  = COUNTRY_CODES.get(label)
            if code is None and label not in COUNTRY_CODES:
                continue  # label non reconnu comme pays → ignorer
            if code is None:
                continue  # label "Autre"/"Other" → pas de code
            rows.append({"isin": isin, "source": "justetf", "country_label": label, "country_code": code, "weight": g["weight"]})
        if rows:
            client.table("investissement_fund_geos").insert(rows).execute()
        counts["geos"] = len(rows)

    return counts


def run(apply: bool, limit: int | None, isin_filter: str | None) -> None:
    print("=" * 64)
    print("  JustETF Holdings Scraper (requests + BS4)")
    print("=" * 64)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite: {limit}")
    if isin_filter:
        print(f"  ISIN  : {isin_filter}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    stats   = Counter()

    # Sélectionner les ETFs à scraper
    if isin_filter:
        etfs = [{"isin": isin_filter.upper(), "name": "—"}]
    else:
        already_done = {
            r["isin"] for r in
            client.table("investissement_fund_holdings").select("isin").execute().data
        }
        all_etfs = client.table("investissement_funds") \
            .select("isin,name,aum_eur") \
            .eq("product_type", "etf") \
            .not_.is_("isin", "null") \
            .order("aum_eur", desc=True) \
            .execute().data
        etfs = [
            e for e in all_etfs
            if e["isin"] not in already_done and ISIN_RE.match(e["isin"] or "")
        ]
        if limit:
            etfs = etfs[:limit]

    print(f"  ETFs à scraper : {len(etfs)}")

    session = requests.Session()
    session.headers.update(HEADERS)

    for i, etf in enumerate(etfs, 1):
        isin = etf["isin"]
        name = (etf.get("name") or "")[:50]

        # Fetch via session (keep-alive, cookie jar)
        url = BASE_URL.format(isin=isin)
        try:
            resp = session.get(url, timeout=FETCH_TIMEOUT, allow_redirects=True)
            if "search" in resp.url or resp.status_code != 200:
                stats["not_on_justetf"] += 1
                time.sleep(RATE_LIMIT_S)
                continue
            soup = BeautifulSoup(resp.text, "html.parser")
        except Exception:
            stats["error"] += 1
            print(f"  [{i:4d}] {isin} — ERREUR réseau")
            time.sleep(RATE_LIMIT_S)
            continue

        # Extract
        result = {"holdings": [], "sectors": [], "geos": []}
        bad_kw = re.compile(r"volatilit|rendement|perform|ann[eé]e|1 an|3 ans|mois|semaine|an courant|cotation|place|ticker|bloomberg|reut|\d{4}", re.I)

        try:
            for table in soup.find_all("table"):
                rows = table.find_all("tr")
                if 5 <= len(rows) <= 25 and _is_pct_table(rows):
                    items = _extract_name_weight_rows(rows)
                    if len(items) >= 3 and not any(bad_kw.search(it["name"]) for it in items[:3]):
                        # Rejeter si les noms ressemblent à des pays (geo mal détecté comme holdings)
                        if any(it["name"] in COUNTRY_CODES for it in items[:3]):
                            continue
                        for j, it in enumerate(items[:10], 1):
                            result["holdings"].append({"rank": j, "position_name": it["name"], "weight": it["weight"]})
                        break
        except Exception:
            pass

        try:
            rows = _find_section_table_bs(soup, SECTOR_KEYWORDS)
            if rows:
                for it in _extract_name_weight_rows(rows)[:15]:
                    result["sectors"].append({"label": it["name"], "weight": it["weight"]})
        except Exception:
            pass

        try:
            rows = _find_section_table_bs(soup, GEO_KEYWORDS)
            if rows:
                for it in _extract_name_weight_rows(rows)[:20]:
                    result["geos"].append({"label": it["name"], "weight": it["weight"]})
        except Exception:
            pass

        time.sleep(RATE_LIMIT_S)

        n_hold = len(result["holdings"])
        n_sec  = len(result["sectors"])
        n_geo  = len(result["geos"])

        if not n_hold and not n_sec and not n_geo:
            stats["no_data"] += 1
            print(f"  [{i:4d}] {isin} — aucune donnée extraite ({name})")
            continue

        stats["ok"] += 1
        print(f"  [{i:4d}] {isin} — {n_hold} holdings, {n_sec} secteurs, {n_geo} pays ({name})")
        if result["holdings"]:
            top = result["holdings"][0]
            print(f"         Top: {top['position_name']} {top['weight']*100:.1f}%")

        if apply:
            try:
                save_to_db(client, isin, result)
            except Exception as db_err:
                stats["db_error"] += 1
                print(f"         DB ERROR: {db_err}")

        if i % 20 == 0:
            elapsed = (datetime.now(timezone.utc) - started).total_seconds()
            print(f"  ... {i}/{len(etfs)} — {elapsed:.0f}s — {dict(stats)}")

    print()
    print(f"  Résultat final : {dict(stats)}")
    log_run(
        scraper="justetf-holdings",
        status="success" if apply else "partial",
        records_processed=stats.get("ok", 0),
        records_failed=stats.get("error", 0) + stats.get("db_error", 0),
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply",  action="store_true")
    parser.add_argument("--limit",  type=int, default=None)
    parser.add_argument("--isin",   type=str, default=None)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
