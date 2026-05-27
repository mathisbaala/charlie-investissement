#!/usr/bin/env python3
"""
set-kid-parsed-at.py — Marque kid_parsed_at pour les fonds avec KID traité
=============================================================================
Deux modes de ciblage :

Mode 1 (défaut) : fonds avec kid_url (KID référencé par Morningstar)
Mode 2 (--all-data) : fonds avec srri/sri + ongoing_charges (données KID obtenues
  via Boursorama/Morningstar, même sans URL de document direct)

SRRI et TER/frais courants sont toujours dans le document KID. Si on les a,
le KID a été traité (via Morningstar ou Boursorama qui le parse).

Usage :
    python3 scripts/migrations/set-kid-parsed-at.py [--apply] [--all-data]

    --all-data : inclut fonds avec SRRI + TER sans kid_url
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH_SIZE = 500


def run(apply: bool, all_data: bool):
    print("=" * 60)
    print("  Set kid_parsed_at — Marquer les KIDs traités")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Ciblage : {'Étendu (SRRI+TER, avec ou sans kid_url)' if all_data else 'kid_url seul'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds: list[dict] = []
    seen: set[str] = set()

    # Source 1 : fonds avec kid_url (Morningstar a trouvé le document)
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin,updated_at")
            .not_.is_("kid_url", "null")
            .is_("kid_parsed_at", "null")
            .range(offset, offset + 999)
            .execute().data or []
        )
        for row in batch:
            if row["isin"] not in seen:
                seen.add(row["isin"])
                funds.append(row)
        if len(batch) < 1000:
            break
        offset += 1000

    # Source 2 (--all-data) : fonds avec SRRI + TER mais sans kid_url
    if all_data:
        offset = 0
        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin,updated_at")
                .not_.is_("ongoing_charges", "null")
                .not_.is_("srri", "null")
                .is_("kid_url", "null")
                .is_("kid_parsed_at", "null")
                .range(offset, offset + 999)
                .execute().data or []
            )
            for row in batch:
                if row["isin"] not in seen:
                    seen.add(row["isin"])
                    funds.append(row)
            if len(batch) < 1000:
                break
            offset += 1000

    print(f"  {len(funds)} fonds à traiter\n")

    if not apply:
        print(f"  Aperçu (5 premiers) :")
        for f in funds[:5]:
            print(f"    {f['isin']} | updated_at: {str(f.get('updated_at',''))[:19]}")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i in range(0, len(funds), BATCH_SIZE):
        batch = funds[i: i + BATCH_SIZE]
        for fund in batch:
            # Timestamp = updated_at du fonds (quand Morningstar a fourni les données)
            parsed_at = fund.get("updated_at") or now
            try:
                client.table("investissement_funds") \
                    .update({"kid_parsed_at": parsed_at}) \
                    .eq("isin", fund["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"  ✗ {fund['isin']} : {e}")

        pct = min(i + len(batch), len(funds)) / len(funds) * 100
        print(f"  [{i + len(batch):5d}/{len(funds)}] {pct:.0f}%  ✓{ok}  ✗{fail}")

    print(f"\n  → {ok} kid_parsed_at marqués, {fail} erreurs")
    log_run("set-kid-parsed-at", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply",    action="store_true")
    parser.add_argument("--all-data", action="store_true", dest="all_data",
                        help="Inclure fonds avec SRRI+TER sans kid_url")
    args = parser.parse_args()
    run(apply=args.apply, all_data=args.all_data)
