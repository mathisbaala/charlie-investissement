#!/usr/bin/env python3
"""
av-fr-cardif-catalog.py — Catalogue UC BNP Paribas Cardif (France)
===================================================================
Portail public : https://document-information-cle.cardif.fr/partenaires/supports

Architecture :
  1. GET page principale → session (JSESSIONID)
  2. POST action=init → liste des 33 contrats (id, libellé)
  3. POST action=filter (DataTables) — paginated — contract=-1, status=true
     → recordsTotal 60 883 entrées ISIN × contrat
  4. Déduplique par ISIN → upsert investissement_funds
  5. Toutes les lignes → upsert investissement_av_lux_eligibility

Champs extraits par fonds :
  - isin, name, sfdr_article, kid_url (DIS), data_source='cardif-fr'

Champs éligibilité (ISIN × contrat) :
  - isin, company_name='BNP Paribas Cardif', contract_name, source_url, scraped_at

Usage :
    python3 scripts/scrapers/av-fr-cardif-catalog.py [--apply] [--limit N] [--no-eligibility]
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

PORTAL_URL  = "https://document-information-cle.cardif.fr/partenaires/supports"
FILTER_URL  = PORTAL_URL

PORTLET_BASE_PARAMS = {
    "p_p_id":           "com_bpc_pcf_priips_views_PriipsFundsPortlet",
    "p_p_lifecycle":    "2",
    "p_p_state":        "normal",
    "p_p_mode":         "view",
    "p_p_resource_id":  "/manageFundsData",
    "p_p_cacheability": "cacheLevelPage",
}

HEADERS = {
    "User-Agent":       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":           "application/json, text/plain, */*",
    "Accept-Language":  "fr-FR,fr;q=0.9",
    "Content-Type":     "application/x-www-form-urlencoded",
    "Referer":          PORTAL_URL,
}

# Colonnes DataTables dans l'ordre exact de la page
DT_COLUMNS = [
    ("contractLabel",  True,  True),   # (data, searchable, orderable)
    ("isin",           True,  True),
    ("name",           True,  True),
    ("status",         True,  True),
    ("closingDateLabel", True, True),
    ("closingDateSort", True, True),
    ("documentUrl",    True,  False),
    ("sfdrProductType", True, True),
    ("pcdDocumentUrl", True,  False),
    ("sfdrWebsiteLink", True, False),
]

PAGE_SIZE   = 1000  # lignes par requête (le serveur l'accepte)
RATE_LIMIT  = 0.3   # secondes entre requêtes
TIMEOUT     = 30


# ─── Session ──────────────────────────────────────────────────────────────────

def make_session() -> requests.Session:
    """Initialise la session HTTP (cookie JSESSIONID requis)."""
    session = requests.Session()
    session.get(PORTAL_URL, headers=HEADERS, timeout=TIMEOUT)
    return session


# ─── DataTables body builder ──────────────────────────────────────────────────

def build_filter_body(start: int, length: int, contract: str = "-1",
                      status: str = "true", draw: int = 1) -> list[tuple]:
    params: list[tuple] = [("draw", str(draw))]
    for i, (col, searchable, orderable) in enumerate(DT_COLUMNS):
        params += [
            (f"columns[{i}][data]",            col),
            (f"columns[{i}][name]",            ""),
            (f"columns[{i}][searchable]",      "true" if searchable else "false"),
            (f"columns[{i}][orderable]",       "true" if orderable else "false"),
            (f"columns[{i}][search][value]",   ""),
            (f"columns[{i}][search][regex]",   "false"),
        ]
    params += [
        ("order[0][column]", "3"),
        ("order[0][dir]",    "asc"),
        ("start",            str(start)),
        ("length",           str(length)),
        ("search[value]",    ""),
        ("search[regex]",    "false"),
        ("fromcontractpage", "false"),
        ("prd",              ""),
        ("contract",         contract),
        ("status",           status),
        ("isin",             ""),
        ("label",            "-1"),
        ("page",             ""),
    ]
    return params


# ─── Fetch paginé ─────────────────────────────────────────────────────────────

def fetch_all_rows(session: requests.Session) -> list[dict]:
    """Récupère toutes les lignes ISIN × contrat (fonds ouverts)."""
    params = {**PORTLET_BASE_PARAMS,
              "_com_bpc_pcf_priips_views_PriipsFundsPortlet_action": "filter"}

    # Premier appel pour compter
    r = session.post(FILTER_URL, params=params,
                     data=build_filter_body(0, 1, draw=1),
                     headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    total = int(r.json().get("recordsTotal") or 0)
    print(f"  → {total:,} lignes ISIN × contrat")

    all_rows: list[dict] = []
    draw = 2
    for start in range(0, total, PAGE_SIZE):
        time.sleep(RATE_LIMIT)
        r2 = session.post(FILTER_URL, params=params,
                          data=build_filter_body(start, PAGE_SIZE, draw=draw),
                          headers=HEADERS, timeout=TIMEOUT)
        r2.raise_for_status()
        batch = r2.json().get("data", [])
        all_rows.extend(batch)
        pct = min(100, (start + len(batch)) * 100 // total)
        print(f"  [{start + len(batch):6}/{total}] {pct:3}%", end="\r", flush=True)
        draw += 1

    print()
    return all_rows


# ─── Parseurs ─────────────────────────────────────────────────────────────────

def parse_sfdr(val: str | None) -> int | None:
    if not val or val == "null":
        return None
    m = re.search(r"([689])", str(val))
    if m:
        return int(m.group(1))
    return None


ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


def map_fund(isin: str, row: dict) -> dict | None:
    """Construit le record investissement_funds pour un ISIN donné."""
    if not ISIN_RE.match(isin):
        return None

    name = (row.get("name") or "").strip()
    if not name or name == "null":
        return None

    sfdr = parse_sfdr(row.get("sfdrProductType"))
    kid  = row.get("documentUrl")
    if kid == "null":
        kid = None

    record: dict = {
        "isin":               isin,
        "name":               name,
        "product_type":       "opcvm",
        "currency":           "EUR",
        "distributor_france": True,
        "data_source":        "cardif-fr",
    }
    if sfdr is not None:
        record["sfdr_article"] = sfdr
    if kid:
        record["kid_url"] = kid
    return record


# ─── Éligibilité ──────────────────────────────────────────────────────────────

def upsert_eligibility_bulk(client, rows: list[dict], dry_run: bool) -> tuple[int, int]:
    """Upsert en masse dans investissement_av_lux_eligibility."""
    if dry_run or not rows:
        return len(rows), 0

    now = datetime.now(timezone.utc).isoformat()
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
    print("  BNP Paribas Cardif AV FR — Catalogue UC")
    print("=" * 60)
    print(f"  Mode         : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite ISINs : {limit}")
    if no_eligibility:
        print("  Éligibilité  : désactivée")
    print()

    started = datetime.now(timezone.utc)

    # 1. Session
    print("  Initialisation session...")
    session = make_session()

    # 2. Fetch toutes les lignes
    print("  Récupération du catalogue...")
    try:
        all_rows = fetch_all_rows(session)
    except Exception as e:
        print(f"  ERREUR fetch : {e}")
        if apply:
            log_run("av-fr-cardif-catalog", "failed", 0, 0, started_at=started)
        return

    print(f"  {len(all_rows):,} lignes récupérées")

    # 3. Dédupliquer par ISIN et par (ISIN, contrat)
    # Pour chaque ISIN, conserver le record avec le plus d'infos (priorité SFDR > no SFDR)
    funds_by_isin: dict[str, dict] = {}
    elig_seen: set[tuple] = set()   # (isin, contract_name) déjà vus
    elig_rows: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    skipped = 0

    for row in all_rows:
        isin = (row.get("isin") or "").strip().upper()
        if not isin or not ISIN_RE.match(isin):
            skipped += 1
            continue

        fund = map_fund(isin, row)
        if not fund:
            skipped += 1
            continue

        # Garder le meilleur record (avec SFDR si possible)
        if isin not in funds_by_isin:
            funds_by_isin[isin] = fund
        else:
            existing = funds_by_isin[isin]
            if fund.get("sfdr_article") and not existing.get("sfdr_article"):
                funds_by_isin[isin] = fund
            elif fund.get("kid_url") and not existing.get("kid_url"):
                funds_by_isin[isin] = fund

        # Éligibilité : une ligne par ISIN × contrat (dédupliqué)
        contract_name = (row.get("contractLabel") or "").strip()
        if contract_name and contract_name != "null":
            key = (isin, contract_name)
            if key not in elig_seen:
                elig_seen.add(key)
                elig_rows.append({
                    "isin":          isin,
                    "company_name":  "BNP Paribas Cardif",
                    "contract_name": contract_name,
                    "source_url":    PORTAL_URL,
                    "scraped_at":    now_iso,
                })

    unique_funds = list(funds_by_isin.values())
    print(f"  {len(unique_funds):,} ISINs uniques, {skipped} lignes ignorées")
    print(f"  {len(elig_rows):,} entrées éligibilité (ISIN × contrat)")

    if limit:
        unique_funds = unique_funds[:limit]
        elig_isins = {f["isin"] for f in unique_funds}
        elig_rows = [e for e in elig_rows if e["isin"] in elig_isins]
        print(f"  Limité à {limit} ISINs ({len(elig_rows)} entrées éligibilité)")

    if not unique_funds:
        print("  Aucun fonds collecté.")
        if apply:
            log_run("av-fr-cardif-catalog", "failed", 0, 0, started_at=started)
        return

    # Aperçu dry-run
    if not apply:
        print("\n  Aperçu investissement_funds (10 premiers) :")
        for f in unique_funds[:10]:
            sfdr = f"SFDR{f['sfdr_article']}" if f.get("sfdr_article") else "    "
            kid  = "KID✓" if f.get("kid_url") else "KID✗"
            print(f"  {f['isin']} | {sfdr:6} | {kid} | {f['name'][:50]}")
        print(f"\n  Seraient upsertés : {len(unique_funds):,} fonds dans investissement_funds")
        print(f"  Seraient upsertés : {len(elig_rows):,} lignes dans investissement_av_lux_eligibility")

        # Distribution SFDR
        sfdr_dist: dict[str, int] = {}
        for f in unique_funds:
            k = f"Article {f['sfdr_article']}" if f.get("sfdr_article") else "Non communiqué"
            sfdr_dist[k] = sfdr_dist.get(k, 0) + 1
        print(f"\n  Distribution SFDR : {sfdr_dist}")
        return

    # 4. Upsert investissement_funds
    client = get_client()
    print(f"\n  Upsert investissement_funds...")
    ok_f, fail_f = upsert_funds_bulk(unique_funds, batch_size=100)
    print(f"  → {ok_f:,} OK, {fail_f} échec")

    # 5. Upsert éligibilité
    if not no_eligibility:
        print(f"  Upsert investissement_av_lux_eligibility...")
        ok_e, fail_e = upsert_eligibility_bulk(client, elig_rows, dry_run=False)
        print(f"  → {ok_e:,} OK, {fail_e} échec")
    else:
        ok_e = fail_e = 0

    status = "success" if fail_f == 0 else "partial"
    log_run("av-fr-cardif-catalog", status, ok_f, fail_f, started_at=started)

    elapsed = (datetime.now(timezone.utc) - started).seconds
    print(f"\n  Terminé en {elapsed}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BNP Paribas Cardif AV FR Catalog")
    parser.add_argument("--apply",           action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",           type=int,            help="Limiter à N ISINs")
    parser.add_argument("--no-eligibility",  action="store_true", help="Ne pas écrire l'éligibilité")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, no_eligibility=args.no_eligibility)
