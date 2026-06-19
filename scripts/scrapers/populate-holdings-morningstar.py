#!/usr/bin/env python3
"""
populate-holdings-morningstar.py — Composition des OPCVM via Morningstar EMEA
=============================================================================
Comble la VENTILATION (géo / secteur / top holdings) des OPCVM qui n'en ont
aucune, via l'API authentifiée Morningstar EMEA — la MÊME que les autres
enrichers ms-emea-* (perf / SRI / TER) déjà câblés en CI. Source statique HTTP
(pas de navigateur), compatible GitHub Actions.

Tables alimentées (FILL-ONLY STRICT, source = 'morningstar') :
  - investissement_fund_geos      (répartition géographique, % → fraction)
  - investissement_fund_sectors   (répartition sectorielle GICS)
  - investissement_fund_holdings  (top positions)

N'écrit JAMAIS dans investissement_funds. Ne traite QUE les fonds SANS géo en
base (ne réécrit pas une ventilation déjà sourcée — FT, émetteur, JustETF…).

Gisement : ~7 100 OPCVM ont un morningstar_rating (donc résolvables côté
Morningstar) mais aucune ventilation. Priorité AUM décroissant : on remplit
d'abord les fonds les plus consultés / référencés.

Pipeline (par fonds) :
  1. Résolution ISIN → secId  via ecint/v1/screener (term=ISIN, universe EMEA).
  2. Récupération de la ventilation via ecint/v1/securities/{secId} (viewId
     portfolio : regions / GICS sectors / holdings). L'API EMEA renvoie du JSON.
  3. Écriture fill-only delete+insert par ISIN sur les 3 tables (idempotent).

⚠️  Identifiants requis : MS_EMEA_USER / MS_EMEA_PASS (secrets repo, comme les
    autres ms-emea-*). Sans eux, le script s'arrête proprement (exit 0, aucun
    write) — il ne casse jamais le pipeline.

⚠️  NOMS DE DATAPOINTS À VALIDER EN LIVE : l'API consommateur publique
    (lt.morningstar.com ?viewId=portfolio) est MORTE (renvoie {dbgtime} seul,
    juin 2026) et le site EMEA est derrière un WAF AWS. Cette réécriture passe
    par l'API ecint authentifiée. Les clés exactes de ventilation (champs
    region*/sector*/holdings du viewId portfolio) peuvent varier selon
    l'entitlement du compte : les parseurs ci-dessous essaient plusieurs chemins
    et comptent `no_data` sans écrire si rien n'est exploitable. Lancer d'abord
    avec --probe sur 2-3 ISIN pour figer le format avant le run de masse.

Usage :
    # Sonde le format réel de l'API pour quelques ISIN (n'écrit pas) :
    python3 scripts/scrapers/populate-holdings-morningstar.py --probe --isin LU0328684104

    # Dry-run priorisé AUM :
    python3 scripts/scrapers/populate-holdings-morningstar.py --limit 20

    # Run réel, fill-only, priorité AUM, batchable :
    python3 scripts/scrapers/populate-holdings-morningstar.py --apply --limit 500
    python3 scripts/scrapers/populate-holdings-morningstar.py --apply --limit 500 --offset 500
"""

import os
import sys
import time
import json
import base64
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config API EMEA (même socle que ms-emea-perf-enricher) ───────────────────

OAUTH_URL   = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER    = "https://www.emea-api.morningstar.com/ecint/v1/screener"
DETAILS_URL = "https://www.emea-api.morningstar.com/ecint/v1/securities/{sec_id}"
UNIVERSES   = ["FOFRA$$ALL", "FEEUR$$ALL"]   # FR + Europe (couvre LU/IE)

RATE_LIMIT_SEC = 0.25     # API authentifiée : pas de blocage IP comme le site public
SOURCE         = "morningstar"

# ─── Mapping secteurs GICS Morningstar → labels français ──────────────────────
# Clés normalisées (minuscule) ; on accepte plusieurs casings côté parse.

SECTOR_MAP = {
    "basicmaterials":        "Matériaux de base",
    "consumercyclical":      "Consommation cyclique",
    "financialservices":     "Services financiers",
    "realestate":            "Immobilier",
    "consumerdefensive":     "Consommation défensive",
    "healthcare":            "Santé",
    "utilities":             "Services aux collectivités",
    "communicationservices": "Services de communication",
    "energy":                "Énergie",
    "industrials":           "Industrie",
    "technology":            "Technologie",
}

# ─── Mapping régions Morningstar → labels / codes ─────────────────────────────

GEO_MAP = {
    "northamerica":     ("Amérique du Nord",      "NA"),
    "unitedstates":     ("États-Unis",            "US"),
    "canada":           ("Canada",                "CA"),
    "unitedkingdom":    ("Royaume-Uni",           "GB"),
    "europedeveloped":  ("Europe développée",     "EU"),
    "eurozone":         ("Zone euro",             "EZ"),
    "europeexeuro":     ("Europe hors euro",      "EXE"),
    "europeemerging":   ("Europe émergente",      "EE"),
    "africa":           ("Afrique",               "AF"),
    "middleeast":       ("Moyen-Orient",          "ME"),
    "africamiddleeast": ("Afrique / Moyen-Orient", "AME"),
    "japan":            ("Japon",                 "JP"),
    "australasia":      ("Australasie",           "AU"),
    "asiadeveloped":    ("Asie développée",       "ASD"),
    "asiaemerging":     ("Asie émergente",        "ASE"),
    "latinamerica":     ("Amérique latine",       "LA"),
}


# ─── Auth ─────────────────────────────────────────────────────────────────────

def _creds_b64() -> str:
    user = os.environ.get("MS_EMEA_USER", "").strip()
    pwd  = os.environ.get("MS_EMEA_PASS", "").strip()
    if not user or not pwd:
        raise EnvironmentError(
            "MS_EMEA_USER et MS_EMEA_PASS sont requis (secrets repo / variables "
            "d'environnement). Exportez-les pour un lancement local.")
    return base64.b64encode(f"{user}:{pwd}".encode()).decode()


def get_token() -> str:
    r = requests.post(
        OAUTH_URL,
        headers={"Authorization": f"Basic {_creds_b64()}", "Accept": "application/json"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _api_get(url: str, params: dict, token: str, retries: int = 4) -> dict | None:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Referer": "https://www.linxea.com/",
    }
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(2 ** attempt)
    return None


# ─── Résolution secId ─────────────────────────────────────────────────────────

def resolve_sec_id(isin: str, token: str) -> str | None:
    """ISIN → Morningstar secId via le screener EMEA (term=ISIN)."""
    for universe in UNIVERSES:
        data = _api_get(SCREENER, {
            "languageId": "fr-FR", "currencyId": "EUR",
            "universeIds": universe, "outputType": "json",
            "securityDataPoints": "SecId|ISIN|Name",
            "term": isin, "pageSize": 1, "page": 1,
        }, token)
        for row in (data or {}).get("rows", []):
            sec = row.get("SecId") or row.get("secId")
            if sec:
                return sec
    return None


def fetch_portfolio(sec_id: str, token: str) -> dict | None:
    """Détail portfolio EMEA (viewId portfolio). Renvoie le JSON brut ou None."""
    data = _api_get(DETAILS_URL.format(sec_id=sec_id), {
        "viewId": "portfolio",
        "languageId": "fr-FR", "currencyId": "EUR", "outputType": "json",
    }, token)
    return data


# ─── Parseurs (tolérants à plusieurs chemins / casings) ───────────────────────

def _walk_lists(obj, predicate, _depth=0):
    """Cherche récursivement (≤4 niveaux) la 1re liste de dicts validant predicate."""
    if _depth > 4:
        return None
    if isinstance(obj, list):
        if obj and isinstance(obj[0], dict) and predicate(obj[0]):
            return obj
        for it in obj:
            r = _walk_lists(it, predicate, _depth + 1)
            if r:
                return r
    elif isinstance(obj, dict):
        for v in obj.values():
            r = _walk_lists(v, predicate, _depth + 1)
            if r:
                return r
    return None


def _to_frac(val) -> float | None:
    """% Morningstar → fraction (0-1). Tolère str avec virgule."""
    try:
        f = float(str(val).replace(",", "."))
    except (ValueError, TypeError):
        return None
    if f <= 0:
        return None
    return round(f / 100, 6)


def parse_geos(data: dict) -> list[dict]:
    results: list[dict] = []
    # Chemin A : dict plat region* → valeur (ex. RegionalExposure / equityRegion)
    for key in ("equityRegion", "regionalExposure", "RegionalExposure",
                "geographicBreakdown", "countryExposure"):
        gd = data.get(key)
        if isinstance(gd, dict) and gd:
            for raw_k, val in gd.items():
                norm = raw_k.lower().replace("region", "").replace("_", "")
                if norm in GEO_MAP:
                    frac = _to_frac(val)
                    if frac:
                        label, code = GEO_MAP[norm]
                        results.append({"country_code": code, "country_label": label,
                                        "weight": frac, "source": SOURCE})
            if results:
                return results
    # Chemin B : liste [{name/code, value}]
    lst = _walk_lists(data, lambda d: any(k in d for k in ("countryCode", "name", "type"))
                      and any(k in d for k in ("value", "weighting", "percent")))
    if lst:
        for it in lst:
            name = (it.get("name") or it.get("countryName") or it.get("type") or "").strip()
            code = (it.get("countryCode") or it.get("code") or "")[:10]
            val  = it.get("value") or it.get("weighting") or it.get("percent")
            frac = _to_frac(val)
            if frac and (name or code):
                norm = name.lower().replace(" ", "").replace("-", "")
                if norm in GEO_MAP:
                    label, mapped_code = GEO_MAP[norm]
                else:
                    label, mapped_code = (name or code), (code or "XX")
                results.append({"country_code": mapped_code, "country_label": label[:100],
                                "weight": frac, "source": SOURCE})
    return results


def parse_sectors(data: dict) -> list[dict]:
    results: list[dict] = []
    for key in ("equitySectors", "globalStockSector", "GlobalStockSector",
                "stockSectorBreakdown", "sectorBreakdown"):
        sd = data.get(key)
        if isinstance(sd, dict) and sd:
            for raw_k, val in sd.items():
                norm = raw_k.lower().replace("sector", "").replace("_", "")
                if norm in SECTOR_MAP:
                    frac = _to_frac(val)
                    if frac:
                        results.append({"sector_name": SECTOR_MAP[norm],
                                        "weight": frac, "source": SOURCE})
            if results:
                return results
    lst = _walk_lists(data, lambda d: any(k in d for k in ("name", "sectorName", "type"))
                      and any(k in d for k in ("value", "weighting", "percent")))
    if lst:
        for it in lst:
            name = (it.get("name") or it.get("sectorName") or it.get("type") or "").strip()
            val  = it.get("value") or it.get("weighting") or it.get("percent")
            frac = _to_frac(val)
            if frac and name:
                label = SECTOR_MAP.get(name.lower().replace(" ", ""), name)
                results.append({"sector_name": label[:100], "weight": frac, "source": SOURCE})
    return results[:15]


def parse_holdings(data: dict) -> list[dict]:
    results: list[dict] = []
    lst = _walk_lists(
        data,
        lambda d: any(k in d for k in ("securityName", "holdingName", "name"))
        and any(k in d for k in ("weighting", "weight", "portfolioWeight")),
    )
    for i, h in enumerate(lst or [], start=1):
        name = (h.get("securityName") or h.get("holdingName") or h.get("name") or "").strip()
        if not name:
            continue
        frac = _to_frac(h.get("weighting") or h.get("weight") or h.get("portfolioWeight"))
        if not frac:
            continue
        results.append({
            "rank": len(results) + 1,
            "position_name": name[:200],
            "ticker": ((h.get("ticker") or h.get("isin") or "") or None) and
                      str(h.get("ticker") or h.get("isin"))[:20],
            "asset_type": (h.get("assetType") or h.get("type") or None),
            "sector": (h.get("sector") or h.get("sectorName") or None),
            "country": (h.get("country") or h.get("countryCode") or None),
            "weight": frac,
            "source": SOURCE,
        })
        if len(results) >= 10:
            break
    return results


# ─── Sélection des cibles (fill-only, priorité AUM) ───────────────────────────

def _isins_with_geo(client) -> set[str]:
    """ISIN ayant DÉJÀ une ventilation géo (peu importe la source) → exclus."""
    have: set[str] = set()
    after = ""
    while True:
        rows = (client.table("investissement_fund_geos")
                .select("isin").gt("isin", after).order("isin").limit(1000)
                .execute().data or [])
        if not rows:
            break
        have.update(r["isin"] for r in rows)
        if len(rows) < 1000:
            break
        after = rows[-1]["isin"]
    return have


def select_targets(client, limit: int | None, offset: int) -> list[dict]:
    """OPCVM/ETF avec morningstar_rating, SANS géo, triés AUM décroissant."""
    have_geo = _isins_with_geo(client)
    out: list[dict] = []
    page = 1000
    db_offset = 0
    while True:
        rows = (client.table("investissement_funds")
                .select("isin, name, aum_eur")
                .not_.is_("morningstar_rating", "null")
                .in_("product_type", ["opcvm", "etf", "fcp", "sicav"])
                .order("aum_eur", desc=True, nullsfirst=False)
                .range(db_offset, db_offset + page - 1)
                .execute().data or [])
        if not rows:
            break
        for r in rows:
            if r["isin"] not in have_geo:
                out.append(r)
        if len(rows) < page:
            break
        db_offset += page
        # Sur-récupère pour appliquer offset+limit après filtrage géo.
        if limit and len(out) >= offset + limit + page:
            break
    sliced = out[offset:]
    if limit:
        sliced = sliced[:limit]
    return sliced


# ─── Écriture fill-only (idempotente) ─────────────────────────────────────────

def write_breakdowns(client, isin: str, geos, sectors, holdings, now_iso: str) -> None:
    if geos:
        rows = [{"isin": isin, **g, "updated_at": now_iso} for g in geos]
        client.table("investissement_fund_geos").delete().eq("isin", isin).execute()
        client.table("investissement_fund_geos").insert(rows).execute()
    if sectors:
        rows = [{"isin": isin, **s, "updated_at": now_iso} for s in sectors]
        client.table("investissement_fund_sectors").delete().eq("isin", isin).execute()
        client.table("investissement_fund_sectors").insert(rows).execute()
    if holdings:
        rows = [{"isin": isin, **h, "updated_at": now_iso} for h in holdings]
        client.table("investissement_fund_holdings").delete().eq("isin", isin).execute()
        client.table("investissement_fund_holdings").insert(rows).execute()


# ─── Run ──────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, offset: int,
        single_isin: str | None, probe: bool) -> None:
    print("=" * 60)
    print("  Populate Holdings — Morningstar EMEA (fill-only, priorité AUM)")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}"
          f"{'  [PROBE: dump JSON brut]' if probe else ''}")

    started = datetime.now(timezone.utc)
    client  = get_client()
    now_iso = started.isoformat()
    stats   = Counter()

    print("  Auth Morningstar EMEA...", flush=True)
    try:
        token = get_token()
    except EnvironmentError as e:
        print(f"  ⚠️  {e}")
        print("  → Aucun identifiant : arrêt propre (exit 0, aucune écriture).")
        return

    if single_isin:
        funds = [{"isin": single_isin, "name": single_isin, "aum_eur": None}]
    else:
        funds = select_targets(client, limit, offset)

    print(f"  {len(funds)} fonds cibles (MS rating, sans géo, AUM desc, "
          f"offset {offset})", flush=True)

    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        name = (fund.get("name") or isin)[:40]
        time.sleep(RATE_LIMIT_SEC)

        sec_id = resolve_sec_id(isin, token)
        if not sec_id:
            stats["no_sec_id"] += 1
            continue

        time.sleep(RATE_LIMIT_SEC)
        data = fetch_portfolio(sec_id, token)

        if probe:
            print(f"\n=== {isin} / secId={sec_id} ===")
            if data is None:
                print("  (aucune réponse / 404)")
            else:
                top = data[0] if isinstance(data, list) and data else data
                print("  TOP-LEVEL KEYS:",
                      sorted(top.keys()) if isinstance(top, dict) else type(top))
                print(json.dumps(top, ensure_ascii=False, indent=1)[:2000])
            continue

        if data is None:
            stats["no_portfolio"] += 1
            continue

        top = data[0] if isinstance(data, list) and data else data
        if not isinstance(top, dict):
            stats["no_data"] += 1
            continue

        geos     = parse_geos(top)
        sectors  = parse_sectors(top)
        holdings = parse_holdings(top)

        if not (geos or sectors or holdings):
            stats["no_data"] += 1
            continue

        stats["ok"] += 1
        geo_sum = round(sum(g["weight"] for g in geos) * 100, 1)
        if i <= 30 or i % 50 == 0:
            print(f"  ✓ {isin} ({name}) — {len(holdings)} pos, "
                  f"{len(sectors)} sect, {len(geos)} géo (Σ {geo_sum}%)", flush=True)

        if apply:
            try:
                write_breakdowns(client, isin, geos, sectors, holdings, now_iso)
            except Exception as e:
                stats["write_err"] += 1
                if stats["write_err"] <= 3:
                    print(f"  ✗ write({isin}) : {e}", flush=True)

    print(f"\n  Résumé :")
    print(f"    ✓ ventilés          : {stats['ok']}")
    print(f"    ✗ sans secId        : {stats['no_sec_id']}")
    print(f"    ✗ sans portfolio    : {stats['no_portfolio']}")
    print(f"    ✗ données vides     : {stats['no_data']}")
    if stats["write_err"]:
        print(f"    ✗ erreurs écriture  : {stats['write_err']}")
    if not apply and not probe:
        print("\n  ⚠  Dry-run — relancer avec --apply pour persister.")

    if apply:
        log_run("populate-holdings-morningstar", "success",
                stats["ok"], stats["no_sec_id"] + stats["no_portfolio"] + stats["no_data"],
                started_at=started)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit",  type=int, help="Limiter à N fonds (après filtrage géo)")
    ap.add_argument("--offset", type=int, default=0, help="Décalage dans la liste priorisée AUM")
    ap.add_argument("--isin",   type=str, help="Un seul ISIN (test)")
    ap.add_argument("--probe",  action="store_true",
                    help="Dump le JSON brut de l'API (figer le format avant le run de masse)")
    args = ap.parse_args()
    run(apply=args.apply, limit=args.limit, offset=args.offset,
        single_isin=args.isin, probe=args.probe)


if __name__ == "__main__":
    main()
