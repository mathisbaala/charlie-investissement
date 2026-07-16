#!/usr/bin/env python3
"""
av-lux-allianz-catalog.py — Catalogue UC Allianz Life Luxembourg (LPS France)
==============================================================================
Allianz Life Luxembourg S.A. publie l'univers d'UC de chaque contrat sur son
portail PRIIPS public (KID/DIS, mis à jour mensuellement) :
  https://life.allianz.lu/priips/

Un POST form-encodé `p=<code produit>&lang=fr` (aucun cookie/CSRF requis)
renvoie la table HTML du contrat avec un attribut data-isin par fonds. Codes
produits France (repérage 2026-07-16) :
  085 = Allianz Exclusive Invest France   (~192 supports)
  092 = Global Invest Evolution France

⚠ La page pèse 15-20 Mo : on extrait les data-isin au regex (pas de parse DOM
complet). Les codes internes non-ISIN (fonds internes AZLU*) sont écartés par
le format + clé de contrôle.

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà présents dans
investissement_funds. N'insère/écrase JAMAIS de fonds.

Usage :
    python3 scripts/scrapers/av-lux-allianz-catalog.py            # dry-run
    python3 scripts/scrapers/av-lux-allianz-catalog.py --apply
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session, _valid_isin  # noqa: E402

PRIIPS_URL = "https://life.allianz.lu/priips/"

# ⚠ contract_name DOIT différer de company_name (matview FILTER
#   contract_name <> company_name — cf. migrations Generali/Swiss Life Lux).
COMPANY = "Allianz Life Luxembourg"

# (nom de contrat, code produit du portail PRIIPS)
CONTRACTS = [
    ("Allianz Exclusive Invest France", "085"),
    ("Global Invest Evolution France",  "092"),
]

DATA_ISIN_RE = re.compile(r'data-isin="([A-Z0-9]+)"')
TIMEOUT = 120  # page ~16-19 Mo
RATE    = 1.0


def fetch_contract_isins(session, product_code: str) -> list[str]:
    """ISIN distincts du contrat via POST p=<code>&lang=fr sur le portail PRIIPS."""
    try:
        r = session.post(PRIIPS_URL, data={"p": product_code, "lang": "fr"},
                         timeout=TIMEOUT)
    except Exception as e:
        print(f"      ⚠ POST p={product_code} : {str(e)[:80]}")
        return []
    if r.status_code != 200:
        print(f"      ⚠ HTTP {r.status_code} sur p={product_code}")
        return []
    raw = sorted(set(DATA_ISIN_RE.findall(r.text or "")))
    # data-isin porte aussi des codes internes (AZLU…) → vrai ISIN uniquement.
    return [x for x in raw if _valid_isin(x)]


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print(f"  {COMPANY} — portail PRIIPS (catalogue UC par contrat)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    contracts = CONTRACTS[:limit] if limit else CONTRACTS
    session = make_session()

    per_contract: list[tuple[str, list[str]]] = []
    for i, (name, code) in enumerate(contracts):
        isins = fetch_contract_isins(session, code)
        print(f"  [{i+1}/{len(contracts)}] {name[:44]:44} {len(isins):5} ISIN")
        per_contract.append((name, isins))
        time.sleep(RATE)

    union = sorted({x for _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — portail cassé ou codes produits changés.")
        if apply:
            log_run("av-lux-allianz-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  Aperçu (10 premiers ISIN) :", ", ".join(union[:10]))
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for contract_name, isins in per_contract:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": COMPANY, "contract_name": contract_name,
                "source_url": PRIIPS_URL, "scraped_at": now,
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
    log_run("av-lux-allianz-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Allianz Life Luxembourg — catalogue UC (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
