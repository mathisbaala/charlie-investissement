#!/usr/bin/env python3
"""
ms-emea-perf-enricher.py — Performances manquantes via Morningstar EMEA
========================================================================
Cible : fonds OPCVM/ETF sans performance_1y ou performance_3y ou performance_5y.
Source : API Morningstar EMEA — ReturnM12, ReturnM36, ReturnM60.
Stratégie : paginer FOFRA$$ALL + FEEUR$$ALL.
Les performances Morningstar EMEA sont déjà en % (ex: 5.2 pour 5.2%).

Usage :
    python3 scripts/scrapers/ms-emea-perf-enricher.py [--apply] [--limit N]
"""

import sys, time, argparse, base64, requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

OAUTH_URL  = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER   = "https://www.emea-api.morningstar.com/ecint/v1/screener"
_CREDS     = base64.b64encode(b"ec-Linxe-2022@eamsecservice.com:LinxeB*j91").decode()
PAGE_SIZE  = 2000
UNIVERSES  = ["FOFRA$$ALL", "FEEUR$$ALL"]


def get_token() -> str:
    r = requests.post(OAUTH_URL,
                      headers={"Authorization": f"Basic {_CREDS}", "Accept": "application/json"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def fetch_perf_from_universe(token: str, universe: str, target: set[str]) -> dict[str, dict]:
    bearer  = f"Bearer {token}"
    headers = {"Authorization": bearer, "Accept": "application/json", "Referer": "https://www.linxea.com/"}
    params  = {
        "languageId": "fr-FR", "currencyId": "EUR",
        "universeIds": universe, "outputType": "json",
        "securityDataPoints": "ISIN|ReturnM12|ReturnM36|ReturnM60",
        "filters": "", "pageSize": PAGE_SIZE, "page": 1,
    }
    r = requests.get(SCREENER, params=params, headers=headers, timeout=30)
    r.raise_for_status()
    data  = r.json()
    total = data.get("total", 0)
    rows  = data.get("rows", [])
    print(f"  {universe} Page 1 : {len(rows)}/{total}", flush=True)

    result: dict[str, dict] = {}
    page = 2
    while True:
        for row in rows:
            isin = (row.get("ISIN") or "").strip()
            if isin not in target:
                continue
            updates: dict = {}
            for ms_field, db_field in [("ReturnM12", "performance_1y"),
                                        ("ReturnM36", "performance_3y"),
                                        ("ReturnM60", "performance_5y")]:
                val = row.get(ms_field)
                if val is not None:
                    try:
                        updates[db_field] = round(float(val), 4)
                    except (ValueError, TypeError):
                        pass
            if updates:
                result[isin] = updates
        if len(rows) < PAGE_SIZE or (page - 1) * PAGE_SIZE >= total:
            break
        params["page"] = page
        r = requests.get(SCREENER, params=params, headers=headers, timeout=30)
        r.raise_for_status()
        rows = r.json().get("rows", [])
        if page % 10 == 0:
            print(f"  {universe} Page {page} : ~{(page-1)*PAGE_SIZE}/{total}", flush=True)
        page += 1
        time.sleep(0.15)

    return result


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  MS EMEA Perf Enricher — performances manquantes")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")

    started = datetime.now(timezone.utc)
    client  = get_client()

    print("  Chargement des ISINs avec performances manquantes...", flush=True)
    no_perf: list[str] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin") \
            .in_("product_type", ["opcvm", "etf"]) \
            .or_("performance_1y.is.null,performance_3y.is.null,performance_5y.is.null") \
            .range(offset, offset + 999) \
            .execute().data or []
        no_perf.extend(r["isin"] for r in batch)
        if len(batch) < 1000:
            break
        offset += 1000

    target = set(no_perf)
    print(f"  {len(target)} fonds avec au moins 1 performance manquante")

    print("  Auth Morningstar EMEA...", flush=True)
    token = get_token()

    all_updates: dict[str, dict] = {}
    remaining = set(target)
    for universe in UNIVERSES:
        if not remaining:
            break
        print(f"  Screener {universe} ({len(remaining)} ISINs restants)...", flush=True)
        found = fetch_perf_from_universe(token, universe, remaining)
        # Fusionner (ne pas écraser les champs déjà trouvés)
        for isin, updates in found.items():
            if isin not in all_updates:
                all_updates[isin] = {}
            all_updates[isin].update(updates)
        remaining -= set(found.keys())
        print(f"  → {len(found)} trouvés dans {universe}", flush=True)

    print(f"  {len(all_updates)} ISINs avec au moins 1 performance trouvée")

    if limit:
        all_updates = dict(list(all_updates.items())[:limit])

    # Filtrer pour ne mettre à jour que les champs vraiment manquants en DB
    # (ne pas écraser des données déjà présentes)
    print("  Chargement des données actuelles pour filtrage...", flush=True)
    isins_list = list(all_updates.keys())
    db_data: dict[str, dict] = {}
    CHUNK = 500
    for i in range(0, len(isins_list), CHUNK):
        batch = client.table("investissement_funds") \
            .select("isin, performance_1y, performance_3y, performance_5y") \
            .in_("isin", isins_list[i:i+CHUNK]) \
            .execute().data or []
        for r in batch:
            db_data[r["isin"]] = r

    updated = skipped = 0
    now = datetime.now(timezone.utc).isoformat()

    for isin, updates in all_updates.items():
        db_row = db_data.get(isin, {})
        # Ne mettre à jour que les champs NULL en DB
        changes = {k: v for k, v in updates.items() if db_row.get(k) is None}
        if not changes:
            continue
        if apply:
            try:
                client.table("investissement_funds") \
                    .update({**changes, "updated_at": now}) \
                    .eq("isin", isin) \
                    .execute()
                updated += 1
            except Exception as e:
                if skipped < 3:
                    print(f"  ✗ {isin}: {e}", flush=True)
                skipped += 1
        else:
            updated += 1

    print(f"\n  → {updated} fonds enrichis en performance, {skipped} erreurs")
    if apply:
        log_run("ms-emea-perf-enricher", "success", updated, skipped, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
