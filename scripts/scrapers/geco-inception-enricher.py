#!/usr/bin/env python3
"""
geco-inception-enricher.py — Date de création des OPCVM FR depuis GECO
=======================================================================
Cible les OPCVM/ETF FR (ISIN FR*) sans inception_date.
Extrait cmpDateCreation depuis l'API compartiment AMF GECO.

Usage :
    python3 scripts/scrapers/geco-inception-enricher.py [--apply] [--limit N]
"""

import sys
import time
import json
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

WORKERS        = 4
RATE_LIMIT_SEC = 0.8
TIMEOUT        = 12
GECO_BASE      = "https://geco.amf-france.org/back-office"

SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ")


def fetch_geco_inception(session: FetcherSession, isin: str) -> str | None:
    """Retourne la date de création (YYYY-MM-DD) depuis GECO pour un ISIN FR."""
    try:
        r = session.get(
            f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{isin}",
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if r.status != 200 or not r.body:
            return None
        body = r.body.decode("utf-8").strip()
        if body in ("", "null", "{}"):
            return None
        share = json.loads(body)
        if not isinstance(share, dict):
            return None

        # Essayer parDateCreation dans la part (plus précis)
        par_date = (share.get("parDateCreation") or "").strip()
        if par_date:
            return par_date[:10]

        cmp_id = share.get("cmpId")
        if not cmp_id:
            return None

        r2 = session.get(
            f"{GECO_BASE}/funds/compartment/{cmp_id}",
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if r2.status != 200 or not r2.body:
            return None
        comp = json.loads(r2.body.decode("utf-8"))
        cmp_date = (comp.get("cmpDateCreation") or "").strip()
        return cmp_date[:10] if cmp_date else None

    except Exception:
        return None


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  GECO Inception Enricher — Date de création AMF")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite  : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # FR OPCVM/ETF sans inception_date
    print("  Récupération des fonds FR sans inception_date…")
    funds: list[dict] = []
    seen: set[str] = set()
    PAGE = 1000
    offset = 0

    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name")
            .in_("product_type", ["opcvm", "etf"])
            .like("isin", "FR%")
            .is_("inception_date", "null")
            .range(offset, offset + PAGE - 1)
            .execute().data or []
        )
        for row in batch:
            isin = row["isin"]
            if isin in seen or len(isin) != 12:
                continue
            name_lower = (row.get("name") or "").lower()
            if any(p in name_lower for p in SKIP_PATTERNS):
                continue
            seen.add(isin)
            funds.append(row)
        if len(batch) < PAGE:
            break
        if limit and len(funds) >= limit * 2:
            break
        offset += PAGE

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} fonds FR sans inception_date")
    print()

    found = not_found = 0
    lock = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, not_found
        i, row = args
        isin = row["isin"]
        name = (row.get("name") or "")[:40]

        with FetcherSession(impersonate="chrome") as session:
            time.sleep(RATE_LIMIT_SEC)
            date_val = fetch_geco_inception(session, isin)

        if date_val:
            with lock:
                found += 1
                if i <= 30 or i % 200 == 0:
                    print(f"  ✓ [{i:5d}] {isin} | inc={date_val} | {name}")
            if apply:
                upsert_fund({"isin": isin, "inception_date": date_val})
        else:
            with lock:
                not_found += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ~ [{i:5d}] {isin} | not found | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} dates de création récupérées, {not_found} non trouvées")

    if apply:
        log_run("geco-inception-enricher", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GECO Inception Date Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
