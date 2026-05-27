#!/usr/bin/env python3
"""
av-lux-utmost-catalog.py — Catalogue fonds Utmost Luxembourg S.A. (ex-Lombard International)
==============================================================================================
Utmost Luxembourg S.A. publie mensuellement un PDF de ses UC externes pour le contrat
"Liberté" (code 2626) :
  https://www.utmostwealthdocs.com/mb/D2UfYL

Format PDF (pdftotext -layout) — colonnes fixes :
  CODE ISIN | LIBELLÉ | SOCIÉTÉ DE GESTION | SRI (1-7) | PERF BRUTE 1Y | PERF BRUTE 5Y |
  FRAIS GESTION (B) | PERF NETTE 1Y (A-B) | PERF NETTE 5Y | ... | FORME | DEVISE | LABEL

Anchrage colonnes : les offsets numériques après la position du SRI sont stables :
  TER (FRAIS GESTION) : SRI + ~40
  perf_nette_1y       : SRI + ~51-53

Données extraites :
  - isin, name, currency, sri, srri, ter, ongoing_charges, performance_1y
  - av_lux_eligible = True, data_source = "utmost-luxembourg"

Usage :
    python3 scripts/scrapers/av-lux-utmost-catalog.py [--apply] [--limit N]
"""

import re
import sys
import subprocess
import tempfile
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

PDF_URL  = "https://www.utmostwealthdocs.com/mb/D2UfYL"
COMPANY  = "Utmost Luxembourg S.A."
CONTRACT = "Utmost Liberté Luxembourg"

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

ISIN_RE     = re.compile(r'^([A-Z]{2}[A-Z0-9]{10})\s+')
PCT_RE      = re.compile(r'([\-]?\d+[,\.]\d+)\s*%')
CURRENCY_RE = re.compile(r'\b(EUR|USD|GBP|CHF|NOK|SEK|DKK)\b')
SECTION_RE  = re.compile(r'^Fonds\s+\w', re.I)


# ─── Parsing ───────────────────────────────────────────────────────────────────

def pct_in_window(line: str, start: int, end: int) -> float | None:
    """Extraire la valeur en % dans une fenêtre [start:end] de la ligne."""
    segment = line[max(0, start):min(len(line), end)]
    m = PCT_RE.search(segment)
    if m:
        return round(float(m.group(1).replace(",", ".")), 4)
    return None


def find_sri_pos(line: str) -> int | None:
    """Trouver la position du digit SRI (1-7) dans la ligne, avant le premier %."""
    first_pct = line.find("%")
    if first_pct <= 0:
        return None
    m = re.search(r'\s([1-7])\s{2,}', line[:first_pct])
    return m.start(1) if m else None


def parse_isin_line(line: str) -> dict | None:
    isin_m = ISIN_RE.match(line)
    if not isin_m:
        return None

    isin    = isin_m.group(1)
    sri_pos = find_sri_pos(line)

    sri = None
    ter = None
    perf_1y = None

    if sri_pos is not None:
        sri_m = re.match(r'([1-7])', line[sri_pos:sri_pos+1])
        if sri_m:
            sri = int(sri_m.group(1))
        # Offsets mesurés : TER ≈ SRI+38..48, perf_nette_1y ≈ SRI+49..60
        ter    = pct_in_window(line, sri_pos + 36, sri_pos + 49)
        perf_1y = pct_in_window(line, sri_pos + 49, sri_pos + 62)

    # Devise (dans la partie droite de la ligne, après les colonnes numériques)
    cur_m = CURRENCY_RE.search(line[min(150, len(line)):])
    if not cur_m:
        cur_m = CURRENCY_RE.search(line[max(0, len(line) - 60):])
    currency = cur_m.group(1) if cur_m else "EUR"

    # Nom partiel : colonne LIBELLÉ, positions ~20-38 (SGP démarre vers pos 40)
    name_part = line[20:40].strip() if len(line) > 20 else ""

    return {
        "isin":       isin,
        "sri":        sri,
        "ter":        ter,
        "perf_1y":    perf_1y,
        "currency":   currency,
        "name_part":  name_part,
    }


def extract_funds_from_text(text: str) -> list[dict]:
    lines = text.splitlines()
    funds: dict[str, dict] = {}
    last_isin: str | None  = None

    for idx, line in enumerate(lines):
        if ISIN_RE.match(line):
            parsed = parse_isin_line(line)
            if not parsed:
                continue

            isin      = parsed["isin"]
            last_isin = isin

            fund: dict = {
                "isin":            isin,
                "av_lux_eligible": True,
                "data_source":     "utmost-luxembourg",
            }

            if parsed["name_part"]:
                fund["name"] = parsed["name_part"]
            if parsed["sri"] is not None:
                fund["sri"]  = parsed["sri"]
                fund["srri"] = parsed["sri"]
            if parsed["ter"] is not None:
                fund["ter"]             = parsed["ter"]
                fund["ongoing_charges"] = parsed["ter"]
            if parsed["perf_1y"] is not None:
                fund["performance_1y"] = parsed["perf_1y"]
            if parsed["currency"]:
                fund["currency"] = parsed["currency"]

            funds[isin] = fund

        elif last_isin and last_isin in funds:
            # Ligne de continuation : compléter le nom depuis la colonne LIBELLÉ (pos ~20-43)
            if len(line) >= 20 and line[:20].strip() == "":
                # Colonne LIBELLÉ seulement (pos 20-38, sans déborder sur SGP)
                libelle_cont = line[20:40].strip()
                # Exclure les lignes de pourcentages ou valeurs numériques
                if libelle_cont and not re.search(r'\d+[,\.]\d+\s*%', libelle_cont):
                    existing = funds[last_isin].get("name", "")
                    if libelle_cont not in existing:
                        funds[last_isin]["name"] = (existing + " " + libelle_cont).strip()
                # Réinitialiser après la ligne de continuation principale
                last_isin = None

    return list(funds.values())


# ─── Eligibility ───────────────────────────────────────────────────────────────

def upsert_eligibility(client, isin: str) -> bool:
    row = {
        "isin":          isin,
        "company_name":  COMPANY,
        "contract_name": CONTRACT,
        "source_url":    PDF_URL,
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
    print("  Utmost Luxembourg — PDF Catalog Scraper")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)

    print(f"  Téléchargement PDF Utmost Luxembourg…")
    try:
        r = requests.get(PDF_URL, headers=HEADERS, timeout=30)
        if not r.ok:
            print(f"  ERREUR : HTTP {r.status_code}")
            log_run("av-lux-utmost-catalog", "failed", 0, 0, started_at=started)
            return
    except Exception as e:
        print(f"  ERREUR réseau : {e}")
        log_run("av-lux-utmost-catalog", "failed", 0, 0, started_at=started)
        return

    print(f"  PDF {len(r.content)//1024} Ko → extraction pdftotext…")
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(r.content)
        pdf_path = f.name

    try:
        result = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            print(f"  ⚠ pdftotext : {result.stderr[:200]}")
            log_run("av-lux-utmost-catalog", "failed", 0, 0, started_at=started)
            return
        text = result.stdout
    finally:
        Path(pdf_path).unlink(missing_ok=True)

    funds = extract_funds_from_text(text)
    print(f"  {len(funds)} fonds extraits")

    if limit:
        funds = funds[:limit]

    if not apply:
        print("\n  Aperçu (12 premiers) :")
        for f in funds[:12]:
            sri  = f"SRI={f['sri']}" if f.get("sri") else "    "
            ter  = f"TER={f['ter']:.2f}%" if f.get("ter") else "        "
            p1y  = f"p1y={f['performance_1y']:+.2f}%" if f.get("performance_1y") is not None else "          "
            print(f"  {f['isin']}  {f.get('currency','?'):4}  {sri:6}  {ter:12}  {p1y:12}  {f.get('name','')[:40]}")
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
    log_run("av-lux-utmost-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Utmost Luxembourg Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
