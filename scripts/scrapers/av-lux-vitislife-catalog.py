#!/usr/bin/env python3
"""
av-lux-vitislife-catalog.py — Catalogue fonds Vitis Life Luxembourg
====================================================================
Vitis Life publie un PDF mensuel de ses fonds disponibles :
  https://www.vitislife.com/wp-content/uploads/AAAA/MM/AAAA.MM.JJ_LU_Liste-des-fonds.pdf

Le PDF (layout fixe) contient par ligne :
  [SRI circles: g g g c c c c]  [Type]  [Nom fonds]  [ISIN]  [CCY]  [Art. X]  [✓]  [rétro%]

Le SRI est encodé par le nombre de 'g' en début de ligne (g=cercle rempli, c=vide).

Usage :
    python3 scripts/scrapers/av-lux-vitislife-catalog.py [--apply] [--limit N]
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

PDF_URL  = "https://www.vitislife.com/wp-content/uploads/2026/03/2026.04.10_LU_Liste-des-fonds.pdf"
COMPANY  = "Vitis Life"
CONTRACT = "Vitis Life Luxembourg"

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
ISIN_RE   = re.compile(r"\b([A-Z]{2}[A-Z0-9]{10})\b")
SFDR_RE   = re.compile(r"Art\.\s*([689])")
CURRENCY_RE = re.compile(r"\b(EUR|USD|GBP|CHF|NOK|SEK|DKK)\b")
TYPE_RE   = re.compile(r"(Monétaire|Moneta|Obligation|Action|Mixte|Multi-actif|Immobilier|Diversif)", re.I)


def count_sri(line: str) -> int | None:
    """Compte les 'g' en tête de ligne dans le bloc SRI (max 7)."""
    m = re.match(r"\s*((?:g\s*)+)", line)
    if not m:
        return None
    n = m.group(1).count("g")
    return n if 1 <= n <= 7 else None


def parse_sfdr(line: str) -> int | None:
    m = SFDR_RE.search(line)
    return int(m.group(1)) if m else None


def extract_funds_from_text(text: str) -> list[dict]:
    funds: dict[str, dict] = {}
    current_type = ""

    for line in text.splitlines():
        isin_m = ISIN_RE.search(line)
        if not isin_m:
            # Détecter le type courant (header de section)
            t_m = TYPE_RE.search(line)
            if t_m and len(line.strip()) < 30:
                current_type = t_m.group(0)
            continue

        isin = isin_m.group(1)
        if isin in funds:
            continue

        # SRI
        sri = count_sri(line)

        # SFDR
        sfdr = parse_sfdr(line)

        # Type (depuis la ligne ou le type courant)
        t_m = TYPE_RE.search(line)
        fund_type = t_m.group(0).capitalize() if t_m else current_type

        # Currency (après l'ISIN)
        after = line[isin_m.end():]
        cur_m = CURRENCY_RE.search(after)
        currency = cur_m.group(1) if cur_m else "EUR"

        # Nom : entre le type et l'ISIN, nettoyé
        before = line[:isin_m.start()].strip()
        # Supprimer le bloc SRI (g/c + espaces) en début
        name_raw = re.sub(r"^[gc\s]+", "", before)
        # Supprimer le mot de type et les espaces suivants
        name_raw = TYPE_RE.sub("", name_raw).strip().lstrip("*").strip()
        # Nettoyer les espaces multiples
        name = re.sub(r"\s{2,}", " ", name_raw).strip() or None

        fund: dict = {
            "isin":            isin,
            "currency":        currency,
            "av_lux_eligible": True,
            "data_source":     "vitislife",
        }
        if name:
            fund["name"] = name
        if sri:
            fund["sri"]  = sri
            fund["srri"] = sri
        if sfdr:
            fund["sfdr_article"] = sfdr

        funds[isin] = fund

    return list(funds.values())


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


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Vitis Life Luxembourg — PDF Scraper")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)

    print(f"  Téléchargement PDF Vitis Life…")
    try:
        r = requests.get(PDF_URL, headers=HEADERS, timeout=30)
        if not r.ok:
            print(f"  ERREUR : HTTP {r.status_code}")
            log_run("av-lux-vitislife-catalog", "failed", 0, 0, started_at=started)
            return
    except Exception as e:
        print(f"  ERREUR réseau : {e}")
        log_run("av-lux-vitislife-catalog", "failed", 0, 0, started_at=started)
        return

    print(f"  PDF {len(r.content)//1024} Ko → extraction pdftotext…")
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(r.content)
        pdf_path = f.name

    try:
        result = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f"  ⚠ pdftotext : {result.stderr[:200]}")
            return
        text = result.stdout
    finally:
        Path(pdf_path).unlink(missing_ok=True)

    funds = extract_funds_from_text(text)
    print(f"  {len(funds)} fonds extraits")

    if limit:
        funds = funds[:limit]

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in funds[:10]:
            sri  = f"SRI={f['sri']}" if f.get("sri") else "    "
            sfdr = f"SFDR{f['sfdr_article']}" if f.get("sfdr_article") else "     "
            print(f"  {f['isin']}  {f.get('currency','?'):4}  {sri:6}  {sfdr:6}  {f.get('name','')[:50]}")
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
    log_run("av-lux-vitislife-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vitis Life Luxembourg Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
