#!/usr/bin/env python3
"""
justetf-perf-fill.py — Performance manquante pour ETFs via JustETF
===================================================================
Cible les ETFs avec performance_1y IS NULL (non couverts par Boursorama).

Usage :
    python3 scripts/scrapers/justetf-perf-fill.py [--apply] [--limit N]
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
HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
    "Referer":         "https://www.justetf.com/fr/",
}
BASE_URL = "https://www.justetf.com/fr/etf-profile.html?isin={isin}"


def _val(html: str, testid: str) -> str | None:
    m = re.search(rf'data-testid="{re.escape(testid)}"[^>]*>([^<]{{1,80}})', html)
    return m.group(1).strip() if m else None


def parse_pct(s: str | None) -> float | None:
    if not s or s.strip() in ("-", "–", ""):
        return None
    s = s.replace("\xa0", " ").replace(" p.a.", "").replace("%", "").replace("+", "").strip()
    s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def fetch_etf(session: FetcherSession, isin: str) -> dict:
    url = BASE_URL.format(isin=isin)
    try:
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            return {}
        html = page.body.decode("utf-8")

        result = {}

        p1y = parse_pct(_val(html, "etf-returns-section_1year-return"))
        p3y = parse_pct(_val(html, "etf-returns-section_3year-return"))
        p5y = parse_pct(_val(html, "etf-returns-section_5year-return"))
        if p1y is not None: result["performance_1y"] = round(p1y, 2)
        if p3y is not None: result["performance_3y"] = round(p3y, 2)
        if p5y is not None: result["performance_5y"] = round(p5y, 2)

        ter_raw = _val(html, "etf-profile-header_ter-value")
        ter = parse_pct(ter_raw)
        if ter is not None and 0 < ter < 20:
            result["ongoing_charges"] = round(ter / 100, 6)
            result["ter"]             = round(ter / 100, 6)

        return result
    except Exception:
        return {}


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  JustETF Perf Fill — Performance pour ETFs sans perf_1y")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name")
            .eq("product_type", "etf")
            .is_("performance_1y", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} ETFs sans performance_1y\n")

    session = FetcherSession(impersonate="chrome").__enter__()
    found = not_found = 0
    now = datetime.now(timezone.utc).isoformat()

    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        name = (fund.get("name") or "")[:45]
        time.sleep(RATE_LIMIT)

        data = fetch_etf(session, isin)
        if data.get("performance_1y") is not None:
            found += 1
            p1 = data["performance_1y"]
            ter_pct = round(data.get("ongoing_charges", 0) * 100, 3) if data.get("ongoing_charges") else None
            if i <= 20 or i % 50 == 0:
                print(f"  ✓ [{i:3d}] {isin} | {p1:+.2f}% | TER:{ter_pct}% | {name}")
            if apply:
                try:
                    client.table("investissement_funds") \
                        .update({**data, "updated_at": now}) \
                        .eq("isin", isin) \
                        .execute()
                except Exception as e:
                    if found <= 3:
                        print(f"  ✗ DB {isin}: {e}")
        else:
            not_found += 1
            if i <= 10 or i % 50 == 0:
                print(f"  ✗ [{i:3d}] {isin} | not found | {name}")

    print(f"\n  → {found} enrichis, {not_found} non trouvés")
    if apply:
        log_run("justetf-perf-fill", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
