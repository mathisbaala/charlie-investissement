#!/usr/bin/env python3
"""
av-fr-oradea-catalog.py — Référencement Oradéa Vie (AV France, groupe SG)
=========================================================================
Source : portail PRIIPS Oradéa  https://priips.oradea-vie.com/priips/oradea.html
  (HTML avec attributs cdproduit / cdcategorie / cdisine="<ISIN>").

ÉLIGIBILITÉ-ONLY : n'écrit que dans investissement_av_lux_eligibility, et
uniquement pour les ISIN déjà présents dans investissement_funds.

Usage :
    python3 scripts/scrapers/av-fr-oradea-catalog.py            # dry-run
    python3 scripts/scrapers/av-fr-oradea-catalog.py --apply
"""
import sys, re, time, argparse
from datetime import datetime, timezone
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

COMPANY = "Oradéa Vie"
H = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
# (page partenaire, libellé contrat)
PAGES = [
    ("https://priips.oradea-vie.com/priips/oradea.html", "Oradéa Vie (gamme courtage)"),
]


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
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    client = get_client()
    known = existing_isins(client)
    print(f"ISIN en base : {len(known)}")

    rows = []
    for url, contract in PAGES:
        t = requests.get(url, headers=H, timeout=40).text
        isins = sorted(set(re.findall(r'cdisine="([A-Z]{2}[A-Z0-9]{9}\d)"', t)))
        kept = [x for x in isins if x in known]
        for x in kept:
            rows.append((x, contract, url))
        print(f"  {contract[:40]:40} {len(isins):5} ISIN, {len(kept):5} en base")
        time.sleep(0.3)

    union = sorted({r[0] for r in rows})
    print(f"\nUnion ISIN Oradéa (en base) : {len(union)} | lignes éligibilité : {len(rows)}")

    if not args.apply:
        print("DRY-RUN — rien écrit. Relancer avec --apply.")
        return

    now = datetime.now(timezone.utc).isoformat()
    batch, ok = [], 0
    for isin, contract, url in rows:
        batch.append({"isin": isin, "company_name": COMPANY, "contract_name": contract,
                      "source_url": url, "scraped_at": now})
        if len(batch) >= 200:
            client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
            ok += len(batch); batch = []
    if batch:
        client.table("investissement_av_lux_eligibility").upsert(batch, on_conflict="isin,contract_name").execute()
        ok += len(batch)
    print(f"Éligibilité écrite : {ok} lignes ({len(union)} fonds Oradéa distincts).")


if __name__ == "__main__":
    main()
