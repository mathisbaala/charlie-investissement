#!/usr/bin/env python3
"""
av-fr-axa-catalog.py — Catalogue UC AXA France
===============================================
Portail public :
  - Gestion Privée : https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html
  - Assurance Vie  : https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html

Architecture :
  1. Codes contrats hardcodés (extraits du DOM HTML)
  2. POST /apipriips/v1/information-produit {codeUV, nom}
     → liste des ANNEXE (fonds individuels) avec isin, nom, kidUrl, noteDurable
  3. Déduplique par ISIN → upsert investissement_funds
  4. Toutes les lignes → upsert investissement_av_lux_eligibility

Champs extraits par fonds :
  - isin, name, sfdr_article, kid_url, data_source='axa-fr'

Champs éligibilité (ISIN × contrat) :
  - isin, company_name='AXA France', contract_name, source_url, scraped_at

Usage :
    python3 scripts/scrapers/av-fr-axa-catalog.py [--apply] [--limit N] [--no-eligibility]
"""

import sys
import re
import time
import json
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

API_URL = "https://apis.axa.fr/apipriips/v1/information-produit"

HEADERS = {
    "User-Agent":   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":       "application/json",
    "Content-Type": "application/json",
    "Origin":       "https://www.axa.fr",
    "Referer":      "https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html",
}

# Contrats AXA France (codes extraits du HTML des pages DIC)
CONTRACTS = [
    # Gestion Privée
    {"code": "96784",       "categorie": "INDIVIDUELLE", "name": "AMADEO EVOLUTION VIE",             "source": "https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html"},
    {"code": "96794",       "categorie": "INDIVIDUELLE", "name": "AMADEO EVOLUTION CAPITALISATION",  "source": "https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html"},
    {"code": "70554",       "categorie": "INDIVIDUELLE", "name": "PER AMADEO",                       "source": "https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html"},
    {"code": "93164",       "categorie": "INDIVIDUELLE", "name": "AMADEO EXCELLENCE VIE",            "source": "https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html"},
    {"code": "93154",       "categorie": "INDIVIDUELLE", "name": "AMADEO EXCELLENCE CAPITALISATION", "source": "https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html"},
    {"code": "92094",       "categorie": "INDIVIDUELLE", "name": "PAM EXCELLENCE VIE",               "source": "https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html"},
    {"code": "93014",       "categorie": "INDIVIDUELLE", "name": "PAM EXCELLENCE CAPITALISATION",    "source": "https://www.axa.fr/epargne-retraite/gestion-privee/DIC.html"},
    # Assurance Vie Standard
    {"code": "91734",       "categorie": "INDIVIDUELLE", "name": "ARPEGES",                "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    {"code": "80774-80074", "categorie": "INDIVIDUELLE", "name": "CLER",                   "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    {"code": "93884",       "categorie": "INDIVIDUELLE", "name": "CLEF",                   "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    {"code": "93804",       "categorie": "INDIVIDUELLE", "name": "EXCELIUM VIE",           "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    {"code": "94054",       "categorie": "INDIVIDUELLE", "name": "EXCELIUM CAPITALISATION", "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    {"code": "91424",       "categorie": "INDIVIDUELLE", "name": "FIGURES LIBRES",         "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    {"code": "95564",       "categorie": "INDIVIDUELLE", "name": "MILLENIUM",              "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    {"code": "91974",       "categorie": "INDIVIDUELLE", "name": "NOVIAL",                 "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    {"code": "91954",       "categorie": "INDIVIDUELLE", "name": "PRIVILEGE",              "source": "https://www.axa.fr/epargne-retraite/assurance-vie/DIC.html"},
    # PER Individuel
    {"code": "96914",       "categorie": "INDIVIDUELLE", "name": "FAR PER",                "source": "https://www.axa.fr/epargne-retraite/assurance-retraite/per/DIC.html"},
    {"code": "96904",       "categorie": "INDIVIDUELLE", "name": "PER MA RETRAITE",        "source": "https://www.axa.fr/epargne-retraite/assurance-retraite/per/DIC.html"},
    # Épargne retraite professionnelle (collectifs)
    {"code": "A82",         "categorie": "COLLECTIVES",  "name": "ARTICLE 82",             "source": "https://www.axa.fr/pro/epargne-retraite-professionnelle/DIC.html"},
    {"code": "IFC_ST",      "categorie": "COLLECTIVES",  "name": "SOLERE IFC",             "source": "https://www.axa.fr/pro/epargne-retraite-professionnelle/DIC.html"},
    {"code": "IFC_SM",      "categorie": "COLLECTIVES",  "name": "IFC SUR MESURE",         "source": "https://www.axa.fr/pro/epargne-retraite-professionnelle/DIC.html"},
    {"code": "PER_ST",      "categorie": "COLLECTIVES",  "name": "SOLERE PER",             "source": "https://www.axa.fr/pro/epargne-retraite-professionnelle/DIC.html"},
    {"code": "PER_SM",      "categorie": "COLLECTIVES",  "name": "PERO",                   "source": "https://www.axa.fr/pro/epargne-retraite-professionnelle/DIC.html"},
    {"code": "PERECO_ASS",  "categorie": "COLLECTIVES",  "name": "PERECO ASSURANTIEL",     "source": "https://www.axa.fr/pro/epargne-retraite-professionnelle/DIC.html"},
    {"code": "PERECO_CT",   "categorie": "COLLECTIVES",  "name": "PERECO COMPTE TITRE",    "source": "https://www.axa.fr/pro/epargne-retraite-professionnelle/DIC.html"},
]

RATE_LIMIT = 1.0   # secondes entre requêtes
TIMEOUT    = 30

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


# ─── Fetch ────────────────────────────────────────────────────────────────────

def fetch_contract_funds(session: requests.Session, code: str, name: str, categorie: str = "INDIVIDUELLE") -> list[dict]:
    """Récupère les fonds d'un contrat AXA via POST."""
    body = {"codeUV": code, "nom": name, "categorie": categorie}
    try:
        r = session.post(API_URL, json=body, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"\n  ⚠  {name} ({code}) : {e}")
        return []


# ─── Parseur ──────────────────────────────────────────────────────────────────

def map_fund(item: dict) -> dict | None:
    """Construit le record investissement_funds depuis un item ANNEXE."""
    isin = (item.get("isin") or "").strip().upper()
    if not ISIN_RE.match(isin):
        return None

    name = (item.get("nom") or "").strip()
    if not name:
        return None

    # SFDR depuis noteDurable ('6', '8', '9', 'NC')
    sfdr = None
    nd = item.get("noteDurable") or ""
    if nd in ("6", "8", "9"):
        sfdr = int(nd)

    kid = item.get("kidUrl")
    if not kid or kid == "null":
        kid = None

    record: dict = {
        "isin":               isin,
        "name":               name,
        "product_type":       "opcvm",
        "currency":           "EUR",
        "distributor_france": True,
        "data_source":        "axa-fr",
    }
    if sfdr is not None:
        record["sfdr_article"] = sfdr
    if kid:
        record["kid_url"] = kid
    return record


# ─── Éligibilité ──────────────────────────────────────────────────────────────

def upsert_eligibility_bulk(client, rows: list[dict], dry_run: bool) -> tuple[int, int]:
    if dry_run or not rows:
        return len(rows), 0

    batch_size = 200
    ok = fail = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            client.table("investissement_av_lux_eligibility") \
                .upsert(batch, on_conflict="isin,contract_name") \
                .execute()
            ok += len(batch)
        except Exception as e:
            err = str(e)
            if "42P01" in err or "does not exist" in err.lower():
                print(f"\n  ⚠  Table investissement_av_lux_eligibility inexistante")
                return 0, len(rows)
            print(f"\n  ⚠  eligibility batch {i//batch_size+1} : {e}")
            fail += len(batch)

    return ok, fail


# ─── Runner ────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, no_eligibility: bool):
    print("=" * 60)
    print("  AXA France AV — Catalogue UC")
    print("=" * 60)
    print(f"  Mode         : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Contrats     : {len(CONTRACTS)}")
    if limit:
        print(f"  Limite ISINs : {limit}")
    if no_eligibility:
        print("  Éligibilité  : désactivée")
    print()

    started = datetime.now(timezone.utc)
    session = requests.Session()

    funds_by_isin: dict[str, dict] = {}
    elig_seen: set[tuple] = set()
    elig_rows: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    skipped = 0
    total_rows = 0

    for idx, contract in enumerate(CONTRACTS, 1):
        code       = contract["code"]
        cname      = contract["name"]
        source_url = contract["source"]
        categorie  = contract.get("categorie", "INDIVIDUELLE")

        time.sleep(RATE_LIMIT)
        items = fetch_contract_funds(session, code, cname, categorie)

        annexes = [i for i in items if i.get("type") == "ANNEXE"]
        total_rows += len(annexes)

        for item in annexes:
            # Filtre statut vente
            if item.get("statutVente") == "Fermé":
                skipped += 1
                continue

            fund = map_fund(item)
            if not fund:
                skipped += 1
                continue

            isin = fund["isin"]

            # Meilleur record par ISIN
            if isin not in funds_by_isin:
                funds_by_isin[isin] = fund
            else:
                existing = funds_by_isin[isin]
                if fund.get("sfdr_article") and not existing.get("sfdr_article"):
                    funds_by_isin[isin] = fund
                elif fund.get("kid_url") and not existing.get("kid_url"):
                    funds_by_isin[isin] = fund

            # Éligibilité
            key = (isin, cname)
            if key not in elig_seen:
                elig_seen.add(key)
                elig_rows.append({
                    "isin":          isin,
                    "company_name":  "AXA France",
                    "contract_name": cname,
                    "source_url":    source_url,
                    "scraped_at":    now_iso,
                })

        print(f"  [{idx:2}/{len(CONTRACTS)}] {cname:40} → {len(annexes)} fonds")

    unique_funds = list(funds_by_isin.values())
    print(f"\n  {total_rows:,} lignes brutes, {len(unique_funds):,} ISINs uniques, {skipped} ignorées")
    print(f"  {len(elig_rows):,} entrées éligibilité")

    if limit:
        unique_funds = unique_funds[:limit]
        elig_isins = {f["isin"] for f in unique_funds}
        elig_rows = [e for e in elig_rows if e["isin"] in elig_isins]
        print(f"  Limité à {limit} ISINs ({len(elig_rows)} entrées éligibilité)")

    if not unique_funds:
        print("  Aucun fonds collecté.")
        if apply:
            log_run("av-fr-axa-catalog", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in unique_funds[:10]:
            sfdr = f"SFDR{f['sfdr_article']}" if f.get("sfdr_article") else "    "
            kid  = "KID✓" if f.get("kid_url") else "KID✗"
            print(f"  {f['isin']} | {sfdr:6} | {kid} | {f['name'][:50]}")
        sfdr_dist: dict[str, int] = {}
        for f in unique_funds:
            k = f"Art{f['sfdr_article']}" if f.get("sfdr_article") else "NC"
            sfdr_dist[k] = sfdr_dist.get(k, 0) + 1
        print(f"\n  SFDR : {sfdr_dist}")
        print(f"  Seraient upsertés : {len(unique_funds):,} fonds, {len(elig_rows):,} éligibilités")
        return

    # Upsert
    client = get_client()
    print(f"\n  Upsert investissement_funds...")
    ok_f, fail_f = upsert_funds_bulk(unique_funds, batch_size=100)
    print(f"  → {ok_f:,} OK, {fail_f} échec")

    if not no_eligibility:
        print(f"  Upsert investissement_av_lux_eligibility...")
        ok_e, fail_e = upsert_eligibility_bulk(client, elig_rows, dry_run=False)
        print(f"  → {ok_e:,} OK, {fail_e} échec")

    status = "success" if fail_f == 0 else "partial"
    log_run("av-fr-axa-catalog", status, ok_f, fail_f, started_at=started)

    elapsed = (datetime.now(timezone.utc) - started).seconds
    print(f"\n  Terminé en {elapsed}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AXA France AV Catalog")
    parser.add_argument("--apply",          action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",          type=int,            help="Limiter à N ISINs")
    parser.add_argument("--no-eligibility", action="store_true", help="Ne pas écrire l'éligibilité")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, no_eligibility=args.no_eligibility)
