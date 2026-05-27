#!/usr/bin/env python3
"""
av-lux-apicil-onelife-catalog.py — Catalogue fonds Apicil Luxembourg (via OneLife)
===================================================================================
L'AV Luxembourg d'Apicil est opérée par OneLife (filiale rachetée par Apicil en 2019).
OneLife publie un catalogue XML public (PRIIPs IOD) via Harvest Cosy3 :
  https://www.priipsdocuments.com/onelife/IOD_xml/IODs_0.xml

Le fichier XML (34 Mo, 68 527 entrées) liste tous les fonds par combinaison
pays × produit × profil × langue. On filtre sur "Wealth Luxembourg - FEXT" et
on déduplique par ISIN.

Champs extraits :
  - isin, name, currency, sri (1-6), fund_type (UCITS/EF/ICF)

Pas de : performances, TER, SFDR article (non présents dans ce fichier).

Usage :
    python3 scripts/scrapers/av-lux-apicil-onelife-catalog.py [--apply] [--limit N]
"""

import re
import sys
import argparse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

XML_URL  = "https://www.priipsdocuments.com/onelife/IOD_xml/IODs_0.xml"
COMPANY  = "Apicil / OneLife"
CONTRACT = "OneLife Wealth Luxembourg"
FILTER   = "Wealth Luxembourg"  # sous-filtre dans le champ ID

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":     "application/xml, */*",
}

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


# ─── Parseurs ─────────────────────────────────────────────────────────────────

def extract_funds_from_xml(content: bytes) -> list[dict]:
    root = ET.fromstring(content)
    funds: dict[str, dict] = {}

    for entry in root:
        s = entry.find("SET_ID")
        if s is None:
            continue
        id_text = s.findtext("ID") or ""
        if FILTER not in id_text or "FEXT" not in id_text:
            continue

        isin = (s.findtext("ISIN") or "").strip().upper()
        if not ISIN_RE.match(isin) or isin in funds:
            continue

        level = s.findtext("LEVEL") or ""
        sri_m = re.search(r"(\d)", level)

        fund: dict = {
            "isin":            isin,
            "av_lux_eligible": True,
            "data_source":     "apicil-onelife",
        }

        name = (s.findtext("FUND") or "").strip()
        if name:
            fund["name"] = name

        currency = (s.findtext("Currency") or "").strip()
        if currency:
            fund["currency"] = currency

        if sri_m:
            v = int(sri_m.group(1))
            if 1 <= v <= 7:
                fund["sri"] = v
                fund["srri"] = v

        funds[isin] = fund

    return list(funds.values())


def upsert_eligibility(client, isin: str) -> bool:
    row = {
        "isin":          isin,
        "company_name":  COMPANY,
        "contract_name": CONTRACT,
        "source_url":    XML_URL,
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.table("investissement_av_lux_eligibility") \
            .upsert(row, on_conflict="isin,contract_name") \
            .execute()
        return True
    except Exception as e:
        if "42P01" not in str(e) and "does not exist" not in str(e).lower():
            print(f"    ⚠ eligibility {isin} : {e}")
        return False


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Apicil / OneLife — XML Scraper (Wealth Luxembourg FEXT)")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)

    print(f"  Téléchargement XML OneLife ({XML_URL[:60]}…)")
    try:
        r = requests.get(XML_URL, timeout=90)
        if not r.ok:
            print(f"  ERREUR : HTTP {r.status}")
            log_run("av-lux-apicil-onelife-catalog", "failed", 0, 0, started_at=started)
            return
    except Exception as e:
        print(f"  ERREUR réseau : {e}")
        log_run("av-lux-apicil-onelife-catalog", "failed", 0, 0, started_at=started)
        return

    print(f"  XML {len(r.content)//1024} Ko → parsing…")
    funds = extract_funds_from_xml(r.content)
    print(f"  {len(funds)} fonds uniques extraits (filtre: {FILTER} FEXT)")

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
            enrich = {k: v for k, v in f.items() if k != "name" and v is not None}
            try:
                client.table("investissement_funds") \
                    .update({k: v for k, v in enrich.items() if k != "isin"}) \
                    .eq("isin", f["isin"]) \
                    .execute()
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
    log_run("av-lux-apicil-onelife-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Apicil / OneLife Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
