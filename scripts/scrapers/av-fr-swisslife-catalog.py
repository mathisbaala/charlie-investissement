#!/usr/bin/env python3
"""
av-fr-swisslife-catalog.py — Catalogue UC SwissLife France
============================================================
Portail public : https://infoclevie.swisslife.fr

Architecture :
  1. GET /api/v1/products?sponsorsIds={sponsor}
     Sponsors : ROUGE (8 contrats marque directe) + BLANCHE (48 contrats CGP marque-blanche)
  2. GET /api/v1/investmentOptions?sponsorsIds={sponsor}&productId={pid}
     → liste des fonds (isin, investmentOptionName, isActive, permalink)
  3. Déduplique par ISIN → upsert investissement_funds
  4. Toutes les lignes → upsert investissement_av_lux_eligibility

Champs extraits par fonds :
  - isin, name, kid_url (permalink = KID Morningstar), data_source='swisslife-fr'

Champs éligibilité (ISIN × contrat) :
  - isin, company_name='SwissLife France', contract_name, source_url, scraped_at

Usage :
    python3 scripts/scrapers/av-fr-swisslife-catalog.py [--apply] [--limit N] [--no-eligibility]
"""

import re
import sys
import time
import json
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

PORTAL_URL   = "https://infoclevie.swisslife.fr"
PRODUCTS_URL = f"{PORTAL_URL}/api/v1/products"
OPTIONS_URL  = f"{PORTAL_URL}/api/v1/investmentOptions"

# Sponsors disponibles : ROUGE = 8 contrats directs, BLANCHE = 48 contrats CGP
SPONSOR_IDS = ["ROUGE", "BLANCHE"]

HEADERS = {
    "User-Agent":   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":       "application/json",
    "Referer":      PORTAL_URL,
}

RATE_LIMIT = 0.5
TIMEOUT    = 30

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


# ─── Fetch ────────────────────────────────────────────────────────────────────

def fetch_products(session: requests.Session, sponsor: str) -> list[dict]:
    r = session.get(PRODUCTS_URL, params={"sponsorsIds": sponsor}, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    products = r.json()
    active = [p for p in products if "fermé" not in p.get("ProductName", "").lower()]
    print(f"  Sponsor {sponsor:8} → {len(products)} contrats ({len(active)} actifs)")
    return products


def fetch_contract_funds(session: requests.Session, product_id: str, sponsor: str = "ROUGE") -> list[dict]:
    params = {"sponsorsIds": sponsor, "productId": product_id}
    try:
        r = session.get(OPTIONS_URL, params=params, headers=HEADERS, timeout=TIMEOUT)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"\n  ⚠  {product_id} : {e}")
        return []


# ─── Parseur ──────────────────────────────────────────────────────────────────

def map_fund(item: dict) -> dict | None:
    """Construit le record depuis un item investmentOptions SwissLife."""
    isin = (item.get("isin") or item.get("Isin") or "").strip().upper()
    if not ISIN_RE.match(isin):
        return None

    name = (item.get("investmentOptionName") or item.get("InvestmentOptionName") or "").strip()
    if not name:
        return None

    # Seulement les fonds actifs
    if not item.get("isActive", True):
        return None

    kid = item.get("permalink") or item.get("Permalink")
    if not kid or kid == "null":
        kid = None

    record: dict = {
        "isin":               isin,
        "name":               name,
        "product_type":       "opcvm",
        "currency":           "EUR",
        "distributor_france": True,
        "data_source":        "swisslife-fr",
    }
    if kid:
        record["kid_url"] = kid
    return record


# ─── Éligibilité ──────────────────────────────────────────────────────────────

def upsert_eligibility_bulk(client, rows: list[dict], dry_run: bool) -> tuple[int, int]:
    if dry_run or not rows:
        return len(rows), 0

    batch_size = 200
    ok = fail = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            client.table("investissement_av_lux_eligibility") \
                .upsert(batch, on_conflict="isin,contract_name") \
                .execute()
            ok += len(batch)
        except Exception as e:
            err = str(e)
            if "42P01" in err or "does not exist" in err.lower():
                print(f"\n  ⚠  Table investissement_av_lux_eligibility inexistante")
                return 0, len(rows)
            print(f"\n  ⚠  eligibility batch {i//batch_size+1} : {e}")
            fail += len(batch)

    return ok, fail


# ─── Runner ────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, no_eligibility: bool):
    print("=" * 60)
    print("  SwissLife France AV — Catalogue UC")
    print("=" * 60)
    print(f"  Mode         : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite ISINs : {limit}")
    if no_eligibility:
        print("  Éligibilité  : désactivée")
    print()

    started = datetime.now(timezone.utc)
    session = requests.Session()

    # 1. Liste des contrats (tous sponsors)
    print("  Récupération des contrats...")
    all_products: list[tuple[dict, str]] = []  # (product, sponsor)
    seen_pids: set[str] = set()
    for sponsor in SPONSOR_IDS:
        try:
            prods = fetch_products(session, sponsor)
        except Exception as e:
            print(f"  ERREUR products {sponsor} : {e}")
            continue
        for p in prods:
            pid = p.get("ProductId", "")
            if pid and pid not in seen_pids:
                seen_pids.add(pid)
                all_products.append((p, sponsor))

    if not all_products:
        print("  Aucun contrat trouvé.")
        if apply:
            log_run("av-fr-swisslife-catalog", "failed", 0, 0, started_at=started)
        return

    # 2. Fonds par contrat
    print(f"  Récupération des fonds ({len(all_products)} contrats)...")
    funds_by_isin: dict[str, dict] = {}
    elig_seen: set[tuple] = set()
    elig_rows: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    skipped = 0
    total_rows = 0

    for idx, (product, sponsor) in enumerate(all_products, 1):
        pid   = product.get("ProductId", "")
        pname = product.get("ProductName", "")
        if not pid:
            continue

        time.sleep(RATE_LIMIT)
        items = fetch_contract_funds(session, pid, sponsor)
        total_rows += len(items)

        for item in items:
            fund = map_fund(item)
            if not fund:
                skipped += 1
                continue

            isin = fund["isin"]

            # Meilleur record par ISIN
            if isin not in funds_by_isin:
                funds_by_isin[isin] = fund
            else:
                existing = funds_by_isin[isin]
                if fund.get("kid_url") and not existing.get("kid_url"):
                    funds_by_isin[isin] = fund

            # Éligibilité
            key = (isin, pname)
            if key not in elig_seen:
                elig_seen.add(key)
                elig_rows.append({
                    "isin":          isin,
                    "company_name":  "SwissLife France",
                    "contract_name": pname,
                    "source_url":    PORTAL_URL,
                    "scraped_at":    now_iso,
                })

        print(f"  [{idx:2}/{len(all_products)}] [{sponsor:7}] {pname:45} → {len(items)} fonds")

    unique_funds = list(funds_by_isin.values())
    print(f"\n  {total_rows:,} lignes brutes, {len(unique_funds):,} ISINs uniques, {skipped} ignorées")
    print(f"  {len(elig_rows):,} entrées éligibilité")

    if limit:
        unique_funds = unique_funds[:limit]
        elig_isins = {f["isin"] for f in unique_funds}
        elig_rows = [e for e in elig_rows if e["isin"] in elig_isins]
        print(f"  Limité à {limit} ISINs ({len(elig_rows)} entrées éligibilité)")

    if not unique_funds:
        print("  Aucun fonds collecté.")
        if apply:
            log_run("av-fr-swisslife-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in unique_funds[:10]:
            kid = "KID✓" if f.get("kid_url") else "KID✗"
            print(f"  {f['isin']} | {kid} | {f['name'][:60]}")
        print(f"\n  Seraient upsertés : {len(unique_funds):,} fonds, {len(elig_rows):,} éligibilités")
        return

    # Upsert
    client = get_client()
    print(f"\n  Upsert investissement_funds...")
    ok_f, fail_f = upsert_funds_bulk(unique_funds, batch_size=100)
    print(f"  → {ok_f:,} OK, {fail_f} échec")

    if not no_eligibility:
        print(f"  Upsert investissement_av_lux_eligibility...")
        ok_e, fail_e = upsert_eligibility_bulk(client, elig_rows, dry_run=False)
        print(f"  → {ok_e:,} OK, {fail_e} échec")

    status = "success" if fail_f == 0 else "partial"
    log_run("av-fr-swisslife-catalog", status, ok_f, fail_f, started_at=started)

    elapsed = (datetime.now(timezone.utc) - started).seconds
    print(f"\n  Terminé en {elapsed}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SwissLife France AV Catalog")
    parser.add_argument("--apply",          action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",          type=int,            help="Limiter à N ISINs")
    parser.add_argument("--no-eligibility", action="store_true", help="Ne pas écrire l'éligibilité")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, no_eligibility=args.no_eligibility)
