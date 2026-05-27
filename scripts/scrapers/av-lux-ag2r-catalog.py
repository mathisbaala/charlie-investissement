#!/usr/bin/env python3
"""
av-lux-ag2r-catalog.py — Catalogue fonds AG2R La Mondiale Luxembourg (LMEP)
=============================================================================
Source : API opcvm360 appelée depuis l'iframe AG2R La Mondiale.
URL iframe : https://iframes.opcvm360.com/funds?iframekey=dec511123cYF4gtju8Spf67dr&licontracts=633

L'API répond 200 directement avec requests + headers Referer/Origin corrects,
pas besoin de Playwright. Le fallback Playwright est conservé au cas où.

336 fonds au total, pas de pagination (limit=500 suffit).

Contract : AG2R La Mondiale — "Life Mobility Evolution"
Company  : AG2R La Mondiale

Usage :
    python3 scripts/scrapers/av-lux-ag2r-catalog.py [--apply] [--limit N]
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

API_URL = (
    "https://services.opcvm360.com/api-v1/instrs-iframes"
    "?limit=500&offset=0&sortFields=name"
    "&licontracts=633"
    "&iframeKey=dec511123cYF4gtju8Spf67dr"
    "&fields=idFundShare,idFund,isin,name,msRatingValue,labelIsr,lastVl,"
    "varPLast,varPYTD,varP1Y,varP3Y,varP5Y,varP10Y,volat5Y,sri,"
    "varPAnnualized1Y,varPAnnualized3Y,varPAnnualized5Y,varPAnnualized10Y"
)
IFRAME_URL = "https://iframes.opcvm360.com/funds?iframekey=dec511123cYF4gtju8Spf67dr&licontracts=633"

COMPANY  = "AG2R La Mondiale"
CONTRACT = "Life Mobility Evolution"
SOURCE   = "ag2r-lmep"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer":         "https://iframes.opcvm360.com/",
    "Origin":          "https://iframes.opcvm360.com",
}


# ─── Parsing ───────────────────────────────────────────────────────────────────

def parse_float(value) -> float | None:
    """Convertit une valeur API en float, retourne None si absent/invalide."""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def parse_int(value) -> int | None:
    """Convertit une valeur API en int, retourne None si absent/invalide."""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def parse_fund(item: dict) -> dict:
    """Convertit un item JSON de l'API en dict compatible investissement_funds."""
    isin = (item.get("isin") or "").strip().upper()
    name = (item.get("name") or "").strip() or None

    sri           = parse_int(item.get("sri"))
    ms_rating     = parse_int(item.get("msRatingValue"))
    perf_1y       = parse_float(item.get("varP1Y"))
    perf_3y       = parse_float(item.get("varP3Y"))
    perf_5y       = parse_float(item.get("varP5Y"))

    fund: dict = {
        "isin":            isin,
        "name":            name,
        "av_lux_eligible": True,
        "data_source":     SOURCE,
    }

    # Champs optionnels — uniquement si valeur présente
    if sri is not None:
        fund["sri"] = sri
    if ms_rating is not None:
        fund["morningstar_rating"] = ms_rating
    if perf_1y is not None:
        fund["performance_1y"] = perf_1y
    if perf_3y is not None:
        fund["performance_3y"] = perf_3y
    if perf_5y is not None:
        fund["performance_5y"] = perf_5y

    return fund


# ─── Fetch API — requests ──────────────────────────────────────────────────────

def fetch_via_requests() -> list[dict] | None:
    """
    Tente de récupérer les données via requests.
    Retourne la liste des items JSON ou None si échec (403, erreur réseau…).
    """
    try:
        resp = requests.get(API_URL, timeout=30)
        if page.status == 200:
            data = json.loads(page.body.decode("utf-8"))
            items = data.get("data", [])
            total = data.get("metadata", {}).get("totalCount", "?")
            print(f"  requests OK — {len(items)} fonds (total annoncé : {total})")
            return items
        else:
            print(f"  requests : HTTP {page.status} — fallback Playwright")
            return None
    except Exception as e:
        print(f"  requests erreur : {e} — fallback Playwright")
        return None


# ─── Fetch API — Playwright (fallback) ────────────────────────────────────────

def fetch_via_playwright() -> list[dict] | None:
    """
    Fallback Playwright : navigue vers l'iframe et intercepte la réponse réseau.
    N'est utilisé que si requests échoue (403 ou erreur).
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "\n  ERREUR : Playwright n'est pas installé et l'API a retourné 403.\n"
            "  Installez-le avec : pip install playwright && playwright install chromium\n"
        )
        return None

    print("  Playwright : navigation vers l'iframe…")
    captured: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=HEADERS["User-Agent"],
            extra_http_headers={
                "Accept-Language": HEADERS["Accept-Language"],
            },
        )
        page = context.new_page()

        # Intercepter les réponses réseau de l'API opcvm360
        def on_response(response):
            if "services.opcvm360.com/api-v1/instrs-iframes" in response.url:
                try:
                    body = response.json()
                    items = body.get("data", [])
                    captured.extend(items)
                    total = body.get("metadata", {}).get("totalCount", "?")
                    print(f"  Playwright intercepté : {len(items)} fonds (total : {total})")
                except Exception as e:
                    print(f"  Playwright parse error : {e}")

        page.on("response", on_response)

        try:
            page.goto(IFRAME_URL, wait_until="networkidle", timeout=30_000)
        except Exception as e:
            print(f"  Playwright navigation error : {e}")

        browser.close()

    return captured if captured else None


# ─── Eligibility upsert ────────────────────────────────────────────────────────

def upsert_eligibility(client, isin: str) -> bool:
    row = {
        "isin":          isin,
        "company_name":  COMPANY,
        "contract_name": CONTRACT,
        "source_url":    IFRAME_URL,
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.table("investissement_av_lux_eligibility") \
            .upsert(row, on_conflict="isin,contract_name") \
            .execute()
        return True
    except Exception as e:
        if "42P01" in str(e) or "does not exist" in str(e).lower():
            return False
        print(f"    eligibility {isin} : {e}")
        return False


# ─── Main ──────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  AG2R La Mondiale AV Catalog — API opcvm360")
    print("=" * 60)
    print(f"  Mode     : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Contrat  : {CONTRACT}")
    if limit:
        print(f"  Limite   : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)

    # 1. Essayer requests d'abord
    items = fetch_via_requests()

    # 2. Fallback Playwright si nécessaire
    if items is None:
        items = fetch_via_playwright()

    if not items:
        print("\n  ERREUR : impossible de récupérer les données.")
        log_run(SOURCE, "failed", 0, 0, started_at=started)
        return

    # 3. Parser les fonds
    all_funds: dict[str, dict] = {}
    skipped = 0

    for item in items:
        isin = (item.get("isin") or "").strip().upper()
        if not isin or len(isin) < 10:
            skipped += 1
            continue
        if isin not in all_funds:
            fund = parse_fund(item)
            if fund.get("name"):  # ignorer si pas de nom
                all_funds[isin] = fund

    unique_isins = list(all_funds.keys())
    if limit:
        unique_isins = unique_isins[:limit]

    print(f"\n  Total : {len(unique_isins)} fonds ISIN uniques ({skipped} ignorés)")

    # 4. Dry-run : aperçu
    if not apply:
        print("\n  Aperçu (10 premiers) :")
        header = f"  {'ISIN':14}  {'SRI':3}  {'MS':2}  {'1Y':6}  {'3Y':6}  {'5Y':6}  Nom"
        print(header)
        print("  " + "-" * 80)
        for isin in unique_isins[:10]:
            f = all_funds[isin]
            sri    = f.get("sri", "-")
            ms     = f.get("morningstar_rating", "-")
            p1y    = f"{f['performance_1y']:+.1f}%" if f.get("performance_1y") is not None else "  -  "
            p3y    = f"{f['performance_3y']:+.1f}%" if f.get("performance_3y") is not None else "  -  "
            p5y    = f"{f['performance_5y']:+.1f}%" if f.get("performance_5y") is not None else "  -  "
            name   = (f.get("name") or "")[:45]
            print(f"  {isin:14}  {str(sri):3}  {str(ms):2}  {p1y:6}  {p3y:6}  {p5y:6}  {name}")
        print(f"\n  Seraient écrits : {len(unique_isins)} fonds + {len(unique_isins)} lignes eligibility")
        return

    # 5. Apply
    client = get_client()

    # Upsert investissement_funds
    funds_list = [all_funds[isin] for isin in unique_isins]
    ok, fail = upsert_funds_bulk(funds_list, batch_size=100)
    print(f"\n  Upsert investissement_funds     : {ok} OK, {fail} échec")

    # Upsert eligibility
    elig_ok = elig_fail = 0
    for isin in unique_isins:
        if upsert_eligibility(client, isin):
            elig_ok += 1
        else:
            elig_fail += 1

    print(f"  Upsert eligibility              : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run(SOURCE, status, ok, fail, started_at=started)
    elapsed = (datetime.now(timezone.utc) - started).seconds
    print(f"\n  Terminé en {elapsed}s — statut : {status}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="AG2R La Mondiale AV Luxembourg — catalogue fonds via API opcvm360"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
