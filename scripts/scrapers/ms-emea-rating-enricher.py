#!/usr/bin/env python3
"""
ms-emea-rating-enricher.py — Note étoiles Morningstar (+ vol/sharpe) via EMEA
=============================================================================
Un seul scan des univers EMEA (FOFRA$$ALL + FEEUR$$ALL) pour combler :
  - morningstar_rating   (StarRatingM255, entier 1-5)  ← objectif principal
  - volatility_1y / _3y  (StandardDeviationM12/M36)     ← bonus même requête
  - sharpe_1y / _3y      (SharpeM12/M36)                ← bonus même requête

FILL-ONLY strict : n'écrit un champ que s'il est NULL en base.
Même socle OAuth/screener que ms-emea-combo-enricher.py (creds Linxea).

Usage :
    python3 scripts/scrapers/ms-emea-rating-enricher.py [--apply] [--limit N]
    python3 scripts/scrapers/ms-emea-rating-enricher.py --apply --type opcvm
    python3 scripts/scrapers/ms-emea-rating-enricher.py --apply --rating-only
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

DATA_POINTS = "ISIN|StarRatingM255|StandardDeviationM12|StandardDeviationM36|SharpeM12|SharpeM36"


def get_token() -> str:
    r = requests.post(
        OAUTH_URL,
        headers={"Authorization": f"Basic {_CREDS}", "Accept": "application/json"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _screener_get(params: dict, headers: dict, retries: int = 5):
    """GET screener résilient : retry sur 5xx/429/erreurs réseau (backoff exp.)."""
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


def _safe_float(v, lo: float, hi: float):
    if v is None:
        return None
    try:
        f = float(str(v).replace(",", "."))
        return f if lo < f < hi else None
    except (ValueError, TypeError):
        return None


def fetch_universe(token: str, universe: str, target: set[str]) -> dict[str, dict]:
    """Scan complet d'un universe, retourne {isin: {champs}} pour ISINs cibles."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept":        "application/json",
        "Referer":       "https://www.linxea.com/",
    }
    params = {
        "languageId":        "fr-FR",
        "currencyId":        "EUR",
        "universeIds":       universe,
        "outputType":        "json",
        "securityDataPoints": DATA_POINTS,
        "filters":           "",
        "pageSize":          PAGE_SIZE,
        "page":              1,
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

            # Note étoiles (1-5)
            sr = row.get("StarRatingM255")
            if sr is not None:
                try:
                    v = int(float(sr))
                    if 1 <= v <= 5:
                        updates["morningstar_rating"] = v
                except (ValueError, TypeError):
                    pass

            # Volatilité (écart-type annualisé, %)
            vol1 = _safe_float(row.get("StandardDeviationM12"), 0, 100)
            vol3 = _safe_float(row.get("StandardDeviationM36"), 0, 100)
            if vol1 is not None:
                updates["volatility_1y"] = round(vol1, 6)
            if vol3 is not None:
                updates["volatility_3y"] = round(vol3, 6)

            # Sharpe
            sh1 = _safe_float(row.get("SharpeM12"), -20, 20)
            sh3 = _safe_float(row.get("SharpeM36"), -20, 20)
            if sh1 is not None:
                updates["sharpe_1y"] = round(sh1, 6)
            if sh3 is not None:
                updates["sharpe_3y"] = round(sh3, 6)

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


def run(apply: bool, limit: int | None, types_filter: list[str], rating_only: bool) -> None:
    print("=" * 68)
    print("  MS EMEA Rating Enricher — note étoiles (+ vol/sharpe)")
    print("=" * 68)
    print(f"  Mode        : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Types       : {','.join(types_filter)}")
    print(f"  Rating only : {rating_only}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Charger les fonds cibles (manque au moins 1 des champs visés)
    print("  Chargement des ISINs cibles...", flush=True)
    if rating_only:
        or_clause = "morningstar_rating.is.null"
    else:
        or_clause = "morningstar_rating.is.null,volatility_1y.is.null,volatility_3y.is.null,sharpe_1y.is.null,sharpe_3y.is.null"

    target_funds: list[dict] = []
    offset = 0
    while True:
        q = client.table("investissement_funds") \
            .select("isin,morningstar_rating,volatility_1y,volatility_3y,sharpe_1y,sharpe_3y") \
            .in_("product_type", types_filter) \
            .or_(or_clause) \
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
        # Ne retirer que les ISINs pour qui on a une note (les autres peuvent
        # avoir vol/sharpe dans l'autre univers — mais on rescanne juste ceux
        # totalement absents ; garder simple : retirer ceux matchés)
        remaining -= set(found.keys())
        print(f"  → {len(found)} matchés dans {universe}, {len(remaining)} restants", flush=True)

    print(f"\n  {len(emea_data)} ISINs avec données EMEA au total")

    # Filtrer FILL-ONLY : ne mettre à jour que les champs NULL en DB
    fields = ["morningstar_rating"] if rating_only else \
             ["morningstar_rating", "volatility_1y", "volatility_3y", "sharpe_1y", "sharpe_3y"]
    to_update: list[dict] = []
    counters = {k: 0 for k in fields}

    for isin, new_data in emea_data.items():
        db_row = target.get(isin, {})
        changes: dict = {}
        for f in fields:
            if db_row.get(f) is None and f in new_data:
                changes[f] = new_data[f]
                counters[f] += 1
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
    log_run("ms-emea-rating-enricher", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Note étoiles Morningstar via EMEA")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds écrits")
    parser.add_argument("--type", choices=["opcvm", "etf"], help="Restreindre à un type")
    parser.add_argument("--rating-only", action="store_true",
                        help="Ne combler que morningstar_rating (ignorer vol/sharpe)")
    args = parser.parse_args()
    types = [args.type] if args.type else ["opcvm", "etf"]
    run(apply=args.apply, limit=args.limit, types_filter=types, rating_only=args.rating_only)
