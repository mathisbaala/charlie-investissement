#!/usr/bin/env python3
"""
av-lux-axa-wealtheurope-catalog.py — Catalogue fonds AXA Wealth Europe Luxembourg
===================================================================================
AXA Wealth Europe publie un PDF mensuel listant les supports UC de son contrat
luxembourgeois.

URL fixe :
  https://axa-wealtheurope.lu/sites/axawe/files/2026-04/ZF3010025_LE-FR-LSF-CGPPAB-0326-DYN_01.pdf

Le PDF (~6 pages, ~265 ISIN) contient des colonnes en layout fixe :
  Catégorie | ISIN | Libellé du fonds | Société de gestion | SRI | SFDR | Quotidien
  | Perf N-1(A)% | Perf 5ans annualisée(H)% | Frais courants(B)% | …

Colonnes extraites par position de caractère (pdftotext -layout) :
  col  0-50  : catégorie BCE (non utilisée)
  col 51-63  : ISIN
  col 64-112 : libellé du fonds
  juste avant "Quotidien" : SRI (1-7) et SFDR (6/8/9)
  col 210-236: Performance brute N-1 (A) → performance_1y
  col 237-262: Performance annualisée 5 ans (H) → performance_5y
  col 258-275: Frais courants actif (B) → ongoing_charges (÷100)

Usage :
    python3 scripts/scrapers/av-lux-axa-wealtheurope-catalog.py [--apply] [--limit N]
    python3 scripts/scrapers/av-lux-axa-wealtheurope-catalog.py --apply
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

PDF_URL  = (
    "https://axa-wealtheurope.lu/sites/axawe/files/2026-04/"
    "ZF3010025_LE-FR-LSF-CGPPAB-0326-DYN_01.pdf"
)
COMPANY  = "AXA Wealth Europe"
CONTRACT = "AXA Wealth Europe Luxembourg"
SOURCE   = "axa-wealth-europe"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
}

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


# ─── Helpers ───────────────────────────────────────────────────────────────────

def pct_to_float(s: str) -> float | None:
    """Convertit une chaîne '−6,14' ou '2,25' en float (-6.14 / 2.25)."""
    if s is None:
        return None
    s = str(s).strip().replace(",", ".").replace("%", "").strip()
    if not re.match(r"^[+-]?\d{1,3}(\.\d{1,2})?$", s):
        return None
    try:
        return round(float(s), 4)
    except ValueError:
        return None


def col_num(line: str, start: int, end: int) -> str | None:
    """Extrait le premier nombre décimal (virgule) dans la tranche [start:end]."""
    seg = line[start:end] if len(line) > start else ""
    m = re.search(r"[-+]?\d+,\d+", seg)
    return m.group() if m else None


# ─── PDF download & extraction ─────────────────────────────────────────────────

def download_and_extract(url: str) -> str | None:
    """Télécharge le PDF et retourne le texte extrait via pdftotext -layout."""
    print(f"  Téléchargement : {url}")
    try:
        r = requests.get(url, timeout=60)
    except Exception as e:
        print(f"  ERREUR réseau : {e}")
        return None

    if not r.ok:
        print(f"  ERREUR HTTP {r.status}")
        return None
    if b"%PDF" not in r.content[:10]:
        print(f"  ERREUR : réponse non-PDF (Content-Type: {r.headers.get('Content-Type')})")
        return None

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(r.content)
        pdf_path = f.name

    print(f"  PDF {len(r.content) // 1024} Ko → extraction pdftotext…")
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            print(f"  pdftotext stderr : {result.stderr[:300]}")
            return None
        return result.stdout
    except FileNotFoundError:
        print("  ERREUR : pdftotext introuvable (brew install poppler)")
        return None
    finally:
        Path(pdf_path).unlink(missing_ok=True)


# ─── Parser ────────────────────────────────────────────────────────────────────

def extract_funds_from_text(text: str) -> list[dict]:
    """
    Parse le texte pdftotext (-layout) du PDF AXA Wealth Europe.

    Structure de chaque ligne de données (largeur fixe) :
      col  0-50  : catégorie BCE
      col 51-63  : ISIN (12 caractères)
      col 64-112 : libellé du fonds (peut être vide si nom sur ligne suivante)
      juste avant "Quotidien" (-25 chars) : "<SRI:1-7> <SFDR:6|8|9>"
      col 210-236: Performance brute N-1 (A) — peut être vide
      col 237-262: Performance annualisée 5 ans (H) — peut être vide
      col 258-275: Frais courants actif (B) — toujours rempli
    """
    funds: dict[str, dict] = {}

    for line in text.splitlines():
        # Chercher un ISIN dans la zone col 45-70 (tolérance ±5 autour de 51)
        isin: str | None = None
        for token in line.split():
            if ISIN_RE.match(token):
                idx = line.find(token, 45)
                if 45 <= idx <= 70:
                    isin = token
                    break

        if isin is None or isin in funds:
            continue

        # Ignorer les lignes sans colonne Quotidien (hors tableau de données)
        if "Quotidien" not in line:
            continue

        # Libellé du fonds : col 64-112
        name = line[64:113].strip() if len(line) > 64 else ""

        # SRI et SFDR : les deux chiffres dans les ~25 caractères avant "Quotidien"
        q_pos = line.find("Quotidien")
        sri_area = line[max(0, q_pos - 25) : q_pos]
        sri_m = re.search(r"([1-7])\s+([689])\s*$", sri_area.strip())
        sri = int(sri_m.group(1)) if sri_m else None
        sfdr = int(sri_m.group(2)) if sri_m else None

        # Performances et frais par position de caractère
        p1y_raw = col_num(line, 210, 237)   # Performance N-1 (A)
        p5y_raw = col_num(line, 237, 263)   # Performance 5 ans annualisée (H)
        oc_raw  = col_num(line, 258, 276)   # Frais courants actif (B)

        performance_1y = pct_to_float(p1y_raw)
        performance_5y = pct_to_float(p5y_raw)
        # ongoing_charges est en %, on stocke en décimal (ex: 1,99 → 0.0199)
        ongoing_charges = round(pct_to_float(oc_raw) / 100, 6) if pct_to_float(oc_raw) is not None else None

        fund: dict = {
            "isin":            isin,
            "av_lux_eligible": True,
            "data_source":     SOURCE,
        }
        if name:
            fund["name"] = name
        if sri is not None:
            fund["sri"] = sri
        if sfdr is not None:
            fund["sfdr_article"] = sfdr
        if performance_1y is not None:
            fund["performance_1y"] = performance_1y
        if performance_5y is not None:
            fund["performance_5y"] = performance_5y
        if ongoing_charges is not None:
            fund["ongoing_charges"] = ongoing_charges

        funds[isin] = fund

    return list(funds.values())


# ─── Éligibilité ───────────────────────────────────────────────────────────────

def upsert_eligibility(client, isin: str, source_url: str) -> bool:
    row = {
        "isin":          isin,
        "company_name":  COMPANY,
        "contract_name": CONTRACT,
        "source_url":    source_url,
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.table("investissement_av_lux_eligibility") \
            .upsert(row, on_conflict="isin,contract_name") \
            .execute()
        return True
    except Exception as e:
        if "42P01" in str(e) or "does not exist" in str(e).lower():
            return False
        print(f"    eligibility {isin} : {e}")
        return False


# ─── Point d'entrée ────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None) -> None:
    print("=" * 60)
    print("  AXA Wealth Europe Luxembourg — PDF Scraper")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)

    text = download_and_extract(PDF_URL)
    if not text:
        if apply:
            log_run(SOURCE, "failed", 0, 0, started_at=started)
        return

    funds = extract_funds_from_text(text)
    print(f"  {len(funds)} fonds extraits du PDF")

    if limit:
        funds = funds[:limit]
        print(f"  Limite appliquée : {limit} fonds")

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for f in funds[:10]:
            sri_str  = f"SRI={f['sri']}"          if f.get("sri")          else "     "
            sfdr_str = f"SFDR{f['sfdr_article']}"  if f.get("sfdr_article") else "      "
            p1y_str  = f"p1y={f['performance_1y']:+.2f}%" if f.get("performance_1y") is not None else ""
            p5y_str  = f"p5y={f['performance_5y']:+.2f}%" if f.get("performance_5y") is not None else ""
            oc_str   = f"oc={f['ongoing_charges']:.4f}"   if f.get("ongoing_charges")  is not None else ""
            name_str = f.get("name", "")[:40] or "(nom sur ligne suivante)"
            print(
                f"  {f['isin']}  {sri_str:6}  {sfdr_str:6}  "
                f"{p1y_str:12}  {p5y_str:12}  {oc_str:10}  {name_str}"
            )
        print(f"\n  Seraient écrits : {len(funds)} fonds + {len(funds)} lignes eligibility")
        return

    # ── APPLY ──────────────────────────────────────────────────────────────────
    client = get_client()

    funds_with_name    = [f for f in funds if f.get("name")]
    funds_without_name = [f for f in funds if not f.get("name")]
    print(f"\n  Fonds avec nom : {len(funds_with_name)} | sans nom : {len(funds_without_name)}")

    # Upsert complet pour les fonds avec nom
    ok, fail = (
        upsert_funds_bulk(funds_with_name, batch_size=100)
        if funds_with_name else (0, 0)
    )
    print(f"  Upsert investissement_funds (avec nom) : {ok} OK, {fail} échec")

    # Enrichissement partiel pour les fonds sans nom (ne pas écraser les noms existants)
    if funds_without_name:
        enrich_ok = enrich_fail = 0
        for f in funds_without_name:
            fields = {k: v for k, v in f.items() if k != "name" and k != "isin" and v is not None}
            fields["updated_at"] = datetime.now(timezone.utc).isoformat()
            try:
                client.table("investissement_funds") \
                    .update(fields) \
                    .eq("isin", f["isin"]) \
                    .execute()
                enrich_ok += 1
            except Exception as e:
                if "23502" not in str(e):  # 23502 = fonds inexistant, skip silencieux
                    print(f"    enrichissement {f['isin']} : {e}")
                enrich_fail += 1
        print(f"  Enrichissement (sans nom) : {enrich_ok} mis à jour, {enrich_fail} ignorés")

    # Table eligibility
    elig_ok = elig_fail = 0
    for f in funds:
        if upsert_eligibility(client, f["isin"], PDF_URL):
            elig_ok += 1
        else:
            elig_fail += 1
    print(f"  Upsert investissement_av_lux_eligibility : {elig_ok} OK, {elig_fail} non traités")

    status = "success" if fail == 0 else "partial"
    log_run(SOURCE, status, ok + (len(funds_without_name) if funds_without_name else 0), fail, started_at=started)
    print(f"\n  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AXA Wealth Europe Luxembourg AV Catalog")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
