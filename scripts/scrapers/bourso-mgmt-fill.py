#!/usr/bin/env python3
"""
bourso-mgmt-fill.py — Remplit management_company depuis Boursorama (2026-07-17)
================================================================================
Chantier "principales sociétés de gestion" : GECO ne référence plus les OPCVM
étrangers au niveau ISIN (endpoint shareByCmpCodeParPrincp vide pour LU/IE,
liste NON_FR = FIA sans ISIN). Boursorama affiche en revanche la
« Société de gestion » sur chaque fiche OPCVM/ETF :

    <p class="c-list-info__heading"> Société de gestion </p>
    <p class="c-list-info__value ...">Amundi Luxembourg S.A.</p>

FILL-ONLY (via db.safe_fill_funds, jamais d'écrasement) : cible les fonds
opcvm/etf dont management_company est NULL, ISIN réel, hors fonds dédiés.

Usage :
    python3 scripts/scrapers/bourso-mgmt-fill.py [--apply] [--limit N] [--isin ISIN]
"""

import re
import sys
import time
import argparse
import threading
import concurrent.futures
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, safe_fill_funds, log_run

WORKERS    = 3
RATE_LIMIT = 0.8
TIMEOUT    = 25
BATCH_DB   = 100

BOURSO_URL     = "https://www.boursorama.com/bourse/opcvm/cours/{isin}/"
BOURSO_ETF_URL = "https://www.boursorama.com/bourse/trackers/cours/{isin}/"

_ISIN_RE = re.compile(r'^[A-Z]{2}[A-Z0-9]{9}[0-9]$')
SKIP_NAME = re.compile(r'fonds d[ée]di[ée]|\*\*\*|\bfcpe\b|\bficpv\b', re.IGNORECASE)

# <p ...heading> Société de gestion </p><p ...value ...> XXX </p> (valeur texte ou lien)
SG_RE = re.compile(
    r'Société de gestion\s*</p>\s*<p[^>]*>(?:\s*<a[^>]*>)?\s*([^<]+?)\s*<',
    re.IGNORECASE | re.DOTALL)

_rate_lock = threading.Lock()
_last_req = [0.0]


def _throttle():
    with _rate_lock:
        wait = _last_req[0] + RATE_LIMIT / WORKERS - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_req[0] = time.time()


def fetch_sg(sess, isin, product_type):
    urls = [BOURSO_ETF_URL, BOURSO_URL] if product_type == "etf" else [BOURSO_URL, BOURSO_ETF_URL]
    for tpl in urls:
        _throttle()
        try:
            page = sess.get(tpl.format(isin=isin), stealthy_headers=True, timeout=TIMEOUT)
            if page.status != 200 or not page.body or len(page.body) < 10000:
                continue
            html = page.body.decode("utf-8", "ignore")
            m = SG_RE.search(html)
            if m:
                sg = re.sub(r"\s+", " ", m.group(1)).strip()
                if 2 < len(sg) < 90:
                    return sg
            return None  # page trouvée mais pas de SG → inutile d'essayer l'autre URL
        except Exception:
            continue
    return None


def load_targets(limit=None, only_isin=None):
    client = get_client()
    if only_isin:
        rows = (client.table("investissement_funds")
                .select("isin,name,product_type").eq("isin", only_isin).execute().data)
        return rows
    targets = []
    for pt in ("opcvm", "etf"):
        offset = 0
        while True:
            rows = (client.table("investissement_funds")
                    .select("isin,name,product_type")
                    .eq("product_type", pt).is_("management_company", "null")
                    .order("isin").range(offset, offset + 999).execute().data)
            if not rows:
                break
            targets.extend(rows)
            if len(rows) < 1000:
                break
            offset += 1000
    targets = [t for t in targets
               if _ISIN_RE.match(t["isin"]) and not SKIP_NAME.search(t.get("name") or "")]
    if limit:
        targets = targets[:limit]
    return targets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--isin")
    args = ap.parse_args()

    print("=" * 60)
    print(f"  BOURSO MGMT FILL — {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 60)

    targets = load_targets(args.limit, args.isin)
    print(f"  Cibles (mgmt NULL, ISIN réel, hors dédiés) : {len(targets)}")

    found, misses, pending = [], 0, []
    lock = threading.Lock()
    sessions = [FetcherSession(impersonate="chrome").__enter__() for _ in range(WORKERS)]
    stats = {"filled": 0, "failed": 0}

    def flush(force=False):
        nonlocal pending
        with lock:
            if pending and (force or len(pending) >= BATCH_DB):
                batch, pending = pending, []
            else:
                return
        if args.apply:
            r = safe_fill_funds(batch, source="boursorama")
            stats["filled"] += r.get("fields_filled", 0)
            stats["failed"] += r.get("failed", 0)
            print(f"    … écrit {len(batch)} (cumul rempli={stats['filled']})", flush=True)

    def work(idx_t):
        nonlocal misses
        idx, t = idx_t
        sg = fetch_sg(sessions[idx % WORKERS], t["isin"], t["product_type"])
        with lock:
            if sg:
                found.append((t["isin"], sg))
                pending.append({"isin": t["isin"], "management_company": sg})
            else:
                misses += 1
            n = len(found) + misses
            if n % 200 == 0:
                print(f"  {n}/{len(targets)} traités — {len(found)} SG trouvées", flush=True)
        flush()

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(work, enumerate(targets)))
    flush(force=True)

    print("\n" + "=" * 60)
    print(f"  Traités : {len(targets)} | SG trouvées : {len(found)} | introuvables : {misses}")
    for isin, sg in found[:30]:
        print(f"    {isin}  → {sg}")
    if len(found) > 30:
        print(f"    ... (+{len(found) - 30})")
    if args.apply:
        print(f"  Écrit : fields_filled={stats['filled']}, failed={stats['failed']}")
        log_run("bourso-mgmt-fill", "success",
                records_processed=len(targets), records_failed=stats["failed"])
    else:
        print("\n  DRY-RUN — rien écrit. Relancer avec --apply.")


if __name__ == "__main__":
    main()
