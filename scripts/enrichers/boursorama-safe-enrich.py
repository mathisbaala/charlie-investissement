#!/usr/bin/env python3
"""
boursorama-safe-enrich.py — Métriques OPCVM/ETF FR via Boursorama (FILL-ONLY)
=============================================================================
Réutilise le parseur HTML de scrapers/boursorama-enricher.py mais applique via
db.safe_fill_funds : remplit uniquement les colonnes NULL (perf 1Y/3Y/5Y, SRRI,
Morningstar, AUM, TER), merge field_sources, ne touche pas la complétude des
fonds déjà riches. Aucune écriture destructive (contraste avec upsert_fund).

Cibles : OPCVM/ETF FR sans performance_1y, triés par AUM décroissant (les plus
gros d'abord). Flush périodique → résilient aux interruptions.

Usage :
    python3 scripts/enrichers/boursorama-safe-enrich.py [--apply] [--limit N]
"""

import sys
import time
import argparse
import threading
import importlib.util
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import safe_fill_funds, log_run, get_client

# Import du parseur Boursorama (fichier à tirets → importlib)
_bp = Path(__file__).parent.parent / "scrapers" / "boursorama-enricher.py"
_spec = importlib.util.spec_from_file_location("boursorama_enricher", str(_bp))
bz = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bz)

from scrapling.fetchers import FetcherSession

WORKERS = 4
RATE = 0.6
FLUSH_EVERY = 300
SKIP = ("fonds dédié", "***", "ficpv ", "fcpe ")


def load_targets(client, limit):
    funds, offset, page = [], 0, 1000
    while True:
        # Boursorama couvre les fonds commercialisés en France (FR/LU/IE surtout).
        # Tri AUM décroissant : les plus gros (donc les plus pertinents CGP) d'abord ;
        # les misses sont des appels rapides.
        q = client.table("investissement_funds") \
            .select("isin, name, aum_eur") \
            .in_("product_type", ["opcvm", "etf"]) \
            .is_("performance_1y", "null") \
            .or_("isin.like.FR*,isin.like.LU*,isin.like.IE*") \
            .order("aum_eur", desc=True, nullsfirst=False) \
            .range(offset, offset + page - 1)
        batch = q.execute().data or []
        funds += [r for r in batch if not any(p in (r.get("name") or "").lower() for p in SKIP)]
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
    print("  Boursorama — Métriques OPCVM/ETF FR (FILL-ONLY)")
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    started = datetime.now(timezone.utc)
    client = get_client()
    targets = load_targets(client, args.limit)
    print(f"  {len(targets)} cibles (FR, sans perf_1y, par AUM décroissant)\n")
    if not targets:
        return

    lock = threading.Lock()
    pending, totals = [], {"found": 0, "miss": 0, "filled": 0, "new": 0, "updated": 0, "failed": 0}

    def flush():
        if not pending or not args.apply:
            pending.clear()
            return
        batch = pending[:]
        pending.clear()
        st = safe_fill_funds(batch, source="boursorama")
        totals["filled"] += st["fields_filled"]
        totals["updated"] += st["rows_updated"]
        totals["new"] += st["new_inserted"]
        totals["failed"] += st["failed"]
        print(f"    → flush {len(batch)} : +{st['fields_filled']} champs, {st['rows_updated']} fonds", flush=True)

    def process(arg):
        i, fund = arg
        isin = fund["isin"]
        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE)
        try:
            data = bz.fetch_boursorama(session, isin)
        except Exception:
            data = {}
        has = data.get("performance_1y") is not None or data.get("srri") is not None \
            or data.get("ongoing_charges") is not None or data.get("aum_eur") is not None
        with lock:
            if has:
                totals["found"] += 1
                pending.append({"isin": isin, **data})
                if i <= 20 or i % 250 == 0:
                    p1 = f"{data.get('performance_1y'):+.1f}%" if data.get("performance_1y") is not None else "—"
                    print(f"  ✓ [{i:5d}] {isin} | p1y {p1} | SRRI {data.get('srri','?')} | AUM {data.get('aum_eur','—')}", flush=True)
            else:
                totals["miss"] += 1
            if len(pending) >= FLUSH_EVERY:
                flush()

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(targets, 1)))
    flush()

    print(f"\n  ✓ {totals['found']} fonds avec données, {totals['miss']} sans")
    if args.apply:
        print(f"  → {totals['updated']} enrichis (+{totals['filled']} champs NULL), "
              f"{totals['new']} nouveaux, {totals['failed']} échecs")
        log_run("boursorama-safe-enrich",
                "success" if totals["failed"] == 0 else "partial",
                totals["updated"] + totals["new"], totals["failed"], started_at=started)
    else:
        print("  DRY-RUN — aucune écriture.")


if __name__ == "__main__":
    main()
