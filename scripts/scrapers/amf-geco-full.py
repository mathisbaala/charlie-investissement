#!/usr/bin/env python3
"""
amf-geco-full.py — Collecte exhaustive AMF GECO
================================================
Récupère les ~12 000 compartiments agréés par l'AMF et les upserte
dans investissement_funds.

Usage :
    python3 scripts/scrapers/amf-geco-full.py [--apply] [--limit N]

Sans --apply : mode dry-run (affiche les premiers résultats sans écrire).
--limit N   : limite à N fonds (test).

API GECO (non documentée, reverse-engineered) :
    POST https://geco.amf-france.org/back-office/funds/getCompartmentsBycriteria
    Retourne JSON paginé, ~100 résultats/page.
"""

import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import upsert_funds_bulk, log_run, get_client

# ─── Config ────────────────────────────────────────────────────────────────────

GECO_URL = "https://geco.amf-france.org/back-office/funds/getCompartmentsBycriteria?productType=FR"
PAGE_SIZE = 100
RATE_LIMIT_SEC = 1.1          # respecter l'API AMF
MAX_EMPTY_PAGES = 3            # stopper après N pages vides consécutives
BATCH_UPSERT = 200             # lignes par upsert Supabase

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; Charlie-Investissement/1.0; data@charlie.fr)",
    "Referer": "https://geco.amf-france.org/",
    "Origin": "https://geco.amf-france.org",
}

# Mapping catégorie AMF → asset_class Charlie
CATEGORY_MAP = {
    "Actions":          "actions",
    "Obligations":      "obligations",
    "Monétaire":        "monetaire",
    "Diversifié":       "diversifie",
    "Alternatif":       "alternatif",
    "Immobilier":       "immobilier",
    "Fonds de fonds":   "diversifie",
    "Trésorerie":       "monetaire",
}

def geco_category_to_asset_class(cat: str | None) -> str:
    if not cat:
        return "diversifie"
    for key, val in CATEGORY_MAP.items():
        if key.lower() in (cat or "").lower():
            return val
    return "diversifie"

def parse_inception_date(val: str | None) -> str | None:
    if not val:
        return None
    # GECO renvoie parfois "DD/MM/YYYY" ou "YYYY-MM-DD"
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(val.strip(), fmt).date().isoformat()
        except (ValueError, AttributeError):
            pass
    return None

def map_geco_record(r: dict) -> dict | None:
    """Convertit un enregistrement GECO en row investissement_funds.

    Structure réelle de l'API GECO (reverse-engineered 2026-05) :
    - ISIN : sharesIsins[0] ou cmpCodeParPrincp
    - Nom  : cmpNom
    - SGP  : gestionnaire
    - Cat  : cmpClssFndAmfLib
    - Date : cmpDateCreation
    - Total: 15 000+ fonds (clé racine 'compartmentDtos', meta 'total')
    """
    # ── ISIN — priorité : cmpIsin → sharesIsins[0] → cmpCodeParPrincp ──
    import re as _re
    def _valid_isin(s: str | None) -> str | None:
        if s and _re.match(r'^[A-Z]{2}[A-Z0-9]{10}$', str(s).strip()):
            return str(s).strip()
        return None

    isin = (
        _valid_isin(r.get("cmpIsin"))
        or next((_valid_isin(s) for s in (r.get("sharesIsins") or []) if s), None)
        or _valid_isin(r.get("cmpCodeParPrincp"))
    )
    if not isin:
        return None

    # ── Nom ──
    name = (r.get("cmpNom") or r.get("nomFonds") or "").strip()
    if not name:
        return None

    # ── SGP ──
    sgp = (r.get("gestionnaire") or r.get("societeGestion") or "").strip()

    # ── Catégorie AMF ──
    category_raw = (r.get("cmpClssFndAmfLib") or r.get("categorie") or "").strip()
    asset_class  = geco_category_to_asset_class(category_raw)

    # ── Date de création ──
    inception_raw = r.get("cmpDateCreation") or r.get("dateCreation") or ""
    inception_date = parse_inception_date(inception_raw)

    # ── Type produit : FIA ou UCITS ──
    prd_faml = r.get("prdFaml", "").upper()
    product_type = "opcvm"  # on garde opcvm comme type générique

    # ── Statut ──
    statut = r.get("cmpStatutCode", "")  # VIV=vivant, LQD=liquidé

    return {
        "isin":              isin,
        "name":              name,
        "product_type":      product_type,
        "management_company": sgp or None,
        "category":          category_raw or None,
        "asset_class":       asset_class,
        "currency":          "EUR",
        "inception_date":    inception_date,
        "distributor_france": True,
        "data_source":       "amf-geco",
    }


def fetch_page(session: FetcherSession, offset: int) -> list[dict]:
    payload = {
        "first":        offset,
        "rows":         PAGE_SIZE,
        "sortOrder":    1,
        "filters":      {},
        "globalFilter": None,
    }
    for attempt in range(4):
        try:
            resp = session.post(GECO_URL, json=payload, stealthy_headers=True, timeout=30)
            if resp.status == 200:
                data = json.loads(resp.body.decode("utf-8"))
                # Structure réelle : {"compartmentDtos": [...], "total": 15423}
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return (
                        data.get("compartmentDtos") or
                        data.get("data") or
                        data.get("compartiments") or
                        data.get("results") or
                        []
                    )
            elif resp.status in (429, 503):
                wait = 10 * (attempt + 1)
                print(f"    Rate-limited ({resp.status}) — attente {wait}s...")
                time.sleep(wait)
            else:
                print(f"    HTTP {resp.status} à l'offset {offset}")
                return []
        except Exception as e:
            wait = 5 * (attempt + 1)
            print(f"    Erreur réseau (tentative {attempt+1}) : {e} — attente {wait}s")
            time.sleep(wait)
    return []


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  AMF GECO — Collecte exhaustive OPCVM")
    print("=" * 60)
    print(f"  Mode : {'APPLY (écriture Supabase)' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()

    all_rows: list[dict] = []
    seen_isins: set[str] = set()
    offset = 0
    empty_streak = 0
    total_fetched = 0

    while True:
        if limit and total_fetched >= limit:
            break

        print(f"  Page {offset // PAGE_SIZE + 1:4d} (offset={offset})...", end=" ", flush=True)
        time.sleep(RATE_LIMIT_SEC)

        raw = fetch_page(session, offset)
        if not raw:
            empty_streak += 1
            print(f"✗ vide (streak={empty_streak})")
            if empty_streak >= MAX_EMPTY_PAGES:
                print("  → Fin de la liste détectée.")
                break
            offset += PAGE_SIZE
            continue

        empty_streak = 0
        mapped = [map_geco_record(r) for r in raw]
        # Dedup global : ignorer les ISINs déjà vus (compartiments multi-parts)
        valid  = [m for m in mapped if m is not None and m["isin"] not in seen_isins]
        total_fetched += len(valid)

        print(f"✓ {len(raw)} bruts → {len(valid)} valides (total={total_fetched})")

        # Dedup par ISIN (GECO peut retourner le même ISIN sur plusieurs compartiments)
        for row in valid:
            seen_isins.add(row["isin"])
            all_rows.append(row)

        offset += PAGE_SIZE

        # Upsert par batch pour ne pas tout perdre si interruption
        if apply and len(all_rows) >= BATCH_UPSERT:
            # Dedup le batch courant avant envoi
            batch = list({r["isin"]: r for r in all_rows[:BATCH_UPSERT]}.values())
            ok, fail = upsert_funds_bulk(batch)
            print(f"    → Upsert {len(batch)} fonds : {ok} OK, {fail} échec")
            all_rows = all_rows[BATCH_UPSERT:]

    # Flush du reste
    if apply and all_rows:
        batch = list({r["isin"]: r for r in all_rows}.values())
        ok, fail = upsert_funds_bulk(batch)
        print(f"  → Flush final {len(batch)} fonds : {ok} OK, {fail} échec")

    n_total = total_fetched
    print()
    print(f"  ✓ {n_total} fonds collectés depuis AMF GECO")

    if not apply:
        print()
        print("  Exemple des 3 premiers fonds :")
        # Recollect a sample for display
        sample = fetch_page(session, 0)
        for r in sample[:3]:
            m = map_geco_record(r)
            if m:
                print(f"    {m['isin']} | {m['name'][:50]} | {m['management_company']} | {m['category']}")

    if apply:
        log_run(
            scraper="amf-geco-full",
            status="success",
            records_processed=n_total,
            started_at=started,
        )
        print()
        print("  Pipeline run loggé dans investissement_pipeline_runs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AMF GECO — collecte exhaustive OPCVM")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase (défaut: dry-run)")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
