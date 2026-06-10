#!/usr/bin/env python3
"""
ms-emea-combo-enricher.py — TER + AUM + SRI + Perf via Morningstar EMEA (1 seul scan)
=======================================================================================
Combine les 3 enrichisseurs EMEA en un seul passage sur FOFRA$$ALL + FEEUR$$ALL.
Récupère en une seule paginaion : OngoingCharge, FundTNAV, KID_SRI,
ReturnM12, ReturnM36, ReturnM60.

Cible : OPCVM et ETF avec au moins 1 champ manquant parmi :
  ter, aum_eur, sri, performance_1y, performance_3y, performance_5y

Usage :
    python3 scripts/scrapers/ms-emea-combo-enricher.py [--apply] [--limit N]
    python3 scripts/scrapers/ms-emea-combo-enricher.py --apply
    python3 scripts/scrapers/ms-emea-combo-enricher.py --apply --type opcvm
"""

import sys
import time
import argparse
import base64
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

OAUTH_URL = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER  = "https://www.emea-api.morningstar.com/ecint/v1/screener"
_CREDS    = base64.b64encode(b"ec-Linxe-2022@eamsecservice.com:LinxeB*j91").decode()
PAGE_SIZE = 2000
UNIVERSES = ["FOFRA$$ALL", "FEEUR$$ALL"]

DATA_POINTS = "ISIN|OngoingCharge|FundTNAV|KID_SRI|ReturnM12|ReturnM36|ReturnM60|InceptionDate"


def get_token() -> str:
    r = requests.post(
        OAUTH_URL,
        headers={"Authorization": f"Basic {_CREDS}", "Accept": "application/json"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _screener_get(params: dict, headers: dict, retries: int = 5):
    """GET screener résilient : retry sur 5xx/429/erreurs réseau (backoff exponentiel).
    Retourne le JSON, ou None si échec persistant (le scan bascule alors sur
    résultats partiels au lieu de crasher tout le run avant l'écriture)."""
    for attempt in range(retries):
        try:
            r = requests.get(SCREENER, params=params, headers=headers, timeout=45)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            return r.json()
        except Exception:
            time.sleep(2 ** attempt)
    return None


def fetch_universe(token: str, universe: str, target: set[str]) -> dict[str, dict]:
    """Scan complet d'un universe, retourne {isin: {champs}} pour les ISINs dans target."""
    bearer  = f"Bearer {token}"
    headers = {
        "Authorization": bearer,
        "Accept":        "application/json",
        "Referer":       "https://www.linxea.com/",
    }
    params = {
        "languageId":       "fr-FR",
        "currencyId":       "EUR",
        "universeIds":      universe,
        "outputType":       "json",
        "securityDataPoints": DATA_POINTS,
        "filters":          "",
        "pageSize":         PAGE_SIZE,
        "page":             1,
    }

    data = _screener_get(params, headers)
    if data is None:
        print(f"  {universe} : page 1 inaccessible — univers ignoré", flush=True)
        return {}
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

            # TER / ongoing_charges
            oc = row.get("OngoingCharge")
            if oc is not None:
                try:
                    oc_f = float(str(oc).replace(",", "."))
                    if 0 < oc_f < 20:
                        updates["ter"]             = round(oc_f / 100, 6)
                        updates["ongoing_charges"] = round(oc_f / 100, 6)
                except (ValueError, TypeError):
                    pass

            # AUM
            tnav = row.get("FundTNAV")
            if tnav is not None:
                try:
                    updates["aum_eur"] = int(float(tnav))
                except (ValueError, TypeError):
                    pass

            # SRI
            sri = row.get("KID_SRI")
            if sri is not None:
                try:
                    v = int(float(sri))
                    if 1 <= v <= 7:
                        updates["sri"] = v
                except (ValueError, TypeError):
                    pass

            # Performances (déjà en %, ex: 5.2 = 5.2%)
            for ms_field, db_field in [
                ("ReturnM12", "performance_1y"),
                ("ReturnM36", "performance_3y"),
                ("ReturnM60", "performance_5y"),
            ]:
                val = row.get(ms_field)
                if val is not None:
                    try:
                        updates[db_field] = round(float(val), 4)
                    except (ValueError, TypeError):
                        pass

            # InceptionDate
            inc = row.get("InceptionDate")
            if inc and isinstance(inc, str) and len(inc) >= 10:
                updates["inception_date_emea"] = inc[:10]

            if updates:
                result[isin] = updates

        if len(rows) < PAGE_SIZE or (page - 1) * PAGE_SIZE >= total:
            break

        params["page"] = page
        data = _screener_get(params, headers)
        if data is None:
            print(f"  {universe} Page {page} : abandon (échec persistant) — {len(result)} matchés conservés", flush=True)
            break
        rows = data.get("rows", [])
        if page % 10 == 0:
            pct = min((page - 1) * PAGE_SIZE, total)
            print(f"  {universe} Page {page} : ~{pct}/{total} ({len(result)} matchés)", flush=True)
        page += 1
        time.sleep(0.15)

    return result


def run(apply: bool, limit: int | None, types_filter: list[str]) -> None:
    print("=" * 68)
    print("  MS EMEA Combo Enricher — TER / AUM / SRI / Perf (1 scan)")
    print("=" * 68)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Types : {','.join(types_filter)}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Charger les fonds cibles (manque au moins 1 champ)
    print("  Chargement des ISINs cibles...", flush=True)
    target_funds: list[dict] = []
    offset = 0
    while True:
        q = client.table("investissement_funds") \
            .select("isin,ter,aum_eur,sri,performance_1y,performance_3y,performance_5y,inception_date") \
            .in_("product_type", types_filter) \
            .or_("ter.is.null,aum_eur.is.null,sri.is.null,performance_1y.is.null,performance_3y.is.null,performance_5y.is.null") \
            .range(offset, offset + 999)
        batch = q.execute().data or []
        target_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    target = {f["isin"]: f for f in target_funds}
    print(f"  {len(target)} fonds cibles (champ manquant)")

    # Auth EMEA
    print("  Auth Morningstar EMEA...", flush=True)
    token = get_token()
    print("  Token OK")

    # Scan des univers
    emea_data: dict[str, dict] = {}
    remaining = set(target.keys())
    for universe in UNIVERSES:
        if not remaining:
            break
        print(f"\n  Screener {universe} ({len(remaining)} ISINs restants)...", flush=True)
        found = fetch_universe(token, universe, remaining)
        emea_data.update(found)
        remaining -= set(found.keys())
        print(f"  → {len(found)} matchés dans {universe}, {len(remaining)} restants", flush=True)

    print(f"\n  {len(emea_data)} ISINs avec données EMEA au total")

    # Filtrer : ne mettre à jour que les champs vraiment NULL en DB
    to_update: list[dict] = []
    counters = {k: 0 for k in ["ter", "aum_eur", "sri", "performance_1y", "performance_3y", "performance_5y", "inception_date"]}

    for isin, new_data in emea_data.items():
        db_row = target.get(isin, {})
        changes: dict = {}

        if db_row.get("ter") is None and "ter" in new_data:
            changes["ter"]             = new_data["ter"]
            changes["ongoing_charges"] = new_data["ongoing_charges"]
            counters["ter"] += 1
        if db_row.get("aum_eur") is None and "aum_eur" in new_data:
            changes["aum_eur"] = new_data["aum_eur"]
            counters["aum_eur"] += 1
        if db_row.get("sri") is None and "sri" in new_data:
            changes["sri"] = new_data["sri"]
            counters["sri"] += 1
        for pf in ["performance_1y", "performance_3y", "performance_5y"]:
            if db_row.get(pf) is None and pf in new_data:
                changes[pf] = new_data[pf]
                counters[pf] += 1
        if db_row.get("inception_date") is None and "inception_date_emea" in new_data:
            changes["inception_date"] = new_data["inception_date_emea"]
            counters["inception_date"] += 1

        if changes:
            to_update.append({"isin": isin, **changes})

    if limit:
        to_update = to_update[:limit]

    print(f"\n  {len(to_update)} fonds à enrichir :")
    for field, cnt in counters.items():
        if cnt > 0:
            print(f"    {field:<20}: {cnt}")

    if not apply:
        print("\n  [DRY-RUN] Pas d'écriture. Ajouter --apply pour persister.")
        return

    print("\n  Application en base...", flush=True)
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i, row in enumerate(to_update, 1):
        isin = row["isin"]
        changes = {k: v for k, v in row.items() if k != "isin"}
        try:
            client.table("investissement_funds") \
                .update({**changes, "updated_at": now}) \
                .eq("isin", isin) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ✗ {isin}: {e}", flush=True)
        if i % 500 == 0 or i == len(to_update):
            pct = i / len(to_update) * 100
            print(f"    [{i:6d}/{len(to_update)}] {pct:.0f}%  ✓{ok}  ✗{fail}", flush=True)

    print(f"\n  → {ok} fonds enrichis, {fail} erreurs")
    log_run("ms-emea-combo-enricher", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Enrichissement EMEA combiné — TER, AUM, SRI, Perf en un seul scan",
    )
    parser.add_argument("--apply",  action="store_true",  help="Écrire en base (sinon dry-run)")
    parser.add_argument("--limit",  type=int,             help="Limiter à N mises à jour")
    parser.add_argument("--type",   type=str, default="opcvm,etf",
                        help="Types cibles (défaut: opcvm,etf)")
    args = parser.parse_args()
    types_filter = [t.strip() for t in args.type.split(",") if t.strip()]
    run(apply=args.apply, limit=args.limit, types_filter=types_filter)
