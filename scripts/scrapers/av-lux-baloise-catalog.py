#!/usr/bin/env python3
"""
av-lux-baloise-catalog.py — Catalogue fonds Baloise Life Luxembourg
====================================================================
Baloise Life publie sa liste de supports en PDF public :
https://www.baloise-life.com/dam/baloise-international-lu/PDF/telechargements/lu/External-funds-Fund-list-Luxembourg.pdf

Colonnes PDF (layout fixe) :
  Nom du fonds | ISIN | Devise | Région | Catégorie | Perf1Y% | Perf3Y% | Perf5Y% | Manager | URL | SRI

Le PDF est régulièrement mis à jour (mensuel env.).

Usage :
    python3 scripts/scrapers/av-lux-baloise-catalog.py [--apply] [--limit N]
    python3 scripts/scrapers/av-lux-baloise-catalog.py --apply
"""

import re
import sys
import subprocess
import time
import tempfile
import argparse
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

PDF_URL    = (
    "https://www.baloise-life.com/dam/baloise-international-lu/PDF/"
    "telechargements/lu/External-funds-Fund-list-Luxembourg.pdf"
)
COMPANY    = "Baloise Life"
CONTRACT   = "Baloise Life Luxembourg"

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")
PERF_RE = re.compile(r"^[+-]?\d{1,3}[,.]?\d{0,2}$")


def pct_to_float(s: str) -> float | None:
    if not s:
        return None
    s = s.strip().replace(",", ".").replace("%", "")
    try:
        return round(float(s), 4)
    except ValueError:
        return None


def parse_sri(s: str) -> int | None:
    s = str(s).strip()
    if s.isdigit() and 1 <= int(s) <= 7:
        return int(s)
    return None


def extract_funds_from_text(text: str) -> list[dict]:
    """
    Extrait les fonds depuis le texte pdftotext (layout).
    Chaque ligne de données contient un ISIN valide.
    Pattern observé :
      [Fund Name ...]   ISIN   Currency  Region  Category  1Y%  3Y%  5Y%  Manager  URL  SRI
    """
    funds: dict[str, dict] = {}

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue

        # Trouver le(s) ISIN dans la ligne
        tokens = line.split()
        isin_positions = [(i, t) for i, t in enumerate(tokens) if ISIN_RE.match(t)]
        if not isin_positions:
            continue

        for isin_idx, isin in isin_positions:
            if isin in funds:
                continue  # déjà vu

            # Tokens après l'ISIN
            after = tokens[isin_idx + 1:]

            # Currency : généralement 3 lettres majuscules après l'ISIN
            currency = None
            if after and re.match(r"^[A-Z]{3}$", after[0]):
                currency = after[0]
                after = after[1:]

            # SRI : dernier token si c'est 1-7
            sri = None
            if after and after[-1].isdigit() and 1 <= int(after[-1]) <= 7:
                sri = int(after[-1])
                after = after[:-1]

            # Manager URL : avant le SRI, souvent contient un point
            # Perf : 3 tokens numériques (1Y, 3Y, 5Y) avant le manager
            perfs = []
            perf_start = None
            for j, tok in enumerate(after):
                val = tok.replace(",", ".").replace("%", "").replace("N.d.", "").strip()
                if re.match(r"^[+-]?\d{1,3}(\.\d{1,2})?$", val) and val != "":
                    if perf_start is None:
                        perf_start = j
                    perfs.append(pct_to_float(tok))
                elif perf_start is not None:
                    break

            p1y = perfs[0] if len(perfs) > 0 else None
            p3y = perfs[1] if len(perfs) > 1 else None
            p5y = perfs[2] if len(perfs) > 2 else None

            # Nom du fonds : tokens AVANT l'ISIN
            name_tokens = tokens[:isin_idx]
            # Supprimer tokens qui ressemblent à un manager en début de ligne
            name = " ".join(name_tokens).strip() or None

            fund: dict = {
                "isin":            isin,
                "currency":        currency or "EUR",
                "av_lux_eligible": True,
                "data_source":     "baloise-lux",
            }
            if name:
                fund["name"] = name
            if sri:
                fund["sri"] = sri
            if p1y is not None:
                fund["performance_1y"] = p1y
            if p3y is not None:
                fund["performance_3y"] = p3y
            if p5y is not None:
                fund["performance_5y"] = p5y

            funds[isin] = fund

    return list(funds.values())


def download_pdf(url: str) -> str | None:
    """Télécharge le PDF et retourne le texte via pdftotext."""
    r = requests.get(url, timeout=30)
    if not r.ok:
        print(f"  ERREUR téléchargement PDF : {r.status}")
        return None

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(r.content)
        pdf_path = f.name

    try:
        result = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f"  ⚠ pdftotext erreur : {result.stderr[:200]}")
            return None
        return result.stdout
    except FileNotFoundError:
        print("  ERREUR : pdftotext non installé (brew install poppler)")
        return None
    finally:
        Path(pdf_path).unlink(missing_ok=True)


def upsert_eligibility(client, isin: str, dry_run: bool) -> bool:
    row = {
        "isin":          isin,
        "company_name":  COMPANY,
        "contract_name": CONTRACT,
        "source_url":    PDF_URL,
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }
    if dry_run:
        return True
    try:
        client.table("investissement_av_lux_eligibility") \
            .upsert(row, on_conflict="isin,contract_name") \
            .execute()
        return True
    except Exception as e:
        if "42P01" in str(e) or "does not exist" in str(e).lower():
            return False
        print(f"    ⚠ eligibility {isin} : {e}")
        return False


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Baloise Life AV Catalog — PDF Scraper")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)

    print(f"  Téléchargement PDF Baloise…")
    text = download_pdf(PDF_URL)
    if not text:
        log_run("av-lux-baloise-catalog", "failed", 0, 0, started_at=started)
        return

    funds = extract_funds_from_text(text)
    print(f"  {len(funds)} fonds extraits du PDF")

    if limit:
        funds = funds[:limit]

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in funds[:10]:
            sri = f"SRI={f['sri']}" if f.get("sri") else ""
            p1  = f"p1y={f['performance_1y']:+.1f}%" if f.get("performance_1y") else ""
            print(f"  {f['isin']}  {f.get('currency','?'):4}  {sri:6}  {p1:12}  {f.get('name','')[:45]}")
        print(f"\n  Seraient écrits : {len(funds)} fonds + {len(funds)} lignes eligibility")
        return

    client = get_client()

    ok, fail = upsert_funds_bulk(funds, batch_size=100)
    print(f"\n  Upsert investissement_funds : {ok} OK, {fail} échec")

    elig_ok = elig_fail = 0
    for f in funds:
        if upsert_eligibility(client, f["isin"], dry_run=False):
            elig_ok += 1
        else:
            elig_fail += 1

    print(f"  Upsert eligibility : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run("av-lux-baloise-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Baloise Life AV Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
