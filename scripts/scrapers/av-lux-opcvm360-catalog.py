#!/usr/bin/env python3
"""
av-lux-opcvm360-catalog.py — Scraper générique opcvm360 pour contrats AV Luxembourg
=====================================================================================
L'API opcvm360 alimente des iframes de catalogues de fonds pour assureurs AV Lux.
Ce script est paramétrable par contrat via --contract-id (ou --all pour tous).

Contrats identifiés (iframeKey=dec511123cYF4gtju8Spf67dr) :
  633  AG2R La Mondiale               "Life Mobility Evolution"        336 fonds
  645  APICIL (Intencial)             "Intencial Liberalys Vie (BP Large)"  157 fonds
  665  APICIL (Intencial)             "Intencial Liberalys Vie (BP Medium)" 106 fonds
  669  APICIL (Intencial)             "Intencial Liberalys Vie (+ SCPI)"     57 fonds
  670  APICIL (Intencial)             "Intencial Liberalys Vie (Core DNCA)"  43 fonds
  671  APICIL (Intencial)             "Intencial Liberalys Vie (Premium)"   117 fonds
  672  APICIL (Intencial)             "Intencial Liberalys Vie (Plus)"       57 fonds
  673  APICIL (Intencial)             "Intencial Liberalys Vie (Essentiel)"  42 fonds
       ↑ « Liberalys » = marque INTENCIAL Patrimoine (assureur APICIL Épargne), PAS
         Natixis Life : ids étiquetés à la main à tort (opcvm360 ne les rattache pas
         à cette clé promoteur). Corrigé 17/07 (recoupement ISIN + insurerName APICIL).
  680  La Banque Postale Life / CNP   "Compte Libre Croissance LBP"     49 fonds
  681  La Banque Postale Life / CNP   "Compte Libre Croissance LBP 2"   49 fonds
  701  APICIL Luxembourg              "APICIL Luxembourg AV"            40 fonds
  705  Suravenir Luxembourg           "Suravenir Opportunités Lux"     468 fonds
  706  Suravenir Luxembourg           "Suravenir Libertés Lux"         468 fonds

Note : les noms de contrats sont des approximations basées sur l'analyse des fonds.
       Mettre à jour KNOWN_CONTRACTS lorsque les noms officiels sont confirmés.

Usage :
    python3 scripts/scrapers/av-lux-opcvm360-catalog.py --contract-id 671
    python3 scripts/scrapers/av-lux-opcvm360-catalog.py --all [--apply]
    python3 scripts/scrapers/av-lux-opcvm360-catalog.py --contract-id 705 --apply
    python3 scripts/scrapers/av-lux-opcvm360-catalog.py --list
"""

import sys
import json
import argparse
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

IFRAME_KEY = "dec511123cYF4gtju8Spf67dr"
API_BASE   = "https://services.opcvm360.com/api-v1/instrs-iframes"
IFRAME_BASE = "https://iframes.opcvm360.com/funds"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer":         "https://iframes.opcvm360.com/",
    "Origin":          "https://iframes.opcvm360.com",
}

API_FIELDS = (
    "isin,name,msRatingValue,labelIsr,lastVl,"
    "varP1Y,varP3Y,varP5Y,sri,"
    "varPAnnualized1Y,varPAnnualized3Y,varPAnnualized5Y"
)

# Contrats connus : id → (company, contract_name, data_source_tag)
KNOWN_CONTRACTS: dict[int, tuple[str, str, str]] = {
    633: ("AG2R La Mondiale",           "Life Mobility Evolution",              "ag2r-lmep"),
    # « Liberalys » = Intencial Patrimoine / APICIL Épargne (PAS Natixis Life).
    # Noms alignés sur la base (upsert idempotent sur (isin, contract_name)).
    645: ("APICIL",                     "Intencial Liberalys Vie (BP Large)",   "intencial-liberalys"),
    665: ("APICIL",                     "Intencial Liberalys Vie (BP Medium)",  "intencial-liberalys"),
    669: ("APICIL",                     "Intencial Liberalys Vie (+ SCPI)",     "intencial-liberalys"),
    670: ("APICIL",                     "Intencial Liberalys Vie (Core DNCA)",  "intencial-liberalys"),
    671: ("APICIL",                     "Intencial Liberalys Vie (Premium)",    "intencial-liberalys"),
    672: ("APICIL",                     "Intencial Liberalys Vie (Plus)",       "intencial-liberalys"),
    673: ("APICIL",                     "Intencial Liberalys Vie (Essentiel)",  "intencial-liberalys"),
    680: ("La Banque Postale Life",     "Compte Libre Croissance LBP",          "lbp-life-lux"),
    681: ("La Banque Postale Life",     "Compte Libre Croissance LBP 2",        "lbp-life-lux"),
    701: ("APICIL Luxembourg",          "APICIL Luxembourg AV",                 "apicil-lux"),
    705: ("Suravenir Luxembourg",       "Suravenir Opportunités Lux",           "suravenir-lux"),
    706: ("Suravenir Luxembourg",       "Suravenir Libertés Lux",               "suravenir-lux"),
}

# Noms d'assureur canoniques : l'API /licontracts renvoie parfois une casse
# différente du nom autoritaire (ex. « AG2R LA MONDIALE » tout en capitales), ce
# qui crée un doublon de pill côté UI face aux autres sources. On normalise vers
# une forme unique. Dict ciblé (PAS de title-case générique : casserait CNP/ACM/
# MACSF/MAAF qui doivent rester en capitales).
CANONICAL_COMPANY: dict[str, str] = {
    "AG2R LA MONDIALE": "AG2R La Mondiale",
}

def canon_company(name: str) -> str:
    return CANONICAL_COMPANY.get(name.strip(), name.strip())

RATE_LIMIT = 0.5  # secondes entre requêtes


# ─── Parsing ───────────────────────────────────────────────────────────────────

def pf(v) -> float | None:
    if v is None: return None
    try: return float(v)
    except: return None

def pi(v) -> int | None:
    if v is None: return None
    try: return int(v)
    except: return None


def parse_fund(item: dict, data_source: str) -> dict | None:
    isin = (item.get("isin") or "").strip().upper()
    if not isin or len(isin) < 10 or isin.startswith("SCPI"):
        return None

    name = (item.get("name") or "").strip() or None
    if not name:
        return None

    fund: dict = {
        "isin":            isin,
        "name":            name,
        "av_lux_eligible": True,
        "data_source":     data_source,
    }

    sri = pi(item.get("sri"))
    if sri is not None:
        fund["sri"]  = sri
        fund["srri"] = sri

    ms = pi(item.get("msRatingValue"))
    if ms is not None:
        fund["morningstar_rating"] = ms

    for db_key, api_key in [
        ("performance_1y", "varP1Y"),
        ("performance_3y", "varP3Y"),
        ("performance_5y", "varP5Y"),
    ]:
        v = pf(item.get(api_key))
        if v is not None:
            fund[db_key] = v

    return fund


# ─── Fetch ─────────────────────────────────────────────────────────────────────

PAGE_SIZE = 500  # l'API plafonne une page à 500 lignes


def fetch_contract(contract_id: int) -> list[dict]:
    """Récupère TOUS les fonds du contrat en paginant. L'API plafonne une page à
    500 lignes : les gros contrats (ex. meilleurtaux Liberté Vie = 920 fonds)
    étaient auparavant tronqués à 500 → supports manquants côté référencement."""
    all_items: list[dict] = []
    offset = 0
    total = None
    while True:
        url = (
            f"{API_BASE}"
            f"?limit={PAGE_SIZE}&offset={offset}&sortFields=name"
            f"&licontracts={contract_id}"
            f"&iframeKey={IFRAME_KEY}"
            f"&fields={API_FIELDS}"
        )
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
        except Exception as e:
            print(f"    API erreur (offset={offset}) : {e}")
            break
        if not r.ok:
            print(f"    API HTTP {r.status_code} (offset={offset})")
            break
        data  = r.json()
        items = data.get("data", [])
        total = data.get("metadata", {}).get("totalCount", len(items))
        all_items.extend(items)
        if len(items) < PAGE_SIZE or len(all_items) >= total:
            break
        offset += PAGE_SIZE
        time.sleep(RATE_LIMIT)
    print(f"    API OK — {len(all_items)} fonds (total={total})")
    return all_items


def fetch_licontracts_catalog() -> dict[int, tuple[str, str, str]]:
    """Liste AUTORITAIRE des contrats rattachés à la clé iframe via l'API
    /licontracts : idLiContract → (insurerName, name, data_source).
    Les noms d'assureur viennent directement de l'API (fini « Assureur inconnu » :
    p.ex. 470 → Generali Vie / « meilleurtaux Allocation Vie »).
    """
    url = f"https://services.opcvm360.com/api-v1/licontracts?iframeKey={IFRAME_KEY}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        if not r.ok:
            print(f"  /licontracts HTTP {r.status_code}")
            return {}
        data = r.json().get("data", [])
    except Exception as e:
        print(f"  /licontracts erreur : {e}")
        return {}

    catalog: dict[int, tuple[str, str, str]] = {}
    for it in data:
        cid = it.get("idLiContract")
        if cid is None:
            continue
        insurer = canon_company((it.get("insurerName") or "").strip() or "Assureur inconnu")
        name    = (it.get("name") or f"Contrat {cid}").strip()
        catalog[int(cid)] = (insurer, name, f"opcvm360-{cid}")
    return catalog


# ─── Eligibility ───────────────────────────────────────────────────────────────

def upsert_eligibility(client, isin: str, company: str, contract: str, contract_id: int) -> bool:
    row = {
        "isin":          isin,
        "company_name":  company,
        "contract_name": contract,
        "source_url":    f"{IFRAME_BASE}?iframekey={IFRAME_KEY}&licontracts={contract_id}",
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.table("investissement_av_lux_eligibility") \
            .upsert(row, on_conflict="isin,contract_name") \
            .execute()
        return True
    except Exception as e:
        if "42P01" not in str(e) and "does not exist" not in str(e).lower():
            print(f"      ⚠ eligibility {isin}: {e}")
        return False


# ─── Run one contract ──────────────────────────────────────────────────────────

def run_contract(contract_id: int, apply: bool, limit: int | None,
                 override: tuple[str, str, str] | None = None) -> tuple[int, int]:
    """Scrape un contrat. Retourne (ok, fail). `override` = (company, contract,
    data_source) autoritaire (mode --dynamic) ; sinon fallback KNOWN_CONTRACTS."""
    company, contract_name, data_source = override or KNOWN_CONTRACTS.get(
        contract_id,
        ("Assureur inconnu", f"Contrat {contract_id}", f"opcvm360-{contract_id}")
    )
    company = canon_company(company)

    # Garde-fou : un contrat sans assureur identifiable ne porte aucune info utile
    # pour un CGP (pollue le filtre « assureur » avec une pill « Assureur inconnu »).
    # On saute plutôt que d'écrire du bruit ; ces fonds sont quasi toujours déjà
    # référencés par un vrai contrat ailleurs.
    if company == "Assureur inconnu":
        print(f"\n  ── Contract {contract_id} : assureur non identifiable → ignoré")
        return 0, 0

    iframe_url = f"{IFRAME_BASE}?iframekey={IFRAME_KEY}&licontracts={contract_id}"
    print(f"\n  ── Contract {contract_id} : {company} / {contract_name}")
    print(f"     {iframe_url}")

    items = fetch_contract(contract_id)
    if not items:
        return 0, 0

    funds: dict[str, dict] = {}
    for item in items:
        f = parse_fund(item, data_source)
        if f and f["isin"] not in funds:
            funds[f["isin"]] = f

    unique = list(funds.values())
    if limit:
        unique = unique[:limit]

    print(f"    {len(unique)} fonds valides")

    if not apply:
        for f in unique[:5]:
            sri = f"SRI={f['sri']}" if f.get("sri") else "    "
            p1y = f"p1y={f['performance_1y']:+.1f}%" if f.get("performance_1y") is not None else "        "
            print(f"    {f['isin']}  {sri:6}  {p1y:10}  {f.get('name','')[:40]}")
        return len(unique), 0

    client = get_client()

    ok, fail = upsert_funds_bulk(unique, batch_size=100)
    print(f"    Upsert funds : {ok} OK, {fail} échec")

    elig_ok = elig_fail = 0
    for f in unique:
        if upsert_eligibility(client, f["isin"], company, contract_name, contract_id):
            elig_ok += 1
        else:
            elig_fail += 1
    print(f"    Upsert eligibility : {elig_ok} OK, {elig_fail} non traités")

    log_run(
        f"opcvm360-{contract_id}",
        "success" if fail == 0 else "partial",
        ok, fail,
        started_at=datetime.now(timezone.utc),
    )
    return ok, fail


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(contract_ids: list[int], apply: bool, limit: int | None,
        overrides: dict[int, tuple[str, str, str]] | None = None):
    overrides = overrides or {}
    print("=" * 60)
    print("  opcvm360 Generic AV Lux Catalog Scraper")
    print("=" * 60)
    print(f"  Mode     : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Contrats : {contract_ids}")
    print()

    total_ok = total_fail = 0
    for i, cid in enumerate(contract_ids):
        ok, fail = run_contract(cid, apply, limit, override=overrides.get(cid))
        total_ok   += ok
        total_fail += fail
        if i < len(contract_ids) - 1:
            time.sleep(RATE_LIMIT)

    print(f"\n{'='*60}")
    print(f"  Total : {total_ok} OK, {total_fail} échec sur {len(contract_ids)} contrats")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="opcvm360 Generic AV Lux Catalog")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--contract-id", type=int,    help="ID de contrat à scraper")
    group.add_argument("--all",         action="store_true", help="Scraper tous les contrats KNOWN_CONTRACTS")
    group.add_argument("--dynamic",     action="store_true", help="Découvrir les contrats via /licontracts (noms d'assureur autoritaires)")
    group.add_argument("--list",        action="store_true", help="Lister les contrats (connus + découverts)")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds par contrat")
    args = parser.parse_args()

    if args.list:
        print("Contrats KNOWN_CONTRACTS :")
        for cid, (company, name, src) in sorted(KNOWN_CONTRACTS.items()):
            print(f"  {cid:4}  {company:35}  {name}")
        print("\nContrats découverts via /licontracts :")
        for cid, (company, name, src) in sorted(fetch_licontracts_catalog().items()):
            print(f"  {cid:4}  {company:35}  {name}")
        sys.exit(0)

    if args.dynamic:
        catalog = fetch_licontracts_catalog()
        if not catalog:
            print("Aucun contrat découvert via /licontracts."); sys.exit(1)
        run(sorted(catalog), apply=args.apply, limit=args.limit, overrides=catalog)
        sys.exit(0)

    if args.all:
        # Tous sauf 633 (déjà couvert par ag2r-catalog.py)
        ids = sorted(k for k in KNOWN_CONTRACTS if k != 633)
    else:
        ids = [args.contract_id]

    run(ids, apply=args.apply, limit=args.limit)
