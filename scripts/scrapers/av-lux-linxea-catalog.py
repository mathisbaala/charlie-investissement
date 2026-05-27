#!/usr/bin/env python3
"""
av-lux-linxea-catalog.py — Catalogue UC Linxea via Morningstar ECINT API
=========================================================================
Linxea expose son catalogue de fonds via un widget Morningstar (XRay) accessible
sur https://www.linxea.com/outils/liste-des-supports-xray/

La page charge un JWT depuis son URL hash pour s'authentifier auprès de l'API
Morningstar ECINT (https://www.emea-api.morningstar.com/ecint/v1/screener).

Chaque univers Morningstar correspond à un ou plusieurs contrats Linxea.
Les 8 univers observés couvrent :
  - FEEUR$$ALL_5627 : Linxea Spirit 2 + Linxea Spirit PER  (589 fonds)
  - FEEUR$$ALL_7170 : Linxea Avenir 2                       (635 fonds)
  - FEEUR$$ALL_842  : Linxea Vie                            (719 fonds)
  - FEEUR$$ALL_2659 : Linxea Zen                            (379 fonds)
  - FEEUR$$ALL_5650 : Linxea Spirit Capitalisation 2        (589 fonds)
  - FEEUR$$ALL_5649 : Linxea Avenir Capitalisation 2        (402 fonds)
  - FEEUR$$ALL_5252 : Linxea Suravenir PER                  (830 fonds)
  - FOFRA$$ALL_7306 : Linxea PER (fonds FR)                 (11 fonds)

Total unique : ~1 789 fonds (overlap entre contrats)

Stratégie :
  1. Ouvre le navigateur (Playwright headless) pour récupérer un JWT frais
     en allant sur la page xray (le JWT expire en ~1h)
  2. Pagination de chaque univers via l'API ECINT (pageSize=500)
  3. Pour chaque fonds : ISIN, nom légal, TER (ManagementFee), SRI, SFDR, perfs
  4. Met à jour investissement_funds (av_lux_eligible=True + enrichissement)
  5. Upsert dans investissement_av_lux_eligibility (table dédiée par contrat)

Usage :
    python3 scripts/scrapers/av-lux-linxea-catalog.py [--apply] [--limit N]
    python3 scripts/scrapers/av-lux-linxea-catalog.py --apply
"""

import re
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

# Pour extraire le JWT avec Playwright (optionnel si JWT_TOKEN passé en env)
try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, update_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT  = 1.5   # secondes entre requêtes API
TIMEOUT     = 30
PAGE_SIZE   = 500

XRAY_URL    = "https://www.linxea.com/outils/liste-des-supports-xray/"
MS_API_BASE = "https://www.emea-api.morningstar.com/ecint/v1/screener"

# Mapping univers Morningstar → contrats Linxea
UNIVERSES = {
    "FEEUR$$ALL_5627": ["Linxea Spirit 2", "Linxea Spirit PER"],
    "FEEUR$$ALL_7170": ["Linxea Avenir 2"],
    "FEEUR$$ALL_842":  ["Linxea Vie"],
    "FEEUR$$ALL_2659": ["Linxea Zen"],
    "FEEUR$$ALL_5650": ["Linxea Spirit Capitalisation 2"],
    "FEEUR$$ALL_5649": ["Linxea Avenir Capitalisation 2"],
    "FEEUR$$ALL_5252": ["Linxea Suravenir PER"],
    "FOFRA$$ALL_7306": ["Linxea PER"],
}

# Champs demandés à l'API ECINT
SEC_DATA_POINTS = "|".join([
    "SecId",
    "ISIN",
    "LegalName",
    "name",
    "ManagementFee",       # TER proxy (frais de gestion)
    "KID_SRI",             # SRI (1-7)
    "EETEUSFDR",           # classification SFDR
    "EET_EUSFDRType",      # Article 6/8/9
    "CategoryName",
    "GlobalCategoryName",
    "GlobalAssetClassId",
    "ReturnM12",           # perf 1 an glissant (%)
    "ReturnM36",           # perf 3 ans glissant (%)
    "ReturnM60",           # perf 5 ans glissant (%)
    "ReturnM120",          # perf 10 ans glissant (%)
    "universe",
])

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept":          "application/json",
}


# ─── Récupération du JWT ───────────────────────────────────────────────────────

def get_jwt_from_browser() -> str | None:
    """
    Lance un navigateur Playwright headless, charge la page XRay et extrait le JWT
    depuis l'URL hash (le site place automatiquement le token dans le hash).
    """
    if not HAS_PLAYWRIGHT:
        print("  [jwt] playwright non installé — pip install playwright && playwright install chromium")
        return None

    print("  [jwt] Ouverture du navigateur pour récupérer le JWT...")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            )
            page = ctx.new_page()
            page.goto(XRAY_URL, wait_until="networkidle", timeout=30_000)

            # Attendre que le JWT soit dans le hash
            for _ in range(20):
                url = page.url
                m = re.search(r"token=([A-Za-z0-9._-]+)", url)
                if m:
                    token = m.group(1)
                    print(f"  [jwt] JWT récupéré ({len(token)} chars)")
                    browser.close()
                    return token
                time.sleep(0.5)

            browser.close()
            print("  [jwt] JWT non trouvé dans l'URL hash")
            return None

    except Exception as e:
        print(f"  [jwt] Erreur Playwright : {e}")
        return None


def get_jwt_from_env() -> str | None:
    """Lit le JWT depuis la variable d'env LINXEA_MS_JWT si défini."""
    import os
    return os.environ.get("LINXEA_MS_JWT") or None


# ─── Fetch API Morningstar ─────────────────────────────────────────────────────

def fetch_universe(
    session: FetcherSession,
    token: str,
    universe_id: str,
) -> list[dict]:
    """
    Pagine l'API ECINT pour un univers donné.
    Retourne la liste brute des rows JSON.
    """
    auth_headers = {**HEADERS, "Authorization": f"Bearer {token}"}
    rows_all = []
    page = 1
    total = None

    while True:
        params = {
            "languageId":          "fr-FR",
            "currencyId":          "",
            "universeIds":         universe_id,
            "outputType":          "json",
            "securityDataPoints":  SEC_DATA_POINTS,
            "filters":             "",
            "subUniverseId":       "",
            "term":                "",
            "page":                page,
            "pageSize":            PAGE_SIZE,
            "sortOrder":           "LegalName asc",
        }

        try:
            resp = session.get(MS_API_BASE, headers=auth_headers, params=params, timeout=TIMEOUT)
            if resp.status == 401:
                print(f"  [ecint] JWT expiré (401) sur univers {universe_id}")
                return rows_all
            if resp.status != 200:
                raise Exception(f"HTTP {resp.status}")
            data = json.loads(resp.body.decode("utf-8"))
        except Exception as e:
            print(f"  [ecint] Erreur page {page} univers {universe_id} : {e}")
            break

        rows = data.get("rows", [])
        if total is None:
            total = data.get("total", 0)

        rows_all.extend(rows)

        fetched = len(rows_all)
        print(f"    univers {universe_id} : page {page} → {fetched}/{total}")

        if fetched >= total or len(rows) < PAGE_SIZE:
            break

        page += 1
        time.sleep(RATE_LIMIT)

    return rows_all


# ─── Mapping données → BD ──────────────────────────────────────────────────────

ASSET_CLASS_MAP = {
    "GR_Fixed": "obligations",
    "GR_Equity": "actions",
    "GR_MultiAsset": "diversifie",
    "GR_Commodity": "alternatif",
    "GR_Alternative": "alternatif",
    "GR_RealEstate": "immobilier",
    "GR_Money": "monetaire",
}

SFDR_MAP = {8: 8, 9: 9, 6: 6}


def map_fund(row: dict, contracts: list[str]) -> dict | None:
    """Mappe un row ECINT en dict investissement_funds."""
    isin = (row.get("ISIN") or "").strip().upper()
    if not isin or not re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", isin):
        return None

    name = (row.get("LegalName") or row.get("name") or "").strip()
    if not name:
        return None

    ter_raw = row.get("ManagementFee")
    ter = None
    if ter_raw is not None:
        try:
            v = float(ter_raw)
            if 0 < v < 20:
                # ManagementFee est déjà en % (ex: 2.2 = 2.2%)
                ter = round(v / 100, 6)
        except (ValueError, TypeError):
            pass

    sri_raw = row.get("KID_SRI")
    sri = None
    if sri_raw is not None:
        try:
            v = int(sri_raw)
            if 1 <= v <= 7:
                sri = v
        except (ValueError, TypeError):
            pass

    sfdr_raw = row.get("EET_EUSFDRType") or row.get("EETEUSFDR")
    sfdr_article = None
    if sfdr_raw is not None:
        try:
            v = int(str(sfdr_raw).strip())
            if v in (6, 8, 9):
                sfdr_article = v
        except (ValueError, TypeError):
            pass

    asset_class_id = row.get("GlobalAssetClassId") or ""
    asset_class = ASSET_CLASS_MAP.get(asset_class_id, "diversifie")

    category = row.get("CategoryName") or row.get("GlobalCategoryName") or None

    # Perfs en % absolu (ex: 15.43 = +15.43% sur 1 an)
    def parse_perf(val) -> float | None:
        if val is None:
            return None
        try:
            v = float(val)
            return round(v, 2) if -200 < v < 2000 else None
        except (ValueError, TypeError):
            return None

    perf_1y  = parse_perf(row.get("ReturnM12"))
    perf_3y  = parse_perf(row.get("ReturnM36"))
    perf_5y  = parse_perf(row.get("ReturnM60"))
    perf_10y = parse_perf(row.get("ReturnM120"))

    record = {
        "isin":               isin,
        "name":               name,
        "product_type":       "opcvm",
        "asset_class":        asset_class,
        "currency":           "EUR",
        "av_lux_eligible":    True,
        "distributor_france": True,
        "data_source":        "linxea-xray",
    }
    if category:
        record["category"] = category
    if ter is not None:
        record["ongoing_charges"] = ter
        record["ter"] = ter
    if sri is not None:
        record["sri"] = sri
    if sfdr_article is not None:
        record["sfdr_article"] = sfdr_article
    if perf_1y is not None:
        record["performance_1y"] = perf_1y
    if perf_3y is not None:
        record["performance_3y"] = perf_3y
    if perf_5y is not None:
        record["performance_5y"] = perf_5y

    return record


# ─── Upsert eligibility table ──────────────────────────────────────────────────

def upsert_eligibility(client, isin: str, contract: str, universe_id: str, dry_run: bool = False) -> bool:
    """Upsert dans investissement_av_lux_eligibility."""
    row = {
        "isin":          isin,
        "company_name":  "Linxea",
        "contract_name": contract,
        "source_url":    XRAY_URL,
        "universe_id":   universe_id,
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }
    if dry_run:
        return True
    try:
        client.table("investissement_av_lux_eligibility") \
            .upsert(row, on_conflict="isin,contract_name") \
            .execute()
        return True
    except Exception as e:
        # Si la table n'existe pas encore
        if "42P01" in str(e) or "does not exist" in str(e).lower():
            return False  # silencieux
        print(f"    ⚠ eligibility upsert {isin}/{contract} : {e}")
        return False


# ─── Runner ────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Linxea AV Catalog — Morningstar ECINT API")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)

    # Récupérer le JWT
    token = get_jwt_from_env() or get_jwt_from_browser()
    if not token:
        print("  ERREUR : impossible de récupérer le JWT Morningstar")
        print("  → Installer playwright : pip install playwright && playwright install chromium")
        print("  → Ou exporter LINXEA_MS_JWT=<token>")
        log_run("av-lux-linxea-catalog", "failed", 0, 0, started_at=started)
        return

    session = FetcherSession(impersonate="chrome").__enter__()
    client  = get_client() if apply else None

    # Collecter tous les fonds avec leurs contrats
    # isin -> (fund_dict, set_of_contracts, set_of_universes)
    all_funds: dict[str, tuple[dict, set, set]] = {}

    for universe_id, contracts in UNIVERSES.items():
        print(f"\n  Univers {universe_id} ({', '.join(contracts)}) ...")
        time.sleep(RATE_LIMIT)
        rows = fetch_universe(session, token, universe_id)
        print(f"  → {len(rows)} fonds bruts")

        for row in rows:
            fund = map_fund(row, contracts)
            if not fund:
                continue
            isin = fund["isin"]
            if isin in all_funds:
                all_funds[isin][1].update(contracts)
                all_funds[isin][2].add(universe_id)
            else:
                all_funds[isin] = (fund, set(contracts), {universe_id})

    unique = list(all_funds.keys())
    print(f"\n  Total unique : {len(unique)} fonds")

    if limit:
        unique = unique[:limit]
        print(f"  Limité à {limit} fonds")

    if not unique:
        print("  Aucun fonds collecté.")
        log_run("av-lux-linxea-catalog", "failed", 0, 0, started_at=started)
        return

    # Aperçu dry-run
    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for isin in unique[:10]:
            fund, contracts, universes = all_funds[isin]
            contr_str = ", ".join(sorted(contracts))
            ter_str   = f"TER={fund.get('ter', fund.get('ongoing_charges')):.3f}" if fund.get("ter") or fund.get("ongoing_charges") else "TER=?"
            p1y_str   = f"p1y={fund.get('performance_1y'):+.1f}%" if fund.get("performance_1y") is not None else ""
            print(f"  {isin} | {fund.get('asset_class','?'):12} | {ter_str} | {p1y_str} | {fund.get('name','')[:35]}")
            print(f"           → {contr_str}")
        print(f"\n  Seraient écrits : {len(unique)} fonds dans investissement_funds")
        print(f"  Seraient écrits dans investissement_av_lux_eligibility :")
        total_elig = sum(len(c) for _, c, _ in all_funds.values())
        print(f"    {total_elig} lignes (isin x contrat)")
        return

    # Écriture
    funds_list = [all_funds[isin][0] for isin in unique]
    ok, fail = upsert_funds_bulk(funds_list, batch_size=100)
    print(f"\n  Upsert investissement_funds : {ok} OK, {fail} échec")

    # Upsert eligibility
    elig_ok = elig_fail = 0
    for isin in unique:
        fund, contracts, universes = all_funds[isin]
        for contract in contracts:
            universe_id = next(iter(universes))  # on prend le premier univers associé
            ok_e = upsert_eligibility(client, isin, contract, universe_id, dry_run=False)
            if ok_e:
                elig_ok += 1
            else:
                elig_fail += 1
        time.sleep(0.01)  # léger throttle

    print(f"  Upsert investissement_av_lux_eligibility : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run("av-lux-linxea-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Linxea AV Catalog — Morningstar ECINT")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
