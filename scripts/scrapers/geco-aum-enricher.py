#!/usr/bin/env python3
"""
geco-aum-enricher.py — AUM des OPCVM depuis AMF GECO share endpoint
====================================================================
Pour chaque OPCVM/ETF sans aum_eur, récupère l'AUM depuis l'API GECO
via le endpoint share/{shareId} → netAssetValueDTOS[0].assetUnderManagement

Usage :
    python3 scripts/scrapers/geco-aum-enricher.py [--apply] [--limit N]
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
RATE_LIMIT_SEC = 1.0
TIMEOUT        = 12
GECO_BASE      = "https://geco.amf-france.org/back-office"

HEADERS = {
    "Accept":       "application/json",
    "User-Agent":   "Mozilla/5.0 (compatible; Charlie-Investissement/1.0; data@charlie.fr)",
    "Referer":      "https://geco.amf-france.org/",
    "Content-Type": "application/json",
    "Origin":       "https://geco.amf-france.org",
}

SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ")


def _get_share_aum(session: FetcherSession, isin: str) -> int | None:
    """
    Récupère l'AUM depuis GECO pour un ISIN.
    Retourne l'AUM en euros (entier).
    """
    # Méthode directe : shareByCmpCodeParPrincp/{ISIN}
    try:
        r = session.get(
            f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{isin}",
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if r.status == 200 and r.body.decode("utf-8").strip() not in ("", "null", "{}"):
            share = json.loads(r.body.decode("utf-8"))
            if isinstance(share, dict) and share.get("idInterne"):
                share_id = share["idInterne"]
                # Fetch share details to get AUM
                r2 = session.get(
                    f"{GECO_BASE}/funds/share/{share_id}",
                    stealthy_headers=True, timeout=TIMEOUT,
                )
                if r2.status == 200:
                    data = json.loads(r2.body.decode("utf-8"))
                    navs = data.get("netAssetValueDTOS", [])
                    if navs:
                        # Last entry (most recent)
                        aum_k = navs[0].get("assetUnderManagement")
                        if aum_k and float(aum_k) > 0:
                            return int(float(aum_k) * 1000)  # K€ → €
    except (Exception, ValueError, KeyError):
        pass
    return None


def run(apply: bool, limit: int | None, isin_filter: str | None):
    print("=" * 60)
    print("  GECO AUM Enricher — Actifs sous gestion depuis AMF")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite  : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    if isin_filter:
        funds = [{"isin": isin_filter, "name": ""}]
    else:
        funds: list[dict] = []
        seen: set[str] = set()
        page_size = 1000
        offset = 0

        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin, name, product_type")
                .in_("product_type", ["opcvm", "etf", "fpci", "fip", "fcpi", "fcpr", "fps", "opci", "sci"])
                .is_("aum_eur", "null")
                .like("isin", "FR%")
                .range(offset, offset + page_size - 1)
                .execute().data or []
            )
            for row in batch:
                isin = row["isin"]
                if isin not in seen and len(isin) == 12:
                    name_lower = (row.get("name") or "").lower()
                    if not any(p in name_lower for p in SKIP_PATTERNS):
                        seen.add(isin)
                        funds.append(row)
            if len(batch) < page_size:
                break
            if limit and len(funds) >= limit * 2:
                break
            offset += page_size

        if limit:
            funds = funds[:limit]

    print(f"  {len(funds)} fonds à enrichir (AUM manquant)")
    print()

    found    = 0
    not_found = 0
    lock      = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, not_found
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:35]

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT_SEC)

        aum = _get_share_aum(session, isin)
        with lock:
            if aum:
                found += 1
                if apply:
                    upsert_fund({"isin": isin, "aum_eur": aum})
                if i <= 30 or i % 200 == 0:
                    aum_m = f"{aum/1_000_000:.1f}M€"
                    print(f"  ✓ [{i:5d}] {isin} | AUM:{aum_m:10} | {name}")
            else:
                not_found += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ~ [{i:5d}] {isin} | no AUM | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} enrichis, {not_found} sans AUM")

    if apply:
        log_run("geco-aum-enricher", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GECO AUM Enricher")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    parser.add_argument("--isin",   type=str,            help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
