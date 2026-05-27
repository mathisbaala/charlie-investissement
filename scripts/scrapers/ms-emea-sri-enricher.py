#!/usr/bin/env python3
"""
ms-emea-sri-enricher.py — SRI manquants via Morningstar EMEA
=============================================================
Cible : fonds OPCVM/ETF sans sri ET sans srri.
Source : API Morningstar EMEA (credentials Linxea) — champ KID_SRI.
Stratégie : paginer FOFRA$$ALL (57k fonds FR) puis FEEUR$$ALL (188k).

Usage :
    python3 scripts/scrapers/ms-emea-sri-enricher.py [--apply] [--limit N]
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
UNIVERSES  = ["FOFRA$$ALL", "FEEUR$$ALL"]  # FR d'abord (~57k), puis EU (~188k)


def get_token() -> str:
    r = requests.post(OAUTH_URL,
                      headers={"Authorization": f"Basic {_CREDS}", "Accept": "application/json"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def fetch_sri_from_universe(token: str, universe: str, target: set[str]) -> dict[str, int]:
    """Pagine sur un universe et retourne {isin: sri} pour les ISINs dans target."""
    bearer  = f"Bearer {token}"
    headers = {"Authorization": bearer, "Accept": "application/json", "Referer": "https://www.linxea.com/"}
    params  = {
        "languageId": "fr-FR", "currencyId": "EUR",
        "universeIds": universe, "outputType": "json",
        "securityDataPoints": "ISIN|KID_SRI",
        "filters": "", "pageSize": PAGE_SIZE, "page": 1,
    }
    r = requests.get(SCREENER, params=params, headers=headers, timeout=30)
    r.raise_for_status()
    data  = r.json()
    total = data.get("total", 0)
    rows  = data.get("rows", [])
    print(f"  {universe} Page 1 : {len(rows)}/{total}", flush=True)

    result: dict[str, int] = {}
    page = 2
    while True:
        for row in rows:
            isin = (row.get("ISIN") or "").strip()
            sri  = row.get("KID_SRI")
            if isin in target and sri is not None:
                try:
                    v = int(float(sri))
                    if 1 <= v <= 7:
                        result[isin] = v
                except (ValueError, TypeError):
                    pass
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
    print("  MS EMEA SRI Enricher — KID_SRI pour fonds sans SRI")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")

    started = datetime.now(timezone.utc)
    client  = get_client()

    print("  Chargement des ISINs sans SRI...", flush=True)
    no_sri: list[str] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin") \
            .in_("product_type", ["opcvm", "etf"]) \
            .is_("sri", "null") \
            .is_("srri", "null") \
            .range(offset, offset + 999) \
            .execute().data or []
        no_sri.extend(r["isin"] for r in batch)
        if len(batch) < 1000:
            break
        offset += 1000

    target = set(no_sri)
    print(f"  {len(target)} fonds sans SRI en DB")

    print("  Auth Morningstar EMEA...", flush=True)
    token = get_token()

    emea_sri: dict[str, int] = {}
    remaining = set(target)
    for universe in UNIVERSES:
        if not remaining:
            break
        print(f"  Screener {universe} ({len(remaining)} ISINs restants)...", flush=True)
        found = fetch_sri_from_universe(token, universe, remaining)
        emea_sri.update(found)
        remaining -= set(found.keys())
        print(f"  → {len(found)} trouvés dans {universe}, {len(remaining)} restants", flush=True)

    print(f"  {len(emea_sri)} ISINs avec KID_SRI au total")

    # Intersection déjà faite dans fetch_sri_from_universe
    to_update = emea_sri
    if limit:
        to_update = dict(list(to_update.items())[:limit])

    print(f"  {len(to_update)} fonds à enrichir")

    updated = skipped = 0
    now = datetime.now(timezone.utc).isoformat()

    for isin, sri in to_update.items():
        if apply:
            try:
                client.table("investissement_funds") \
                    .update({"sri": sri, "updated_at": now}) \
                    .eq("isin", isin) \
                    .execute()
                updated += 1
            except Exception as e:
                if skipped < 3:
                    print(f"  ✗ {isin}: {e}", flush=True)
                skipped += 1
        else:
            updated += 1

    print(f"\n  → {updated} fonds enrichis en SRI, {skipped} erreurs")
    if apply:
        log_run("ms-emea-sri-enricher", "success", updated, skipped, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
