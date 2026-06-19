#!/usr/bin/env python3
"""_ms_sal_probe.py — TEMPORAIRE : sonde les endpoints SAL Morningstar EMEA.

But : déterminer si notre token oauth entitlé (token/oauth, le MÊME que le
screener ecint qui marche) donne accès aux endpoints sal/sal-service
portfolio/* (région / secteur / holdings) — la VRAIE source de ventilation
(découverte via fizban99/pp-portfolio-classifier), par opposition à
ecint/v1/securities/{id}?viewId=portfolio qui renvoie 404.

Dump brut, n'écrit rien. À supprimer après validation.
"""
import os, sys, json, base64, requests

OAUTH_URL = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER  = "https://www.emea-api.morningstar.com/ecint/v1/screener"
SAL_BASE  = "https://www.emea-api.morningstar.com/sal/sal-service"
UNIVERSES = ["FOFRA$$ALL", "FEEUR$$ALL"]

# Endpoints SAL portfolio (pp-portfolio-classifier) ; {type}=fund|etf, {sec}=secId
SAL_PATHS = {
    "Sector":  "{type}/portfolio/v2/sector/{sec}/data",
    "Holding": "{type}/portfolio/holding/v2/{sec}/data",
    "Region":  "{type}/portfolio/regionalSector/{sec}/data",
    "Country": "{type}/portfolio/regionalSectorIncludeCountries/{sec}/data",
}
SAL_PARAMS = {
    "languageId": "en", "locale": "en", "clientId": "MDC_intl",
    "benchmarkId": "category", "version": "3.60.0",
    "premiumNum": "10", "freeNum": "10",
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


def resolve_sec_id(isin, token):
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json",
               "Referer": "https://www.linxea.com/"}
    for u in UNIVERSES:
        r = requests.get(SCREENER, params={
            "languageId": "fr-FR", "currencyId": "EUR", "universeIds": u,
            "outputType": "json", "securityDataPoints": "SecId|ISIN|Name|InvestmentType",
            "term": isin, "pageSize": 1, "page": 1,
        }, headers=headers, timeout=30)
        if r.status_code != 200:
            continue
        for row in (r.json() or {}).get("rows", []):
            sec = row.get("SecId") or row.get("secId")
            if sec:
                return sec, row.get("InvestmentType") or row.get("Name")
    return None, None


def probe_sal(isin, token):
    sec, meta = resolve_sec_id(isin, token)
    print(f"\n{'='*70}\n{isin} → secId={sec}  (meta={meta})")
    if not sec:
        print("  pas de secId, skip")
        return
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json",
               "Referer": "https://www.linxea.com/"}
    for typ in ("fund", "etf"):
        for label, tmpl in SAL_PATHS.items():
            path = tmpl.format(type=typ, sec=sec)
            url = f"{SAL_BASE}/{path}"
            params = dict(SAL_PARAMS)
            try:
                r = requests.get(url, params=params, headers=headers, timeout=30)
            except Exception as e:
                print(f"  [{typ}/{label}] EXC {e}")
                continue
            ct = r.headers.get("content-type", "")
            print(f"  [{typ}/{label}] HTTP {r.status_code} ct={ct} len={len(r.content)}")
            if r.status_code == 200 and "json" in ct:
                try:
                    body = r.json()
                except Exception:
                    print(f"      (non-json body: {r.text[:200]})")
                    continue
                dump = json.dumps(body, ensure_ascii=False)
                print(f"      KEYS={sorted(body.keys()) if isinstance(body, dict) else type(body)}")
                print(f"      BODY[:1500]={dump[:1500]}")
            elif r.status_code != 404 and r.content:
                print(f"      BODY[:300]={r.text[:300]}")


def main():
    isins = sys.argv[1:] or ["IE00B87KCF77", "IE00BFMXXD54", "LU0328684104"]
    token = get_token()
    print(f"token ok (len={len(token)})")
    for isin in isins:
        probe_sal(isin, token)


if __name__ == "__main__":
    main()
