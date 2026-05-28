#!/usr/bin/env python3
"""
reclassify-insurance-stocks.py — Reclassification des actions individuelles stockées comme OPCVM
================================================================================================
Les scrapers AXA/Cardif ont importé des actions individuelles (US, JP, DE, GB…)
avec product_type="opcvm". Ce script les reclasse en "action".

Critères de reclassification (TOUS requis) :
  1. product_type = "opcvm"
  2. ISIN prefix non-fonds (US, JP, DE sauf fonds, GB, NL, CH, BE, SE…)
  3. data_source = "axa-fr" ou "cardif-fr"
  4. ter IS NULL (conserver les vrais fonds US enregistrés en assurance)
  5. Nom NE contient PAS de termes fonds (FUND, ETF, SICAV, FCP, UCITS, INDEX)

Exclusions explicites :
  - ISIN FR/LU/IE : toujours des fonds
  - Noms "FUND", "ETF", "SICAV", "FCP", "UCITS", "INDEX" : vrais fonds

Usage :
    python3 scripts/migrations/reclassify-insurance-stocks.py           # dry-run
    python3 scripts/migrations/reclassify-insurance-stocks.py --apply
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

INSURANCE_SOURCES = {"axa-fr", "cardif-fr"}
FUND_KEYWORDS     = ("fund", "etf", "sicav", "fcp", "ucits", "index", "tracker",
                     "compartiment", "fonds", "memoire", "mémoire", "autocall",
                     "phoenix", "phénix", "barrier", " note ", "certificat",
                     "structured", "autocallable", "capital protégé", "garanti",
                     # Obligations / produits de taux US/JP
                     "treasury", "t-note", "t-bill", "bond", "bund", "gilt",
                     "obligation", "etats-unis", "japan govt",
                     # ETFs indiciels US courants
                     "spdr", "ishares", "vanguard", "invesco", "s&p", "nasdaq",
                     "dow jones", "russell", "msci")
# Préfixes ISIN qui sont toujours des fonds ou des produits à conserver tels quels
FUND_PREFIXES     = ("FR", "LU", "IE", "XS", "CS", "QS", "AM", "SC", "OT", "GF")
# Seuls les ISINs de ces pays sont candidats à reclassification (conservateur)
STOCK_PREFIXES    = {"US", "JP"}


def _is_fund_name(name: str) -> bool:
    n = (name or "").lower()
    return any(kw in n for kw in FUND_KEYWORDS)


def _get_source_key(ds) -> str:
    if isinstance(ds, dict) and ds:
        return list(ds.keys())[0]
    return str(ds or "")


def fetch_candidates(client) -> list[dict]:
    candidates = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name, data_source, ter")
            .eq("product_type", "opcvm")
            .is_("ter", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        for r in batch:
            isin = r.get("isin", "")
            if isin[:2] in FUND_PREFIXES:
                continue
            if isin[:2] not in STOCK_PREFIXES:
                continue
            src = _get_source_key(r.get("data_source"))
            if src not in INSURANCE_SOURCES:
                continue
            if _is_fund_name(r.get("name", "")):
                continue
            candidates.append(r)
        if len(batch) < 1000:
            break
        offset += 1000
    return candidates


def run(apply: bool) -> None:
    print("=" * 60)
    print("  Reclassify Insurance Stocks — OPCVM → action")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")

    started = datetime.now(timezone.utc)
    client  = get_client()

    candidates = fetch_candidates(client)
    print(f"\n  {len(candidates)} OPCVM à reclasser en 'action'")

    from collections import Counter
    prefix_count = Counter(r["isin"][:2] for r in candidates)
    for pfx, cnt in prefix_count.most_common(10):
        print(f"    {pfx}: {cnt}")

    if not candidates:
        print("\n  Rien à faire.")
        return

    print(f"\n  Exemples (5 premiers):")
    for r in candidates[:5]:
        print(f"    {r['isin']:20s} | {(r.get('name') or '')[:40]}")

    if not apply:
        print("\n  DRY-RUN — aucune modification.")
        return

    updated = skipped = 0
    now = datetime.now(timezone.utc).isoformat()
    BATCH = 500

    for i in range(0, len(candidates), BATCH):
        batch = candidates[i:i + BATCH]
        isins = [r["isin"] for r in batch]
        try:
            client.table("investissement_funds") \
                .update({"product_type": "action", "updated_at": now}) \
                .in_("isin", isins) \
                .execute()
            updated += len(batch)
            pct = (i + len(batch)) * 100 // len(candidates)
            print(f"    [{i + len(batch):4d}/{len(candidates)}] {pct}%  ✓{updated}  ✗{skipped}")
        except Exception as e:
            print(f"  ✗ batch error: {e}")
            skipped += len(batch)

    print(f"\n  → {updated} reclassés, {skipped} erreurs")

    if apply:
        log_run(
            scraper="reclassify-insurance-stocks",
            status="success" if updated > 0 else "partial",
            records_processed=updated,
            records_failed=skipped,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
