#!/usr/bin/env python3
"""
pea-boursedirect-catalog.py — Univers OPCVM PEA / PEA-PME de Bourse Direct
===========================================================================
Le moteur OPCVM de Bourse Direct (iframe WebFG sur boursedirect.fr/fr/opcvm/
recherche) répond à un POST JSON PUBLIC, sans session (repérage 2026-07-17) :
  POST https://prod1s.solutions.webfg.ch/boursedirect/opcvm/recherche/ajax
  body {"term":"","zeroFees":"false","eligibles":["PEA"],…,"page":1,"pageSize":500}
  → JSON riche par fonds : ISIN direct, secId Morningstar, VL, perfs, frais.
  Valeur PEA-PME du filtre : "PEA/PME". pageSize=500 accepté → ~7 requêtes.

~3 190 fonds PEA : c'est l'univers négociable chez Bourse Direct (proche de
l'univers réglementaire OPCVM). Référencé comme contrats : company
« Bourse Direct », contrats « PEA Bourse Direct » / « PEA-PME Bourse Direct »
(noms → type pea automatique ; précédent courtier : Linxea, Fortuneo).

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/pea-boursedirect-catalog.py            # dry-run
    python3 scripts/scrapers/pea-boursedirect-catalog.py --apply
"""

import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session, _valid_isin  # noqa: E402

AJAX_URL   = "https://prod1s.solutions.webfg.ch/boursedirect/opcvm/recherche/ajax"
SOURCE_URL = "https://www.boursedirect.fr/fr/opcvm/recherche"

COMPANY = "Bourse Direct"

# (nom de contrat, valeur du filtre `eligibles`)
# ⚠ PEA-PME = « PEAPME » (sans séparateur) : « PEA/PME » et autres variantes
#   sont IGNORÉS par l'API qui renvoie alors l'univers entier (57 507 fonds) —
#   vérifié le 17/07. Garde-fou MAX_UNIVERSE en aval.
CONTRACTS = [
    ("PEA Bourse Direct",     "PEA"),
    ("PEA-PME Bourse Direct", "PEAPME"),
]

PAGE_SIZE = 500
TIMEOUT   = 45
RATE      = 2.0
MAX_PAGES = 30      # ~7 pages observées pour le PEA
MAX_UNIVERSE = 10000  # un « univers » PEA > 10k = filtre ignoré par l'API → on n'écrit pas


def fetch_universe(session, eligible: str) -> set[str]:
    """ISIN de l'univers pour une valeur du filtre d'éligibilité."""
    isins: set[str] = set()
    page = 1
    while page <= MAX_PAGES:
        body = {
            "term": "", "zeroFees": "false", "eligibles": [eligible],
            "ratings": [], "medalists": [], "risk": [], "volatilite": [],
            "page": page, "pageSize": PAGE_SIZE, "sortOrder": None,
        }
        try:
            r = session.post(AJAX_URL, json=body, timeout=TIMEOUT)
        except Exception as e:
            print(f"      ⚠ {eligible} p{page} : {str(e)[:60]}")
            break
        if r.status_code != 200:
            print(f"      ⚠ {eligible} p{page} : HTTP {r.status_code}")
            break
        j = r.json()
        rows = j.get("data") or j.get("rows") or j.get("results") or []
        if isinstance(j, list):
            rows = j
        if not rows:
            break
        added = 0
        for row in rows:
            isin = str((row or {}).get("isin") or "").strip().upper()
            if _valid_isin(isin):
                isins.add(isin)
                added += 1
        if added == 0:
            break
        page += 1
        time.sleep(RATE)
    return isins


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print(f"  {COMPANY} — univers OPCVM PEA/PEA-PME (API WebFG)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    session = make_session()
    contracts = CONTRACTS[:limit] if limit else CONTRACTS
    per_contract: list[tuple[str, list[str]]] = []
    for i, (name, eligible) in enumerate(contracts):
        isins = fetch_universe(session, eligible)
        if len(isins) > MAX_UNIVERSE:
            print(f"  [{i+1}/{len(contracts)}] {name[:40]:40} ✗ {len(isins)} ISIN : filtre ignoré par l'API, contrat écarté")
            continue
        print(f"  [{i+1}/{len(contracts)}] {name[:40]:40} {len(isins):5} ISIN")
        per_contract.append((name, sorted(isins)))
        time.sleep(RATE)

    union = sorted({x for _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — endpoint WebFG déplacé ou format changé.")
        if apply:
            log_run("pea-boursedirect-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
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

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} ISIN bruts avant filtre).")
    log_run("pea-boursedirect-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bourse Direct — univers PEA (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
