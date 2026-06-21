#!/usr/bin/env python3
"""
av-lux-cardif-lux-vie-catalog.py — Catalogue UC Cardif Lux Vie
===============================================================
Cardif Lux Vie (filiale BNP Paribas Cardif) expose une API REST publique
sur https://www.cardifluxvie.lu/docInfo/api/ pour son outil documentaire.

Endpoints exploitables :
  - GET  /docInfo/api/produits             → liste des 25 contrats (id, libelle, status)
  - GET  /docInfo/api/support-list/{id}    → liste complète des supports pour un contrat
  - POST /docInfo/api/support-search?...   → recherche paginée (pour vérification)
  - GET  /docInfo/api/support-isin         → tous les ISINs en lookup (2969 entrées)

Note : l'API est protégée par CSRF pour les POST directs depuis l'extérieur,
mais les endpoints GET fonctionnent librement depuis un navigateur. On utilise
Playwright pour rester dans le contexte de la page (requêtes fetch() dans le
contexte browser).

Contrats actifs (filtrés status="Ouvert") parmi les 25 produits :
  Dont produits français/belge/luxembourgeois pouvant intéresser les CGP FR :
  - CAP SECURE France (id=5)
  - CAP SECURE LUXEMBOURG (id=7)
  - Cardif Elite Lux (id=33)
  - LIBERTY 2 INVEST France (id=28)
  - LIBERTY 2 INVEST INTERNATIONAL (id=41)
  - SAINT-HONORÉ INTERNATIONAL (id=30)
  - PERSPECTIVE RMM VIE (id=29)
  - OPTILIFE² FRANCE (id=31)
  - ... et tous les autres ouverts

Chaque support expose : nom, ISIN, type (Fonds Externe/Interne Dédié), gestionnaire,
statut (Ouvert/Fermé), SFDR article.

Usage :
    python3 scripts/scrapers/av-lux-cardif-lux-vie-catalog.py [--apply] [--limit N]
    python3 scripts/scrapers/av-lux-cardif-lux-vie-catalog.py --apply
"""

import re
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

# NB : ce scraper NÉCESSITE un navigateur (Playwright) — les APIs Cardif
# (/docInfo/api/produits, /docInfo/api/support-list/) ne répondent que dans le
# contexte de session de la SPA (404 en requête directe, vérifié 21/06). Ce n'est
# donc PAS une migration scrapling→parsel : le bloqueur CI est le navigateur, pas
# scrapling (l'import scrapling, inutilisé, a été retiré). À planifier seulement
# via un workflow avec Playwright, ou laisser en seed manuel.
try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT    = 1.5
TIMEOUT       = 30
CARDIF_BASE   = "https://www.cardifluxvie.lu"
CARDIF_APP    = f"{CARDIF_BASE}/document-information/"
PRODUITS_URL  = f"{CARDIF_BASE}/docInfo/api/produits"
SUPPORT_LIST  = f"{CARDIF_BASE}/docInfo/api/support-list"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept":          "application/json",
    "Referer":         CARDIF_APP,
    "Origin":          CARDIF_BASE,
}


# ─── Fetch via Playwright ─────────────────────────────────────────────────────

def fetch_via_browser(url_path: str) -> dict | list | None:
    """
    Charge la page Cardif dans un navigateur, puis exécute un fetch() relatif.
    Nécessaire car les APIs utilisent les cookies/session du navigateur.
    """
    if not HAS_PLAYWRIGHT:
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            )
            page = ctx.new_page()
            page.goto(CARDIF_APP, wait_until="domcontentloaded", timeout=20_000)

            # Fetch depuis le contexte de la page
            result = page.evaluate(f"""
                async () => {{
                    const resp = await fetch('{url_path}');
                    if (!resp.ok) return null;
                    return await resp.json();
                }}
            """)
            browser.close()
            return result
    except Exception as e:
        print(f"  [browser] Erreur pour {url_path} : {e}")
        return None


def fetch_support_list_via_browser(product_id: int) -> list:
    """Récupère la liste des supports pour un produit Cardif via le navigateur."""
    if not HAS_PLAYWRIGHT:
        return []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            )
            page = ctx.new_page()
            page.goto(f"{CARDIF_APP}#/details", wait_until="domcontentloaded", timeout=20_000)

            result = page.evaluate(f"""
                async () => {{
                    const resp = await fetch('/docInfo/api/support-list/{product_id}');
                    if (!resp.ok) return [];
                    return await resp.json();
                }}
            """)
            browser.close()
            return result or []
    except Exception as e:
        print(f"  [browser] Erreur support-list/{product_id} : {e}")
        return []


# ─── Mapping ──────────────────────────────────────────────────────────────────

def parse_sfdr(classification: str) -> int | None:
    if not classification:
        return None
    m = re.search(r"[689]", str(classification))
    if m and m.group() in ("6", "8", "9"):
        return int(m.group())
    return None


def map_fund(support: dict, product_name: str) -> dict | None:
    """Mappe un enregistrement support Cardif vers investissement_funds."""
    isin = (support.get("isin") or "").strip().upper()
    if not isin or not re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", isin):
        return None

    name = (support.get("nom") or "").strip()
    if not name:
        return None

    mgmt = (support.get("nomGestionnaire") or "").strip() or None
    fund_type = (support.get("type") or "").lower()

    # "Fonds Externe" = OPCVM/ETF externe ; "Fonds Interne Dédié" = FID propriétaire
    if "interne" in fund_type:
        product_type = "fid"    # Fonds Interne Dédié
    elif "externe" in fund_type:
        product_type = "opcvm"
    else:
        product_type = "opcvm"

    sfdr_info   = support.get("sfdr") or {}
    sfdr_article = parse_sfdr(sfdr_info.get("classification"))

    record = {
        "isin":               isin,
        "name":               name,
        "product_type":       product_type,
        "management_company": mgmt,
        "currency":           "EUR",
        "av_lux_eligible":    True,
        "data_source":        "cardif-lux-vie",
    }
    if sfdr_article is not None:
        record["sfdr_article"] = sfdr_article

    return record


# ─── Upsert eligibility ───────────────────────────────────────────────────────

def upsert_eligibility(client, isin: str, product: dict, dry_run: bool = False) -> bool:
    """Upsert dans investissement_av_lux_eligibility."""
    row = {
        "isin":          isin,
        "company_name":  "Cardif Lux Vie",
        "contract_name": product["libelle"],
        "source_url":    CARDIF_APP,
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
        if "42P01" in str(e) or "does not exist" in str(e).lower():
            return False
        print(f"    ⚠ eligibility {isin}/{product['libelle']} : {e}")
        return False


# ─── Runner ────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Cardif Lux Vie AV Catalog — REST API")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)

    if not HAS_PLAYWRIGHT:
        print("  ERREUR : playwright requis pour l'authentification browser")
        print("  → pip install playwright && playwright install chromium")
        log_run("av-lux-cardif-lux-vie-catalog", "failed", 0, 0, started_at=started)
        return

    # 1. Récupérer la liste des produits
    print("  Récupération des produits Cardif Lux Vie...")
    products_raw = fetch_via_browser("/docInfo/api/produits")
    if not products_raw:
        print("  ERREUR : impossible de récupérer les produits")
        log_run("av-lux-cardif-lux-vie-catalog", "failed", 0, 0, started_at=started)
        return

    # Filtrer produits ouverts (actifs)
    products = [p for p in products_raw if p.get("status") == "Ouvert"]
    print(f"  → {len(products)}/{len(products_raw)} produits ouverts")
    for p in products:
        print(f"    [{p['id']:3}] {p['libelle']}")

    # Collecter tous les supports avec leur(s) produit(s)
    # isin -> (fund_dict, list_of_products)
    all_funds: dict[str, tuple[dict, list]] = {}
    skipped_no_isin = 0

    for product in products:
        prod_id   = product["id"]
        prod_name = product["libelle"]
        print(f"\n  Produit {prod_name} (id={prod_id})...")
        time.sleep(RATE_LIMIT)

        supports = fetch_support_list_via_browser(prod_id)
        if not supports:
            print(f"  → 0 supports (erreur ou vide)")
            continue

        with_isin    = [s for s in supports if s.get("isin")]
        without_isin = len(supports) - len(with_isin)
        skipped_no_isin += without_isin
        print(f"  → {len(supports)} supports dont {len(with_isin)} avec ISIN ({without_isin} FID sans ISIN ignorés)")

        for support in with_isin:
            fund = map_fund(support, prod_name)
            if not fund:
                continue
            isin = fund["isin"]
            if isin in all_funds:
                all_funds[isin][1].append(product)
            else:
                all_funds[isin] = (fund, [product])

    unique = list(all_funds.keys())
    print(f"\n  Total unique : {len(unique)} fonds ISIN")
    print(f"  FID sans ISIN ignorés : {skipped_no_isin}")

    if limit:
        unique = unique[:limit]
        print(f"  Limité à {limit}")

    if not unique:
        print("  Aucun fonds collecté.")
        log_run("av-lux-cardif-lux-vie-catalog", "failed", 0, 0, started_at=started)
        return

    # Aperçu dry-run
    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for isin in unique[:10]:
            fund, prods = all_funds[isin]
            prod_str = ", ".join(p["libelle"] for p in prods[:2])
            sfdr_str = f"SFDR{fund.get('sfdr_article')}" if fund.get("sfdr_article") else ""
            print(f"  {isin} | {fund.get('product_type','?'):8} | {sfdr_str:8} | {fund.get('name','')[:40]}")
            print(f"           → {prod_str}")
        print(f"\n  Seraient écrits : {len(unique)} fonds dans investissement_funds")
        total_elig = sum(len(p) for _, p in all_funds.values())
        print(f"  Seraient écrits dans investissement_av_lux_eligibility :")
        print(f"    {total_elig} lignes (isin x contrat)")
        return

    # Écriture dans investissement_funds
    client     = get_client()
    funds_list = [all_funds[isin][0] for isin in unique]
    ok, fail   = upsert_funds_bulk(funds_list, batch_size=100)
    print(f"\n  Upsert investissement_funds : {ok} OK, {fail} échec")

    # Upsert eligibility
    elig_ok = elig_fail = 0
    for isin in unique:
        fund, prods = all_funds[isin]
        for product in prods:
            ok_e = upsert_eligibility(client, isin, product, dry_run=False)
            if ok_e:
                elig_ok += 1
            else:
                elig_fail += 1
        time.sleep(0.01)

    print(f"  Upsert investissement_av_lux_eligibility : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run("av-lux-cardif-lux-vie-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cardif Lux Vie AV Catalog")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
