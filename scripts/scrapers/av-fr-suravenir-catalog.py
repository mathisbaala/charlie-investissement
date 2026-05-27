#!/usr/bin/env python3
"""
av-fr-suravenir-catalog.py — Catalogue UC Suravenir (France)
=============================================================
Portail public : https://reglementaire-priips.suravenir.fr

Architecture (SPA Vue/React) :
  1. GET /data/products.json       → 125 contrats (productId, productName…)
  2. GET /data/{productId}.json    → liste des fonds du contrat (ISIN × contrat)
  3. Déduplique par ISIN            → upsert investissement_funds
  4. Toutes les lignes              → upsert investissement_av_lux_eligibility

Champs extraits par fonds :
  - isin, name, sfdr_article, kid_url, data_source='suravenir-fr'
  - product_type : 'etf' si TRACKERS, sinon 'opcvm'

Champs éligibilité (ISIN × contrat) :
  - isin, company_name='Suravenir', contract_name, source_url, scraped_at

Usage :
    python3 scripts/scrapers/av-fr-suravenir-catalog.py [--apply] [--limit N] [--no-eligibility]
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

PORTAL_URL   = "https://reglementaire-priips.suravenir.fr"
PRODUCTS_URL = f"{PORTAL_URL}/data/products.json"
DATA_URL_TPL = f"{PORTAL_URL}/data/{{pid}}.json"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":          "application/json",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer":         PORTAL_URL,
}

RATE_LIMIT = 0.5   # secondes entre requêtes
TIMEOUT    = 30

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")

# Natures Suravenir qui correspondent à des ETF/trackers
TRACKER_NATURES = {"TRACKERS"}


# ─── Fetch ────────────────────────────────────────────────────────────────────

def fetch_products(session: requests.Session) -> list[dict]:
    r = session.get(PRODUCTS_URL, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    products = r.json()
    active = [p for p in products if p.get("status") not in ("CLOSED",)]
    print(f"  → {len(products)} contrats ({len(active)} actifs)")
    return products


def fetch_contract_funds(session: requests.Session, product_id: str) -> list[dict]:
    url = DATA_URL_TPL.format(pid=product_id)
    try:
        r = session.get(url, headers=HEADERS, timeout=TIMEOUT)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  ⚠  {product_id}.json : {e}")
        return []


# ─── Parseur ──────────────────────────────────────────────────────────────────

def map_fund(isin: str, row: dict) -> dict | None:
    if not ISIN_RE.match(isin):
        return None

    name = (row.get("name") or "").strip()
    if not name:
        return None

    sfdr_raw = row.get("financialInstrumentSfdrProductType")
    sfdr = None
    if sfdr_raw is not None:
        try:
            v = int(sfdr_raw)
            if v in (6, 8, 9):
                sfdr = v
        except (ValueError, TypeError):
            pass

    nature = row.get("nature") or ""
    product_type = "etf" if nature in TRACKER_NATURES else "opcvm"

    kid = row.get("documentUrl")
    if not kid or kid == "null":
        kid = None

    record: dict = {
        "isin":               isin,
        "name":               name,
        "product_type":       product_type,
        "currency":           "EUR",
        "distributor_france": True,
        "data_source":        "suravenir-fr",
    }
    if sfdr is not None:
        record["sfdr_article"] = sfdr
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
    print("  Suravenir AV FR — Catalogue UC")
    print("=" * 60)
    print(f"  Mode         : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite ISINs : {limit}")
    if no_eligibility:
        print("  Éligibilité  : désactivée")
    print()

    started = datetime.now(timezone.utc)
    session = requests.Session()

    # 1. Liste des contrats
    print("  Récupération des contrats...")
    try:
        products = fetch_products(session)
    except Exception as e:
        print(f"  ERREUR products.json : {e}")
        if apply:
            log_run("av-fr-suravenir-catalog", "failed", 0, 0, started_at=started)
        return

    # 2. Fonds par contrat
    print(f"  Récupération des fonds ({len(products)} contrats)...")
    funds_by_isin: dict[str, dict] = {}
    elig_seen: set[tuple] = set()
    elig_rows: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    skipped = 0
    total_rows = 0

    for idx, product in enumerate(products, 1):
        pid = product.get("productId", "")
        pname = product.get("productName", "")
        if not pid:
            continue

        time.sleep(RATE_LIMIT)
        rows = fetch_contract_funds(session, pid)
        total_rows += len(rows)

        for row in rows:
            isin = (row.get("isin") or "").strip().upper()
            if not isin:
                skipped += 1
                continue

            # Filtre : seulement les fonds actifs
            if row.get("status") not in ("ACTIVE", None, ""):
                skipped += 1
                continue

            fund = map_fund(isin, row)
            if not fund:
                skipped += 1
                continue

            # Meilleur record par ISIN
            if isin not in funds_by_isin:
                funds_by_isin[isin] = fund
            else:
                existing = funds_by_isin[isin]
                if fund.get("sfdr_article") and not existing.get("sfdr_article"):
                    funds_by_isin[isin] = fund
                elif fund.get("kid_url") and not existing.get("kid_url"):
                    funds_by_isin[isin] = fund

            # Éligibilité unique par (ISIN, contrat)
            key = (isin, pname)
            if key not in elig_seen:
                elig_seen.add(key)
                elig_rows.append({
                    "isin":          isin,
                    "company_name":  "Suravenir",
                    "contract_name": pname,
                    "source_url":    PORTAL_URL,
                    "scraped_at":    now_iso,
                })

        pct = idx * 100 // len(products)
        print(f"  [{idx:3}/{len(products)}] {pct:3}% | {pid} | {pname[:40]}", end="\r", flush=True)

    print()
    unique_funds = list(funds_by_isin.values())
    print(f"  {total_rows:,} lignes brutes, {len(unique_funds):,} ISINs uniques, {skipped} ignorées")
    print(f"  {len(elig_rows):,} entrées éligibilité (ISIN × contrat)")

    if limit:
        unique_funds = unique_funds[:limit]
        elig_isins = {f["isin"] for f in unique_funds}
        elig_rows = [e for e in elig_rows if e["isin"] in elig_isins]
        print(f"  Limité à {limit} ISINs ({len(elig_rows)} entrées éligibilité)")

    if not unique_funds:
        print("  Aucun fonds collecté.")
        if apply:
            log_run("av-fr-suravenir-catalog", "failed", 0, 0, started_at=started)
        return

    # Aperçu dry-run
    if not apply:
        print("\n  Aperçu investissement_funds (10 premiers) :")
        for f in unique_funds[:10]:
            sfdr = f"SFDR{f['sfdr_article']}" if f.get("sfdr_article") else "    "
            kid  = "KID✓" if f.get("kid_url") else "KID✗"
            print(f"  {f['isin']} | {sfdr:6} | {kid} | {f['name'][:50]}")
        print(f"\n  Seraient upsertés : {len(unique_funds):,} fonds")
        print(f"  Seraient upsertés : {len(elig_rows):,} lignes éligibilité")
        sfdr_dist: dict[str, int] = {}
        for f in unique_funds:
            k = f"Article {f['sfdr_article']}" if f.get("sfdr_article") else "Non renseigné"
            sfdr_dist[k] = sfdr_dist.get(k, 0) + 1
        print(f"  SFDR : {sfdr_dist}")
        return

    # 3. Upsert investissement_funds
    client = get_client()
    print(f"\n  Upsert investissement_funds...")
    ok_f, fail_f = upsert_funds_bulk(unique_funds, batch_size=100)
    print(f"  → {ok_f:,} OK, {fail_f} échec")

    # 4. Upsert éligibilité
    if not no_eligibility:
        print(f"  Upsert investissement_av_lux_eligibility...")
        ok_e, fail_e = upsert_eligibility_bulk(client, elig_rows, dry_run=False)
        print(f"  → {ok_e:,} OK, {fail_e} échec")
    else:
        ok_e = fail_e = 0

    status = "success" if fail_f == 0 else "partial"
    log_run("av-fr-suravenir-catalog", status, ok_f, fail_f, started_at=started)

    elapsed = (datetime.now(timezone.utc) - started).seconds
    print(f"\n  Terminé en {elapsed}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Suravenir AV FR Catalog")
    parser.add_argument("--apply",          action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",          type=int,            help="Limiter à N ISINs")
    parser.add_argument("--no-eligibility", action="store_true", help="Ne pas écrire l'éligibilité")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, no_eligibility=args.no_eligibility)
