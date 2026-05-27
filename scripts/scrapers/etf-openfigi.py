#!/usr/bin/env python3
"""
etf-openfigi.py — ETFs Euronext via OpenFIGI + Yahoo Finance
=============================================================
OpenFIGI (Bloomberg, gratuit) liste tous les ETPs cotés sur Euronext Paris.
Yahoo Finance enrichit avec TER (netExpenseRatio), AUM, performance.

Sources :
  - OpenFIGI /v3/search : exchCode=FP, securityType=ETP → tickers
  - Yahoo Finance yfinance : ticker.PA → TER, AUM, rendement

L'ISIN est obtenu via Yahoo Finance v10 quoteSummary ou
via l'endpoint /v3/mapping d'OpenFIGI.

Usage :
    python3 scripts/scrapers/etf-openfigi.py [--apply] [--limit N]
    python3 scripts/scrapers/etf-openfigi.py --apply  (tous les ETPs Euronext Paris)
"""

import re
import sys
import time
import math
import argparse
import warnings
from datetime import datetime, timezone
from pathlib import Path

import requests

warnings.filterwarnings("ignore")

try:
    import yfinance as yf
except ImportError:
    print("yfinance manquant. Lance : pip install yfinance")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

OPENFIGI_URL   = "https://api.openfigi.com/v3/search"
RATE_LIMIT     = 1.0
TIMEOUT        = 15

HEADERS = {
    "User-Agent":    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Content-Type":  "application/json",
    "Accept":        "application/json",
}

# Exchanges Euronext à couvrir
EXCHANGES = ["FP", "NA", "BB", "OS", "LI", "MI"]   # Paris, Amsterdam, Bruxelles, Oslo, Lisbonne, Milan
EXCHANGE_NAMES = {
    "FP": "Euronext Paris",
    "NA": "Euronext Amsterdam",
    "BB": "Euronext Bruxelles",
    "OS": "Euronext Oslo",
    "LI": "Euronext Lisbonne",
    "MI": "Euronext Milan",
}
YAHOO_SUFFIXES = {
    "FP": ".PA",
    "NA": ".AS",
    "BB": ".BR",
    "OS": ".OL",
    "LI": ".LS",
    "MI": ".MI",
}

# ─── Étape 1 : Lister les ETPs via OpenFIGI ───────────────────────────────────

def collect_etps_openfigi(exch_codes: list[str]) -> list[dict]:
    """
    Pagine OpenFIGI pour chaque exchange et collecte tous les ETPs.
    Retourne liste de {ticker, exchCode, figi, name}.
    """
    all_etps = []
    seen_tickers = set()

    for exch in exch_codes:
        next_token = None
        page       = 0
        while True:
            payload = {
                "query":        "ETF",
                "exchCode":     exch,
                "securityType": "ETP",
            }
            if next_token:
                payload["start"] = next_token

            try:
                r = requests.post(OPENFIGI_URL, json=payload, timeout=TIMEOUT)
                if r.status != 200:
                    break
                d    = json.loads(r.body.decode("utf-8"))
                data = d.get("data", [])
                for item in data:
                    ticker = item.get("ticker", "")
                    if ticker and ticker not in seen_tickers:
                        seen_tickers.add(ticker)
                        all_etps.append({
                            "ticker":   ticker,
                            "exchCode": exch,
                            "figi":     item.get("figi", ""),
                            "name":     item.get("name", ""),
                        })
                next_token = d.get("next")
                page += 1
                if not next_token:
                    break
                time.sleep(0.2)  # gentle rate limit OpenFIGI
            except Exception:
                break

        print(f"  {exch}: {sum(1 for e in all_etps if e['exchCode'] == exch)} ETPs")

    return all_etps


# ─── Étape 2 : Enrichir via Yahoo Finance ─────────────────────────────────────

ASSET_KEYWORDS = {
    "actions":     ["equit", "stock", "share", "msci", "cac", "dax", "s&p", "nasdaq", "stoxx", "world", "emerging"],
    "obligations": ["bond", "obligat", "fixed", "credit", "treasur", "gilt", "bund"],
    "alternatif":  ["gold", "silver", "oil", "commodit", "metal", "energy", "matieres"],
    "immobilier":  ["real estate", "reit", "immo", "foncier"],
    "monetaire":   ["money", "cash", "monetaire", "liquidit"],
}

def guess_asset_class(text: str) -> str:
    t = text.lower()
    for cls, kws in ASSET_KEYWORDS.items():
        if any(k in t for k in kws):
            return cls
    return "diversifie"

def enrich_from_yahoo(ticker: str, suffix: str) -> dict | None:
    """Enrichit un ETF depuis Yahoo Finance."""
    symbol = f"{ticker}{suffix}"
    try:
        t    = yf.Ticker(symbol)
        info = t.info
        if not info or info.get("quoteType") not in ("ETF", "ETP", "MUTUALFUND"):
            return None

        data: dict = {
            "product_type":       "etf",
            "distributor_france": True,
            "data_source":        "openfigi-yahoo",
        }

        name = info.get("longName") or info.get("shortName", "")
        if name:
            data["name"] = name

        currency = info.get("currency", "EUR")
        if currency:
            data["currency"] = currency[:3]

        mgmt = info.get("fundFamily", "")
        if mgmt:
            data["management_company"] = mgmt

        # TER / frais courants
        ter = info.get("netExpenseRatio")
        if ter and isinstance(ter, (int, float)) and 0 < ter < 20:
            data["ongoing_charges"] = round(ter / 100 if ter > 1 else ter, 6)

        # AUM
        aum = info.get("totalAssets")
        if aum and aum > 0:
            data["aum_eur"] = int(aum)

        # Performance
        ytd = info.get("ytdReturn")
        if ytd is not None:
            data["performance_1y"] = round(float(ytd), 2)

        # Morningstar
        ms = info.get("morningStarOverallRating")
        if ms and int(ms) > 0:
            data["morningstar_rating"] = int(ms)

        # Asset class depuis le nom
        ac = guess_asset_class(f"{name} {info.get('category', '')}")
        data["asset_class"] = ac

        # PEA — heuristique : ETFs UCITS domiciliés en France ou avec MSCI EMU
        cat = (info.get("category") or "").lower()
        if "france" in cat or "pea" in (name or "").lower():
            data["pea_eligible"] = True

        return data if data.get("name") else None

    except Exception:
        return None


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, exchanges: list[str]):
    print("=" * 60)
    print("  ETF OpenFIGI + Yahoo Finance — Euronext")
    print("=" * 60)
    print(f"  Mode      : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Exchanges : {', '.join(exchanges)}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Phase 1 : Collecter les ETPs via OpenFIGI
    print("  Phase 1 — OpenFIGI : listing des ETPs...")
    etps = collect_etps_openfigi(exchanges)
    print(f"  → {len(etps)} ETPs uniques trouvés")

    if limit:
        etps = etps[:limit]

    # Phase 2 : Enrichissement Yahoo Finance
    print(f"\n  Phase 2 — Yahoo Finance : enrichissement de {len(etps)} ETPs...")
    results = []
    found   = 0
    missing = 0

    for i, etp in enumerate(etps, 1):
        ticker  = etp["ticker"]
        exch    = etp["exchCode"]
        suffix  = YAHOO_SUFFIXES.get(exch, ".PA")

        time.sleep(0.3)
        data = enrich_from_yahoo(ticker, suffix)

        if data:
            found += 1
            # ISIN : pas fourni par OpenFIGI ni Yahoo dans les cas simples
            # On stocke avec un ISIN provisoire basé sur le ticker pour now
            # Un enrichisseur ultérieur peut ajouter l'ISIN réel
            yf_ticker = f"{ticker}{suffix}"

            # Chercher si un fonds avec ce nom existe déjà en base
            name = data.get("name", "")
            if not name:
                missing += 1
                continue

            results.append({
                **data,
                "yahoo_symbol": yf_ticker,
            })
        else:
            missing += 1

        if i % 100 == 0 or i <= 20:
            print(f"  [{i:4d}/{len(etps)}] {ticker}{suffix:5} | {'✓' if data else '✗'} | {(data or {}).get('name', '')[:35]}")

    pct = f"{found/len(etps)*100:.0f}%" if etps else "N/A"
    print(f"\n  ✓ {found}/{len(etps)} ETPs enrichis ({pct})")

    # Phase 3 : Récupérer les ISINs depuis Yahoo Finance (quoteSummary)
    print(f"\n  Phase 3 — Recherche ISINs pour {found} ETPs enrichis...")
    # Les ISINs sont cherchés via l'API Yahoo Finance search
    etf_with_isin = []
    no_isin       = 0

    for r in results:
        symbol = r.get("yahoo_symbol", "")
        if not symbol:
            continue
        try:
            # Yahoo Finance search retourne l'ISIN pour certains instruments
            url = f"https://query2.finance.yahoo.com/v1/finance/search?q={symbol}&lang=en&region=US&quotesCount=1"
            resp = requests.get(url, headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            }, timeout=10)
            if page.status == 200:
                items = json.loads(page.body.decode("utf-8")).get("quotes", [])
                for item in items:
                    if item.get("symbol", "") == symbol:
                        # Yahoo ne donne pas l'ISIN directement via search
                        break

            # Essayer via quoteSummary
            sum_url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}?modules=summaryProfile"
            resp2 = requests.get(sum_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            if resp2.status_code == 200:
                qr = resp2.json().get("quoteSummary", {}).get("result", [])
                if qr:
                    profile = qr[0].get("summaryProfile", {})
                    isin_candidate = profile.get("isin", "")
                    if isin_candidate and re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", isin_candidate):
                        r["isin"] = isin_candidate
        except Exception:
            pass

        if r.get("isin"):
            etf_with_isin.append(r)
        else:
            no_isin += 1

        time.sleep(0.15)

    print(f"  ISINs trouvés : {len(etf_with_isin)} | Sans ISIN : {no_isin}")

    # Pour les ETFs sans ISIN, on ne peut pas les stocker (ISIN = PK)
    # On tente quand même via OpenFIGI mapping pour quelques-uns
    if not etf_with_isin:
        print("  ⚠️  Aucun ISIN trouvé — les ETFs sont stockés sans ISIN (non applicable)")
        return

    if apply:
        # Filtrer les ISINs déjà en base pour faire update, sinon insert complet
        existing_isins = set()
        for isin in [r["isin"] for r in etf_with_isin]:
            r2 = client.table("investissement_funds").select("isin").eq("isin", isin).execute()
            if r2.data:
                existing_isins.add(isin)

        to_upsert = [r for r in etf_with_isin if r.get("isin")]
        # Ajouter un nom minimal si manquant pour l'upsert initial
        for r in to_upsert:
            if not r.get("name"):
                r["name"] = r.get("yahoo_symbol", r.get("isin", "ETF"))
            r.pop("yahoo_symbol", None)

        ok, fail = upsert_funds_bulk(to_upsert, batch_size=50)
        print(f"  → Upsert {len(to_upsert)} ETFs : {ok} OK, {fail} échec")
        log_run("etf-openfigi", "success", ok, fail, started_at=started)
    else:
        print(f"\n  Aperçu (10 premiers avec ISIN) :")
        for r in etf_with_isin[:10]:
            ter_pct = f"{r.get('ongoing_charges', 0)*100:.2f}%" if r.get("ongoing_charges") else "N/A"
            print(f"  {r.get('isin')} | TER:{ter_pct} | {r.get('name', '')[:45]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ETF Euronext via OpenFIGI + Yahoo Finance")
    parser.add_argument("--apply",    action="store_true",           help="Écrire dans Supabase")
    parser.add_argument("--limit",    type=int,                      help="Limiter à N ETPs")
    parser.add_argument("--exchange", type=str, default="FP",        help="FP|NA|BB|ALL")
    args   = parser.parse_args()

    if args.exchange.upper() == "ALL":
        exch = list(YAHOO_SUFFIXES.keys())
    else:
        exch = [args.exchange.upper()]

    run(apply=args.apply, limit=args.limit, exchanges=exch)
