#!/usr/bin/env python3
"""
geco-category-enricher.py — Catégorie AMF + Société de gestion depuis GECO
===========================================================================
Cible les OPCVM/ETF français (ISIN FR*) sans `category` ou sans
`management_company`. Les données viennent de l'API compartiments AMF GECO.

Champs enrichis :
  - category          (cmpClssFndAmfLib — catégorie AMF officielle)
  - management_company (gestionnaire — société de gestion AMF enregistrée)

Usage :
    python3 scripts/scrapers/geco-category-enricher.py           # dry-run
    python3 scripts/scrapers/geco-category-enricher.py --apply
    python3 scripts/scrapers/geco-category-enricher.py --apply --limit 500
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

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS        = 3
RATE_LIMIT_SEC = 0.8
TIMEOUT        = 15
GECO_BASE      = "https://geco.amf-france.org/back-office"

HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    "Referer":      "https://geco.amf-france.org/",
    "Origin":       "https://geco.amf-france.org",
}

SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ")


# ─── GECO lookup ──────────────────────────────────────────────────────────────

def fetch_geco_meta(session: FetcherSession, isin: str) -> dict | None:
    """
    Retourne {category, management_company} depuis GECO pour un ISIN FR.
    Pipeline : shareByCmpCodeParPrincp → cmpId → /funds/compartment/{cmpId}
    """
    # Étape 1 : obtenir le cmpId via la part
    cmp_id: str | None = None
    try:
        r = session.get(
            f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{isin}",
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if r.status == 200 and r.body:
            body = r.body.decode("utf-8").strip()
            if body not in ("", "null", "{}"):
                share = json.loads(body)
                if isinstance(share, dict):
                    cmp_id = share.get("cmpId")  # ex: "c100608"
    except Exception:
        pass

    if not cmp_id:
        return None

    # Étape 2 : détails du compartiment (catégorie + gestionnaire)
    try:
        r2 = session.get(
            f"{GECO_BASE}/funds/compartment/{cmp_id}",
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if r2.status != 200 or not r2.body:
            return None
        comp = json.loads(r2.body.decode("utf-8"))
    except Exception:
        return None

    result: dict = {}

    cat_lib = (comp.get("cmpClssFndAmfLib") or "").strip()
    if cat_lib and len(cat_lib) > 2 and cat_lib.lower() not in ("nan", "nc", "n/a"):
        result["category"] = cat_lib

    mgmt = (comp.get("gestionnaire") or "").strip()
    if mgmt and len(mgmt) > 2:
        result["management_company"] = mgmt

    return result if result else None


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  GECO Category Enricher — Catégorie AMF + Gestionnaire")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite  : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Cibler les OPCVM/ETF FR sans category OU sans management_company
    print("  Récupération des fonds FR à enrichir…")
    funds: list[dict] = []
    seen:  set[str]   = set()
    PAGE  = 1000
    offset = 0

    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name, category, management_company")
            .in_("product_type", ["opcvm", "etf"])
            .like("isin", "FR%")
            .range(offset, offset + PAGE - 1)
            .execute().data or []
        )
        for row in batch:
            isin = row["isin"]
            if isin in seen:
                continue
            if len(isin) != 12:
                continue
            name_lower = (row.get("name") or "").lower()
            if any(p in name_lower for p in SKIP_PATTERNS):
                continue
            needs_cat  = not row.get("category")
            needs_mgmt = not row.get("management_company")
            if needs_cat or needs_mgmt:
                seen.add(isin)
                funds.append(row)
        if len(batch) < PAGE:
            break
        if limit and len(funds) >= limit * 2:
            break
        offset += PAGE

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} fonds FR à enrichir")
    print()

    found     = 0
    not_found = 0
    lock      = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, not_found
        i, row = args
        isin = row["isin"]
        name = (row.get("name") or "")[:35]

        with FetcherSession(impersonate="chrome") as session:
            time.sleep(RATE_LIMIT_SEC)
            meta = fetch_geco_meta(session, isin)

        if not meta:
            with lock:
                not_found += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ~ [{i:5d}] {isin} | not found | {name}")
            return

        # Ne mettre à jour que les champs manquants
        updates: dict = {}
        if not row.get("category") and "category" in meta:
            updates["category"] = meta["category"]
        if not row.get("management_company") and "management_company" in meta:
            updates["management_company"] = meta["management_company"]

        if not updates:
            with lock:
                not_found += 1
            return

        with lock:
            found += 1
            if i <= 30 or i % 200 == 0:
                parts = []
                if "category" in updates:
                    parts.append(f"cat={updates['category'][:25]}")
                if "management_company" in updates:
                    parts.append(f"mgmt={updates['management_company'][:20]}")
                print(f"  ✓ [{i:5d}] {isin} | {' | '.join(parts)} | {name}")

        if apply:
            upsert_fund({"isin": isin, **updates})

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} enrichis, {not_found} non trouvés/déjà complets")

    if apply:
        log_run("geco-category-enricher", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GECO Category + Management Company Enricher")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
