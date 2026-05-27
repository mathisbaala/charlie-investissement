#!/usr/bin/env python3
"""
geco-realestate.py — SCPI / OPCI / SCI depuis AMF GECO
=======================================================
Collecte tous les fonds immobiliers (SCPI, OPCI, SCI) enregistrés
à l'AMF via l'API GECO et les insère dans investissement_funds.

Source : https://geco.amf-france.org (API publique AMF)

SCPI : Société civile de placement immobilier — immobilier direct
OPCI : Organisme de placement collectif immobilier — hybride
SCI  : Société Civile Immobilière — véhicule de détention immobilière

Usage :
    python3 scripts/scrapers/geco-realestate.py [--apply] [--limit N]
    python3 scripts/scrapers/geco-realestate.py --apply  (tous)
"""

import json
import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, update_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

GECO_URL       = "https://geco.amf-france.org/back-office/funds/getCompartmentsBycriteria?productType=FR"
RATE_LIMIT_SEC = 0.5
TIMEOUT        = 20
PAGE_SIZE      = 500

HEADERS = {
    "Content-Type":  "application/json",
    "User-Agent":    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Accept":        "application/json",
}

# ISIN réel : code pays ISO 3166-1 alpha-2 + 10 alphanumériques
# On exclut les codes GECO pseudo-ISIN (SCPI..., OPCI..., SCI...)
ISIN_RE = re.compile(r"^(?:FR|DE|LU|IE|GB|US|NL|BE|IT|ES|AT|CH|SE|DK|NO|FI)[A-Z0-9]{10}$")

# Nature → product_type dans notre schéma
NATURE_MAP = {
    "SCPI": "scpi",
    "OPCI": "opci",
    "SCI":  "sci",
}


# ─── Extraction GECO ──────────────────────────────────────────────────────────

def extract_isin(rec: dict) -> str | None:
    code = rec.get("cmpCodeParPrincp", "")
    if code and ISIN_RE.match(code):
        return code
    for s in (rec.get("sharesIsins") or []):
        if s and ISIN_RE.match(s):
            return s
    return None


def extract_fund(rec: dict) -> dict | None:
    isin = extract_isin(rec)
    if not isin:
        return None

    nature_lib = rec.get("prdNatureLib", "")
    product_type = None
    for key, val in NATURE_MAP.items():
        if key in nature_lib:
            product_type = val
            break
    if not product_type:
        return None

    name = rec.get("cmpNom", "").strip()
    if not name:
        return None

    fund = {
        "isin":               isin,
        "name":               name,
        "product_type":       product_type,
        "management_company": rec.get("gestionnaire", "").strip() or None,
        "distributor_france": True,
        "data_source":        "amf-geco",
        "currency":           "EUR",
    }

    date_str = rec.get("cmpDateCreation", "")
    if date_str:
        try:
            fund["inception_date"] = date_str[:10]
        except Exception:
            pass

    return fund


def collect_realestate_geco(session: FetcherSession, limit: int | None) -> list[dict]:
    funds   = []
    offset  = 0
    total_scanned = 0

    while True:
        if limit and len(funds) >= limit:
            break

        payload = {
            "first":        offset,
            "rows":         PAGE_SIZE,
            "sortOrder":    1,
            "filters":      {},
            "globalFilter": None,
        }
        try:
            resp = session.post(GECO_URL, json=payload, stealthy_headers=True, timeout=TIMEOUT)
            if resp.status != 200:
                print(f"  HTTP {resp.status} à offset {offset}")
                break
            d = json.loads(resp.body.decode("utf-8"))
            records = d.get("compartmentDtos", [])
        except Exception as e:
            print(f"  Erreur à offset {offset}: {e}")
            break

        if not records:
            break

        total_scanned += len(records)
        for rec in records:
            nature = rec.get("prdNatureLib", "")
            if any(k in nature for k in NATURE_MAP):
                fund = extract_fund(rec)
                if fund:
                    funds.append(fund)

        if offset % 2000 == 0 and offset > 0:
            print(f"    Scanné {total_scanned} fonds, {len(funds)} immobiliers trouvés")

        if len(records) < PAGE_SIZE:
            break

        offset += PAGE_SIZE
        time.sleep(RATE_LIMIT_SEC)

    return funds[:limit] if limit else funds


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  GECO Real Estate — SCPI / OPCI / SCI")
    print("=" * 60)
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    session = FetcherSession(impersonate="chrome").__enter__()

    print("  Collecte AMF GECO...")
    funds = collect_realestate_geco(session, limit)

    # Dédupliquer par ISIN
    seen = set()
    unique = []
    for f in funds:
        if f["isin"] not in seen:
            seen.add(f["isin"])
            unique.append(f)
    funds = unique

    # Stats
    by_type = {}
    for f in funds:
        pt = f["product_type"]
        by_type[pt] = by_type.get(pt, 0) + 1
    print(f"  Trouvés : {len(funds)} fonds | " + " | ".join(f"{k}:{v}" for k, v in by_type.items()))

    # Vérifier les nouveaux vs existants
    if apply:
        existing_isins: set[str] = set()
        page, page_size = 0, 1000
        all_isins = [f["isin"] for f in funds]
        while True:
            batch_isins = all_isins[page * page_size: (page + 1) * page_size]
            if not batch_isins:
                break
            r = client.table("investissement_funds").select("isin").in_("isin", batch_isins).execute()
            for row in (r.data or []):
                existing_isins.add(row["isin"])
            if len(batch_isins) < page_size:
                break
            page += 1

        new_funds    = [f for f in funds if f["isin"] not in existing_isins]
        update_funds = [f for f in funds if f["isin"] in existing_isins]

        print(f"\n  Nouveaux : {len(new_funds)} | Mise à jour : {len(update_funds)}")

        # Upsert les nouveaux (avec name → INSERT OK)
        if new_funds:
            ok, fail = upsert_funds_bulk(new_funds, batch_size=100)
            print(f"  → Insertion {len(new_funds)} fonds : {ok} OK, {fail} échec")

        # Update les existants (sans toucher aux champs déjà enrichis)
        if update_funds:
            # On ne met à jour que les champs de base (ne pas écraser les données financières)
            update_rows = [
                {
                    "isin":               f["isin"],
                    "management_company": f.get("management_company"),
                    "distributor_france": True,
                    "data_source":        "amf-geco",
                }
                for f in update_funds
                if f.get("management_company")
            ]
            if update_rows:
                ok2, fail2 = update_funds_bulk(update_rows, batch_size=100)
                print(f"  → Update {len(update_rows)} fonds : {ok2} OK, {fail2} échec")

        log_run(
            scraper="geco-realestate",
            status="success",
            records_processed=len(new_funds),
            records_failed=0,
            started_at=started,
        )
    else:
        print(f"\n  Aperçu (15 premiers) :")
        for f in funds[:15]:
            print(f"  {f['isin']} | {f['product_type']:5} | {f.get('management_company','')[:25]:25} | {f['name'][:40]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SCPI/OPCI/SCI depuis AMF GECO")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
