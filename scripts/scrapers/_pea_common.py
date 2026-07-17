#!/usr/bin/env python3
"""
_pea_common.py — Socle partagé des scrapers d'univers PEA de courtiers/banques
===============================================================================
Chaque scraper pea-<courtier>-catalog.py ne fournit que sa COLLECTE (liste
d'ISIN par contrat) ; l'écriture est commune et identique aux conventions du
référencement AV (docs/av-referencing.md) :
  - ÉLIGIBILITÉ-ONLY : filtre sur les ISIN déjà présents dans
    investissement_funds, jamais d'insertion/écrasement de fonds ;
  - dédup (isin, contract_name) avant upsert batch (anti-21000) ;
  - scraped_at=now() (alimente le délistage Tier 4) ;
  - log_run par scraper.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins  # noqa: E402


def write_pea_contracts(
    company: str,
    per_contract: list[tuple[str, list[str], str]],
    *,
    scraper_name: str,
    apply: bool,
    started=None,
) -> None:
    """Écrit [(contract_name, isins, source_url)] pour un courtier.

    En dry-run : affiche seulement le récapitulatif (aucun accès DB).
    """
    started = started or datetime.now(timezone.utc)
    union = sorted({x for _, isins, _ in per_contract for x in isins})
    print(f"\n  Contrats : {len(per_contract)} | union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — source cassée, rien n'est écrit.")
        if apply:
            log_run(scraper_name, "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()
    batch, ok = [], 0
    for contract_name, isins, source_url in per_contract:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": company, "contract_name": contract_name,
                "source_url": source_url, "scraped_at": now,
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

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} ISIN bruts avant filtre).")
    log_run(scraper_name, "success", ok, 0, started_at=started)
