#!/usr/bin/env python3
"""
euronext-etf.py — ETFs officiels depuis Euronext
=================================================
Euronext publie mensuellement un CSV téléchargeable listant tous les ETFs
cotés sur ses marchés (Paris, Amsterdam, Bruxelles, Oslo, Dublin, Milan).

Ce CSV contient pour chaque ETF :
  - ISIN, nom, ticker
  - Marché de cotation (XPAR = Paris, XAMS = Amsterdam, …)
  - Devise
  - Secteur / type d'actif
  - Société de gestion (émetteur)
  - Éligibilité PEA (champ spécifique Euronext France)

Source officielle :
  https://live.euronext.com/fr/pd_cms/api/downloadCSVEtf?mics=XPAR,XAMS,XBRU,XOSL,XLIS,XMLI

Usage :
    python3 scripts/scrapers/euronext-etf.py [--apply] [--market XPAR]

--market : XPAR (Paris, défaut), XAMS, XBRU, ALL
"""

import csv
import io
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

EURONEXT_ETF_CSV = (
    "https://live.euronext.com/fr/pd_cms/api/downloadCSVEtf"
    "?mics=XPAR,XAMS,XBRU,XOSL,XLIS,XMLI"
)
EURONEXT_ETF_XPAR = (
    "https://live.euronext.com/fr/pd_cms/api/downloadCSVEtf?mics=XPAR"
)

# URL alternative : téléchargement direct Euronext
EURONEXT_BULK_URL = (
    "https://live.euronext.com/en/pd/data/stocks"
    "?mics=XPAR,XAMS,XBRU&display_datapoints=dp_name,dp_isin,dp_emitter"
    "&display_filters=df_instrument_type%3Detf"
)

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":          "text/csv,application/csv,text/plain,*/*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer":         "https://live.euronext.com/fr/find-etf",
}

MARKET_NAMES = {
    "XPAR": "Euronext Paris",
    "XAMS": "Euronext Amsterdam",
    "XBRU": "Euronext Bruxelles",
    "XOSL": "Euronext Oslo",
    "XLIS": "Euronext Lisboa",
    "XMLI": "Euronext Milan",
}

# ─── Mapping type d'actif ─────────────────────────────────────────────────────

def guess_asset_class(row: dict) -> str:
    text = " ".join([
        str(row.get("Instrument Name", "")),
        str(row.get("Sector", "")),
        str(row.get("Type", "")),
        str(row.get("Category", "")),
    ]).lower()

    if any(w in text for w in ["equit", "action", "stock", "share"]):
        return "actions"
    if any(w in text for w in ["bond", "obligat", "fixed", "credit", "taux"]):
        return "obligations"
    if any(w in text for w in ["commodit", "gold", "silver", "oil", "metal", "matieres"]):
        return "alternatif"
    if any(w in text for w in ["real estate", "reit", "immo", "foncier"]):
        return "immobilier"
    if any(w in text for w in ["money", "cash", "monetaire", "liquidit"]):
        return "monetaire"
    return "diversifie"


def try_download_csv(session: FetcherSession, url: str) -> str | None:
    try:
        page = session.get(url, stealthy_headers=True, timeout=30)
        if page.status == 200:
            ct = resp.headers.get("Content-Type", "")
            if "csv" in ct or "text" in ct or len(page.body) > 1000:
                return page.body.decode("utf-8")
    except Exception:
        pass
    return None


def parse_euronext_csv(csv_text: str, target_market: str | None) -> list[dict]:
    """Parse le CSV Euronext → rows investissement_funds."""
    rows = []
    reader = csv.DictReader(io.StringIO(csv_text), delimiter=";")
    if not reader.fieldnames:
        # Essayer avec virgule
        reader = csv.DictReader(io.StringIO(csv_text), delimiter=",")

    seen_isins = set()
    for raw in reader:
        # Normaliser les clés (supprimer espaces)
        row = {k.strip(): v.strip() for k, v in raw.items() if k}

        # Trouver l'ISIN
        isin = (
            row.get("ISIN") or
            row.get("isin") or
            row.get("ISIN Code") or
            row.get("Isin") or ""
        ).strip().upper()

        import re
        if not re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", isin):
            continue

        if isin in seen_isins:
            continue
        seen_isins.add(isin)

        # Filtre par marché si demandé
        market = (row.get("Market") or row.get("MIC") or row.get("Marché") or "").upper()
        if target_market and target_market != "ALL" and market != target_market:
            continue

        # Nom
        name = (
            row.get("Instrument Name") or row.get("Name") or
            row.get("Libellé") or row.get("Nom") or ""
        ).strip()
        if not name:
            continue

        # Devise
        currency = (row.get("Currency") or row.get("Devise") or "EUR").strip().upper()[:3]

        # Émetteur / SGP
        issuer = (
            row.get("Emitter") or row.get("Émetteur") or
            row.get("Issuer") or row.get("Provider") or ""
        ).strip() or None

        # PEA — Euronext France tague explicitement les ETFs PEA
        pea_raw = (
            row.get("PEA") or row.get("PEA Eligible") or
            row.get("éligible PEA") or row.get("PEA Eligibility") or ""
        ).lower()
        pea_eligible = pea_raw in ("oui", "yes", "true", "1", "x", "✓")

        # Asset class
        asset_class = guess_asset_class(row)

        # Indice sous-jacent
        index_name = (
            row.get("Benchmark") or row.get("Index") or
            row.get("Indice") or row.get("Replicated Index") or ""
        ).strip() or None

        # TER si disponible
        ter_raw = row.get("TER") or row.get("OCF") or row.get("Frais courants") or ""
        ter = None
        if ter_raw:
            try:
                ter_val = float(ter_raw.replace(",", ".").replace("%", "").strip())
                ter = round(ter_val / 100, 6)
            except ValueError:
                pass

        mapped = {
            "isin":               isin,
            "name":               name,
            "product_type":       "etf",
            "management_company": issuer,
            "asset_class":        asset_class,
            "currency":           currency,
            "pea_eligible":       pea_eligible,
            "distributor_france": True,
            "data_source":        "euronext",
        }
        if ter:
            mapped["ter"] = ter
            mapped["ongoing_charges"] = ter
        if index_name:
            mapped["category"] = index_name

        rows.append(mapped)

    return rows


def run(apply: bool, market: str):
    print("=" * 60)
    print("  Euronext ETF — CSV officiel mensuel")
    print("=" * 60)
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Marché : {market}")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()

    # Essayer les URLs dans l'ordre
    csv_text = None
    for url in [EURONEXT_ETF_CSV, EURONEXT_ETF_XPAR]:
        print(f"  Téléchargement CSV...", end=" ", flush=True)
        csv_text = try_download_csv(session, url)
        if csv_text and len(csv_text) > 500:
            print(f"✓ {len(csv_text):,} octets")
            break
        print("✗ indisponible")

    if not csv_text:
        print("  ⚠️  CSV Euronext indisponible — tentative API JSON...")
        # Fallback : API JSON Euronext
        try:
            page = session.get(EURONEXT_BULK_URL, headers={**HEADERS, "Accept": "application/json"}, timeout=30)
            if page.status == 200:
                data = json.loads(page.body.decode("utf-8"))
                print(f"  → API JSON: {len(data)} résultats")
                # Traitement basique du JSON
                results = []
                for item in data:
                    isin = (item.get("isin") or "").upper()
                    import re
                    if re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", isin):
                        results.append({
                            "isin":         isin,
                            "name":         item.get("name", ""),
                            "product_type": "etf",
                            "asset_class":  "actions",
                            "currency":     "EUR",
                            "data_source":  "euronext-json",
                            "distributor_france": True,
                        })
                if apply and results:
                    ok, fail = upsert_funds_bulk(results)
                    print(f"  → Upsert {len(results)} ETFs : {ok} OK, {fail} échec")
        except Exception as e:
            print(f"  ✗ {e}")
        return

    # Parser le CSV
    etfs = parse_euronext_csv(csv_text, market if market != "ALL" else None)
    pea_count = sum(1 for e in etfs if e.get("pea_eligible"))
    print(f"  {len(etfs)} ETFs parsés ({pea_count} PEA-éligibles)")

    if apply and etfs:
        ok, fail = upsert_funds_bulk(etfs, batch_size=200)
        print(f"  → Upsert : {ok} OK, {fail} échec")
        log_run("euronext-etf", "success", ok, fail, started_at=started)
    elif not apply and etfs:
        print("\n  Aperçu (5 premiers) :")
        for e in etfs[:5]:
            pea = "PEA✓" if e.get("pea_eligible") else "    "
            print(f"  {e['isin']} | {pea} | {e['asset_class']:12} | {e['name'][:45]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Euronext ETF — CSV officiel")
    parser.add_argument("--apply",  action="store_true",  help="Écrire dans Supabase")
    parser.add_argument("--market", default="ALL",        help="XPAR|XAMS|XBRU|ALL")
    args = parser.parse_args()
    run(apply=args.apply, market=args.market.upper())
