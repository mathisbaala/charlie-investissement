#!/usr/bin/env python3
"""
av-lux-lmep-easypack.py — Catalogue fonds LMEP via Quantalys Easypack
=======================================================================
La Mondiale Europartner (AG2R La Mondiale) publie son univers de fonds AV Luxembourg
via un portail Quantalys "Easypack" accessible sans authentification :
  https://ag2rlmep-easypack.quantalys.com/LMEPEasypack

Le portail charge les données via une API DataTables (POST JSON) sur :
  POST /LMEPEasypack/Data

Champs disponibles : name, isin, type, catégorie, manager, currency, sri

Usage :
    python3 scripts/scrapers/av-lux-lmep-easypack.py [--apply] [--limit N]
"""

import re
import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

BASE_URL    = "https://ag2rlmep-easypack.quantalys.com/LMEPEasypack"
DATA_URL    = f"{BASE_URL}/Data"
COMPANY     = "AG2R La Mondiale / LMEP"
CONTRACT    = "LMEP Europartner Luxembourg"

HEADERS = {
    "User-Agent":   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":       "application/json, text/javascript, */*",
    "Content-Type": "application/x-www-form-urlencoded",
    "Referer":      BASE_URL,
    "X-Requested-With": "XMLHttpRequest",
}

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")
PAGE_SIZE = 500


# ─── Extraction ───────────────────────────────────────────────────────────────

def fetch_page(session: requests.Session, draw: int, start: int, length: int) -> dict:
    """Requête DataTables standard vers l'endpoint /LMEPEasypack/Data."""
    # Paramètres DataTables server-side
    payload = {
        "draw": draw,
        "start": start,
        "length": length,
        "search[value]": "",
        "search[regex]": "false",
        "order[0][column]": "0",
        "order[0][dir]": "asc",
    }
    try:
        r = session.post(DATA_URL, data=payload, headers=HEADERS, timeout=30)
        if r.ok:
            return r.json()
    except Exception:
        pass
    return {}


def parse_row(row) -> dict | None:
    """Interprète une ligne de données DataTables (list ou dict)."""
    # Les lignes peuvent être des listes ou des dicts selon la config DataTables
    if isinstance(row, list):
        # Format tableau : [name, isin, type, category, manager, currency, sri, ...]
        if len(row) < 2:
            return None
        name = str(row[0]).strip() if row[0] else ""
        isin = str(row[1]).strip().upper() if len(row) > 1 else ""
        currency = str(row[5]).strip() if len(row) > 5 else ""
        sri_raw = str(row[6]).strip() if len(row) > 6 else ""
    elif isinstance(row, dict):
        name = str(row.get("name") or row.get("Name") or row.get("FundName") or "").strip()
        isin = str(row.get("isin") or row.get("ISIN") or row.get("Isin") or "").strip().upper()
        currency = str(row.get("currency") or row.get("Currency") or "").strip()
        sri_raw = str(row.get("sri") or row.get("Sri") or row.get("srri") or "").strip()
    else:
        return None

    if not ISIN_RE.match(isin):
        return None

    fund: dict = {
        "isin":            isin,
        "av_lux_eligible": True,
        "data_source":     "lmep-easypack",
    }
    if name:
        fund["name"] = name
    if currency and re.match(r"^[A-Z]{3}$", currency):
        fund["currency"] = currency
    if sri_raw:
        m = re.search(r"(\d)", sri_raw)
        if m:
            v = int(m.group(1))
            if 1 <= v <= 7:
                fund["sri"] = v
                fund["srri"] = v

    return fund


def extract_all_funds() -> list[dict]:
    session = requests.Session()
    funds: dict[str, dict] = {}
    draw = 1
    start = 0

    # Premier appel pour connaître le total
    resp = fetch_page(session, draw, start=0, length=PAGE_SIZE)
    if not resp:
        print("  ⚠ Pas de réponse DataTables — test format alternatif")
        return []

    total = resp.get("recordsTotal") or resp.get("recordsFiltered") or 0
    data = resp.get("data") or resp.get("aaData") or []
    print(f"  recordsTotal={total}  première page: {len(data)} lignes")

    for row in data:
        f = parse_row(row)
        if f and f["isin"] not in funds:
            funds[f["isin"]] = f

    # Pages suivantes
    while start + PAGE_SIZE < total:
        start += PAGE_SIZE
        draw += 1
        resp = fetch_page(session, draw, start, PAGE_SIZE)
        data = resp.get("data") or resp.get("aaData") or []
        if not data:
            break
        for row in data:
            f = parse_row(row)
            if f and f["isin"] not in funds:
                funds[f["isin"]] = f

    return list(funds.values())


def upsert_eligibility(client, isin: str) -> bool:
    row = {
        "isin":          isin,
        "company_name":  COMPANY,
        "contract_name": CONTRACT,
        "source_url":    BASE_URL,
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.table("investissement_av_lux_eligibility") \
            .upsert(row, on_conflict="isin,contract_name") \
            .execute()
        return True
    except Exception as e:
        if "42P01" not in str(e) and "does not exist" not in str(e).lower():
            print(f"    ⚠ eligibility {isin}: {e}")
        return False


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  LMEP Easypack — Quantalys DataTables Scraper")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)

    print("  Extraction des fonds LMEP Easypack…")
    funds = extract_all_funds()

    if not funds:
        print("  ⚠ Aucun fonds extrait — vérifier l'URL et le format DataTables")
        # Essai alternatif : GET simple
        print("  Tentative GET simple…")
        try:
            r = requests.get(BASE_URL, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }, timeout=20)
            print(f"  HTTP {r.status_code} — {len(r.content)} octets")
            if r.ok:
                # Chercher des ISINs dans la page HTML
                isins = re.findall(r'\b([A-Z]{2}[A-Z0-9]{10})\b', r.text)
                unique_isins = list(dict.fromkeys(isins))
                print(f"  {len(unique_isins)} ISINs trouvés dans la page HTML")
                for i in unique_isins[:10]:
                    print(f"    {i}")
        except Exception as e:
            print(f"  ERREUR : {e}")
        log_run("av-lux-lmep-easypack", "failed", 0, 0, started_at=started)
        return

    print(f"  {len(funds)} fonds extraits")

    if limit:
        funds = funds[:limit]

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in funds[:10]:
            sri = f"SRI={f['sri']}" if f.get("sri") else "    "
            print(f"  {f['isin']}  {f.get('currency','?'):4}  {sri:6}  {f.get('name','')[:50]}")
        print(f"\n  Seraient écrits : {len(funds)} fonds + {len(funds)} lignes eligibility")
        return

    client = get_client()

    funds_with_name    = [f for f in funds if f.get("name")]
    funds_without_name = [f for f in funds if not f.get("name")]
    print(f"\n  Fonds avec nom : {len(funds_with_name)} | sans nom : {len(funds_without_name)}")

    ok, fail = upsert_funds_bulk(funds_with_name, batch_size=100) if funds_with_name else (0, 0)
    print(f"  Upsert investissement_funds (avec nom) : {ok} OK, {fail} échec")

    if funds_without_name:
        enrich_ok = enrich_fail = 0
        for f in funds_without_name:
            enrich = {k: v for k, v in f.items() if k not in ("name",) and v is not None}
            try:
                client.table("investissement_funds") \
                    .update({k: v for k, v in enrich.items() if k != "isin"}) \
                    .eq("isin", f["isin"]).execute()
                enrich_ok += 1
            except Exception:
                enrich_fail += 1
        print(f"  Enrichissement sans-nom : {enrich_ok} mis à jour, {enrich_fail} ignorés")

    elig_ok = elig_fail = 0
    for f in funds:
        if upsert_eligibility(client, f["isin"]):
            elig_ok += 1
        else:
            elig_fail += 1
    print(f"  Upsert eligibility : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run("av-lux-lmep-easypack", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LMEP Easypack Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
