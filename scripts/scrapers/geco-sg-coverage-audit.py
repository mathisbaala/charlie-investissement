#!/usr/bin/env python3
"""
geco-sg-coverage-audit.py — Audit de couverture par société de gestion (READ-ONLY)
==================================================================================
Chiffrage préalable au chantier "liste des SG agréées AMF".

NE FAIT AUCUNE ÉCRITURE. Objectif : quantifier le gain potentiel avant de coder.

1. Pull read-only de l'univers FR agréé via l'API GECO (getCompartmentsBycriteria).
2. Ne garde que les compartiments VIVANTS (cmpStatutCode=VIV) avec ISIN valide.
3. Lit l'ensemble des ISIN déjà présents dans investissement_funds.
4. Croise : combien de fonds GECO vivants NE sont PAS chez nous, ventilé par SG.
5. Sort un rapport (stdout + /tmp/geco_gap_*.json/csv).

Usage : python3 scripts/scrapers/geco-sg-coverage-audit.py [--limit N]
"""

import re
import sys
import csv
import json
import time
import argparse
from pathlib import Path
from collections import defaultdict

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

GECO_URL = "https://geco.amf-france.org/back-office/funds/getCompartmentsBycriteria?productType=FR"
PAGE_SIZE = 100
RATE_LIMIT_SEC = 1.1
MAX_EMPTY_PAGES = 3

_ISIN_RE = re.compile(r'^[A-Z]{2}[A-Z0-9]{10}$')


def valid_isin(s):
    if s and _ISIN_RE.match(str(s).strip()):
        return str(s).strip()
    return None


def extract(r):
    """(isin, sgp, name, statut, category) depuis un record GECO, ou None."""
    isin = (
        valid_isin(r.get("cmpIsin"))
        or next((valid_isin(s) for s in (r.get("sharesIsins") or []) if s), None)
        or valid_isin(r.get("cmpCodeParPrincp"))
    )
    if not isin:
        return None
    sgp = (r.get("gestionnaire") or r.get("societeGestion") or "").strip()
    name = (r.get("cmpNom") or r.get("nomFonds") or "").strip()
    statut = (r.get("cmpStatutCode") or "").strip()
    cat = (r.get("cmpClssFndAmfLib") or "").strip()
    return isin, sgp, name, statut, cat


def norm_sgp(s):
    """Normalisation légère pour regrouper (casse/espaces)."""
    if not s:
        return "(inconnue)"
    return re.sub(r'\s+', ' ', s).strip().upper()


def fetch_page(session, offset):
    payload = {"first": offset, "rows": PAGE_SIZE, "sortOrder": 1,
               "filters": {}, "globalFilter": None}
    for attempt in range(4):
        try:
            resp = session.post(GECO_URL, json=payload, stealthy_headers=True, timeout=30)
            if resp.status == 200:
                data = json.loads(resp.body.decode("utf-8"))
                if isinstance(data, list):
                    return data
                return (data.get("compartmentDtos") or data.get("data")
                        or data.get("results") or [])
            elif resp.status in (429, 503):
                time.sleep(10 * (attempt + 1))
            else:
                print(f"    HTTP {resp.status} @ offset {offset}")
                return []
        except Exception as e:
            print(f"    err {attempt+1}: {e}")
            time.sleep(5 * (attempt + 1))
    return []


def pull_geco(limit=None):
    session = FetcherSession(impersonate="chrome").__enter__()
    living = {}      # isin -> (sgp, name, cat)
    all_isins = set()
    dead = 0
    offset = 0
    empty = 0
    while True:
        if limit and len(all_isins) >= limit:
            break
        print(f"  page {offset//PAGE_SIZE+1:4d} (offset={offset})...", end=" ", flush=True)
        time.sleep(RATE_LIMIT_SEC)
        raw = fetch_page(session, offset)
        if not raw:
            empty += 1
            print(f"vide ({empty})")
            if empty >= MAX_EMPTY_PAGES:
                print("  → fin.")
                break
            offset += PAGE_SIZE
            continue
        empty = 0
        for rec in raw:
            ex = extract(rec)
            if not ex:
                continue
            isin, sgp, name, statut, cat = ex
            all_isins.add(isin)
            if statut and statut != "VIV":
                dead += 1
                continue
            if isin not in living:
                living[isin] = (sgp, name, cat)
        print(f"✓ {len(raw)} bruts (vivants cumulés={len(living)})")
        offset += PAGE_SIZE
    return living, all_isins, dead


def our_isins():
    client = get_client()
    seen = set()
    start = 0
    STEP = 1000
    while True:
        rows = (client.table("investissement_funds").select("isin")
                .range(start, start + STEP - 1).execute().data)
        if not rows:
            break
        for r in rows:
            if r.get("isin"):
                seen.add(r["isin"].strip())
        if len(rows) < STEP:
            break
        start += STEP
    return seen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    print("=" * 64)
    print("  AUDIT COUVERTURE PAR SOCIÉTÉ DE GESTION (read-only)")
    print("=" * 64)

    print("\n[1/3] Pull univers FR agréé (GECO)...")
    living, all_isins, dead = pull_geco(args.limit)
    print(f"\n  GECO : {len(all_isins)} ISIN uniques, {len(living)} vivants, {dead} non-vivants ignorés")

    print("\n[2/3] Lecture des ISIN en base...")
    ours = our_isins()
    print(f"  Base : {len(ours)} ISIN")

    print("\n[3/3] Croisement...")
    missing = {isin: v for isin, v in living.items() if isin not in ours}
    covered = len(living) - len(missing)

    # Ventilation par SG
    by_sgp_missing = defaultdict(list)
    by_sgp_total = defaultdict(int)
    for isin, (sgp, name, cat) in living.items():
        by_sgp_total[norm_sgp(sgp)] += 1
    for isin, (sgp, name, cat) in missing.items():
        by_sgp_missing[norm_sgp(sgp)].append((isin, name, cat))

    # SG entièrement absentes de notre base (0 fonds couverts)
    sgp_fully_absent = [s for s in by_sgp_total
                        if len(by_sgp_missing.get(s, [])) == by_sgp_total[s]]

    print("\n" + "=" * 64)
    print("  RÉSULTAT")
    print("=" * 64)
    print(f"  Fonds GECO vivants                : {len(living)}")
    print(f"  Déjà en base                      : {covered} ({100*covered//max(len(living),1)}%)")
    print(f"  MANQUANTS (gain net potentiel)    : {len(missing)}")
    print(f"  SG distinctes (vivantes)          : {len(by_sgp_total)}")
    print(f"  SG entièrement absentes de la base: {len(sgp_fully_absent)}")

    print("\n  --- Top 30 SG par fonds manquants ---")
    ranked = sorted(by_sgp_missing.items(), key=lambda kv: -len(kv[1]))
    for sgp, items in ranked[:30]:
        tot = by_sgp_total[sgp]
        flag = " [ABSENTE]" if len(items) == tot else ""
        print(f"    {len(items):5d} / {tot:5d}  {sgp[:48]}{flag}")

    # Dumps
    out_json = Path("/tmp/geco_gap_missing.json")
    out_json.write_text(json.dumps(
        {isin: {"sgp": v[0], "name": v[1], "cat": v[2]} for isin, v in missing.items()},
        ensure_ascii=False, indent=2))
    out_csv = Path("/tmp/geco_gap_by_sgp.csv")
    with out_csv.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sgp_normalisee", "manquants", "total_vivants", "entierement_absente"])
        for sgp, items in ranked:
            w.writerow([sgp, len(items), by_sgp_total[sgp],
                        "oui" if len(items) == by_sgp_total[sgp] else "non"])
    print(f"\n  Détail écrit : {out_json}")
    print(f"  Ventilation  : {out_csv}")


if __name__ == "__main__":
    main()
