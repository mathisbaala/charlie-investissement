#!/usr/bin/env python3
"""
euronext-etf-v2.py — ETFs Euronext Paris via search_instruments
================================================================
Scrape la liste complète des ETFs (Trackers) cotés sur Euronext Paris
depuis la page de recherche paginée de live.euronext.com.

Chaque page retourne ~18 ETFs avec :
  - Ticker, Nom, ISIN, Marché

~160 pages pour ~2 900 ETFs au total.

Usage :
    python3 scripts/scrapers/euronext-etf-v2.py [--apply] [--limit N]
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT  = 0.6
TIMEOUT     = 20
MAX_PAGES   = 200

BASE_URL = (
    "https://live.euronext.com/fr/search_instruments/etf"
    "?type=Trackers&restMic=&idRest=all&page={page}"
)

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":          "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer":         "https://live.euronext.com/fr/search_instruments/etf",
}

ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{10})\b")


def guess_asset_class(name: str) -> str:
    n = name.lower()
    if any(w in n for w in ["equity", "action", "stock", "share", "world", "europe", "us ", "msci", "s&p", "cac", "stoxx", "nasdaq", "emergent", "emerg"]):
        return "actions"
    if any(w in n for w in ["bond", "obligat", "fixed", "credit", "corporate", "govern", "taux", "treasury", "aggregate", "duration"]):
        return "obligations"
    if any(w in n for w in ["commodit", "gold", "silver", "oil", "metal", "energy", "or ", "matieres"]):
        return "alternatif"
    if any(w in n for w in ["real estate", "reit", "immo", "foncier", "property"]):
        return "immobilier"
    if any(w in n for w in ["money market", "cash", "monetaire", "court terme", "overnight"]):
        return "monetaire"
    return "diversifie"


def guess_management_company(name: str) -> str | None:
    name_u = name.upper()
    providers = {
        "AMUNDI": "Amundi Asset Management",
        "ISHARES": "BlackRock",
        "XTRACKERS": "DWS",
        "LYXOR": "Lyxor",
        "SPDR": "State Street Global Advisors",
        "VANGUARD": "Vanguard",
        "INVESCO": "Invesco",
        "WisdomTree": "WisdomTree",
        "WISDOMTREE": "WisdomTree",
        "BNP": "BNP Paribas Asset Management",
        "OSSIAM": "Ossiam",
        "VANECK": "VanEck",
        "VAN ECK": "VanEck",
        "HSBC": "HSBC Asset Management",
        "AXA": "AXA Investment Managers",
        "FRANKLIN": "Franklin Templeton",
        "PIMCO": "PIMCO",
        "FIDELITY": "Fidelity",
        "LEGAL & GENERAL": "Legal & General",
        "L&G": "Legal & General",
        "DWS": "DWS",
        "BLACKROCK": "BlackRock",
        "UBS": "UBS Asset Management",
        "PICTET": "Pictet",
        "SWISSCANTO": "Swisscanto",
        "FIRST TRUST": "First Trust",
        "GLOBAL X": "Global X",
        "YIS": "YIS",
        "SRCAF": "Source",
        "MSCI": None,
    }
    for key, company in providers.items():
        if key in name_u:
            return company
    return None


def parse_page(html: str) -> list[dict]:
    """Extrait les ETFs d'une page HTML."""
    rows = []
    tr_blocks = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)

    seen = set()
    for block in tr_blocks:
        text = re.sub(r"<[^>]+>", " ", block)
        text = re.sub(r"\s+", " ", text).strip()

        # Format attendu: "TICKER Name ISIN Market ..."
        isin_m = ISIN_RE.search(text)
        if not isin_m:
            continue
        isin = isin_m.group(1)
        if isin in seen:
            continue
        seen.add(isin)

        # Extraire le nom (entre le ticker et l'ISIN)
        before_isin = text[: isin_m.start()].strip()
        parts = before_isin.split()
        if len(parts) >= 2:
            ticker = parts[0]
            name = " ".join(parts[1:]).strip()
        elif len(parts) == 1:
            ticker = parts[0]
            name = f"ETF {isin}"
        else:
            ticker = ""
            name = f"ETF {isin}"

        if not name or len(name) < 3:
            name = f"ETF {isin}"

        asset_class = guess_asset_class(name)
        mgmt = guess_management_company(name)
        currency = "EUR"
        if "USD" in text[isin_m.end():isin_m.end() + 50].upper():
            currency = "USD"
        elif "GBP" in text[isin_m.end():isin_m.end() + 50].upper():
            currency = "GBP"
        elif "CHF" in text[isin_m.end():isin_m.end() + 50].upper():
            currency = "CHF"

        rows.append({
            "isin":               isin,
            "name":               name[:200],
            "product_type":       "etf",
            "management_company": mgmt,
            "asset_class":        asset_class,
            "currency":           currency,
            "distributor_france": True,
            "data_source":        "euronext",
        })

    return rows


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Euronext ETF v2 — Trackers Euronext Paris")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()

    all_funds: list[dict] = []
    seen_isins: set[str] = set()

    for page_num in range(MAX_PAGES):
        if limit and len(all_funds) >= limit:
            break

        time.sleep(RATE_LIMIT)
        url = BASE_URL.format(page=page_num)
        try:
            resp = session.get(url, timeout=TIMEOUT)
            if resp.status != 200:
                print(f"  Page {page_num}: HTTP {resp.status} — arrêt")
                break

            funds = parse_page(resp.body.decode("utf-8"))
            if not funds:
                print(f"  Page {page_num}: vide — fin de pagination")
                break

            new_funds = [f for f in funds if f["isin"] not in seen_isins]
            for f in new_funds:
                seen_isins.add(f["isin"])
            all_funds.extend(new_funds)

            if page_num % 20 == 0:
                print(f"  Page {page_num:3d}: {len(new_funds):3d} nouveaux ETFs | Total: {len(all_funds)}")

        except Exception as e:
            print(f"  Page {page_num}: Erreur — {e}")
            time.sleep(2)
            continue

    print(f"\n  Total : {len(all_funds)} ETFs collectés")

    if not all_funds:
        print("  ⚠️  Aucun ETF collecté")
        return

    if limit:
        all_funds = all_funds[:limit]

    if apply:
        ok, fail = upsert_funds_bulk(all_funds, batch_size=200)
        print(f"  → Upsert : {ok} OK, {fail} échec")
        log_run("euronext-etf-v2", "success", ok, fail, started_at=started)
    else:
        print("\n  Aperçu (10 premiers) :")
        for f in all_funds[:10]:
            mgmt = (f.get("management_company") or "?")[:20]
            print(f"  {f['isin']} | {f['asset_class']:12} | {mgmt:20} | {f['name'][:45]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Euronext ETF v2")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N ETFs")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
