#!/usr/bin/env python3
"""
linxea-ms-enricher.py — Enrichissement via l'API Morningstar EMEA de Linxea
=============================================================================
Linxea expose son catalogue (1785 fonds) via l'API Morningstar EMEA
(emea-api.morningstar.com/ecint/v1/screener) avec des credentials OAuth.

Champs enrichis (uniquement si manquants en base) :
  - ter / ongoing_charges
  - aum_eur
  - category
  - morningstar_rating
  - sri_score
  - performance_1y, performance_3y, performance_5y, performance_10y
  - sfdr_article
  - name (si manquant)

Usage :
    python3 scripts/scrapers/linxea-ms-enricher.py [--apply] [--limit N]
"""

import sys
import json
import time
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

OAUTH_URL   = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER    = "https://www.emea-api.morningstar.com/ecint/v1/screener"

# Credentials Morningstar EMEA pour le compte Linxea
import base64
_CREDS = base64.b64encode(b"ec-Linxe-2022@eamsecservice.com:LinxeB*j91").decode()
AUTH_HEADER = f"Basic {_CREDS}"

# Universe IDs Linxea (tous les contrats AV Spirit2, Avenir2, etc.)
UNIVERSE_IDS = "|".join([
    "FOFRA$$ALL_7306", "FEEUR$$ALL_1016", "FEEUR$$ALL_7170", "FEEUR$$ALL_2262",
    "FEEUR$$ALL_7171", "FEEUR$$ALL_1018", "FEEUR$$ALL_1963", "FEEUR$$ALL_2633",
    "FEEUR$$ALL_2634", "FEEUR$$ALL_1961", "FEEUR$$ALL_1843", "FEEUR$$ALL_4286",
    "FEEUR$$ALL_5252", "FEEUR$$ALL_2823", "FEEUR$$ALL_1426", "FEEUR$$ALL_5627",
    "FEEUR$$ALL_5628", "FEEUR$$ALL_1962", "FEEUR$$ALL_5650", "FEEUR$$ALL_5649",
    "FEEUR$$ALL_842",  "FEEUR$$ALL_2659",
])

# Champs à récupérer depuis l'API
DATA_POINTS = "|".join([
    "SecId", "ISIN", "LegalName",
    "OngoingCharge", "ManagementFee",
    "FundTNAV",
    "CategoryName", "GlobalCategoryName", "GlobalAssetClassName",
    "StarRating", "KID_SRI",
    "ReturnM12", "ReturnM36", "ReturnM60", "ReturnM120",
    "EET_EUSFDRType",
    "PortfolioDate",
])

PAGE_SIZE = 2000
HEADERS = {
    "Accept":          "application/json",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer":         "https://www.linxea.com/",
}

SFDR_MAP = {
    "Article6": 6,
    "Article 6": 6,
    "Article8": 8,
    "Article 8": 8,
    "Article9": 9,
    "Article 9": 9,
}


# ─── Auth ─────────────────────────────────────────────────────────────────────

def get_token() -> str:
    r = requests.post(OAUTH_URL, headers={**HEADERS, "Authorization": AUTH_HEADER}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


# ─── Screener ─────────────────────────────────────────────────────────────────

def fetch_all_funds(token: str) -> list[dict]:
    bearer = f"Bearer {token}"
    params = {
        "languageId":    "fr-FR",
        "currencyId":    "EUR",
        "universeIds":   UNIVERSE_IDS,
        "outputType":    "json",
        "securityDataPoints": DATA_POINTS,
        "filters":       "",
        "subUniverseId": "",
        "page":          1,
        "pageSize":      PAGE_SIZE,
        "sortOrder":     "LegalName asc",
    }
    r = requests.get(SCREENER, params=params, headers={**HEADERS, "Authorization": bearer}, timeout=30)
    r.raise_for_status()
    data = r.json()
    total   = data.get("total", 0)
    rows    = data.get("rows", [])
    print(f"  Page 1 : {len(rows)} / {total}")

    page = 2
    while len(rows) < total:
        params["page"] = page
        r = requests.get(SCREENER, params=params, headers={**HEADERS, "Authorization": bearer}, timeout=30)
        r.raise_for_status()
        batch = r.json().get("rows", [])
        if not batch:
            break
        rows.extend(batch)
        print(f"  Page {page} : {len(rows)} / {total}")
        page += 1
        time.sleep(0.3)

    return rows


# ─── Mapping champs ────────────────────────────────────────────────────────────

def map_row(row: dict) -> dict:
    """Convertit une ligne Morningstar EMEA en champs DB."""
    result: dict = {}

    isin = (row.get("ISIN") or "").strip()
    if not isin:
        return {}

    result["isin"] = isin

    # TER / ongoing_charges (Morningstar EMEA retourne en %, ex: 0.97 pour 0.97%)
    oc = row.get("OngoingCharge")
    if oc is not None:
        try:
            oc_f = float(oc)
            if 0 < oc_f < 20:
                result["ongoing_charges"] = round(oc_f / 100, 6)
                result["ter"]             = round(oc_f / 100, 6)
        except (ValueError, TypeError):
            pass

    # AUM
    tnav = row.get("FundTNAV")
    if tnav is not None:
        try:
            result["aum_eur"] = int(float(tnav))
        except (ValueError, TypeError):
            pass

    # Catégorie (préférer CategoryName, fallback GlobalCategoryName)
    cat = (row.get("CategoryName") or row.get("GlobalCategoryName") or "").strip()
    if cat:
        result["category"] = cat

    # Morningstar rating
    sr = row.get("StarRating")
    if sr is not None:
        try:
            result["morningstar_rating"] = int(float(sr))
        except (ValueError, TypeError):
            pass

    # SRI (colonne `sri` = PRIIPS SRI, 1-7)
    sri = row.get("KID_SRI")
    if sri is not None:
        try:
            result["sri"] = int(sri)
        except (ValueError, TypeError):
            pass

    # Performances (déjà en %)
    for ms_field, db_field in [("ReturnM12", "performance_1y"), ("ReturnM36", "performance_3y"),
                                ("ReturnM60", "performance_5y")]:
        val = row.get(ms_field)
        if val is not None:
            try:
                result[db_field] = round(float(val), 4)
            except (ValueError, TypeError):
                pass

    # SFDR
    sfdr_raw = str(row.get("EET_EUSFDRType") or "").strip()
    if sfdr_raw in SFDR_MAP:
        result["sfdr_article"] = SFDR_MAP[sfdr_raw]
    elif sfdr_raw.isdigit():
        val = int(sfdr_raw)
        if val in (6, 8, 9):
            result["sfdr_article"] = val

    # Nom
    name = (row.get("LegalName") or "").strip()
    if name:
        result["_name"] = name  # prefixé pour ne mettre que si manquant

    return result


# ─── Run ──────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Linxea MS Enricher — API Morningstar EMEA")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # 1. OAuth token
    print("  Authentification Morningstar EMEA…")
    token = get_token()
    print(f"  Token obtenu (expires ~55min)")
    print()

    # 2. Récupérer tous les fonds Linxea
    print("  Récupération des fonds depuis le screener…")
    ms_rows = fetch_all_funds(token)
    print(f"  {len(ms_rows)} lignes récupérées")
    print()

    # Index par ISIN
    ms_by_isin: dict[str, dict] = {}
    for row in ms_rows:
        mapped = map_row(row)
        isin = mapped.get("isin")
        if isin:
            ms_by_isin[isin] = mapped

    print(f"  {len(ms_by_isin)} ISINs uniques dans la réponse Morningstar")
    print()

    # 3. Charger les fonds DB existants (par ISIN)
    print("  Chargement des fonds depuis Supabase…")
    db_funds: dict[str, dict] = {}
    isin_list = list(ms_by_isin.keys())
    CHUNK = 500  # éviter les URLs trop longues avec PostgREST
    for i in range(0, len(isin_list), CHUNK):
        batch = (
            client.table("investissement_funds")
            .select("isin, name, ter, ongoing_charges, aum_eur, category, morningstar_rating, "
                    "sri, performance_1y, performance_3y, performance_5y, sfdr_article")
            .in_("isin", isin_list[i:i + CHUNK])
            .execute().data or []
        )
        for row in batch:
            db_funds[row["isin"]] = row

    # Pour les ISINs pas encore en DB, on peut les créer
    not_in_db = [isin for isin in ms_by_isin if isin not in db_funds]
    print(f"  {len(db_funds)} fonds trouvés en DB parmi {len(ms_by_isin)}")
    print(f"  {len(not_in_db)} ISINs non trouvés en DB (ignorés)")
    print()

    # 4. Calculer les mises à jour nécessaires
    to_update: list[dict] = []
    FIELDS_TO_CHECK = [
        ("ter",               "ter"),
        ("ongoing_charges",   "ongoing_charges"),
        ("aum_eur",           "aum_eur"),
        ("category",          "category"),
        ("morningstar_rating","morningstar_rating"),
        ("sri",               "sri"),
        ("performance_1y",    "performance_1y"),
        ("performance_3y",    "performance_3y"),
        ("performance_5y",    "performance_5y"),
        ("sfdr_article",      "sfdr_article"),
    ]

    for isin, ms_data in ms_by_isin.items():
        db_row = db_funds.get(isin)
        if not db_row:
            continue

        updates: dict = {}
        for ms_key, db_key in FIELDS_TO_CHECK:
            if ms_key in ms_data and db_row.get(db_key) is None:
                updates[db_key] = ms_data[ms_key]

        # Nom uniquement si manquant
        if not db_row.get("name") and "_name" in ms_data:
            updates["name"] = ms_data["_name"]

        if updates:
            to_update.append({"isin": isin, "name": db_row.get("name") or ms_data.get("_name", ""), **updates})

    if limit:
        to_update = to_update[:limit]

    print(f"  {len(to_update)} fonds à mettre à jour")
    print()

    # 5. Appliquer
    updated = skipped = 0
    now = datetime.now(timezone.utc).isoformat()

    for r in to_update:
        isin = r["isin"]
        name = (r.get("name") or "")[:35]
        changes = {k: v for k, v in r.items() if k not in ("isin", "name")}

        parts = []
        if "ter" in changes:
            parts.append(f"TER={changes['ter']*100:.2f}%")
        if "aum_eur" in changes:
            parts.append(f"AUM={changes['aum_eur']//1_000_000}M€")
        if "category" in changes:
            parts.append(f"cat={changes['category'][:20]}")
        if "morningstar_rating" in changes:
            parts.append(f"★{changes['morningstar_rating']}")
        if "sri" in changes:
            parts.append(f"SRI={changes['sri']}")
        if "performance_1y" in changes:
            parts.append(f"p1y={changes['performance_1y']:+.2f}%")
        if "sfdr_article" in changes:
            parts.append(f"SFDR={changes['sfdr_article']}")

        print(f"  ✓ {isin:15}  {' | '.join(parts)}  {name}")

        if apply:
            try:
                client.table("investissement_funds") \
                    .update({**changes, "updated_at": now}) \
                    .eq("isin", isin) \
                    .execute()
                updated += 1
            except Exception as e:
                if updated <= 3:
                    print(f"    ⚠ {e}")
                skipped += 1
        else:
            updated += 1

    print()
    print(f"  → {updated} fonds enrichis, {skipped} erreurs")

    if apply:
        log_run("linxea-ms-enricher", "success", updated, skipped, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Linxea Morningstar EMEA Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
