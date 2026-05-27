#!/usr/bin/env python3
"""
justetf-enricher.py — Enrichissement ETF via JustETF
=====================================================
Pour chaque ETF dans investissement_funds (product_type='etf'),
collecte depuis la page profil JustETF :
  - TER (frais courants)
  - Performance 1Y, 3Y, 5Y
  - Politique de distribution (capitalisé / distribuant)
  - Réplication (physique / synthétique)

Usage :
    python3 scripts/scrapers/justetf-enricher.py [--apply] [--limit N]
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

RATE_LIMIT = 1.2
TIMEOUT    = 15

BASE_URL = "https://www.justetf.com/fr/etf-profile.html?isin={isin}"


def _val(page, testid: str) -> str | None:
    """Extrait la valeur d'un élément via data-testid (CSS selector Scrapling + auto_save)."""
    els = page.css(f'[data-testid="{testid}"]')
    if not els:
        return None
    v = str(els[0].css("::text").get() or els[0].text or "").strip()
    return v if v else None


def parse_pct(s: str | None) -> float | None:
    """Convertit '0,15% p.a.' ou '+1,23%' en float (0.0015 ou 1.23)."""
    if not s:
        return None
    s = s.replace("\xa0", " ").replace(" p.a.", "").replace("%", "").replace("+", "").strip()
    s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def fetch_etf(session: FetcherSession, isin: str) -> dict:
    """Scrappe la page profil JustETF et retourne les données."""
    url = BASE_URL.format(isin=isin)
    try:
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200 or not page.body:
            return {}

        result = {}

        ter_raw = _val(page, "etf-profile-header_ter-value")
        ter = parse_pct(ter_raw)
        if ter is not None and 0 < ter < 20:
            result["ongoing_charges"] = round(ter / 100, 6)

        p1y = parse_pct(_val(page, "etf-returns-section_1year-return"))
        p3y = parse_pct(_val(page, "etf-returns-section_3year-return"))
        p5y = parse_pct(_val(page, "etf-returns-section_5year-return"))
        if p1y is not None: result["performance_1y"] = round(p1y, 2)
        if p3y is not None: result["performance_3y"] = round(p3y, 2)
        if p5y is not None: result["performance_5y"] = round(p5y, 2)

        fund_size_raw = _val(page, "etf-profile-header_fund-size-value")
        if fund_size_raw:
            # Ex: "12 345 M€" ou "1,2 Mrd€"
            size_m = re.search(r'([\d\s,.]+)\s*(?:M€|M EUR|Mrd€|Md€|B EUR)', fund_size_raw, re.IGNORECASE)
            if size_m:
                num_str = size_m.group(1).replace("\xa0", "").replace(" ", "").replace(",", ".")
                try:
                    num = float(num_str)
                    if "Mrd" in fund_size_raw or "Md" in fund_size_raw or "B " in fund_size_raw:
                        result["aum_eur"] = int(num * 1_000_000_000)
                    else:
                        result["aum_eur"] = int(num * 1_000_000)
                except ValueError:
                    pass

        return result

    except Exception:
        return {}


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  JustETF Enricher — TER + Performances ETF")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds = []
    offset = 0
    page_size = 1000
    while True:
        q = client.table("investissement_funds") \
            .select("isin, name, ongoing_charges") \
            .eq("product_type", "etf") \
            .is_("ongoing_charges", "null") \
            .range(offset, offset + page_size - 1)
        batch = q.execute().data or []
        funds.extend(batch)
        if len(batch) < page_size:
            break
        if limit and len(funds) >= limit:
            funds = funds[:limit]
            break
        offset += page_size

    print(f"  {len(funds)} ETFs sans TER à enrichir")
    print()

    session = FetcherSession(impersonate="chrome").__enter__()
    ok = fail = 0

    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        name = (fund.get("name") or "")[:45]

        time.sleep(RATE_LIMIT)
        data = fetch_etf(session, isin)

        if data.get("ongoing_charges"):
            ok += 1
            ter_pct = round(data["ongoing_charges"] * 100, 3)
            if i <= 20 or i % 100 == 0 or ok % 50 == 0:
                print(f"  ✓ [{i:4d}] {isin} | TER:{ter_pct:.2f}% | {name}")
            if apply:
                upsert_fund({"isin": isin, **data})
        else:
            fail += 1
            if i <= 10 or i % 200 == 0:
                print(f"  ✗ [{i:4d}] {isin} | not found   | {name}")

    print()
    print(f"  ✓ {ok} ETFs enrichis, {fail} non trouvés")

    if apply:
        log_run("justetf-enricher", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JustETF ETF Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N ETFs")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
