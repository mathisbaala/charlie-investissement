#!/usr/bin/env python3
"""
ms-emea-vol-enricher.py — Volatilité / Sharpe manquants via API Morningstar EMEA
==================================================================================
Cible : OPCVM/ETF sans volatility_1y OU sans sharpe_1y.
Source : API EMEA Morningstar (même OAuth que ms-emea-ter-aum-enricher.py).

Champs extraits :
  StandardDeviationM12 → volatility_1y  (%, annualisée)
  StandardDeviationM36 → volatility_3y  (%, annualisée)
  SharpeM12            → sharpe_1y
  SharpeM36            → sharpe_3y
  GBRReturnM12         → performance_1y (si manquant, %)
  GBRReturnM36         → performance_3y (annualisé → cumul total : ((1+r/100)^3-1)*100)
  GBRReturnM60         → performance_5y (annualisé → cumul total : ((1+r/100)^5-1)*100)

Usage :
    python3 scripts/scrapers/ms-emea-vol-enricher.py              # dry-run
    python3 scripts/scrapers/ms-emea-vol-enricher.py --apply      # écriture en base
    python3 scripts/scrapers/ms-emea-vol-enricher.py --apply --limit 5000
"""

import sys
import time
import argparse
import base64
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

OAUTH_URL  = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER   = "https://www.emea-api.morningstar.com/ecint/v1/screener"
_CREDS     = base64.b64encode(b"ec-Linxe-2022@eamsecservice.com:LinxeB*j91").decode()
PAGE_SIZE  = 2000
UNIVERSES  = ["FOFRA$$ALL", "FEEUR$$ALL"]

DATA_POINTS = (
    "ISIN|StandardDeviationM12|StandardDeviationM36"
    "|SharpeM12|SharpeM36"
    "|GBRReturnM12|GBRReturnM36|GBRReturnM60"
    "|OngoingCharge|FundTNAV|KID_SRI"
)


def get_token() -> str:
    r = requests.post(
        OAUTH_URL,
        headers={"Authorization": f"Basic {_CREDS}", "Accept": "application/json"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _safe_float(v, lo: float = -9999, hi: float = 9999) -> float | None:
    if v is None:
        return None
    try:
        f = float(str(v).replace(",", "."))
        return f if lo < f < hi else None
    except (ValueError, TypeError):
        return None


def _annualized_to_cumul(r_pct: float, years: int) -> float:
    """Convertit rendement annualisé (%) en rendement total cumulé (%)."""
    return round(((1 + r_pct / 100) ** years - 1) * 100, 4)


def fetch_emea_universe(token: str, universe: str, target: set[str]) -> dict[str, dict]:
    """Pagine l'univers EMEA et retourne {isin: updates} pour ISINs cibles."""
    bearer  = f"Bearer {token}"
    headers = {
        "Authorization": bearer,
        "Accept": "application/json",
        "Referer": "https://www.linxea.com/",
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

    r = requests.get(SCREENER, params=params, headers=headers, timeout=45)
    r.raise_for_status()
    data  = r.json()
    total = data.get("total", 0)
    rows  = data.get("rows", [])
    print(f"  {universe} Page 1 : ~{len(rows)}/{total}", flush=True)

    result: dict[str, dict] = {}
    page = 2
    while True:
        for row in rows:
            isin = (row.get("ISIN") or "").strip()
            if isin not in target:
                continue
            u: dict = {"isin": isin}

            vol1  = _safe_float(row.get("StandardDeviationM12"), 0, 100)
            vol3  = _safe_float(row.get("StandardDeviationM36"), 0, 100)
            sh1   = _safe_float(row.get("SharpeM12"), -20, 20)
            sh3   = _safe_float(row.get("SharpeM36"), -20, 20)
            p1    = _safe_float(row.get("GBRReturnM12"), -100, 1000)
            p3ann = _safe_float(row.get("GBRReturnM36"), -100, 1000)
            p5ann = _safe_float(row.get("GBRReturnM60"), -100, 1000)
            oc    = _safe_float(row.get("OngoingCharge"), 0, 20)
            tnav  = row.get("FundTNAV")
            sri   = row.get("KID_SRI")

            if vol1 is not None:  u["volatility_1y"] = round(vol1, 6)
            if vol3 is not None:  u["volatility_3y"] = round(vol3, 6)
            if sh1  is not None:  u["sharpe_1y"]     = round(sh1,  6)
            if sh3  is not None:  u["sharpe_3y"]     = round(sh3,  6)
            if p1   is not None:  u["performance_1y"] = round(p1, 4)
            if p3ann is not None: u["performance_3y"] = _annualized_to_cumul(p3ann, 3)
            if p5ann is not None: u["performance_5y"] = _annualized_to_cumul(p5ann, 5)
            if oc   is not None:
                u["ter"]             = round(oc / 100, 6)
                u["ongoing_charges"] = round(oc / 100, 6)
            if tnav is not None:
                try:
                    u["aum_eur"] = int(float(tnav))
                except (ValueError, TypeError):
                    pass
            if sri is not None:
                try:
                    v = int(float(sri))
                    if 1 <= v <= 7:
                        u["sri"] = v
                except (ValueError, TypeError):
                    pass

            if len(u) > 1:
                result[isin] = u

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
                    print(f"  {universe} Page {page} : {e.response.status_code} — retry {wait}s", flush=True)
                    time.sleep(wait)
                else:
                    raise

        data  = r.json()
        rows  = data.get("rows", [])
        n_done = min((page - 1) * PAGE_SIZE, total)
        if n_done % 20000 < PAGE_SIZE:
            print(f"  {universe} Page {page} : ~{n_done}/{total}", flush=True)
        page += 1

    return result


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  EMEA Vol/Sharpe Enricher")
    print("=" * 60)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite: {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Cibles : OPCVM/ETF sans volatility_1y OU sans sharpe_1y
    target_isins: set[str] = set()
    page_size = 1000
    for null_field in ("volatility_1y", "sharpe_1y"):
        offset = 0
        while True:
            q = (
                client.table("investissement_funds")
                .select("isin")
                .in_("product_type", ["opcvm", "etf", "fcp", "sicav"])
                .is_(null_field, "null")
                .range(offset, offset + page_size - 1)
            )
            rows = (q.execute().data) or []
            for row in rows:
                target_isins.add(row["isin"])
            if len(rows) < page_size:
                break
            offset += page_size
            if limit and len(target_isins) >= limit * 2:
                break

    if limit:
        target_isins = set(list(target_isins)[:limit])

    print(f"  {len(target_isins)} ISINs cibles\n")

    token   = get_token()
    updates: dict[str, dict] = {}

    for universe in UNIVERSES:
        found = fetch_emea_universe(token, universe, target_isins)
        for isin, u in found.items():
            if isin not in updates:
                updates[isin] = u
            else:
                updates[isin].update(u)
        print(f"  → {len(found)} trouvés dans {universe}, {len(target_isins - set(updates))} restants")

    print(f"\n  → {len(updates)} fonds à enrichir")

    enriched = 0
    errors   = 0
    for isin, u in updates.items():
        u["updated_at"] = datetime.now(timezone.utc).isoformat()
        if apply:
            try:
                upsert_fund(u)
                enriched += 1
            except Exception as e:
                errors += 1
                print(f"  ✗ {isin} : {e}")
        else:
            vol = u.get("volatility_1y")
            sh  = u.get("sharpe_1y")
            p1  = u.get("performance_1y")
            print(f"  ~ {isin} | vol={vol} | sharpe={sh} | p1y={p1}")
            enriched += 1

    print(f"\n  → {enriched} fonds enrichis (VOL:{sum(1 for u in updates.values() if 'volatility_1y' in u)}, "
          f"SH:{sum(1 for u in updates.values() if 'sharpe_1y' in u)}), {errors} erreurs\n")

    log_run("ms-emea-vol-enricher", enriched, errors, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="EMEA Vol/Sharpe Enricher")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N ISINs cibles")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
