#!/usr/bin/env python3
"""
geco-safe-enrich.py — Enrichissement FILL-ONLY depuis AMF GECO (sans écrasement)
=================================================================================
Réutilise le fetch de scrapers/amf-geco-full.py mais applique via db.safe_fill_funds :
  - ne remplit QUE les colonnes NULL des fonds existants (merge field_sources)
  - insère les nouveaux ISIN (supports nets supplémentaires)
  - ne recalcule PAS data_completeness des fonds existants (préserve la richesse)

Contraste avec amf-geco-full.py --apply qui fait un upsert destructif.

Usage :
    python3 scripts/enrichers/geco-safe-enrich.py [--apply] [--limit N]
Sans --apply : dry-run (collecte + diff, aucune écriture).
"""

import sys
import argparse
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import safe_fill_funds, log_run, get_client

# Import du module scraper (nom de fichier avec tirets → importlib)
_geco_path = Path(__file__).parent.parent / "scrapers" / "amf-geco-full.py"
_spec = importlib.util.spec_from_file_location("amf_geco_full", str(_geco_path))
geco = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(geco)

from scrapling.fetchers import FetcherSession


def collect(limit: int | None) -> list[dict]:
    """Collecte les compartiments GECO, dédupliqués par ISIN."""
    session = FetcherSession(impersonate="chrome").__enter__()
    rows: list[dict] = []
    seen: set[str] = set()
    offset = 0
    empty = 0
    import time
    while True:
        if limit and len(rows) >= limit:
            break
        raw = geco.fetch_page(session, offset)
        if not raw:
            empty += 1
            if empty >= geco.MAX_EMPTY_PAGES:
                break
            offset += geco.PAGE_SIZE
            continue
        empty = 0
        for r in raw:
            m = geco.map_geco_record(r)
            if m and m["isin"] not in seen:
                seen.add(m["isin"])
                rows.append(m)
        print(f"  offset={offset:>6}  collectés={len(rows)}", flush=True)
        offset += geco.PAGE_SIZE
        time.sleep(geco.RATE_LIMIT_SEC)
    return rows[:limit] if limit else rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    print("=" * 64)
    print("  AMF GECO — Enrichissement FILL-ONLY (sans écrasement)")
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print("=" * 64)

    started = datetime.now(timezone.utc)
    records = collect(args.limit)
    print(f"\n  {len(records)} fonds collectés depuis GECO\n")

    if not records:
        print("  Rien à faire.")
        return

    # Diff : combien d'existants vs nouveaux (lecture seule)
    client = get_client()
    isins = [r["isin"] for r in records]
    known = set()
    for i in range(0, len(isins), 300):
        r = client.table("investissement_funds").select("isin").in_("isin", isins[i:i + 300]).execute()
        known |= {x["isin"] for x in (r.data or [])}
    n_new = len([i for i in isins if i not in known])
    print(f"  {len(known)} déjà en base · {n_new} nouveaux ISIN")

    if not args.apply:
        print("\n  DRY-RUN — aucune écriture. Exemples :")
        for m in records[:5]:
            tag = "NOUVEAU" if m["isin"] not in known else "existant"
            print(f"    [{tag}] {m['isin']} | {m['name'][:46]} | {m['category']}")
        return

    print("\n  Application FILL-ONLY...")
    stats = safe_fill_funds(records, source="amf-geco")
    print(f"\n  ✓ {stats['new_inserted']} nouveaux fonds insérés")
    print(f"  ✓ {stats['rows_updated']} fonds enrichis ({stats['fields_filled']} champs NULL remplis)")
    print(f"  ✗ {stats['failed']} échecs")

    log_run(
        scraper="geco-safe-enrich",
        status="success" if stats["failed"] == 0 else "partial",
        records_processed=stats["new_inserted"] + stats["rows_updated"],
        records_failed=stats["failed"],
        started_at=started,
    )


if __name__ == "__main__":
    main()
