#!/usr/bin/env python3
"""
apply-pea-pme-from-euronext.py — Intègre la liste officielle PEA-PME Euronext
==============================================================================
Lit scripts/data/pea-pme-euronext.json (produit par
scripts/scrapers/euronext-pea-pme-list.py, fichier officiel trimestriel) et
applique dans investissement_funds :

  • ISIN DÉJÀ en base → UPDATE des drapeaux pea_pme_eligible + pea_eligible
    (tout titre PEA-PME est éligible PEA ; fill-only, jamais True → False) ;
  • ISIN ABSENTS      → INSERT d'une action minimale (nom, marché en category,
    data_source="euronext-pea-pme") — les enrichers (yahoo, openfigi…)
    complètent ensuite. Désactivable avec --no-create.

Dry-run par défaut, écrire = --apply.

Usage :
  python3 scripts/migrations/apply-pea-pme-from-euronext.py
  python3 scripts/migrations/apply-pea-pme-from-euronext.py --apply
"""

import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run  # noqa: E402

DEFAULT_JSON = Path(__file__).parent.parent / "data" / "pea-pme-euronext.json"
BATCH = 100


def fetch_existing(client) -> dict[str, dict]:
    """ISIN → drapeaux, pagination ORDONNÉE (range sans order = pages instables)."""
    out, off = {}, 0
    while True:
        rows = (
            client.table("investissement_funds")
            .select("isin, pea_eligible, pea_pme_eligible")
            .order("isin")
            .range(off, off + 999)
            .execute().data or []
        )
        for r in rows:
            out[r["isin"]] = r
        if len(rows) < 1000:
            break
        off += 1000
    return out


def main():
    ap = argparse.ArgumentParser(description="Applique la liste PEA-PME Euronext en base")
    ap.add_argument("--json", default=str(DEFAULT_JSON))
    ap.add_argument("--apply", action="store_true", help="écrire en base (défaut : dry-run)")
    ap.add_argument("--no-create", action="store_true", help="ne pas insérer les ISIN absents")
    args = ap.parse_args()

    started = datetime.now(timezone.utc)
    data = json.loads(Path(args.json).read_text())
    companies = {c["isin"]: c for c in data.get("companies", []) if c.get("isin")}

    print("=" * 64)
    print("  Apply PEA-PME (liste officielle Euronext)")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"  Liste : {len(companies)} sociétés ({data.get('meta', {}).get('source_file', '?').rsplit('/', 1)[-1]})")

    client = get_client()
    existing = fetch_existing(client)
    print(f"  Base : {len(existing)} fonds existants")

    flag_pme = [i for i, c in companies.items()
                if i in existing and not existing[i].get("pea_pme_eligible")]
    flag_pea = [i for i, c in companies.items()
                if i in existing and not existing[i].get("pea_eligible")]
    to_create = [c for i, c in companies.items() if i not in existing]

    print(f"\n  → drapeaux à poser : {len(flag_pme)} PEA-PME, {len(flag_pea)} PEA")
    print(f"  → sociétés absentes de la base : {len(to_create)}"
          f"{' (création désactivée)' if args.no_create else ''}")

    updated = created = 0
    if args.apply:
        for isins, col in ((flag_pme, "pea_pme_eligible"), (flag_pea, "pea_eligible")):
            for i in range(0, len(isins), BATCH):
                chunk = isins[i:i + BATCH]
                client.table("investissement_funds").update({col: True}).in_("isin", chunk).execute()
            updated += len(isins)
        if updated:
            print(f"  ✓ {updated} drapeaux mis à jour")

        if to_create and not args.no_create:
            rows = [
                {
                    "isin":               c["isin"],
                    "name":               c["name"],
                    "product_type":       "action",
                    "asset_class":        "actions",
                    "currency":           "EUR",
                    "category":           c.get("market"),
                    "pea_eligible":       True,
                    "pea_pme_eligible":   True,
                    "cto_eligible":       True,
                    "distributor_france": True,
                    "data_source":        "euronext-pea-pme",
                }
                for c in to_create
            ]
            ok, ko = upsert_funds_bulk(rows)
            created = ok
            print(f"  ✓ {ok} actions créées ({ko} échecs)")

        log_run("apply-pea-pme-from-euronext", "success", updated + created, 0, started_at=started)
    else:
        print("\n  Dry-run — exemples de sociétés à créer :")
        for c in to_create[:10]:
            print(f"    {c['isin']}  {(c['name'] or '')[:40]:40}  {c.get('market') or ''}")

    print("=" * 64)


if __name__ == "__main__":
    main()
