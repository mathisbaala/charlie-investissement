#!/usr/bin/env python3
"""
geco-sg-fill-foreign.py — Fill-only étranger (chantier "principales SG" 2026-07-17)
====================================================================================
Pendant du geco-sg-fill.py pour les fonds ÉTRANGERS autorisés à la
commercialisation en France (Amundi Lux, BlackRock Lux, Nordea, M&G Lux,
FIL Lux, Pictet, ODDO BHF Lux/DE, Comgest AMI…).

FILL-ONLY (via db.safe_fill_funds, jamais d'écrasement) :

  A. Ingère les nouveautés étrangères PROPRES absentes de la base
     (mêmes exclusions que le script FR : structurés datés, feeders, fonds dédiés).
  B. Remplit management_company là où elle est NULL, depuis GECO.

Contrairement à amf-geco-foreign.py (upsert global DESTRUCTIF, ne plus relancer),
ce script est idempotent et sûr sur une base déjà peuplée.

Usage : python3 scripts/scrapers/geco-sg-fill-foreign.py [--apply] [--countries LU,IE]
Sans --apply : dry-run (compte et échantillonne, n'écrit rien).
"""

import re
import sys
import time
import json
import argparse
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, safe_fill_funds

GECO_URL = "https://geco.amf-france.org/back-office/funds/getCompartmentsBycriteria?productType={country}"
PAGE_SIZE = 100
RATE_LIMIT_SEC = 1.1
MAX_EMPTY_PAGES = 3
_ISIN_RE = re.compile(r'^[A-Z]{2}[A-Z0-9]{10}$')

FOREIGN_COUNTRIES = ["LU", "IE", "DE", "GB", "CH", "SE", "BE", "NL", "AT", "IT", "ES"]

CATEGORY_MAP = {
    "Actions": "actions", "Obligations": "obligations", "Monétaire": "monetaire",
    "Diversifié": "diversifie", "Alternatif": "alternatif", "Immobilier": "immobilier",
    "Fonds de fonds": "diversifie", "Trésorerie": "monetaire",
}

# --- Exclusions "non propre" (structurés datés / formule / non coté) ---
_EXCL_CAT = {"Fonds à formule", "Fonds commun à risques", "Fonds de prêt/de crédit"}
_EXCL_NAME = re.compile(
    r'\bS\.?\s?L\.?\s?P\.?\b|\bF\.?C\.?P\.?[RI]\b|\bF\.?P\.?C\.?I\b|\bFIP\b'
    r'|feeder|fonds d[ée]di[ée]|\*\*\*'
    r'|\bhorizon\b|exclusive|premium'
    r'|\b(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre'
    r'|january|february|march|april|june|july|august|september|october|november|december)\b'
    r'|\b\d{1,2}[/.]\d{1,2}[/.]20\d{2}\b|\b20\d{2}\b',
    re.IGNORECASE)


def is_clean(isin, name, cat):
    if isin.startswith("AMF"):
        return False
    if cat in _EXCL_CAT:
        return False
    if _EXCL_NAME.search(name or ""):
        return False
    return True


def valid_isin(s):
    return str(s).strip() if s and _ISIN_RE.match(str(s).strip()) else None


def parse_date(raw):
    if not raw:
        return None
    s = str(raw)[:10]
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', s) or re.match(r'(\d{2})/(\d{2})/(\d{4})', s)
    if not m:
        return None
    g = m.groups()
    return f"{g[0]}-{g[1]}-{g[2]}" if len(g[0]) == 4 else f"{g[2]}-{g[1]}-{g[0]}"


def map_record(r):
    isin = (valid_isin(r.get("cmpIsin"))
            or next((valid_isin(s) for s in (r.get("sharesIsins") or []) if s), None)
            or valid_isin(r.get("cmpCodeParPrincp")))
    if not isin:
        return None
    name = (r.get("cmpNom") or r.get("nomFonds") or "").strip()
    if not name:
        return None
    sgp = (r.get("gestionnaire") or r.get("societeGestion") or "").strip()
    cat = (r.get("cmpClssFndAmfLib") or r.get("categorie") or "").strip()
    statut = (r.get("cmpStatutCode") or "").strip()
    n = name.lower()
    is_etf = bool(re.search(r"ucits[\s\-]?etf", n)) or (
        re.search(r"\betf\b", n)
        and not re.search(r"s[ée]lection|allocation|\bselect\b|portfolio|multi[\s\-]?manager|profil", n))
    return {
        "isin": isin, "name": name, "statut": statut, "cat": cat, "sgp": sgp,
        "record": {
            "isin": isin, "name": name,
            "product_type": "etf" if is_etf else "opcvm",
            "management_company": sgp or None,
            "category": cat or None,
            "asset_class": CATEGORY_MAP.get(cat, None),
            "currency": "EUR",
            "inception_date": parse_date(r.get("cmpDateCreation")),
            "distributor_france": True,
        },
    }


def fetch_page(session, country, offset):
    payload = {"first": offset, "rows": PAGE_SIZE, "sortOrder": 1, "filters": {}, "globalFilter": None}
    url = GECO_URL.format(country=country)
    for attempt in range(4):
        try:
            resp = session.post(url, json=payload, stealthy_headers=True, timeout=30)
            if resp.status == 200:
                data = json.loads(resp.body.decode("utf-8"))
                return data if isinstance(data, list) else (data.get("compartmentDtos") or [])
            elif resp.status in (429, 503):
                time.sleep(10 * (attempt + 1))
            else:
                return []
        except Exception as e:
            print(f"    err {attempt+1}: {e}")
            time.sleep(5 * (attempt + 1))
    return []


def pull_geco(countries):
    session = FetcherSession(impersonate="chrome").__enter__()
    living = {}
    for country in countries:
        print(f"\n  [{country}] pull...", flush=True)
        offset, empty, before = 0, 0, len(living)
        while True:
            time.sleep(RATE_LIMIT_SEC)
            raw = fetch_page(session, country, offset)
            if not raw:
                empty += 1
                if empty >= MAX_EMPTY_PAGES:
                    break
                offset += PAGE_SIZE
                continue
            empty = 0
            for rec in raw:
                m = map_record(rec)
                if not m or (m["statut"] and m["statut"] != "VIV"):
                    continue
                living.setdefault(m["isin"], m)
            if offset % 1000 == 0:
                print(f"    ...offset {offset}, vivants cumulés={len(living)}", flush=True)
            offset += PAGE_SIZE
        print(f"  [{country}] +{len(living) - before} vivants")
    return living


def db_state(isins):
    """isin -> management_company (présent si en base)."""
    client = get_client()
    state = {}
    isins = list(isins)
    for i in range(0, len(isins), 400):
        chunk = isins[i:i + 400]
        rows = (client.table("investissement_funds")
                .select("isin,management_company").in_("isin", chunk).execute().data)
        for r in rows:
            state[r["isin"]] = r.get("management_company")
    return state


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--countries", default=",".join(FOREIGN_COUNTRIES))
    args = ap.parse_args()
    countries = [c.strip().upper() for c in args.countries.split(",") if c.strip()]

    print("=" * 60)
    print(f"  GECO SG FILL FOREIGN — {'APPLY' if args.apply else 'DRY-RUN'} — {','.join(countries)}")
    print("=" * 60)

    print("\n[1] Pull GECO étrangers vivants...")
    living = pull_geco(countries)
    print(f"\n  → {len(living)} fonds vivants au total")

    print("\n[2] État base...")
    state = db_state(living.keys())
    in_db = set(state.keys())

    missing = [m for isin, m in living.items() if isin not in in_db]
    clean_new = [m for m in missing if is_clean(m["isin"], m["name"], m["cat"])]
    excluded = len(missing) - len(clean_new)

    fill_mc = [{"isin": isin, "management_company": living[isin]["sgp"]}
               for isin, mc in state.items()
               if (mc is None or not str(mc).strip()) and living[isin]["sgp"]]

    print("\n" + "=" * 60)
    print(f"  A. Manquants total          : {len(missing)}")
    print(f"     dont exclus (structuré/PE): {excluded}")
    print(f"     → NOUVEAUTÉS PROPRES      : {len(clean_new)}")
    for m in clean_new[:60]:
        print(f"        {m['isin']}  {m['name'][:46]:46} | {m['sgp'][:22]}")
    if len(clean_new) > 60:
        print(f"        ... (+{len(clean_new) - 60} autres)")
    print(f"\n  B. management_company NULL remplissables : {len(fill_mc)}")
    print("=" * 60)

    if not args.apply:
        print("\n  DRY-RUN — rien écrit. Relancer avec --apply.")
        return

    print("\n[3] Écriture (fill-only)...")
    if clean_new:
        r = safe_fill_funds([m["record"] for m in clean_new], source="amf-geco")
        print(f"  A. nouveautés : {r}")
    if fill_mc:
        r = safe_fill_funds(fill_mc, source="amf-geco")
        print(f"  B. fill mgmt_company : {r}")
    print("\n  ✓ Terminé.")


if __name__ == "__main__":
    main()
