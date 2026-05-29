#!/usr/bin/env python3
"""
populate-holdings-morningstar.py — Composition des fonds via Morningstar
=========================================================================
Récupère pour chaque fonds :
  - Top 10 positions (investissement_fund_holdings)
  - Répartition sectorielle GICS (investissement_fund_sectors)
  - Répartition géographique (investissement_fund_geos)

Source : API lt.morningstar.com (même endpoint que morningstar-lt-enricher)
  https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{ms_id}
  ?viewId=portfolio&locale=fr-FR&currencyId=EUR&responseViewFormat=json

Cible : fonds avec morningstar_rating (= MS ID résolvable) sans holdings en base.

Usage :
    python3 scripts/scrapers/populate-holdings-morningstar.py
    python3 scripts/scrapers/populate-holdings-morningstar.py --apply
    python3 scripts/scrapers/populate-holdings-morningstar.py --apply --limit 200
    python3 scripts/scrapers/populate-holdings-morningstar.py --apply --isin LU0360483669
"""

import sys
import re
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

from urllib.parse import urlencode
from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

WORKERS        = 1      # 1 seul worker pour éviter blocage IP Morningstar
RATE_LIMIT_SEC = 2.0    # plus prudent pour ce endpoint

SEARCH_URL  = "https://www.morningstar.fr/fr/util/SecuritySearch.ashx"
DETAILS_URL = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{ms_id}"

# ─── Mapping secteurs Morningstar → labels français ───────────────────────────

SECTOR_MAP = {
    "basicMaterials":       "Matériaux de base",
    "consumerCyclical":     "Consommation cyclique",
    "financialServices":    "Services financiers",
    "realestate":           "Immobilier",
    "consumerDefensive":    "Consommation défensive",
    "healthcare":           "Santé",
    "utilities":            "Services aux collectivités",
    "communicationServices":"Services de communication",
    "energy":               "Énergie",
    "industrials":          "Industrie",
    "technology":           "Technologie",
}

# ─── Mapping régions Morningstar → labels / codes ISO ─────────────────────────

GEO_MAP = {
    "northAmerica":      ("Amérique du Nord",     "NA"),
    "unitedKingdom":     ("Royaume-Uni",           "GB"),
    "europeDeveloped":   ("Europe développée",     "EU"),
    "europeEmerging":    ("Europe émergente",      "EE"),
    "africaMiddleEast":  ("Afrique / Moyen-Orient","AME"),
    "japan":             ("Japon",                 "JP"),
    "australasia":       ("Australasie",           "AU"),
    "asiaDeveloped":     ("Asie développée",       "ASD"),
    "asiaEmerging":      ("Asie émergente",        "ASE"),
    "latinAmerica":      ("Amérique latine",       "LA"),
}


def search_ms_id(session: FetcherSession, isin: str) -> str | None:
    try:
        params = {"q": isin, "limit": "1", "language": "fr-FR"}
        page = session.get(SEARCH_URL, params=params, timeout=8, stealthy_headers=True)
        text = page.text if hasattr(page, "text") else str(page)
        m = re.search(r'"i"\s*:\s*"(F\d+)"', text)
        if m:
            return m.group(1)
        m = re.search(r'"pi"\s*:\s*"(F\d+)"', text)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None


def fetch_portfolio(session: FetcherSession, ms_id: str) -> dict | None:
    """Appelle l'API Morningstar avec viewId=portfolio."""
    url = DETAILS_URL.format(ms_id=ms_id)
    params = {
        "viewId":              "portfolio",
        "locale":              "fr-FR",
        "languageId":          "fr-FR",
        "currencyId":          "EUR",
        "responseViewFormat":  "json",
    }
    try:
        page = session.get(url, params=params, timeout=15, stealthy_headers=True)
        text = page.text if hasattr(page, "text") else str(page)
        if not text or text.startswith("<"):
            return None
        return json.loads(text)
    except Exception:
        return None


def parse_holdings(data: dict) -> list[dict]:
    """Extrait le top 10 des positions depuis la réponse portfolio Morningstar."""
    results = []

    # Plusieurs chemins possibles dans la réponse JSON
    holding_lists = []
    for key in ("portfolioHoldings", "topHoldings", "TopHoldings"):
        obj = data.get(key)
        if isinstance(obj, dict):
            for sub_key in ("holdings", "list", "topHoldingList", "Top10Holdings"):
                lst = obj.get(sub_key)
                if isinstance(lst, list):
                    holding_lists.append(lst)
                    break
        elif isinstance(obj, list):
            holding_lists.append(obj)

    if not holding_lists:
        # Chercher récursivement dans un seul niveau de profondeur
        for key, val in data.items():
            if isinstance(val, dict):
                for sk, sv in val.items():
                    if isinstance(sv, list) and sv and "weighting" in str(sv[0]):
                        holding_lists.append(sv)
                        break

    raw = holding_lists[0] if holding_lists else []

    for i, h in enumerate(raw[:10], start=1):
        if not isinstance(h, dict):
            continue
        name = (
            h.get("securityName") or h.get("holdingName") or h.get("name") or ""
        ).strip()
        if not name:
            continue

        weight_raw = h.get("weighting") or h.get("weight") or h.get("portfolioWeight") or 0
        try:
            weight = float(weight_raw) / 100  # Morningstar donne en %
        except (ValueError, TypeError):
            weight = 0.0

        if weight <= 0:
            continue

        results.append({
            "rank":          i,
            "position_name": name[:200],
            "ticker":        (h.get("ticker") or h.get("isin") or "")[:20] or None,
            "asset_type":    h.get("assetType") or h.get("type") or None,
            "sector":        h.get("sector") or h.get("sectorName") or None,
            "country":       h.get("country") or h.get("countryCode") or None,
            "weight":        round(weight, 6),
            "source":        "morningstar",
        })

    return results


def parse_sectors(data: dict) -> list[dict]:
    """Extrait la répartition sectorielle."""
    results = []

    sector_data = None
    for key in ("equitySectors", "stockSectorBreakdown", "SectorBreakdown",
                "equityBreakdown", "assetAllocationByAssetClass"):
        sd = data.get(key)
        if isinstance(sd, dict) and sd:
            sector_data = sd
            break
        if isinstance(sd, list) and sd:
            # Liste de {name, value}
            for item in sd:
                if not isinstance(item, dict):
                    continue
                name = item.get("name") or item.get("sectorName") or ""
                val  = item.get("value") or item.get("weighting") or 0
                try:
                    w = float(val) / 100
                    if w > 0:
                        results.append({
                            "sector_name": SECTOR_MAP.get(name, name),
                            "weight":      round(w, 6),
                            "source":      "morningstar",
                        })
                except (ValueError, TypeError):
                    pass
            return results[:15]

    if sector_data:
        for ms_key, label in SECTOR_MAP.items():
            val = sector_data.get(ms_key)
            if val is None:
                continue
            try:
                w = float(val) / 100
                if w > 0:
                    results.append({
                        "sector_name": label,
                        "weight":      round(w, 6),
                        "source":      "morningstar",
                    })
            except (ValueError, TypeError):
                pass

    return results


def parse_geos(data: dict) -> list[dict]:
    """Extrait la répartition géographique."""
    results = []

    geo_data = None
    for key in ("equityRegion", "equityGeography", "regionalAllocation",
                "RegionalExposure", "geographicBreakdown"):
        gd = data.get(key)
        if isinstance(gd, dict) and gd:
            geo_data = gd
            break
        if isinstance(gd, list) and gd:
            for item in gd:
                if not isinstance(item, dict):
                    continue
                code  = item.get("countryCode") or item.get("code") or ""
                label = item.get("countryName") or item.get("name") or code
                val   = item.get("value") or item.get("weighting") or 0
                try:
                    w = float(val) / 100
                    if w > 0 and code:
                        results.append({
                            "country_code":  code[:10],
                            "country_label": label[:100],
                            "weight":        round(w, 6),
                            "source":        "morningstar",
                        })
                except (ValueError, TypeError):
                    pass
            return results[:30]

    if geo_data:
        for ms_key, (label, code) in GEO_MAP.items():
            val = geo_data.get(ms_key)
            if val is None:
                continue
            try:
                w = float(val) / 100
                if w > 0:
                    results.append({
                        "country_code":  code,
                        "country_label": label,
                        "weight":        round(w, 6),
                        "source":        "morningstar",
                    })
            except (ValueError, TypeError):
                pass

    return results


def run(apply: bool, limit: int | None, single_isin: str | None) -> None:
    client  = get_client()
    session = FetcherSession()
    now     = datetime.now(timezone.utc)
    stats   = Counter()

    # Sélection des fonds avec MS rating (= MS ID probable) sans holdings
    existing_isins = set(
        r["isin"]
        for r in client.table("investissement_fund_holdings")
        .select("isin")
        .execute().data or []
    )

    if single_isin:
        funds = client.table("investissement_funds").select(
            "isin, name"
        ).eq("isin", single_isin).execute().data or []
    else:
        q = (
            client.table("investissement_funds")
            .select("isin, name")
            .not_.is_("morningstar_rating", "null")
            .in_("product_type", ["opcvm", "etf", "fcp", "sicav"])
            .order("aum_eur", desc=True, nulls_first=False)
        )
        if limit:
            q = q.limit(limit * 3)  # on en prend plus car certains n'ont pas de MS ID
        funds = [f for f in (q.execute().data or []) if f["isin"] not in existing_isins]
        if limit:
            funds = funds[:limit]

    print(f"  {len(funds)} fonds cibles (avec MS rating, sans holdings en base)")

    for i, fund in enumerate(funds):
        isin = fund["isin"]
        name = fund["name"] or isin

        if i > 0 and i % 25 == 0:
            pct = i * 100 // len(funds)
            print(f"  [{pct}%] {i}/{len(funds)} — ok:{stats['ok']} "
                  f"no_id:{stats['no_ms_id']} no_data:{stats['no_portfolio']}")

        time.sleep(RATE_LIMIT_SEC)

        # 1. Trouver le MS ID
        ms_id = search_ms_id(session, isin)
        if not ms_id:
            stats["no_ms_id"] += 1
            continue

        time.sleep(RATE_LIMIT_SEC)

        # 2. Récupérer le portfolio
        data = fetch_portfolio(session, ms_id)
        if not data:
            stats["no_portfolio"] += 1
            continue

        holdings = parse_holdings(data)
        sectors  = parse_sectors(data)
        geos     = parse_geos(data)

        if not holdings and not sectors and not geos:
            stats["no_data"] += 1
            continue

        stats["ok"] += 1
        label = f"{isin} ({name[:40]})"
        print(f"    ✓ {label} — {len(holdings)} positions, "
              f"{len(sectors)} secteurs, {len(geos)} régions")

        if apply:
            if holdings:
                rows = [{"isin": isin, **h, "updated_at": now.isoformat()}
                        for h in holdings]
                client.table("investissement_fund_holdings").delete().eq("isin", isin).execute()
                client.table("investissement_fund_holdings").insert(rows).execute()

            if sectors:
                rows = [{"isin": isin, **s, "updated_at": now.isoformat()}
                        for s in sectors]
                client.table("investissement_fund_sectors").delete().eq("isin", isin).execute()
                client.table("investissement_fund_sectors").insert(rows).execute()

            if geos:
                rows = [{"isin": isin, **g, "updated_at": now.isoformat()}
                        for g in geos]
                client.table("investissement_fund_geos").delete().eq("isin", isin).execute()
                client.table("investissement_fund_geos").insert(rows).execute()

    print(f"\n  Résumé holdings Morningstar :")
    print(f"    ✓ Enrichis avec données    : {stats['ok']}")
    print(f"    ✗ Sans MS ID               : {stats['no_ms_id']}")
    print(f"    ✗ Sans données portfolio   : {stats['no_portfolio']}")
    print(f"    ✗ Données vides            : {stats['no_data']}")
    if not apply:
        print("\n  ⚠  Mode dry-run — relancer avec --apply pour persister")

    log_run(client, "populate-holdings-morningstar", len(funds), stats["ok"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply",  action="store_true")
    ap.add_argument("--limit",  type=int)
    ap.add_argument("--isin",   type=str)
    args = ap.parse_args()
    run(apply=args.apply, limit=args.limit, single_isin=args.isin)


if __name__ == "__main__":
    main()
