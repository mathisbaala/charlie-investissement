#!/usr/bin/env python3
"""
linxea-av-catalog.py — Catalogue des UC d'assurance-vie Linxea
==============================================================
Linxea est une des principales plateformes d'assurance-vie en ligne pour
les CGP et les particuliers français. Leur catalogue liste toutes les
unités de compte (UC) disponibles sur leurs contrats (Spirit 2, Avenir,
Zen, Vie+, etc.).

Pour chaque UC :
  - ISIN, nom, société de gestion
  - Catégorie / classe d'actifs
  - TER (frais courants)
  - Performance 1Y, 3Y, 5Y
  - Éligibilité contrats Linxea
  - SRI / SRRI
  - Classification SFDR

Sources :
  1. API publique Linxea (catalogue de fonds)
  2. Pages fonds individuelles (enrichissement)

Usage :
    python3 scripts/scrapers/linxea-av-catalog.py [--apply] [--limit N]
"""

import re
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as cffi_requests  # TLS-impersonation (anti-bot), sans navigateur

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT  = 0.8
TIMEOUT     = 20

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept":          "application/json, text/html, */*",
}

LINXEA_API_BASE = "https://www.linxea.com"

# URLs des APIs de catalogue Linxea (reverse-engineered)
LINXEA_FUND_URLS = [
    "https://www.linxea.com/api/fonds",
    "https://www.linxea.com/comparateur-fonds/",
    "https://www.linxea.com/fonds-assurance-vie",
]

# Contrats Linxea majeurs
LINXEA_CONTRACTS = [
    "spirit-2",
    "avenir-2",
    "zen",
    "vie-plus",
]

ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{10})\b")


def parse_ter(s) -> float | None:
    if not s:
        return None
    try:
        val = float(str(s).replace(",", ".").replace("%", "").strip())
        if 0 < val < 20:
            return round(val / 100 if val > 1 else val, 6)
    except (ValueError, TypeError):
        pass
    return None


def parse_perf(s) -> float | None:
    if not s:
        return None
    try:
        val = float(str(s).replace(",", ".").replace("%", "").strip())
        if -100 < val < 500:
            return round(val, 2)
    except (ValueError, TypeError):
        pass
    return None


def guess_asset_class(name: str, category: str) -> str:
    text = f"{name} {category}".lower()
    if any(w in text for w in ["action", "equity", "stock", "msci", "s&p", "cac", "actions"]):
        return "actions"
    if any(w in text for w in ["obligation", "bond", "fixed", "taux"]):
        return "obligations"
    if any(w in text for w in ["monétaire", "monetary", "cash", "court terme"]):
        return "monetaire"
    if any(w in text for w in ["immobilier", "scpi", "real estate", "pierre"]):
        return "immobilier"
    if any(w in text for w in ["gold", "or", "matières", "commodit"]):
        return "alternatif"
    return "diversifie"


def try_linxea_api(session) -> list[dict]:
    """Tente de récupérer le catalogue via l'API Linxea."""
    results = []

    # Essayer l'API directe
    api_urls = [
        "https://www.linxea.com/api/fonds/search?limit=5000",
        "https://www.linxea.com/api/v1/funds?per_page=5000",
        "https://www.linxea.com/api/products?type=fund&limit=5000",
    ]

    for url in api_urls:
        try:
            page = session.get(url, headers={**HEADERS, "Accept": "application/json"}, timeout=TIMEOUT)
            if page.status_code == 200:
                try:
                    data = json.loads(page.text)
                except (ValueError, UnicodeDecodeError):
                    continue
                if isinstance(data, list) and len(data) > 10:
                    print(f"  [linxea-api] {len(data)} fonds depuis {url}")
                    for item in data:
                        fund = map_linxea_fund(item)
                        if fund:
                            results.append(fund)
                    return results
                elif isinstance(data, dict):
                    for key in ["fonds", "funds", "data", "results", "items"]:
                        if isinstance(data.get(key), list) and len(data[key]) > 10:
                            print(f"  [linxea-api] {len(data[key])} fonds depuis {url} (clé:{key})")
                            for item in data[key]:
                                fund = map_linxea_fund(item)
                                if fund:
                                    results.append(fund)
                            return results
        except Exception:
            pass

    return results


def try_linxea_html(session) -> list[dict]:
    """Scrape la page de comparateur de fonds Linxea."""
    results = []
    urls = [
        "https://www.linxea.com/comparateur-fonds/",
        "https://www.linxea.com/fonds-assurance-vie/",
    ]

    for url in urls:
        try:
            time.sleep(RATE_LIMIT)
            page = session.get(url, headers=HEADERS, timeout=TIMEOUT)
            if page.status_code != 200:
                continue

            html = page.text

            # Chercher les données JSON embeddées dans le HTML
            # (Next.js / React souvent embed les données dans __NEXT_DATA__ ou window.__DATA__)
            json_matches = re.findall(r'__NEXT_DATA__\s*=\s*({.+?})\s*</script>', html, re.DOTALL)
            for jm in json_matches[:1]:
                try:
                    data = json.loads(jm)
                    props = data.get("props", {}).get("pageProps", {})
                    for key in ["fonds", "funds", "data", "initialData"]:
                        items = props.get(key, [])
                        if isinstance(items, list) and len(items) > 5:
                            print(f"  [linxea-html] {len(items)} fonds dans __NEXT_DATA__")
                            for item in items:
                                fund = map_linxea_fund(item)
                                if fund:
                                    results.append(fund)
                            return results
                except json.JSONDecodeError:
                    pass

            # Chercher les ISINs dans le HTML
            isins_found = set(ISIN_RE.findall(html))
            if len(isins_found) > 20:
                print(f"  [linxea-html] {len(isins_found)} ISINs trouvés dans le HTML")
                for isin in isins_found:
                    results.append({
                        "isin":               isin,
                        "name":               f"UC Linxea {isin}",
                        "product_type":       "opcvm",
                        "asset_class":        "diversifie",
                        "currency":           "EUR",
                        "distributor_france": True,
                        "data_source":        "linxea",
                    })
                return results

        except Exception as e:
            print(f"  [linxea-html] Erreur: {e}")

    return results


def map_linxea_fund(item: dict) -> dict | None:
    """Mappe un enregistrement Linxea en row investissement_funds."""
    isin = (
        item.get("isin") or item.get("ISIN") or
        item.get("code_isin") or item.get("codeISIN") or ""
    ).strip().upper()

    if not isin or not re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", isin):
        return None

    name = (
        item.get("name") or item.get("nom") or item.get("label") or
        item.get("libelle") or item.get("fonds_name") or ""
    ).strip()
    if not name:
        return None

    mgmt = (
        item.get("management_company") or item.get("sgp") or
        item.get("societe_gestion") or item.get("manager") or ""
    ).strip() or None

    category = (
        item.get("category") or item.get("categorie") or
        item.get("type") or ""
    ).strip() or None

    asset_class = guess_asset_class(name, category or "")

    ter_raw = (
        item.get("ter") or item.get("TER") or
        item.get("frais_courants") or item.get("ongoing_charges") or
        item.get("frais_gestion")
    )
    ter = parse_ter(ter_raw)

    sfdr_raw = item.get("sfdr") or item.get("sfdr_article") or item.get("article_sfdr")
    sfdr_article = None
    if sfdr_raw:
        m = re.search(r"[689]", str(sfdr_raw))
        if m and m.group() in ("6", "8", "9"):
            sfdr_article = int(m.group())

    sri_raw = item.get("sri") or item.get("SRI") or item.get("risque")
    sri = None
    if sri_raw:
        try:
            v = int(str(sri_raw).strip())
            if 1 <= v <= 7:
                sri = v
        except (ValueError, TypeError):
            pass

    perf_1y = parse_perf(item.get("perf_1y") or item.get("performance_1y") or item.get("rendement_1an"))
    perf_3y = parse_perf(item.get("perf_3y") or item.get("performance_3y") or item.get("rendement_3ans"))

    row = {
        "isin":               isin,
        "name":               name,
        "product_type":       "opcvm",
        "management_company": mgmt,
        "category":           category,
        "asset_class":        asset_class,
        "currency":           "EUR",
        "distributor_france": True,
        "data_source":        "linxea",
    }
    if ter:
        row["ongoing_charges"] = ter
        row["ter"] = ter
    if sfdr_article:
        row["sfdr_article"] = sfdr_article
    if sri:
        row["sri"] = sri
    if perf_1y is not None:
        row["performance_1y"] = perf_1y
    if perf_3y is not None:
        row["performance_3y"] = perf_3y

    return row


def scrape_contract_funds(session, contract: str) -> list[dict]:
    """Scrape les fonds d'un contrat Linxea spécifique."""
    results = []
    urls = [
        f"https://www.linxea.com/assurance-vie/contrats/{contract}/",
        f"https://www.linxea.com/{contract}/",
        f"https://www.linxea.com/assurance-vie/{contract}/unites-de-compte/",
    ]

    for url in urls:
        try:
            time.sleep(RATE_LIMIT)
            page = session.get(url, headers=HEADERS, timeout=TIMEOUT)
            if page.status_code != 200:
                continue

            html = page.text
            isins_found = set(ISIN_RE.findall(html))
            if len(isins_found) > 5:
                print(f"  [linxea/{contract}] {len(isins_found)} ISINs trouvés")
                for isin in isins_found:
                    results.append({
                        "isin":               isin,
                        "name":               f"UC {contract.upper()} {isin}",
                        "product_type":       "opcvm",
                        "asset_class":        "diversifie",
                        "currency":           "EUR",
                        "distributor_france": True,
                        "data_source":        "linxea",
                    })
                break
        except Exception:
            pass

    return results


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Linxea AV Catalog — Unités de Compte")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    session = cffi_requests.Session(impersonate="chrome")

    all_results: list[dict] = []

    # Tentative 1 : API Linxea
    print("  Tentative API Linxea...")
    api_results = try_linxea_api(session)
    if api_results:
        all_results.extend(api_results)
        print(f"  → {len(api_results)} fonds depuis l'API")

    # Tentative 2 : Scraping HTML comparateur
    if len(all_results) < 100:
        print("  Tentative scraping HTML Linxea...")
        html_results = try_linxea_html(session)
        if html_results:
            all_results.extend(html_results)
            print(f"  → {len(html_results)} fonds depuis le HTML")

    # Tentative 3 : Scraping par contrat
    if len(all_results) < 50:
        print("  Tentative scraping par contrat...")
        for contract in LINXEA_CONTRACTS:
            contract_results = scrape_contract_funds(session, contract)
            all_results.extend(contract_results)

    # Dédupliquer par ISIN
    seen: set = set()
    unique = []
    for r in all_results:
        if r["isin"] not in seen:
            seen.add(r["isin"])
            unique.append(r)

    if limit:
        unique = unique[:limit]

    print(f"\n  Total : {len(unique)} UC uniques collectées")

    if not unique:
        print("  ⚠️  Aucun fonds collecté — Linxea a peut-être changé sa structure")
        log_run("linxea-av-catalog", "failed", 0, 0, started_at=started)
        return

    if apply:
        ok, fail = upsert_funds_bulk(unique, batch_size=100)
        print(f"  → Upsert : {ok} OK, {fail} échec")
        log_run("linxea-av-catalog", "success", ok, fail, started_at=started)
    else:
        print("\n  Aperçu (10 premiers) :")
        for r in unique[:10]:
            print(f"  {r['isin']} | {r.get('asset_class','?'):12} | {r.get('name','')[:45]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Linxea AV Catalog")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
