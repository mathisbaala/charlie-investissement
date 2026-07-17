#!/usr/bin/env python3
"""
av-fr-intencial-catalog.py — Catalogue UC des contrats Intencial Patrimoine (APICIL)
=====================================================================================
Intencial Patrimoine (APICIL Epargne) ne publie pas de liste de supports HTML ;
les annexes financières PDF publiques connues :

  • Intencial Liberalys Retraite (PER) — document officiel « Informations
    précontractuelles sur les actifs du Plan » sur espace.intencial.fr
    (~613 ISIN, à jour).
  • Intencial Liberalys Vie — copie publique de la note d'information
    (Annexe 5 « Liste des supports en UC ») hébergée par un distributeur
    (Mon Petit Placement via nextbanq.fr, ~541 ISIN, datée ~2019 → univers
    partiel mais réel ; le document officiel est derrière login).

NON sourçables publiquement (vérifié le 2026-07-16) :
  • Ligne Patrimoine — DIC sur portail PRIIPS APICIL derrière Cloudflare ;
  • Intencial Initiatives (CTO Gresham) — architecture ouverte sans liste figée.

Extraction PDF par pdfplumber (pas de dépendance pdftotext), ISIN validés
clé ISO 6166. ÉLIGIBILITÉ-ONLY : seuls les ISIN déjà au catalogue sont liés.

Usage :
    python3 scripts/scrapers/av-fr-intencial-catalog.py           # dry-run
    python3 scripts/scrapers/av-fr-intencial-catalog.py --apply
"""

import io
import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from _av_pdf_common import make_session, existing_isins, _upsert, _valid_isin  # noqa: E402
from db import get_client, log_run  # noqa: E402

COMPANY = "APICIL"

CONTRACTS = [
    {
        "contract": "Intencial Liberalys Retraite",
        "pdf_url": "https://espace.intencial.fr/documents/2217335/0/ILR_Info_Precontractuelle_des_Actifs.pdf",
    },
    {
        "contract": "Intencial Liberalys Vie",
        "pdf_url": "https://www.nextbanq.fr/img/services/monpetitplacement-vie/intencial-liberalys-vie-apicil.pdf",
    },
]

ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b")


def pdf_isins(session, url: str) -> list[str]:
    r = session.get(url, timeout=60, allow_redirects=True)
    if r.status_code != 200 or r.content[:4] != b"%PDF":
        print(f"    ! HTTP {r.status_code} / signature {r.content[:4]!r}")
        return []
    isins, seen = [], set()
    with pdfplumber.open(io.BytesIO(r.content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for m in ISIN_RE.finditer(text):
                v = m.group(1)
                if v not in seen and _valid_isin(v):
                    seen.add(v)
                    isins.append(v)
    return isins


def run(apply: bool) -> None:
    started = datetime.now(timezone.utc)
    print("=" * 64)
    print(f"  {COMPANY} / Intencial — catalogue UC (annexes PDF publiques)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'} | {len(CONTRACTS)} contrat(s)")
    print("=" * 64)

    session = make_session()
    per_contract = []
    for c in CONTRACTS:
        isins = pdf_isins(session, c["pdf_url"])
        per_contract.append((c["contract"], c["pdf_url"], isins))
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
    log_run("av-fr-intencial-catalog", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Catalogue UC Intencial/APICIL (PDF publics)")
    parser.add_argument("--apply", action="store_true", help="écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
