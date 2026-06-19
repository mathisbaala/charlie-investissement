#!/usr/bin/env python3
"""_ms_sal_probe.py — TEMPORAIRE : sonde l'accès aux ventilations Morningstar.

Historique :
  - itér.1 : emea-api sal/sal-service + Bearer oauth → 401 (pas entitlé).
  - itér.2 : screener ecint expose AssetAllocEquity/PortfolioDate mais pas
    de datapoint région/secteur/holdings ; securities/{id} vide.
  - itér.3 (ici) : api-global.morningstar.com/sal-service/v1 + apikey statique
    (chemin public mstarpy, sans oauth). On résout le secId via NOTRE screener
    entitlé, puis on tape l'API publique pour region/secteur/holdings.

Dump brut, n'écrit rien. À supprimer après validation.
"""
import os, sys, json, base64, requests

OAUTH_URL = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER  = "https://www.emea-api.morningstar.com/ecint/v1/screener"
UNIVERSES = ["FOFRA$$ALL", "FEEUR$$ALL"]

# API publique consommateur (mstarpy) : pas d'oauth, apikey statique.
SAL_GLOBAL = "https://api-global.morningstar.com/sal-service/v1/{type}/{field}/{sec}/data"
APIKEY     = "lstzFDEOhfFNMLikKa0am9mgEKLBl49T"
SAL_PARAMS = {"clientId": "MDC", "version": "4.71.0", "languageId": "en"}

# field SAL → label ; testé pour fund ET etf.
SAL_FIELDS = {
    "Region":  "portfolio/regionalSector",
    "Sector":  "portfolio/v2/sector",
    "Holding": "portfolio/holding/v2",
    "Asset":   "process/asset/v2",
}


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


def resolve_sec(isin, token):
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json",
               "Referer": "https://www.linxea.com/"}
    for u in UNIVERSES:
        r = requests.get(SCREENER, params={
            "languageId": "fr-FR", "currencyId": "EUR", "universeIds": u,
            "outputType": "json", "securityDataPoints": "SecId|ISIN|Name|InvestmentType|AssetAllocEquity",
            "term": isin, "pageSize": 1, "page": 1,
        }, headers=headers, timeout=30)
        if r.status_code != 200:
            continue
        for row in (r.json() or {}).get("rows", []):
            sec = row.get("SecId") or row.get("secId")
            if sec:
                return sec, row.get("InvestmentType"), row.get("AssetAllocEquity")
    return None, None, None


def probe_global(isin, token):
    sec, itype, equity = resolve_sec(isin, token)
    print(f"\n{'='*70}\n{isin} → secId={sec} InvestmentType={itype} AssetAllocEquity={equity}")
    if not sec:
        return
    for typ in ("fund", "etf"):
        for label, field in SAL_FIELDS.items():
            url = SAL_GLOBAL.format(type=typ, field=field, sec=sec)
            try:
                r = requests.get(url, params=SAL_PARAMS, headers={"apikey": APIKEY,
                                 "User-Agent": "Mozilla/5.0"}, timeout=30)
            except Exception as e:
                print(f"  [{typ}/{label}] EXC {e}")
                continue
            ct = r.headers.get("content-type", "")
            print(f"  [{typ}/{label}] HTTP {r.status_code} ct={ct} len={len(r.content)}")
            if r.status_code == 200 and "json" in ct and r.content:
                try:
                    body = r.json()
                except Exception:
                    print(f"      (non-json: {r.text[:200]})")
                    continue
                if isinstance(body, dict):
                    print(f"      KEYS={sorted(body.keys())}")
                print(f"      BODY[:2200]={json.dumps(body, ensure_ascii=False)[:2200]}")
            elif r.status_code != 404 and r.content:
                print(f"      BODY[:300]={r.text[:300]}")


def main():
    isins = sys.argv[1:] or ["IE00B87KCF77", "IE00BFMXXD54", "LU0328684104"]
    token = get_token()
    print(f"token ok (len={len(token)})")
    for isin in isins:
        probe_global(isin, token)


if __name__ == "__main__":
    main()
