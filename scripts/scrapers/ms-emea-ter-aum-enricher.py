#!/usr/bin/env python3
"""
ms-emea-ter-aum-enricher.py — TER/AUM manquants via Morningstar EMEA
====================================================================
Cible : fonds OPCVM/ETF sans TER OU sans AUM.
Source : API Morningstar EMEA — champs OngoingCharge, FundTNAV, KID_SRI.
Stratégie : paginer FOFRA$$ALL (57k) puis FEEUR$$ALL (188k).

Usage :
    python3 scripts/scrapers/ms-emea-ter-aum-enricher.py [--apply] [--limit N]
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


def fetch_ter_aum_from_universe(token: str, universe: str, target: set[str]) -> dict[str, dict]:
    """Pagine et retourne {isin: {ter, aum_eur, sri}} pour ISINs dans target."""
    bearer  = f"Bearer {token}"
    headers = {"Authorization": bearer, "Accept": "application/json", "Referer": "https://www.linxea.com/"}
    params  = {
        "languageId": "fr-FR", "currencyId": "EUR",
        "universeIds": universe, "outputType": "json",
        "securityDataPoints": "ISIN|OngoingCharge|FundTNAV|KID_SRI",
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
            oc = row.get("OngoingCharge")
            if oc is not None:
                try:
                    oc_f = float(str(oc).replace(",", "."))
                    if 0 < oc_f < 20:
                        updates["ter"]             = round(oc_f / 100, 6)
                        updates["ongoing_charges"] = round(oc_f / 100, 6)
                except (ValueError, TypeError):
                    pass
            tnav = row.get("FundTNAV")
            if tnav is not None:
                try:
                    updates["aum_eur"] = int(float(tnav))
                except (ValueError, TypeError):
                    pass
            sri = row.get("KID_SRI")
            if sri is not None:
                try:
                    v = int(float(sri))
                    if 1 <= v <= 7:
                        updates["sri"] = v
                except (ValueError, TypeError):
                    pass
            if updates:
                result[isin] = updates

        if len(rows) < PAGE_SIZE or (page - 1) * PAGE_SIZE >= total:
            break
        params["page"] = page
        for attempt in range(4):
            try:
                r = requests.get(SCREENER, params=params, headers=headers, timeout=45)
                r.raise_for_status()
                break
            except requests.HTTPError as e:
                if e.response is not None and e.response.status_code in (429, 503, 504):
                    wait = 2 ** attempt * 5
                    print(f"  {universe} Page {page} : {e.response.status_code} — retry in {wait}s", flush=True)
                    time.sleep(wait)
                else:
                    raise
        rows = r.json().get("rows", [])
        if page % 10 == 0:
            print(f"  {universe} Page {page} : ~{(page-1)*PAGE_SIZE}/{total}", flush=True)
        page += 1
        time.sleep(0.2)

    return result


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  MS EMEA TER/AUM Enricher")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")

    started = datetime.now(timezone.utc)
    client  = get_client()

    print("  Chargement des ISINs sans TER ou AUM...", flush=True)
    target_funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,ter,aum_eur,sri") \
            .in_("product_type", ["opcvm", "etf"]) \
            .or_("ter.is.null,aum_eur.is.null") \
            .range(offset, offset + 999) \
            .execute().data or []
        target_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    target = {f["isin"]: f for f in target_funds}
    print(f"  {len(target)} fonds avec TER ou AUM manquant")

    print("  Auth Morningstar EMEA...", flush=True)
    token = get_token()

    emea_data: dict[str, dict] = {}
    remaining = set(target.keys())
    for universe in UNIVERSES:
        if not remaining:
            break
        print(f"  Screener {universe} ({len(remaining)} ISINs restants)...", flush=True)
        found = fetch_ter_aum_from_universe(token, universe, remaining)
        emea_data.update(found)
        remaining -= set(found.keys())
        print(f"  → {len(found)} trouvés dans {universe}, {len(remaining)} restants", flush=True)

    print(f"  {len(emea_data)} ISINs avec données EMEA au total")

    # Filtrer : ne mettre à jour que les champs NULL en DB
    to_update: list[dict] = []
    for isin, new_data in emea_data.items():
        db_row = target.get(isin, {})
        changes: dict = {}
        if db_row.get("ter") is None and "ter" in new_data:
            changes["ter"] = new_data["ter"]
            changes["ongoing_charges"] = new_data["ongoing_charges"]
        if db_row.get("aum_eur") is None and "aum_eur" in new_data:
            changes["aum_eur"] = new_data["aum_eur"]
        if db_row.get("sri") is None and "sri" in new_data:
            changes["sri"] = new_data["sri"]
        if changes:
            to_update.append({"isin": isin, **changes})

    if limit:
        to_update = to_update[:limit]

    print(f"  {len(to_update)} fonds à enrichir")

    updated = skipped = 0
    now = datetime.now(timezone.utc).isoformat()
    ter_count = aum_count = sri_count = 0

    for r in to_update:
        isin = r["isin"]
        changes = {k: v for k, v in r.items() if k != "isin"}
        if "ter" in changes: ter_count += 1
        if "aum_eur" in changes: aum_count += 1
        if "sri" in changes: sri_count += 1

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

    print(f"\n  → {updated} fonds enrichis (TER:{ter_count}, AUM:{aum_count}, SRI:{sri_count}), {skipped} erreurs")
    if apply:
        log_run("ms-emea-ter-aum-enricher", "success", updated, skipped, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
