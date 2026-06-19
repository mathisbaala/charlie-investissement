#!/usr/bin/env python3
"""_ms_sal_probe.py — TEMPORAIRE : sonde l'accès aux ventilations Morningstar.

Verdict itération 1 : sal/sal-service (région/secteur/holdings) → 401 avec notre
token oauth (entitlé ecint seulement). Itération 2 : on teste ce que l'endpoint
ENTITLÉ (ecint screener) peut renvoyer comme datapoints de ventilation, + les
variantes ecint/securities (idtype=isin / responseViewFormat / viewId multiples).

Dump brut, n'écrit rien. À supprimer après validation.
"""
import os, sys, json, base64, requests

OAUTH_URL = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER  = "https://www.emea-api.morningstar.com/ecint/v1/screener"
SECURITIES = "https://www.emea-api.morningstar.com/ecint/v1/securities/{sec}"
UNIVERSES = ["FOFRA$$ALL", "FEEUR$$ALL"]

# Candidats datapoints de ventilation à demander au screener (pipe-séparés).
# Le screener ignore/omet silencieusement les inconnus → on inspecte les clés
# RÉELLEMENT présentes dans la 1re row.
CANDIDATE_DATAPOINTS = [
    "SecId", "ISIN", "Name",
    # régional / géo
    "RegionGlobalStockSector", "EquityRegionDeveloped", "EquityRegionEmerging",
    "PortfolioRegion", "RegionalExposure", "GlobalAssetRegion",
    "AmericasNetAssets", "GreaterEuropeNetAssets", "GreaterAsiaNetAssets",
    "NorthAmericaNetAssets", "UnitedKingdomNetAssets", "JapanNetAssets",
    "AssetAllocEquity", "AssetAllocBond", "AssetAllocCash",
    # secteur
    "GlobalStockSector", "EquitySuperSectorCyclical", "EquitySuperSectorDefensive",
    "EquitySuperSectorSensitive", "BasicMaterials", "Technology", "Healthcare",
    "FinancialServices",
    # holdings
    "Top10Holdings", "NumberOfHoldings", "PortfolioHoldings", "HoldingDetail",
    "Top10HoldingsTotalWeighting", "PortfolioDate",
]

# Variantes securities/{id} à tester (params, viewId).
SEC_VARIANTS = [
    {"viewId": "portfolio", "languageId": "fr-FR", "currencyId": "EUR", "outputType": "json"},
    {"viewId": "snapshot",  "languageId": "fr-FR", "currencyId": "EUR", "outputType": "json"},
    {"viewId": "regionExposure", "outputType": "json"},
    {"viewId": "sectorExposure", "outputType": "json"},
    {"viewId": "Portfolio", "responseViewFormat": "json"},
]


def creds_b64():
    u = os.environ.get("MS_EMEA_USER", "").strip()
    p = os.environ.get("MS_EMEA_PASS", "").strip()
    if not u or not p:
        print("  ⚠️  MS_EMEA_USER/PASS absents — arrêt propre.")
        sys.exit(0)
    return base64.b64encode(f"{u}:{p}".encode()).decode()


def get_token():
    r = requests.post(OAUTH_URL, headers={"Authorization": f"Basic {creds_b64()}",
                                          "Accept": "application/json"}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def H(token):
    return {"Authorization": f"Bearer {token}", "Accept": "application/json",
            "Referer": "https://www.linxea.com/"}


def resolve_sec_id(isin, token):
    for u in UNIVERSES:
        r = requests.get(SCREENER, params={
            "languageId": "fr-FR", "currencyId": "EUR", "universeIds": u,
            "outputType": "json", "securityDataPoints": "SecId|ISIN|Name",
            "term": isin, "pageSize": 1, "page": 1,
        }, headers=H(token), timeout=30)
        if r.status_code != 200:
            continue
        for row in (r.json() or {}).get("rows", []):
            sec = row.get("SecId") or row.get("secId")
            if sec:
                return sec
    return None


def probe_screener_datapoints(isin, token):
    print(f"\n### SCREENER datapoints pour {isin}")
    for u in UNIVERSES:
        r = requests.get(SCREENER, params={
            "languageId": "fr-FR", "currencyId": "EUR", "universeIds": u,
            "outputType": "json",
            "securityDataPoints": "|".join(CANDIDATE_DATAPOINTS),
            "term": isin, "pageSize": 1, "page": 1,
        }, headers=H(token), timeout=30)
        print(f"  [{u}] HTTP {r.status_code}")
        if r.status_code != 200:
            print(f"     body[:300]={r.text[:300]}")
            continue
        rows = (r.json() or {}).get("rows", [])
        if not rows:
            print("     (0 rows)")
            continue
        row = rows[0]
        print(f"     ROW KEYS ({len(row)}): {sorted(row.keys())}")
        print(f"     ROW[:1800]={json.dumps(row, ensure_ascii=False)[:1800]}")
        return


def probe_securities_variants(isin, token):
    sec = resolve_sec_id(isin, token)
    print(f"\n### SECURITIES variants pour {isin} (secId={sec})")
    if not sec:
        return
    for v in SEC_VARIANTS:
        r = requests.get(SECURITIES.format(sec=sec), params=v, headers=H(token), timeout=30)
        ct = r.headers.get("content-type", "")
        print(f"  {v} → HTTP {r.status_code} ct={ct} len={len(r.content)}")
        if r.status_code == 200 and "json" in ct and r.content:
            body = r.json()
            top = body[0] if isinstance(body, list) and body else body
            if isinstance(top, dict):
                print(f"     KEYS={sorted(top.keys())}")
            print(f"     BODY[:1200]={json.dumps(body, ensure_ascii=False)[:1200]}")


def main():
    isins = sys.argv[1:] or ["IE00B87KCF77", "IE00BFMXXD54", "LU0328684104"]
    token = get_token()
    print(f"token ok (len={len(token)})")
    for isin in isins:
        print(f"\n{'='*70}\n{isin}")
        probe_screener_datapoints(isin, token)
        probe_securities_variants(isin, token)


if __name__ == "__main__":
    main()
