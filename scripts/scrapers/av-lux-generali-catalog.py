#!/usr/bin/env python3
"""
av-lux-generali-catalog.py — Catalogue fonds Generali Luxembourg
=================================================================
Generali Luxembourg publie mensuellement une annexe PDF de ses supports :
  URL pattern : https://www.generali.lu/media/{hash}/annexe-liste-des-supports-*.pdf

Le PDF (54 pages, ~816 ISIN) contient :
  Manager | Nom fonds | Currency | ISIN | SRI | SFDR | Flags | Perf1Y% | Perf3Y%

Comme l'URL contient un hash changeant, le script détecte l'URL courante
depuis la page de l'offre Generali Luxembourg.

Usage :
    python3 scripts/scrapers/av-lux-generali-catalog.py [--apply] [--limit N]
    python3 scripts/scrapers/av-lux-generali-catalog.py --apply
"""

import re
import sys
import subprocess
import time
import tempfile
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

GENERALI_OFFER_PAGE = "https://www.generali.lu/fr/notre-offre/notre-offre-financiere"
GENERALI_BASE       = "https://www.generali.lu"
# Fallback URL (sera mis à jour dynamiquement depuis la page)
PDF_URL_FALLBACK    = (
    "https://www.generali.lu/media/db1d4979-7fde-45d6-b2e9-1dcb3e8bb055/"
    "annexe-liste-des-supports-dinvestissement-univers-global-2025-05-gel-fr.pdf"
)
COMPANY  = "Generali Luxembourg"
# ⚠️ Le nom de contrat DOIT différer du nom d'assureur : investissement_fund_insurers_mv
# construit contracts[] avec FILTER (contract_name <> company_name) (cf. migration
# 20260611200000). Un contract_name == COMPANY rend les fonds référencés mais NON
# navigables par contrat dans /assureurs. Ici le PDF est l'annexe « Univers Global »
# (liste de supports commune aux contrats Generali Lux) — d'où ce nom distinct, aligné
# sur le pattern Baloise/AXA Wealth Europe (contrat ≠ société).
CONTRACT = "Generali Luxembourg Univers Global"

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
           "Accept-Language": "fr-FR,fr;q=0.9"}
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


def discover_pdf_url() -> str:
    """Tente de trouver l'URL du PDF courant depuis la page Generali."""
    try:
        r = requests.get(GENERALI_OFFER_PAGE, timeout=20)
        if r.ok:
            # Cherche des liens PDF contenant "supports" ou "annexe"
            soup = BeautifulSoup(r.body.decode("utf-8"), "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if (".pdf" in href.lower() and
                        ("support" in href.lower() or "annexe" in href.lower() or "univers" in href.lower())):
                    return href if href.startswith("http") else GENERALI_BASE + href
    except Exception:
        pass
    return PDF_URL_FALLBACK


def pct_to_float(s: str) -> float | None:
    s = str(s).strip().replace(",", ".").replace("%", "").strip()
    # Handle "N.d." or similar
    if not re.match(r"^[+-]?\d{1,3}(\.\d{1,2})?$", s):
        return None
    try:
        return round(float(s), 4)
    except ValueError:
        return None


def parse_sfdr(text: str) -> int | None:
    m = re.search(r"\b([689])\b", str(text))
    return int(m.group(1)) if m else None


def extract_funds_from_text(text: str) -> list[dict]:
    """
    Extrait les fonds depuis le texte pdftotext du PDF Generali.
    Format observé (colonnes -layout, ISIN toujours à colonne ~65) :
      [Manager col 0-45]  [Fund Name col 45-60]  Currency  ISIN  SRI  SFDR  [Flags]  Perf1Y%  Perf3Y%

    Parser stateful : suit le manager courant sur les lignes sans ISIN.
    """
    funds: dict[str, dict] = {}
    CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
    current_manager: str = ""

    for raw_line in text.splitlines():
        if not raw_line.strip() or len(raw_line.strip()) < 12:
            continue

        tokens = raw_line.split()
        isin_positions = [(i, t) for i, t in enumerate(tokens) if ISIN_RE.match(t)]

        if not isin_positions:
            # Ligne sans ISIN — peut contenir un manager name futur
            # (le PDF montre le manager à gauche sur la ligne SUIVANTE parfois)
            continue

        for isin_idx, isin in isin_positions:
            if isin in funds:
                continue

            after = tokens[isin_idx + 1:]
            before = tokens[:isin_idx]

            # Currency : dernier token avant l'ISIN si 3 lettres MAJ
            currency = None
            if before and CURRENCY_RE.match(before[-1]):
                currency = before[-1]
                before = before[:-1]

            # Nom : tout ce qui est avant la devise dans la ligne brute
            # On utilise la ligne brute pour respecter le layout colonne
            # Colonne manager : 0-45, colonne fonds : 45-60 (environ)
            raw_before = raw_line[:raw_line.find(isin)].rstrip()
            if currency:
                # Supprimer la devise finale
                raw_before = re.sub(r"\s+" + re.escape(currency) + r"\s*$", "", raw_before)

            combined_name = raw_before.strip()
            # Si le nom est vide, utiliser le manager courant comme fallback
            if not combined_name and current_manager:
                combined_name = current_manager
            elif combined_name:
                # Mémoriser le manager (première partie du nom, ~45 premiers chars)
                # pour les lignes suivantes sans nom
                manager_part = raw_before[:45].strip()
                if manager_part:
                    current_manager = manager_part

            # SRI : premier token numérique 1-7 après l'ISIN
            sri = None
            sfdr_article = None
            perf_tokens = []

            for j, tok in enumerate(after):
                if sri is None and tok.isdigit() and 1 <= int(tok) <= 7:
                    sri = int(tok)
                    continue
                # SFDR : un nombre 6, 8 ou 9 isolé
                if sfdr_article is None and tok in ("6", "8", "9"):
                    sfdr_article = int(tok)
                    continue
                # Flags : IS, RL, CAP, ACC — skip
                if re.match(r"^[A-Z]{2,4}$", tok) and tok not in ("EUR", "USD", "CHF", "GBP", "JPY"):
                    continue
                # Performance : nombre décimal (avec virgule)
                val = tok.replace(",", ".").replace("%", "")
                if re.match(r"^[+-]?\d{1,3}(\.\d{1,2})?$", val):
                    perf_tokens.append(pct_to_float(tok))

            p1y = perf_tokens[0] if len(perf_tokens) > 0 else None
            p3y = perf_tokens[1] if len(perf_tokens) > 1 else None

            name = combined_name or None

            fund: dict = {
                "isin":            isin,
                "currency":        currency or "EUR",
                "av_lux_eligible": True,
                "data_source":     "generali-lux",
            }
            if name:
                fund["name"] = name
            if sri:
                fund["sri"] = sri
            if sfdr_article:
                fund["sfdr_article"] = sfdr_article
            if p1y is not None:
                fund["performance_1y"] = p1y
            if p3y is not None:
                fund["performance_3y"] = p3y

            funds[isin] = fund

    return list(funds.values())


def download_and_extract(url: str) -> str | None:
    r = requests.get(url, timeout=30)
    if not r.ok:
        print(f"  ERREUR PDF {r.status} : {url}")
        return None
    if b"%PDF" not in r.content[:10]:
        print(f"  ERREUR : pas un PDF (content-type: {r.headers.get('Content-Type')})")
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
            print(f"  ⚠ pdftotext : {result.stderr[:200]}")
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
        "source_url":    PDF_URL_FALLBACK,
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
    print("  Generali Luxembourg AV Catalog — PDF Scraper")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)

    # Découvrir l'URL du PDF courant
    print("  Détection URL PDF courant Generali…")
    pdf_url = discover_pdf_url()
    print(f"  → {pdf_url[:80]}…")

    text = download_and_extract(pdf_url)
    if not text:
        log_run("av-lux-generali-catalog", "failed", 0, 0, started_at=started)
        return

    funds = extract_funds_from_text(text)
    print(f"  {len(funds)} fonds extraits")

    if limit:
        funds = funds[:limit]

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in funds[:10]:
            sri  = f"SRI={f['sri']}"       if f.get("sri")         else "    "
            sfdr = f"SFDR{f['sfdr_article']}" if f.get("sfdr_article") else "     "
            p1   = f"p1y={f['performance_1y']:+.1f}%" if f.get("performance_1y") else ""
            print(f"  {f['isin']}  {f.get('currency','?'):4}  {sri:6}  {sfdr:6}  {p1:12}  {f.get('name','')[:40]}")
        print(f"\n  Seraient écrits : {len(funds)} fonds + {len(funds)} lignes eligibility")
        return

    client = get_client()

    # Enrichissement uniquement — on ne touche pas au nom (colonne manager ≠ nom fonds dans le PDF)
    # On met à jour les fonds existants avec sri/sfdr/perf ; les ISINs inconnus sont ignorés
    enrich_ok = enrich_fail = 0
    SAFE_FIELDS = {"sri", "sfdr_article", "performance_1y", "performance_3y",
                   "currency", "av_lux_eligible", "data_source"}
    for f in funds:
        enrich = {k: v for k, v in f.items() if k in SAFE_FIELDS and v is not None}
        if not enrich:
            enrich_fail += 1
            continue
        try:
            client.table("investissement_funds") \
                .update(enrich) \
                .eq("isin", f["isin"]) \
                .execute()
            enrich_ok += 1
        except Exception:
            enrich_fail += 1
    print(f"\n  Enrichissement fonds existants : {enrich_ok} mis à jour, {enrich_fail} ignorés")
    ok, fail = enrich_ok, enrich_fail

    elig_ok = elig_fail = 0
    for f in funds:
        if upsert_eligibility(client, f["isin"], dry_run=False):
            elig_ok += 1
        else:
            elig_fail += 1

    print(f"  Upsert eligibility : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run("av-lux-generali-catalog", status, ok, fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generali Luxembourg AV Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
