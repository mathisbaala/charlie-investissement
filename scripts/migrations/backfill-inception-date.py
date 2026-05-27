#!/usr/bin/env python3
"""
backfill-inception-date.py — Récupère InceptionDate depuis Morningstar
=======================================================================
Pour les fonds avec morningstar_rating mais sans inception_date,
interroge l'API Morningstar pour obtenir la date de création.

Usage :
    python3 scripts/migrations/backfill-inception-date.py [--apply] [--limit N]
"""

import sys
import time
import argparse
import concurrent.futures
import threading
from scrapling.fetchers import FetcherSession
import json
import re
from datetime import datetime, date, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

WORKERS        = 5
RATE_LIMIT_SEC = 0.45
SEARCH_URL     = "https://www.morningstar.fr/fr/util/SecuritySearch.ashx"
DETAILS_URL    = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{ms_id}"
HEADERS        = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept":          "application/json",
    "Accept-Language": "fr-FR,fr;q=0.9",
}
TIMEOUT        = 12


def get_ms_id(session: FetcherSession, isin: str) -> str | None:
    try:
        time.sleep(RATE_LIMIT_SEC)
        r = session.get(SEARCH_URL, params={"q": isin, "limit": "1"}, stealthy_headers=True, timeout=TIMEOUT)
        if r.status != 200:
            return None
        text = r.body.decode("utf-8")
        parts = text.split("|")
        for p in parts:
            if p.startswith("{"):
                try:
                    data = json.loads(p)
                    return data.get("i")
                except Exception:
                    pass
    except Exception:
        pass
    return None


def get_inception_date(session: FetcherSession, ms_id: str) -> str | None:
    try:
        time.sleep(RATE_LIMIT_SEC)
        r = session.get(
            DETAILS_URL.format(ms_id=ms_id),
            params={"viewId": "snapshot", "locale": "fr-FR", "currencyId": "EUR", "responseViewFormat": "json"},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if r.status != 200:
            return None
        data = r.json()
        if data and isinstance(data, list):
            raw = data[0].get("InceptionDate")
            if raw:
                return raw[:10]
    except (Exception, ValueError):
        pass
    return None


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Backfill InceptionDate depuis Morningstar")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Fonds avec morningstar_rating mais sans inception_date
    funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds").select("isin,name") \
            .not_.is_("morningstar_rating", "null") \
            .is_("inception_date", "null") \
            .range(offset, offset + 999).execute().data or []
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} fonds à traiter\n")

    found = 0
    not_found = 0
    lock = threading.Lock()
    now = datetime.now(timezone.utc).isoformat()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, not_found
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        session = FetcherSession(impersonate="chrome")
        ms_id = get_ms_id(session, isin)
        if not ms_id:
            with lock:
                not_found += 1
            return

        inc_date = get_inception_date(session, ms_id)
        if not inc_date:
            with lock:
                not_found += 1
            return

        with lock:
            found += 1
            if i <= 10 or i % 200 == 0:
                years = round((date.today() - date.fromisoformat(inc_date)).days / 365.25, 1)
                print(f"  ✓ [{i:4d}] {isin} | {inc_date} ({years}Y) | {name}")
            if apply:
                try:
                    inc = date.fromisoformat(inc_date)
                    years = round((date.today() - inc).days / 365.25, 1)
                    client.table("investissement_funds").update({
                        "inception_date":     inc_date,
                        "track_record_years": years,
                        "updated_at":         now,
                    }).eq("isin", isin).execute()
                except Exception as e:
                    if found <= 3:
                        print(f"  ✗ DB write error {isin}: {e}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print(f"\n  → {found} inception_dates récupérées, {not_found} non trouvées")
    if apply:
        log_run("backfill-inception-date", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
