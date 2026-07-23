#!/usr/bin/env python3
"""
derive-distribution-policy.py — Politique de distribution depuis le nom de part
================================================================================
Déduit `distribution_policy` ∈ {capitalisation, distribution} à partir des
suffixes de classe de part présents dans le nom (Acc/Dist et variantes).

PRÉCISION D'ABORD : on ne pose une valeur que sur un token FORT et non ambigu.
Les cas ambigus (pas de token, ou « Income »/« C »/« D » isolés = nom de
stratégie ou code de part) restent NULL — jamais de devinette.

Enjeu CGP : capitalisant = report d'imposition ; distribuant = revenu imposable.

Fill-only strict via safe_fill_funds (n'écrit que si NULL, merge field_sources).

Usage :
    python3 scripts/enrichers/derive-distribution-policy.py            # dry-run
    python3 scripts/enrichers/derive-distribution-policy.py --apply
"""

import sys, re, argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, safe_fill_funds

# Tokens FORTS uniquement (word-boundaries). Testés : 0 conflit sur la base.
CAP_RE = re.compile(
    r"(\bacc\b|acc\.|-acc-|\baccumulat|capitalisa|capitalizi|thesaurier|\breinvest)",
    re.IGNORECASE)
DIST_RE = re.compile(
    r"(\bdist\b|-dist-|\bdistrib|ausschutt|distributing)",
    re.IGNORECASE)


def classify(name: str) -> str | None:
    if not name:
        return None
    cap = bool(CAP_RE.search(name))
    dist = bool(DIST_RE.search(name))
    if cap and not dist:
        return "capitalisation"
    if dist and not cap:
        return "distribution"
    return None  # aucun token, ou conflit → on ne tranche pas


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    client = get_client()
    print("  Chargement des fonds sans distribution_policy…")
    rows: list[dict] = []
    off = 0
    while True:
        q = (client.table("investissement_funds")
             .select("isin,name")
             .is_("distribution_policy", "null")
             .range(off, off + 999).execute())
        b = q.data or []
        rows.extend(b)
        if len(b) < 1000:
            break
        off += 1000
    print(f"  {len(rows)} fonds à examiner")

    records = []
    counts = {"capitalisation": 0, "distribution": 0}
    for r in rows:
        pol = classify(r.get("name", ""))
        if pol:
            records.append({"isin": r["isin"], "distribution_policy": pol})
            counts[pol] += 1
    if args.limit:
        records = records[: args.limit]

    print(f"  Déductions : capitalisation={counts['capitalisation']} "
          f"distribution={counts['distribution']} (total {len(records)})")

    if not args.apply:
        print("  DRY-RUN — rien écrit. Relancer avec --apply.")
        return

    stats = safe_fill_funds(records, source="name-distribution")
    print(f"  → {stats['rows_updated']} fonds mis à jour, "
          f"{stats['fields_filled']} champs remplis, {stats['failed']} échecs")


if __name__ == "__main__":
    main()
