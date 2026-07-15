#!/usr/bin/env python3
"""
apply-referencing-from-harvest.py — Applique en base une récolte de référencement
==================================================================================
Lit un JSON de récolte (scripts/data/referencing-harvest-*.json, produit par un
crawl déterministe local : HTML + PDF, ISIN validés par clé de contrôle ISO 6166)
et écrit le référencement dans investissement_av_lux_eligibility.

GARDE-FOUS (mêmes règles que insurer-harvest-overnight.py) :
  • fill-only référencement : n'écrit JAMAIS dans investissement_funds ;
  • seuls les ISIN DÉJÀ présents dans investissement_funds sont liés ;
  • idempotent : upsert on_conflict (isin, contract_name) ;
  • un assureur avec < 5 ISIN retenus est ignoré (source trop pauvre = bruit) ;
  • dry-run par défaut, écrire = --apply.

Après écriture, rafraîchit la matview investissement_fund_insurers_mv (RPC
inv_refresh_fund_insurers_mv) pour que /assureurs reflète les nouveaux liens.

Usage :
  python3 scripts/migrations/apply-referencing-from-harvest.py --json scripts/data/referencing-harvest-partie1.json
  python3 scripts/migrations/apply-referencing-from-harvest.py --json ... --apply
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client  # noqa: E402

MIN_ISINS = 5


def existing_isins(client) -> set[str]:
    s, off = set(), 0
    while True:
        rows = client.table("investissement_funds").select("isin").range(off, off + 999).execute().data
        if not rows:
            break
        s.update(r["isin"] for r in rows)
        off += 1000
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True, help="chemin du JSON de récolte")
    ap.add_argument("--apply", action="store_true", help="écrire en base (défaut : dry-run)")
    args = ap.parse_args()

    payload = json.loads(Path(args.json).read_text())
    companies = payload["companies"]
    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()
    print(f"Base : {len(known)} ISIN connus | récolte du {payload['meta']['harvested_at']}")

    total = 0
    for company, entry in companies.items():
        rows_src = entry.get("isins", [])
        keep = [r for r in rows_src if r["isin"] in known]
        print(f"  {company}: {len(rows_src)} récoltés → {len(keep)} déjà en base", end="")
        if len(keep) < MIN_ISINS:
            print(" — ignoré (< 5, source trop pauvre)")
            continue
        print(" ✓")
        if args.apply:
            rows = [{
                "isin": r["isin"], "company_name": company, "contract_name": company,
                "source_url": r["source_url"], "scraped_at": now,
            } for r in keep]
            for i in range(0, len(rows), 200):
                client.table("investissement_av_lux_eligibility").upsert(
                    rows[i:i + 200], on_conflict="isin,contract_name").execute()
            total += len(rows)

    if args.apply:
        print(f"Écrit : {total} liens de référencement.")
        try:
            client.rpc("inv_refresh_fund_insurers_mv").execute()
            print("Matview insurers rafraîchie.")
        except Exception as e:
            print(f"⚠ refresh matview à relancer à la main : {str(e)[:80]}")
    else:
        print("Dry-run terminé (aucune écriture). Ajouter --apply pour écrire.")


if __name__ == "__main__":
    main()
