#!/usr/bin/env python3
"""
justetf-aum-fill.py — AUM manquants pour ETFs via JustETF
==========================================================
Cible spécifiquement les ETFs avec TER (déjà enrichis) mais sans aum_eur.
JustETF a le fund size pour la plupart des ETFs européens.

Usage :
    python3 scripts/scrapers/justetf-aum-fill.py [--apply] [--limit N]
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

RATE_LIMIT = 1.2
TIMEOUT    = 15
WORKERS    = 1   # Pas de parallélisme pour éviter le ban JustETF

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
    "Referer":         "https://www.justetf.com/fr/",
}

BASE_URL = "https://www.justetf.com/fr/etf-profile.html?isin={isin}"


def _val(html: str, testid: str) -> str | None:
    m = re.search(rf'data-testid="{re.escape(testid)}"[^>]*>([^<]{{1,80}})', html)
    if m:
        v = m.group(1).strip()
        return v if v else None
    return None


def fetch_aum(session: FetcherSession, isin: str) -> int | None:
    url = BASE_URL.format(isin=isin)
    try:
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            return None
        html = page.body.decode("utf-8")

        # Pattern from fund-size-value-wrapper: "EUR 119\xa0096 M"
        m = re.search(
            r'etf-profile-header_fund-size-value-wrapper[^>]*>.*?EUR\s*([\d\s\xa0 ,.]+)\s*M',
            html, re.DOTALL
        )
        if m:
            num_str = re.sub(r'[\s\xa0 ,]', '', m.group(1))
            try:
                return int(num_str) * 1_000_000
            except (ValueError, TypeError):
                pass
        return None
    except Exception:
        return None


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  JustETF AUM Fill — Fund size pour ETFs sans AUM")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin,name")
            .eq("product_type", "etf")
            .is_("aum_eur", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} ETFs sans AUM à traiter\n")

    session = FetcherSession(impersonate="chrome").__enter__()
    found = not_found = 0
    now = datetime.now(timezone.utc).isoformat()

    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]
        time.sleep(RATE_LIMIT)

        aum = fetch_aum(session, isin)
        if aum:
            found += 1
            if i <= 20 or i % 100 == 0:
                aum_m = aum / 1_000_000
                print(f"  ✓ [{i:4d}] {isin} | AUM:{aum_m:.0f}M€ | {name}")
            if apply:
                try:
                    client.table("investissement_funds") \
                        .update({"aum_eur": aum, "updated_at": now}) \
                        .eq("isin", isin) \
                        .execute()
                except Exception as e:
                    if found <= 3:
                        print(f"  ✗ DB {isin}: {e}")
        else:
            not_found += 1
            if i <= 20 or i % 200 == 0:
                print(f"  ✗ [{i:4d}] {isin} | not found | {name}")

    print(f"\n  → {found} AUM récupérés, {not_found} non trouvés")
    if apply:
        log_run("justetf-aum-fill", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
