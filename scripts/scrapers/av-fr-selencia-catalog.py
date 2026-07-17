#!/usr/bin/env python3
"""
av-fr-selencia-catalog.py — Catalogue UC des contrats Selencia Patrimoine
==========================================================================
Selencia Patrimoine (assureur SELENCIA S.A., ex-Ageas France, groupe Carac)
publie la liste complète des supports de chaque contrat sur son site public,
avec un endpoint d'export Excel (.xls) par produit :

    https://selencia-patrimoine.fr/secure/notre-offre/produit/{id}/export
    (« /secure/ » dans l'URL mais accessible SANS authentification)

Contrats couverts (id produit → contrat) :
    3157 → Privilège Gestion Active                (1 312 ISIN)
    2986 → Privilège Gestion Active Capitalisation (1 192 ISIN)
    6566 → myPGA                                   (1 315 ISIN distincts —
           les doublons du fichier = univers Essentiel/Etendu)

Le .xls généré par le site est légèrement malformé → xlrd avec
ignore_workbook_corruption=True.

ÉLIGIBILITÉ-ONLY : seuls les ISIN déjà présents dans investissement_funds
sont liés (mêmes garde-fous que les autres av-fr-*-catalog).

Usage :
    python3 scripts/scrapers/av-fr-selencia-catalog.py           # dry-run
    python3 scripts/scrapers/av-fr-selencia-catalog.py --apply
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import xlrd

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from _av_pdf_common import make_session, existing_isins, _upsert, _valid_isin  # noqa: E402
from db import get_client, log_run  # noqa: E402

COMPANY = "Selencia"
EXPORT_URL = "https://selencia-patrimoine.fr/secure/notre-offre/produit/{pid}/export"
PAGE_URL   = "https://selencia-patrimoine.fr/secure/notre-offre/produit/{pid}"

CONTRACTS = [
    {"pid": "3157", "contract": "Privilège Gestion Active"},
    {"pid": "2986", "contract": "Privilège Gestion Active Capitalisation"},
    {"pid": "6566", "contract": "myPGA"},
]

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


def fetch_contract_isins(session, pid: str) -> list[str]:
    r = session.get(EXPORT_URL.format(pid=pid), timeout=60)
    if r.status_code != 200:
        print(f"    ! export HTTP {r.status_code}")
        return []
    wb = xlrd.open_workbook(file_contents=r.content, ignore_workbook_corruption=True)
    ws = wb.sheet_by_index(0)
    isins: list[str] = []
    seen: set[str] = set()
    for i in range(ws.nrows):
        for j in range(ws.ncols):
            v = str(ws.cell_value(i, j)).strip()
            if ISIN_RE.match(v) and _valid_isin(v) and v not in seen:
                seen.add(v)
                isins.append(v)
    return isins


def run(apply: bool) -> None:
    started = datetime.now(timezone.utc)
    print("=" * 64)
    print(f"  {COMPANY} — catalogue UC (exports Excel publics)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'} | {len(CONTRACTS)} contrat(s)")
    print("=" * 64)

    session = make_session()
    per_contract: list[tuple[str, str, list[str]]] = []
    for c in CONTRACTS:
        isins = fetch_contract_isins(session, c["pid"])
        per_contract.append((c["contract"], PAGE_URL.format(pid=c["pid"]), isins))
        print(f"  {c['contract'][:44]:44} {len(isins):5} ISIN")
        time.sleep(0.4)

    if not apply:
        print("  DRY-RUN — rien écrit. Relancer avec --apply.")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()
    rows, union = [], set()
    for contract, src, isins in per_contract:
        kept = [x for x in isins if x in known]
        union.update(kept)
        rows.extend({
            "isin": x, "company_name": COMPANY, "contract_name": contract,
            "source_url": src, "scraped_at": now,
        } for x in kept)
        print(f"  {contract[:44]:44} {len(kept):5} en base / {len(isins)}")

    ok = 0
    for i in range(0, len(rows), 200):
        _upsert(client, rows[i:i + 200])
        ok += len(rows[i:i + 200])
    print(f"\n  Éligibilité écrite : {ok} lignes ({len(union)} fonds distincts).")
    log_run("av-fr-selencia-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Catalogue UC Selencia (exports publics)")
    parser.add_argument("--apply", action="store_true", help="écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
