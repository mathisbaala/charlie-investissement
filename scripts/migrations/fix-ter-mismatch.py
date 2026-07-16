#!/usr/bin/env python3
"""
fix-ter-mismatch.py — Aligne ter sur ongoing_charges (source KID)
=================================================================
Convention (data-standards) : ter et ongoing_charges sont des FRACTIONS
(0.0085 = 0.85 %) et doivent être égaux (PRIIPs : ongoing = total frais).
Quand ils divergent, la source primaire est le KID → on aligne ter sur
ongoing_charges.

Garde-fou : on ignore les lignes où ter OU ongoing_charges > 1 (celles-là
sont un problème d'UNITÉ, pas de divergence — à traiter séparément, ne pas
propager une valeur en pourcentage dans une colonne fraction).

Usage :
    python3 scripts/migrations/fix-ter-mismatch.py          # dry-run
    python3 scripts/migrations/fix-ter-mismatch.py --apply
"""
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH = 500
EPS = 0.0001


def fetch_all(client) -> list[dict]:
    rows, offset = [], 0
    while True:
        batch = (
            client.table("investissement_funds").select("isin,ter,ongoing_charges")
            .not_.is_("ter", "null").not_.is_("ongoing_charges", "null")
            .range(offset, offset + 999).execute().data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def run(apply: bool) -> None:
    print("=" * 60)
    print("  fix-ter-mismatch — ter ← ongoing_charges (KID)")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()
    rows = fetch_all(client)
    print(f"  {len(rows)} fonds avec ter ET ongoing_charges")

    updates: list[tuple[str, float, float]] = []
    skipped = 0
    for r in rows:
        try:
            t = float(r["ter"])
            oc = float(r["ongoing_charges"])
        except (TypeError, ValueError):
            continue
        if t > 1 or oc > 1:          # problème d'unité → hors périmètre
            skipped += 1
            continue
        if abs(t - oc) > EPS:
            updates.append((r["isin"], round(oc, 6), t))

    print(f"  {len(updates)} à aligner  ({skipped} ignorés pour unité > 1)")

    if not apply:
        for isin, oc, t in updates[:8]:
            print(f"    {isin}: ter {t} → {oc}")
        return

    ok = fail = 0
    for i in range(0, len(updates), BATCH):
        for isin, oc, _ in updates[i:i + BATCH]:
            try:
                client.table("investissement_funds").update(
                    {"ter": oc, "updated_at": datetime.now(timezone.utc).isoformat()}
                ).eq("isin", isin).execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 5:
                    print(f"  ✗ {isin} : {e}")
        print(f"  [{min(i + BATCH, len(updates)):5d}/{len(updates)}]  ✓{ok} ✗{fail}")

    print(f"\n  → {ok} alignés, {fail} erreurs")
    log_run("fix-ter-mismatch", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Aligne ter sur ongoing_charges (fractions)")
    p.add_argument("--apply", action="store_true", help="Écrire les corrections")
    run(apply=p.parse_args().apply)
