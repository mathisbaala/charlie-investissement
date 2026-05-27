#!/usr/bin/env python3
"""
quantalys-category-enricher.py — Catégories + Société de gestion via Quantalys
================================================================================
Cible les OPCVM/ETF sans `category` présents dans le catalogue Quantalys.
Extrait :
  - category  (ex : "Actions Zone Euro", "Monétaire euro dynamique")
  - management_company  (société de gestion)

Usage :
    python3 scripts/scrapers/quantalys-category-enricher.py           # dry-run
    python3 scripts/scrapers/quantalys-category-enricher.py --apply
    python3 scripts/scrapers/quantalys-category-enricher.py --apply --limit 200
"""

import re
import sys
import json
import html as htmllib
import time
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS        = 2
RATE_LIMIT_SEC = 1.5
TIMEOUT_SEC    = 25
HOME_URL       = "https://www.quantalys.com/"
CATALOG_URL    = "https://www.quantalys.com/Recherche/Produits"
FUND_URL       = "https://www.quantalys.com/Fonds/{fund_id}"

_thread_local = threading.local()


# ─── Session ──────────────────────────────────────────────────────────────────

def init_session() -> FetcherSession:
    sess = FetcherSession(impersonate="chrome").__enter__()
    page = sess.get(HOME_URL, stealthy_headers=True, timeout=TIMEOUT_SEC)
    m = re.search(r"location\.href='(/[^']+)'", page.body.decode("utf-8") if page.body else "")
    if m:
        sess.get(f"https://www.quantalys.com{m.group(1)}", stealthy_headers=True, timeout=TIMEOUT_SEC)
    return sess


def get_thread_session() -> FetcherSession:
    if not hasattr(_thread_local, "sess"):
        _thread_local.sess = init_session()
    return _thread_local.sess


# ─── Catalogue ────────────────────────────────────────────────────────────────

def fetch_catalog(sess: FetcherSession) -> dict[str, int]:
    def _get(s: FetcherSession) -> bytes:
        page = s.get(CATALOG_URL,
                     headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"},
                     timeout=60)
        if page.status != 200 or not page.body:
            raise RuntimeError(f"HTTP {page.status}")
        return page.body

    body = _get(sess)
    raw = body.decode("utf-8")
    if raw.strip().startswith("<"):
        m = re.search(r"location\.href='(/[^']+)'", raw)
        if m:
            sess.get(f"https://www.quantalys.com{m.group(1)}", stealthy_headers=True, timeout=15)
            body = _get(sess)
            raw = body.decode("utf-8")

    funds = json.loads(raw)
    return {f["sCodeISIN"]: f["ID_Produit"] for f in funds if f.get("sCodeISIN")}


# ─── Parser ───────────────────────────────────────────────────────────────────

def parse_category_page(html: str) -> dict:
    result: dict = {}

    # Catégorie Quantalys — via le lien lstCategorie=N
    m = re.search(r'lstCategorie=\d+[^>]*>([^<]+)</a>', html)
    if m:
        cat = htmllib.unescape(m.group(1).strip())
        if cat and len(cat) > 2:
            result["category"] = cat

    # Société de gestion — via lien idSdG=N dans la dt Société de gestion
    idx = html.find("Société de gestion")
    if idx >= 0:
        block = html[idx:idx + 800]
        m2 = re.search(r'idSdG=\d+[^>]*>([^<]+)</a>', block)
        if m2:
            mgmt = htmllib.unescape(m2.group(1).strip())
            if mgmt and len(mgmt) > 2:
                result["management_company"] = mgmt

    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Quantalys Category Enricher")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite  : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    print("  Initialisation session Quantalys…")
    main_sess = init_session()

    print("  Téléchargement catalogue Quantalys…")
    catalog = fetch_catalog(main_sess)
    print(f"  {len(catalog)} fonds dans le catalogue")

    # Récupérer les OPCVM/ETF sans category ET dans le catalogue Quantalys
    print("  Récupération des fonds sans category…")
    funds_in_catalog: list[dict] = []
    seen: set[str] = set()
    PAGE = 1000
    offset = 0

    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name, category, management_company")
            .in_("product_type", ["opcvm", "etf"])
            .range(offset, offset + PAGE - 1)
            .execute().data or []
        )
        for row in batch:
            isin = row["isin"]
            if isin in seen or isin not in catalog:
                continue
            # Cibler ceux sans category OU sans management_company
            needs_cat  = not row.get("category")
            needs_mgmt = not row.get("management_company")
            if needs_cat or needs_mgmt:
                seen.add(isin)
                row["fund_id"] = catalog[isin]
                funds_in_catalog.append(row)
        if len(batch) < PAGE:
            break
        offset += PAGE

    print(f"  {len(funds_in_catalog)} fonds à enrichir (catégorie ou société de gestion manquante)")
    if limit:
        funds_in_catalog = funds_in_catalog[:limit]
    print()

    found    = 0
    not_found = 0
    lock     = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, not_found
        i, row = args
        isin    = row["isin"]
        fund_id = row["fund_id"]
        name    = (row.get("name") or "")[:35]

        sess = get_thread_session()
        time.sleep(RATE_LIMIT_SEC)

        try:
            r = sess.get(FUND_URL.format(fund_id=fund_id), stealthy_headers=True, timeout=TIMEOUT_SEC)
            if r.status != 200 or not r.body:
                with lock:
                    not_found += 1
                return
            html = r.body.decode("utf-8", errors="replace")
        except Exception:
            with lock:
                not_found += 1
            return

        data = parse_category_page(html)
        if not data:
            with lock:
                not_found += 1
            return

        # Ne mettre à jour que les champs manquants
        updates: dict = {}
        if not row.get("category") and "category" in data:
            updates["category"] = data["category"]
        if not row.get("management_company") and "management_company" in data:
            updates["management_company"] = data["management_company"]

        if not updates:
            with lock:
                not_found += 1
            return

        with lock:
            found += 1
            parts = []
            if "category" in updates:
                parts.append(f"cat={updates['category'][:25]}")
            if "management_company" in updates:
                parts.append(f"mgmt={updates['management_company'][:20]}")
            if i <= 30 or i % 200 == 0:
                print(f"  ✓ [{i:5d}] {isin} | {' | '.join(parts)} | {name}")

        if apply:
            upsert_fund({"isin": isin, **updates})

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds_in_catalog, 1)))

    print()
    print(f"  ✓ {found} enrichis, {not_found} sans données")

    if apply:
        log_run("quantalys-category-enricher", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Quantalys Category Enricher")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
