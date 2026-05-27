#!/usr/bin/env python3
"""
justetf-ter-enricher.py — TER des ETFs depuis JustETF
======================================================
Pour chaque ETF sans TER dans investissement_funds, récupère le
Total Expense Ratio (TER / frais totaux sur encours) depuis JustETF.

Source : https://www.justetf.com/fr/etf-profile.html?isin={ISIN}
Pattern extrait : data-testid="tl_etf-basics_value_ter">0,07% p.a.</div>

Usage :
    python3 scripts/scrapers/justetf-ter-enricher.py [--apply] [--limit N] [--isin ISIN]
"""

import sys
import re
import time
import math
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

WORKERS        = 1
RATE_LIMIT_SEC = 3.5
TIMEOUT        = 15
JUSTETF_URL    = "https://www.justetf.com/fr/etf-profile.html?isin={isin}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.justetf.com/",
}


def extract_ter(isin: str) -> float | None:
    """
    Retourne le TER (float, ex: 0.07 pour 0.07%) depuis JustETF.
    Retourne None si non trouvé ou inaccessible.
    """
    url = JUSTETF_URL.format(isin=isin)
    try:
        session = FetcherSession(impersonate="chrome").__enter__()
        r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if r.status == 404:
            return None
        if r.status != 200:
            return None
        html = r.body.decode("utf-8", errors="ignore")

        # Pattern 1 : balise data-testid (le plus fiable)
        m = re.search(r'data-testid="tl_etf-basics_value_ter">([^<]+)<', html)
        if m:
            raw = m.group(1).strip()
            num = re.search(r'([0-9]+[,\.][0-9]+)', raw)
            if num:
                return float(num.group(1).replace(',', '.'))

        # Pattern 2 : texte narratif (fallback)
        m2 = re.search(
            r"(?:ratio des frais totaux|TER).*?s'élève à.*?([0-9]+[,\.][0-9]+)\s*%",
            html, re.DOTALL | re.IGNORECASE
        )
        if m2:
            return float(m2.group(1).replace(',', '.'))

        # Pattern 3 : tableau de caractéristiques
        m3 = re.search(
            r'(?:Frais totaux|Total Expense Ratio)[^<>]*</[^>]+>[^<>]*<[^>]+>([0-9]+[,\.][0-9]+)\s*%',
            html, re.IGNORECASE
        )
        if m3:
            return float(m3.group(1).replace(',', '.'))

    except (Exception, ValueError):
        pass
    return None


def run(apply: bool, limit: int | None, isin_filter: str | None):
    print("=" * 60)
    print("  JustETF TER Enricher — Frais totaux ETFs")
    print("=" * 60)
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    if isin_filter:
        funds = [{"isin": isin_filter, "name": ""}]
    else:
        funds = []
        seen: set[str] = set()
        offset = 0
        page_size = 500

        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin, name")
                .eq("product_type", "etf")
                .is_("ter", "null")
                .range(offset, offset + page_size - 1)
                .execute().data or []
            )
            for row in batch:
                isin = row["isin"]
                if isin not in seen:
                    seen.add(isin)
                    funds.append(row)
            if len(batch) < page_size:
                break
            if limit and len(funds) >= limit * 2:
                break
            offset += page_size

        if limit:
            funds = funds[:limit]

    print(f"  {len(funds)} ETFs sans TER à enrichir")
    print()

    found    = 0
    not_found = 0
    lock     = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, not_found
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        time.sleep(RATE_LIMIT_SEC)
        ter = extract_ter(isin)

        with lock:
            if ter is not None and 0 <= ter <= 10:  # TER raisonnable 0-10%
                found += 1
                if apply:
                    upsert_fund({"isin": isin, "ter": ter, "ongoing_charges": ter})
                print(f"  ✓ [{i:4d}] {isin} | TER:{ter:.2f}% | {name}")
            else:
                not_found += 1
                if i <= 20 or i % 50 == 0:
                    print(f"  ~ [{i:4d}] {isin} | no TER | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} TER enrichis, {not_found} non trouvés")

    if apply:
        log_run(
            "justetf-ter-enricher",
            "success" if not_found < found else "partial",
            found,
            not_found,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JustETF TER Enricher")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N ETFs")
    parser.add_argument("--isin",   type=str,            help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
