#!/usr/bin/env python3
"""
boursorama-aum-fill.py — AUM manquants pour fonds ayant déjà perf_1y
=====================================================================
Cible spécifiquement les fonds AVEC performance_1y mais SANS aum_eur.
Ces fonds sont ignorés par boursorama-enricher.py (qui cible perf_1y IS NULL).

Usage :
    python3 scripts/scrapers/boursorama-aum-fill.py [--apply] [--limit N]
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

RATE_LIMIT = 1.0
TIMEOUT    = 15
BOURSO_OPCVM = "https://www.boursorama.com/bourse/opcvm/cours/{isin}/"
BOURSO_ETF   = "https://www.boursorama.com/bourse/trackers/cours/{isin}/"


def fetch_aum(session: FetcherSession, isin: str, product_type: str = "opcvm") -> int | None:
    url = BOURSO_ETF.format(isin=isin) if product_type == "etf" else BOURSO_OPCVM.format(isin=isin)
    try:
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            return None
        html = page.body.decode("utf-8") if page.body else ""
        aum_ctx = re.search(r"Actif net[^<]*</p>[^<]*<p[^>]*>\s*([^<\n]+)", html, re.IGNORECASE)
        if not aum_ctx:
            return None
        raw = aum_ctx.group(1).strip().split("/")[0].strip()
        raw = raw.replace("\xa0", " ").replace(",", ".")
        m = re.search(r"([\d\s.]+)\s*(Mrd€|Md€|M€|B EUR|M EUR|Mrd|Md|M\b|K\b)", raw, re.IGNORECASE)
        if not m:
            return None
        num = float(m.group(1).replace(" ", ""))
        unit = m.group(2).lower().strip()
        if "mrd" in unit or "b " in unit:
            return int(num * 1_000_000_000)
        if "md" in unit:
            return int(num * 1_000_000_000)
        if unit.startswith("k"):
            return int(num * 1_000)
        return int(num * 1_000_000)
    except Exception:
        return None


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Boursorama AUM Fill — AUM pour fonds sans aum_eur")
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
            .select("isin, name, product_type")
            .not_.is_("performance_1y", "null")
            .is_("aum_eur", "null")
            .in_("product_type", ["opcvm", "etf"])
            .range(offset, offset + 999)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} fonds avec perf_1y mais sans AUM\n")

    session = FetcherSession(impersonate="chrome").__enter__()
    found = not_found = 0
    now = datetime.now(timezone.utc).isoformat()

    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]
        time.sleep(RATE_LIMIT)

        aum = fetch_aum(session, isin, fund.get("product_type", "opcvm"))
        if aum:
            found += 1
            aum_m = aum / 1_000_000
            if i <= 20 or i % 100 == 0:
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
            if i <= 10 or i % 200 == 0:
                print(f"  ✗ [{i:4d}] {isin} | not found | {name}")

    print(f"\n  → {found} AUM récupérés, {not_found} non trouvés")
    if apply:
        log_run("boursorama-aum-fill", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
