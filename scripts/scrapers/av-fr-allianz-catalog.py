#!/usr/bin/env python3
"""
av-fr-allianz-catalog.py — Catalogue UC Allianz France
=======================================================
Portail public : https://priips.allianz.fr/kd-priips/

Architecture (AngularJS SPA) :
  1. GET /rest/page/{page}              → liste des contrats (productCode, name)
     Pages : AZFR (~13 contrats), AGL (~1), other (~14 partenaires)
  2. GET /rest/produit/{code}/dis?date={jsDate}
     → disVersions : liste des fonds (isinCode, name, closingDate)
     IMPORTANT : date doit être au format JavaScript ISO avec ms (ex: 2026-05-23T16:02:56.381Z)
  3. Déduplique par ISIN → upsert investissement_funds
  4. Toutes les lignes → upsert investissement_av_lux_eligibility

Champs extraits par fonds :
  - isin, name, data_source='allianz-fr'
  - Pas de SFDR ni KID URL disponibles dans cette API

Champs éligibilité (ISIN × contrat) :
  - isin, company_name='Allianz France', contract_name, source_url, scraped_at

Usage :
    python3 scripts/scrapers/av-fr-allianz-catalog.py [--apply] [--limit N] [--no-eligibility]
"""

import re
import sys
import time
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

PORTAL_URL  = "https://priips.allianz.fr/kd-priips"
PAGES_URL   = f"{PORTAL_URL}/rest/page/{{page}}"
DIS_URL     = f"{PORTAL_URL}/rest/produit/{{code}}/dis"
SOURCE_URL  = PORTAL_URL

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer":         f"{PORTAL_URL}/",
}

# Pages connues de l'application AngularJS (routes SPA)
CONTRACT_PAGES = ["AZFR", "AGL", "other"]

RATE_LIMIT = 0.5
TIMEOUT    = 30

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


# ─── Date JS (format exigé par l'API AngularJS) ───────────────────────────────

def js_date() -> str:
    """Format JavaScript ISO avec millisecondes (ex: 2026-05-23T16:02:56.381Z)."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


# ─── Fetch ────────────────────────────────────────────────────────────────────

def fetch_page_contracts(session: requests.Session, page: str) -> list[dict]:
    url = PAGES_URL.format(page=page)
    try:
        r = session.get(url, headers=HEADERS, timeout=TIMEOUT)
        if r.status_code in (404, 204):
            return []
        r.raise_for_status()
        data = r.json()
        return data.get("kidsVersion") or []
    except Exception as e:
        print(f"\n  ⚠  page {page} : {e}")
        return []


def fetch_contract_funds(session: requests.Session, code: str) -> list[dict]:
    url = DIS_URL.format(code=code)
    params = {"date": js_date()}
    try:
        r = session.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
        if r.status_code in (404, 204):
            return []
        r.raise_for_status()
        data = r.json()
        return data.get("disVersions") or []
    except Exception as e:
        print(f"\n  ⚠  {code} : {e}")
        return []


# ─── Parseur ──────────────────────────────────────────────────────────────────

def is_open(item: dict) -> bool:
    """Retourne True si le fonds est encore ouvert à la commercialisation."""
    cd = item.get("closingDate")
    if not cd:
        return True
    # Java LocalDate/DateTime sérialisé en dict (Jackson)
    if isinstance(cd, dict):
        year = cd.get("year") or cd.get("Year") or cd.get("yearValue")
        if year is not None:
            return int(year) >= 9999
        return True
    # Chaîne ISO
    if isinstance(cd, str):
        return cd.startswith("9999") or cd in ("null", "")
    # Timestamp ms (9999-12-31 ≈ 253402300799000)
    if isinstance(cd, (int, float)):
        return int(cd) > 250_000_000_000_000
    return True


def map_fund(item: dict) -> dict | None:
    isin = (item.get("isinCode") or "").strip().upper()
    if not ISIN_RE.match(isin):
        return None

    name = (item.get("name") or "").strip()
    if not name:
        return None

    return {
        "isin":               isin,
        "name":               name,
        "product_type":       "opcvm",
        "currency":           "EUR",
        "distributor_france": True,
        "data_source":        "allianz-fr",
    }


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
    print("  Allianz France AV — Catalogue UC")
    print("=" * 60)
    print(f"  Mode         : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite ISINs : {limit}")
    if no_eligibility:
        print("  Éligibilité  : désactivée")
    print()

    started = datetime.now(timezone.utc)
    session = requests.Session()

    # 1. Découverte des contrats
    print("  Récupération des contrats...")
    all_contracts: list[dict] = []
    seen_codes: set[str] = set()

    for page in CONTRACT_PAGES:
        items = fetch_page_contracts(session, page)
        new_items = []
        for c in items:
            code = (c.get("productCode") or "").strip()
            if code and code not in seen_codes:
                seen_codes.add(code)
                new_items.append(c)
        all_contracts.extend(new_items)
        print(f"  Page {page:10} → {len(new_items)} contrats")

    if not all_contracts:
        print("  Aucun contrat trouvé.")
        if apply:
            log_run("av-fr-allianz-catalog", "failed", 0, 0, started_at=started)
        return

    print(f"  → {len(all_contracts)} contrats au total\n")
    print(f"  Récupération des fonds ({len(all_contracts)} contrats)...")

    # 2. Fonds par contrat
    funds_by_isin: dict[str, dict] = {}
    elig_seen: set[tuple] = set()
    elig_rows: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    skipped = 0
    total_rows = 0

    for idx, contract in enumerate(all_contracts, 1):
        code  = (contract.get("productCode") or "").strip()
        cname = (contract.get("name") or code).strip()
        if not code:
            continue

        time.sleep(RATE_LIMIT)
        items = fetch_contract_funds(session, code)
        total_rows += len(items)

        for item in items:
            if not is_open(item):
                skipped += 1
                continue

            fund = map_fund(item)
            if not fund:
                skipped += 1
                continue

            isin = fund["isin"]

            if isin not in funds_by_isin:
                funds_by_isin[isin] = fund

            key = (isin, cname)
            if key not in elig_seen:
                elig_seen.add(key)
                elig_rows.append({
                    "isin":          isin,
                    "company_name":  "Allianz France",
                    "contract_name": cname,
                    "source_url":    SOURCE_URL,
                    "scraped_at":    now_iso,
                })

        print(f"  [{idx:2}/{len(all_contracts)}] {cname:50} → {len(items)} fonds")

    unique_funds = list(funds_by_isin.values())
    print(f"\n  {total_rows:,} lignes brutes, {len(unique_funds):,} ISINs uniques, {skipped} ignorées")
    print(f"  {len(elig_rows):,} entrées éligibilité")

    if limit:
        unique_funds = unique_funds[:limit]
        elig_isins = {f["isin"] for f in unique_funds}
        elig_rows  = [e for e in elig_rows if e["isin"] in elig_isins]
        print(f"  Limité à {limit} ISINs ({len(elig_rows)} entrées éligibilité)")

    if not unique_funds:
        print("  Aucun fonds collecté.")
        if apply:
            log_run("av-fr-allianz-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in unique_funds[:10]:
            print(f"  {f['isin']} | {f['name'][:60]}")
        print(f"\n  Seraient upsertés : {len(unique_funds):,} fonds, {len(elig_rows):,} éligibilités")
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

    status = "success" if fail_f == 0 else "partial"
    log_run("av-fr-allianz-catalog", status, ok_f, fail_f, started_at=started)

    elapsed = (datetime.now(timezone.utc) - started).seconds
    print(f"\n  Terminé en {elapsed}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Allianz France AV Catalog")
    parser.add_argument("--apply",          action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",          type=int,            help="Limiter à N ISINs")
    parser.add_argument("--no-eligibility", action="store_true", help="Ne pas écrire l'éligibilité")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, no_eligibility=args.no_eligibility)
