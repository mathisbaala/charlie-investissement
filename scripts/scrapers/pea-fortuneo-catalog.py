#!/usr/bin/env python3
"""
pea-fortuneo-catalog.py — Univers de fonds du PEA Fortuneo (OPCVM + ETF)
=========================================================================
Fortuneo expose des API JSON publiques (sans cookie ni token — repérage
2026-07-17) pour son moteur de fonds, filtrables par éligibilité :
  GET bourse.fortuneo.fr/api/sicav/search/?page=N&additionalParams={"pea":"true"}
  GET bourse.fortuneo.fr/api/trackers/search/?page=N&additionalParams={"pea":"true"}
  (idem {"peaPme":"true"} pour le PEA-PME ; additionalParams = JSON URL-encodé,
   20 lignes/page, ISIN dans le slug du lien de chaque ligne : «…-LU1890809996-26»)

Contrairement aux listes « univers réglementaire » (Boursorama média, Bourse
Direct/webfg), Fortuneo publie son VRAI catalogue courtier (~445 OPCVM +
~154 ETF PEA) → on le référence comme des contrats : company « Fortuneo »
(précédent Linxea : les courtiers vivent dans la même table), contrats
« PEA Fortuneo » et « PEA-PME Fortuneo » (noms → type pea automatique).

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/pea-fortuneo-catalog.py            # dry-run
    python3 scripts/scrapers/pea-fortuneo-catalog.py --apply
"""

import re
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session, _valid_isin  # noqa: E402

API_ROOT   = "https://bourse.fortuneo.fr/api"
SOURCE_URL = "https://bourse.fortuneo.fr/sicav-fonds"

COMPANY = "Fortuneo"

# (nom de contrat, [(endpoint, additionalParams)])
# ⚠ Le filtre `peaPme` n'existe QUE côté sicav (36 fonds) : sur /trackers il est
#   IGNORÉ et l'API renvoie l'univers ETF entier (3 361) — vérifié le 17/07.
#   Garde-fou MAX_UNIVERSE en aval contre toute régression de ce type.
CONTRACTS = [
    ("PEA Fortuneo",     [("sicav", {"pea": "true"}), ("trackers", {"pea": "true"})]),
    ("PEA-PME Fortuneo", [("sicav", {"peaPme": "true"})]),
]

ISIN_IN_SLUG_RE = re.compile(r"-([A-Z]{2}[A-Z0-9]{9}\d)-\d+")
TIMEOUT = 45
RATE    = 1.0
MAX_PAGES = 200       # garde anti-boucle (~23 pages observées pour le PEA sicav)
MAX_UNIVERSE = 1500   # un « univers » filtré > 1500 = filtre ignoré par l'API → contrat écarté


def fetch_universe(session, kind: str, params: dict) -> set[str]:
    """ISIN d'un univers (sicav|trackers) pour un filtre d'éligibilité donné."""
    isins: set[str] = set()
    page = 1
    while page <= MAX_PAGES:
        try:
            r = session.get(f"{API_ROOT}/{kind}/search/",
                            params={"page": str(page),
                                    "additionalParams": json.dumps(params)},
                            timeout=TIMEOUT)
        except Exception as e:
            print(f"      ⚠ {kind} p{page} : {str(e)[:60]}")
            break
        if r.status_code != 200:
            print(f"      ⚠ {kind} p{page} : HTTP {r.status_code}")
            break
        j = r.json()
        arr = j.get("array") or {}
        rows = arr.get("data") or []
        for row in rows:
            for m in ISIN_IN_SLUG_RE.finditer(json.dumps(row)):
                if _valid_isin(m.group(1)):
                    isins.add(m.group(1))
        # nextPageAvailable vit DANS `array` (pas à la racine — vérifié 17/07).
        if not arr.get("nextPageAvailable") or not rows:
            break
        page += 1
        time.sleep(RATE)
    return isins


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print(f"  {COMPANY} — univers PEA/PEA-PME (API JSON)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    session = make_session()
    contracts = CONTRACTS[:limit] if limit else CONTRACTS
    per_contract: list[tuple[str, list[str]]] = []
    for i, (name, sources) in enumerate(contracts):
        isins: set[str] = set()
        for kind, params in sources:
            isins |= fetch_universe(session, kind, params)
            time.sleep(RATE)
        if len(isins) > MAX_UNIVERSE:
            print(f"  [{i+1}/{len(contracts)}] {name[:40]:40} ✗ {len(isins)} ISIN : filtre ignoré par l'API, contrat écarté")
            continue
        print(f"  [{i+1}/{len(contracts)}] {name[:40]:40} {len(isins):5} ISIN")
        per_contract.append((name, sorted(isins)))

    union = sorted({x for _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — API déplacée ou paramètre de filtre changé.")
        if apply:
            log_run("pea-fortuneo-catalog", "failed", 0, 0, started_at=started)
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
    log_run("pea-fortuneo-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fortuneo — univers PEA (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
