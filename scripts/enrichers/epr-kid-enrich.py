#!/usr/bin/env python3
"""
epr-kid-enrich.py — URLs KID/DICI via le dépôt amfinesoft EPR (FILL-ONLY)
==========================================================================
Le portail réglementaire amfinesoft (epr.amfinesoft.com) héberge les DICI PRIIPs
de la quasi-totalité des fonds distribués en France. Les URLs sont constructibles
par ISIN avec une clé d'accès publique. On essaie plusieurs (distributeur, clé)
découverts dans la nature ; le endpoint « générique » couvre le catalogue maître.

Pour chaque OPCVM/ETF sans kid_url, on construit l'URL, on vérifie qu'elle renvoie
un vrai PDF (200 + magic %PDF), et on stocke kid_url via db.safe_fill_funds
(fill-only, merge field_sources — n'écrase jamais un kid_url existant).

Usage :
    python3 scripts/enrichers/epr-kid-enrich.py [--apply] [--limit N]
"""

import sys
import time
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import safe_fill_funds, log_run, get_client

from scrapling.fetchers import FetcherSession

B = "https://epr.amfinesoft.com/api/v1/download"
# Endpoints découverts (clés publiques dans les URLs de DICI publiées).
# Le générique (sans distributeur) accède au catalogue maître ; les autres
# servent de repli. Ordre = priorité.
ENDPOINTS = [
    ("generic", B + "/underlying/kid/{isin}/lang/fr?key=xJdkzl5Bq4GWwvPKrtPRSK4a9QfrXe"),
    ("sogecap", B + "/SOGECAP/underlying/kid/{isin}/lang/fr?key=7pPlB7HoeaCTjsHOsYGA87RfJcmpSQ"),
    ("axa",     B + "/AXA/underlying/kid-security/{isin}/lang/fr?key=LKCkPWj3Jd2y8HlRp3QAtQ6Cjz36KB"),
]
WORKERS = 6
RATE = 0.2
FLUSH_EVERY = 400


def find_kid(session, isin):
    for _name, tpl in ENDPOINTS:
        url = tpl.format(isin=isin)
        try:
            r = session.get(url, stealthy_headers=True, timeout=20)
            time.sleep(RATE)
            if r.status == 200 and (r.body or b"")[:4] == b"%PDF":
                return url
        except Exception:
            pass
    return None


def load_targets(client, limit):
    funds, offset, page = [], 0, 1000
    while True:
        batch = client.table("investissement_funds") \
            .select("isin, name") \
            .in_("product_type", ["opcvm", "etf"]) \
            .is_("kid_url", "null") \
            .order("aum_eur", desc=True, nullsfirst=False) \
            .range(offset, offset + page - 1).execute().data or []
        funds += batch
        if len(batch) < page or (limit and len(funds) >= limit):
            break
        offset += page
    return funds[:limit] if limit else funds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    print("=" * 64)
    print(f"  EPR KID Finder (amfinesoft) — Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    started = datetime.now(timezone.utc)
    client = get_client()
    targets = load_targets(client, args.limit)
    print(f"  {len(targets)} OPCVM/ETF sans kid_url\n")
    if not targets:
        return

    lock = threading.Lock()
    pending = []
    totals = {"found": 0, "miss": 0, "written": 0, "failed": 0}

    def flush():
        if not pending or not args.apply:
            pending.clear()
            return
        batch = pending[:]
        pending.clear()
        st = safe_fill_funds(batch, source="amfinesoft-epr")
        totals["written"] += st["rows_updated"]
        totals["failed"] += st["failed"]
        print(f"    → flush {len(batch)} : {st['rows_updated']} kid_url écrits", flush=True)

    def process(arg):
        i, fund = arg
        session = FetcherSession(impersonate="chrome").__enter__()
        url = find_kid(session, fund["isin"])
        with lock:
            if url:
                totals["found"] += 1
                pending.append({"isin": fund["isin"], "kid_url": url})
                if totals["found"] <= 15 or totals["found"] % 200 == 0:
                    print(f"  ✓ [{i:5d}] {fund['isin']} | {(fund.get('name') or '')[:34]}", flush=True)
            else:
                totals["miss"] += 1
            if len(pending) >= FLUSH_EVERY:
                flush()

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(targets, 1)))
    flush()

    rate = round(100 * totals["found"] / max(1, totals["found"] + totals["miss"]))
    print(f"\n  ✓ {totals['found']} DICI trouvés ({rate}% hit), {totals['miss']} sans")
    if args.apply:
        print(f"  → {totals['written']} kid_url écrits, {totals['failed']} échecs")
        log_run("epr-kid-enrich", "success" if totals["failed"] == 0 else "partial",
                totals["written"], totals["failed"], started_at=started)
    else:
        print("  DRY-RUN — aucune écriture.")


if __name__ == "__main__":
    main()
