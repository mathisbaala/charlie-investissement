#!/usr/bin/env python3
"""
pea-boursobank-catalog.py — Univers OPCVM du PEA BoursoBank
============================================================
Le moteur OPCVM de boursorama.com (filtre « PEA », checkbox
fundSearch[taxation]=1) liste ~3 050 fonds mais SANS ISIN dans les pages de
liste (identifiants Morningstar uniquement, cf. repérage 2026-07-17) — les
résoudre demanderait ~3 050 fetchs de fiches.

Or ce travail est DÉJÀ fait en amont : le chargeur `boursorama-pea` (hors de ce
repo) alimente investissement_funds avec data_source='boursorama-pea', ISIN
résolus. Ce scraper DÉRIVE donc le contrat « PEA BoursoBank » de ces fonds :
zéro requête réseau, idempotent, à exécuter APRÈS le chargeur dans l'ordre du
job. Caveat documenté : c'est l'univers OPCVM « éligible PEA » du site média
Boursorama — le catalogue effectif BoursoBank peut différer à la marge.

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility.

Usage :
    python3 scripts/scrapers/pea-boursobank-catalog.py            # dry-run
    python3 scripts/scrapers/pea-boursobank-catalog.py --apply
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402

COMPANY    = "BoursoBank"
CONTRACT   = "PEA BoursoBank"
SOURCE_URL = "https://www.boursorama.com/bourse/opcvm/recherche/"
DATA_SOURCE = "boursorama-pea"
MIN_EXPECTED = 1000  # ~2 800-3 050 fonds attendus ; en dessous = chargeur amont cassé.


def run(apply: bool):
    print("=" * 64)
    print(f"  {COMPANY} — {CONTRACT} (dérivé de data_source='{DATA_SOURCE}')")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    client = get_client()
    isins: list[str] = []
    off = 0
    while True:
        rows = client.table("investissement_funds").select("isin") \
            .eq("data_source", DATA_SOURCE).range(off, off + 999).execute().data
        if not rows:
            break
        isins += [r["isin"] for r in rows]
        if len(rows) < 1000:
            break
        off += 1000
    isins = sorted(set(isins))
    print(f"  Fonds {DATA_SOURCE} en base : {len(isins)}")

    if len(isins) < MIN_EXPECTED:
        print(f"  ✗ sous le seuil ({MIN_EXPECTED}) — chargeur amont incomplet, rien n'est écrit.")
        if apply:
            log_run("pea-boursobank-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  DRY-RUN — rien écrit.")
        return

    now = datetime.now(timezone.utc).isoformat()
    batch, ok = [], 0
    for x in isins:  # déjà distincts → pas de doublon (isin, contrat)
        batch.append({
            "isin": x, "company_name": COMPANY, "contract_name": CONTRACT,
            "source_url": SOURCE_URL, "scraped_at": now,
        })
        if len(batch) >= 200:
            client.table("investissement_av_lux_eligibility") \
                .upsert(batch, on_conflict="isin,contract_name").execute()
            ok += len(batch)
            batch = []
    if batch:
        client.table("investissement_av_lux_eligibility") \
            .upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)

    print(f"  Éligibilité écrite : {ok} lignes.")
    log_run("pea-boursobank-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BoursoBank — PEA (dérivé du chargeur boursorama-pea)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = parser.parse_args()
    run(apply=args.apply)
