#!/usr/bin/env python3
"""
fix-ter-and-perf-suspect.py — Corrections TER aberrants et perfs > 200%
========================================================================

Fix 1 — TER aberrants :
  - TER < 0 → NULL (impossible)
  - TER > 10% pour OPCVM/ETF/action/crypto/livret/obligation → NULL
  - TER > 14% pour SCPI/fonds_euros → NULL (frais SCPI max légitimes ~13%)

Fix 2 — Performances suspectes (double-conversion probable) :
  - OPCVM/ETF avec |perf_1y| > 200% → NULL (aucun fonds diversifié ne fait +200% en 1 an)
  - OPCVM/ETF avec |perf_3y| > 500% → NULL
  - OPCVM/ETF avec |perf_5y| > 500% → NULL
  - Actions et crypto exclus (peuvent légitimement dépasser ces seuils)

Usage :
    python3 scripts/migrations/fix-ter-and-perf-suspect.py           # dry-run
    python3 scripts/migrations/fix-ter-and-perf-suspect.py --apply
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

TER_MAX_STANDARD = 0.10   # 10% — max plausible OPCVM/ETF
TER_MAX_SCPI     = 0.14   # 14% — max plausible SCPI/fonds_euros
PERF_MAX_1Y      = 200.0  # %  — max absolu OPCVM/ETF sur 1 an
PERF_MAX_35Y     = 500.0  # %  — max absolu OPCVM/ETF sur 3/5 ans

SCPI_TYPES = {"scpi", "opci", "sci", "fonds_euros"}
SKIP_PERF_TYPES = {"action", "crypto"}  # peuvent légitimement dépasser

FIELDS = "isin,product_type,ter,ongoing_charges,performance_1y,performance_3y,performance_5y"


def fetch_all(client) -> list[dict]:
    funds, offset = [], 0
    while True:
        batch = (client.table("investissement_funds").select(FIELDS)
                 .range(offset, offset + 999).execute().data or [])
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return funds


def fix_ter(funds: list[dict]) -> list[dict]:
    updates = []
    for f in funds:
        upd = {}
        ptype = f.get("product_type", "")
        max_ter = TER_MAX_SCPI if ptype in SCPI_TYPES else TER_MAX_STANDARD

        for field in ("ter", "ongoing_charges"):
            v = f.get(field)
            if v is None:
                continue
            v = float(v)
            if v < 0 or v > max_ter:
                upd[field] = None

        if upd:
            upd["isin"] = f["isin"]
            upd["_product_type"] = ptype
            upd["_reason"] = "ter_aberrant"
            updates.append(upd)
    return updates


def fix_perf_suspect(funds: list[dict]) -> list[dict]:
    updates = []
    for f in funds:
        ptype = f.get("product_type", "")
        if ptype in SKIP_PERF_TYPES:
            continue

        upd = {}
        for field, threshold in (
            ("performance_1y", PERF_MAX_1Y),
            ("performance_3y", PERF_MAX_35Y),
            ("performance_5y", PERF_MAX_35Y),
        ):
            v = f.get(field)
            if v is None:
                continue
            if abs(float(v)) > threshold:
                upd[field] = None

        if upd:
            upd["isin"] = f["isin"]
            upd["_product_type"] = ptype
            upd["_reason"] = "perf_suspect"
            updates.append(upd)
    return updates


def apply_updates(client, updates: list[dict], label: str, apply: bool) -> tuple[int, int]:
    print(f"\n  ━━━ {label} ━━━")
    print(f"  {len(updates)} fonds à corriger")
    for u in updates[:3]:
        meta = {k: v for k, v in u.items() if k.startswith("_") or k == "isin"}
        data = {k: v for k, v in u.items() if not k.startswith("_") and k != "isin"}
        print(f"    {meta} → {data}")

    if not apply or not updates:
        return 0, 0

    now_iso = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for u in updates:
        isin = u["isin"]
        payload = {k: v for k, v in u.items() if not k.startswith("_") and k != "isin"}
        payload["updated_at"] = now_iso
        try:
            client.table("investissement_funds").update(payload).eq("isin", isin).execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"    ✗ {isin}: {e}")

    print(f"  → {ok} corrigés, {fail} erreurs")
    return ok, fail


def run(apply: bool):
    print("=" * 70)
    print("  fix-ter-and-perf-suspect — TER aberrants + perfs > seuil")
    print("=" * 70)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}\n")

    started = datetime.now(timezone.utc)
    client = get_client()

    print("  Chargement des fonds...")
    funds = fetch_all(client)
    print(f"  {len(funds)} fonds chargés")

    ter_updates  = fix_ter(funds)
    perf_updates = fix_perf_suspect(funds)

    ok_ter,  fail_ter  = apply_updates(client, ter_updates,  "TER aberrants",         apply)
    ok_perf, fail_perf = apply_updates(client, perf_updates, "Performances suspectes", apply)

    total_ok   = ok_ter + ok_perf
    total_fail = fail_ter + fail_perf
    total_found = len(ter_updates) + len(perf_updates)

    print(f"\n  {'━' * 70}")
    print(f"  TOTAL : {total_found} corrections identifiées")
    if apply:
        print(f"  Appliqué : {total_ok} succès, {total_fail} erreurs")
        log_run("fix-ter-and-perf-suspect", "success", total_ok, total_fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
