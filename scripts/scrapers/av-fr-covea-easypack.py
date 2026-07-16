#!/usr/bin/env python3
"""
av-fr-covea-easypack.py — PER Covéa (MMA Vie, GMF Vie) via Quantalys Easypack
==============================================================================
mma.fr et gmf.fr sont derrière DataDome (403), mais chaque marque Covéa expose
un portail Quantalys « infos supports » public (repérage 2026-07-16) :
  https://infos-supports-investissement-mma.quantalys.com/mma/<id_contrat>
  https://infos-supports-investissement-gmf.quantalys.com/gmf/<id_contrat>
Même porte JS que LMEP (redirect à jeton posant les cookies), puis
POST /<marque>/Data — payload DataTables MINIMAL à colonnes nommées
(columns[i][data]=sCodeISIN…) + `id_contrat` (vérifié : recordsTotal exact).

PÉRIMÈTRE : les PER individuels (mission mapping PER) —
  MMA PER Avenir (id 4, ~33 UC), MMA Signature PER (id 16, ~160 UC),
  GMF PER Cadencéo (id 19, ~32 UC).
Les portails couvrent aussi les AV (MMA Multisupports id 1 : 44 UC vs 31 via
cap.mma.fr ; GMF Multéo id 1, Certigo id 6) → piste pour remplacer le PDF
cap.mma.fr et le miroir cleerly.fr de av-fr-{mma,gmf}-catalog (non fait ici).

use_proxy=True : quantalys peut bloquer les IP datacenter CI (cf. LMEP).

ÉLIGIBILITÉ-ONLY : n'écrit que le lien (isin, contrat) dans
investissement_av_lux_eligibility, filtré sur les ISIN déjà en base.

Usage :
    python3 scripts/scrapers/av-fr-covea-easypack.py            # dry-run
    python3 scripts/scrapers/av-fr-covea-easypack.py --apply
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402
from _av_pdf_common import existing_isins, make_session  # noqa: E402

# (company_name, racine du portail, segment, [(id_contrat, nom de contrat)])
PORTALS = [
    ("MMA Vie", "https://infos-supports-investissement-mma.quantalys.com", "mma",
     [(4, "MMA PER Avenir"), (16, "MMA Signature PER")]),
    ("GMF Vie", "https://infos-supports-investissement-gmf.quantalys.com", "gmf",
     [(19, "PER Cadencéo")]),
]

ISIN_RE   = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")
PAGE_SIZE = 400
TIMEOUT   = 45
COLUMNS   = ["nID", "sCodeISIN", "sNom"]  # colonnes nommées suffisent (vérifié)


def _open_portal(session, root: str, segment: str, first_id: int) -> str:
    """Franchit la porte JS du portail, renvoie le referer de session."""
    g = session.get(f"{root}/{segment}/{first_id}", timeout=TIMEOUT)
    m = re.search(r"window\.location\.href\s*=\s*'([^']+)'", g.text or "")
    if not m:
        return f"{root}/{segment}/{first_id}"
    referer = root + m.group(1)
    session.get(referer, timeout=TIMEOUT)  # pose les cookies
    return referer


def _payload(id_contrat: int, start: int, length: int) -> dict:
    p = {
        "draw": "1", "start": str(start), "length": str(length),
        "search[value]": "", "search[regex]": "false",
        "order[0][column]": "1", "order[0][dir]": "asc",
        "id_contrat": str(id_contrat),
    }
    for i, name in enumerate(COLUMNS):
        p[f"columns[{i}][data]"] = name
        p[f"columns[{i}][name]"] = name
        p[f"columns[{i}][searchable]"] = "true"
        p[f"columns[{i}][orderable]"] = "true"
        p[f"columns[{i}][search][value]"] = ""
        p[f"columns[{i}][search][regex]"] = "false"
    return p


def _fetch_contract_isins(session, root, segment, referer, id_contrat: int) -> list[str]:
    headers = {
        "X-Requested-With": "XMLHttpRequest", "Referer": referer,
        "Origin": root, "Accept": "application/json, text/javascript, */*",
    }
    isins: set[str] = set()
    start, total = 0, None
    while True:
        j = None
        for attempt in range(3):
            try:
                r = session.post(f"{root}/{segment}/Data",
                                 data=_payload(id_contrat, start, PAGE_SIZE),
                                 headers=headers, timeout=TIMEOUT)
                if r.status_code != 200:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                j = r.json()
                break
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        if j is None:
            print(f"      ⚠ id_contrat={id_contrat} : page start={start} abandonnée.")
            break
        if total is None:
            total = j.get("recordsTotal") or j.get("recordsFiltered") or 0
        data = j.get("data") or []
        if not data:
            break
        for row in data:
            code = str((row or {}).get("sCodeISIN") or "").strip().upper()
            if ISIN_RE.match(code):
                isins.add(code)
        start += PAGE_SIZE
        if total and start >= total:
            break
        time.sleep(0.3)
    return sorted(isins)


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print("  Covéa (MMA/GMF) — Easypack Quantalys (PER)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    per_contract: list[tuple[str, str, str, list[str]]] = []  # (company, contract, src, isins)
    n = 0
    for company, root, segment, contracts in PORTALS:
        session = make_session(use_proxy=True)
        referer = _open_portal(session, root, segment, contracts[0][0])
        for id_contrat, name in contracts:
            if limit and n >= limit:
                break
            isins = _fetch_contract_isins(session, root, segment, referer, id_contrat)
            print(f"  {company[:8]:8} {name[:40]:40} {len(isins):4} ISIN")
            per_contract.append((company, name, f"{root}/{segment}/{id_contrat}", isins))
            n += 1
            time.sleep(0.3)

    union = sorted({x for _, _, _, isins in per_contract for x in isins})
    print(f"\n  Union ISIN distincts : {len(union)}")

    if not union:
        print("  ✗ aucun ISIN — porte/ids de contrats probablement changés.")
        if apply:
            log_run("av-fr-covea-easypack", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  DRY-RUN — rien écrit (filtre « en base » appliqué seulement en --apply).")
        return

    client = get_client()
    known = existing_isins(client)
    now = datetime.now(timezone.utc).isoformat()

    seen_keys: set[tuple[str, str]] = set()  # dédup (isin, contrat) anti-21000
    batch, ok = [], 0
    for company, contract_name, src_url, isins in per_contract:
        for x in isins:
            if x not in known:
                continue
            key = (x, contract_name)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            batch.append({
                "isin": x, "company_name": company, "contract_name": contract_name,
                "source_url": src_url, "scraped_at": now,
            })
    if batch:
        client.table("investissement_av_lux_eligibility") \
            .upsert(batch, on_conflict="isin,contract_name").execute()
        ok = len(batch)

    print(f"  Éligibilité écrite : {ok} lignes ({len(union)} ISIN bruts avant filtre).")
    log_run("av-fr-covea-easypack", "success", ok, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Covéa MMA/GMF — PER (éligibilité-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N contrats (debug)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
