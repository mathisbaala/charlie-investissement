#!/usr/bin/env python3
"""
backfill-kid-fees.py — Re-parser les KIDs pour extraire les frais détaillés
=============================================================================
Les KIDs parsés avant la migration 20260529000004 n'ont pas les colonnes :
  entry_fee_max, exit_fee_max, performance_fee, holding_period_years

Ce script re-télécharge et re-parse les KIDs des fonds qui ont kid_parsed_at
renseigné mais ces colonnes à NULL, pour combler ce gap.

Différences vs kid-bulk-parser --force :
  - Cible uniquement les fonds avec kid_url + (entry_fee_max IS NULL)
  - Plus léger : ne recalcule pas ongoing_charges/sri déjà présents
  - Rate limit plus souple (les URLs GECO sont fiables)

Usage :
    python3 scripts/migrations/backfill-kid-fees.py
    python3 scripts/migrations/backfill-kid-fees.py --apply
    python3 scripts/migrations/backfill-kid-fees.py --apply --limit 500
    python3 scripts/migrations/backfill-kid-fees.py --apply --only-geco
"""

import sys
import re
import hashlib
import argparse
import time
import requests
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config ───────────────────────────────────────────────────────────────────

RATE_LIMIT_SEC    = 0.4
MAX_PDF_SIZE_MB   = 10
PAGE_FETCH_TIMEOUT = 20
BATCH_SIZE        = 200

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Charlie-Investissement/1.0; data@charlie.fr)",
    "Accept":     "application/pdf,application/octet-stream,*/*",
}

FLAGS = re.DOTALL | re.IGNORECASE

# ─── Patterns frais (FR + EN) ─────────────────────────────────────────────────

PATTERNS_FR = {
    "entry_fee_max": [
        r"co[uû]ts\s+d.entr[eé]e.*?jusqu.[aà].*?(\d+[.,]\d+)\s*%",
        r"frais\s+d.entr[eé]e[^\d]*(\d+[.,]\d+)\s*%",
        r"commission\s+de\s+souscription[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "exit_fee_max": [
        r"co[uû]ts\s+de\s+sortie.*?jusqu.[aà].*?(\d+[.,]\d+)\s*%",
        r"frais\s+de\s+sortie[^\d]*(\d+[.,]\d+)\s*%",
        r"co[uû]ts\s+de\s+sortie[^\d]*(\d+[.,]\d+)\s*%",
        r"commission\s+de\s+rachat[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "performance_fee": [
        r"commission\s+de\s+surperformance[^\d]*(\d+[.,]\d+)\s*%",
        r"frais\s+de\s+performance[^\d]*(\d+[.,]\d+)\s*%",
        r"performance\s+fee[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "holding_period": [
        r"p[eé]riode\s*(?:minimale\s*de\s*)?d[eé]tention\s*recommand[eé]e\s*:?\s*(\d+)\s*ans?",
        r"p[eé]riode\s+de\s+d[eé]tention\s+recommand[eé]e[^\d]*(\d+)\s*an",
        r"dur[eé]e\s+recommand[eé]e[^\d]*(\d+)\s*an",
        r"horizon\s+de\s+placement[^\d]*(\d+)\s*an",
    ],
}

PATTERNS_EN = {
    "entry_fee_max": [
        r"entry\s+costs?.*?up\s+to\s+(\d+[.,]\d+)\s*%",
        r"entry\s+(?:charge|fee)[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "exit_fee_max": [
        r"exit\s+costs?.*?up\s+to\s+(\d+[.,]\d+)\s*%",
        r"exit\s+(?:charge|fee)[^\d]*(\d+[.,]\d+)\s*%",
        r"redemption\s+(?:charge|fee)[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "performance_fee": [
        r"performance\s+fee[^\d]*(\d+[.,]\d+)\s*%",
        r"performance[\s\-]+related\s+(?:fee|cost)[^\d]*(\d+[.,]\d+)\s*%",
    ],
    "holding_period": [
        r"recommended\s+holding\s+period[^\d]*(\d+)\s*year",
        r"recommended\s+investment\s+horizon[^\d]*(\d+)\s*year",
    ],
}


def try_patterns(text: str, pats: list[str]) -> str | None:
    for p in pats:
        m = re.search(p, text, FLAGS)
        if m:
            return m.group(1)
    return None


def extract_number(s: str) -> float | None:
    try:
        return float(s.replace(",", ".").strip())
    except (ValueError, AttributeError):
        return None


def parse_fees_from_text(text: str) -> dict:
    is_french = text.count("le") > text.count("the")
    pats = PATTERNS_FR if is_french else PATTERNS_EN
    result: dict = {}

    raw = try_patterns(text, pats["entry_fee_max"])
    val = extract_number(raw) if raw else None
    if val is not None and 0 <= val <= 15:
        result["entry_fee_max"] = round(val / 100, 6)

    raw = try_patterns(text, pats["exit_fee_max"])
    val = extract_number(raw) if raw else None
    if val is not None and 0 <= val <= 10:
        result["exit_fee_max"] = round(val / 100, 6)

    raw = try_patterns(text, pats["performance_fee"])
    val = extract_number(raw) if raw else None
    if val is not None and 0 <= val <= 60:
        result["performance_fee"] = round(val / 100, 6)

    raw = try_patterns(text, pats["holding_period"])
    val = extract_number(raw) if raw else None
    if val is not None and 1 <= val <= 30:
        result["holding_period_years"] = int(val)

    return result


def fetch_pdf_text(url: str) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=PAGE_FETCH_TIMEOUT, stream=True)
        if resp.status_code != 200:
            return None
        size = 0
        chunks = []
        for chunk in resp.iter_content(65536):
            size += len(chunk)
            chunks.append(chunk)
            if size > MAX_PDF_SIZE_MB * 1024 * 1024:
                return None
        data = b"".join(chunks)
        # Simple text extraction from PDF (pdfminer si disponible, sinon fallback)
        try:
            import io
            from pdfminer.high_level import extract_text
            text = extract_text(io.BytesIO(data))
            return text
        except ImportError:
            # Fallback: extraction basique du texte brut PDF
            text = data.decode("latin-1", errors="replace")
            # Garder seulement les caractères imprimables
            return re.sub(r"[^\x20-\x7E\xC0-\xFF\n\r\t]", " ", text)
        except Exception:
            return None
    except Exception:
        return None


def run(apply: bool, limit: int | None, only_geco: bool, only_amfinesoft: bool = False) -> None:
    print("=" * 64)
    print("  Backfill frais détaillés depuis KIDs")
    print("=" * 64)
    print(f"  Mode      : {'APPLY' if apply else 'DRY-RUN'}")
    source = "GECO" if only_geco else ("Amfinesoft" if only_amfinesoft else "Tous")
    print(f"  Source    : {source}")
    if limit:
        print(f"  Limite    : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Sélectionner les fonds avec kid_url mais sans frais parsés
    fields = "isin,name,kid_url,entry_fee_max"
    offset = 0
    funds  = []

    while True:
        q = client.table("investissement_funds") \
            .select(fields) \
            .not_.is_("kid_url", "null") \
            .is_("entry_fee_max", "null")
        if only_geco:
            q = q.ilike("kid_url", "%geco.amf-france.org%")
        elif only_amfinesoft:
            q = q.ilike("kid_url", "%amfinesoft%")
        batch = q.range(offset, offset + BATCH_SIZE - 1).execute().data
        if not batch:
            break
        funds.extend(batch)
        offset += BATCH_SIZE
        if limit and len(funds) >= limit:
            funds = funds[:limit]
            break

    print(f"  Fonds à re-parser : {len(funds)}")

    stats = Counter()

    for i, fund in enumerate(funds, 1):
        isin    = fund["isin"]
        kid_url = fund["kid_url"]
        name    = (fund.get("name") or "")[:50]

        text = fetch_pdf_text(kid_url)
        time.sleep(RATE_LIMIT_SEC)

        if not text:
            stats["pdf_error"] += 1
            print(f"  [{i:4d}] {isin} — PDF inaccessible")
            continue

        fees = parse_fees_from_text(text)

        if not fees:
            stats["no_fees"] += 1
            print(f"  [{i:4d}] {isin} — aucun frais extrait ({name})")
            continue

        stats["ok"] += 1
        fee_summary = ", ".join(f"{k}={v}" for k, v in fees.items())
        print(f"  [{i:4d}] {isin} — {fee_summary} ({name})")

        if apply:
            try:
                client.table("investissement_funds").update(fees).eq("isin", isin).execute()
            except Exception as db_err:
                stats["db_error"] += 1
                print(f"  [{i:4d}] {isin} — DB ERROR: {db_err}")
                time.sleep(1)
                continue

        if i % 50 == 0:
            elapsed = (datetime.now(timezone.utc) - started).total_seconds()
            print(f"  ... {i}/{len(funds)} — {elapsed:.0f}s — {dict(stats)}")

    print()
    print(f"  Résultat final : {dict(stats)}")
    print()

    log_run(
        scraper="backfill-kid-fees",
        status="success" if apply else "partial",
        records_processed=stats.get("ok", 0),
        records_failed=stats.get("pdf_error", 0),
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply",     action="store_true")
    parser.add_argument("--limit",     type=int, default=None)
    parser.add_argument("--only-geco",       action="store_true", dest="only_geco")
    parser.add_argument("--only-amfinesoft", action="store_true", dest="only_amfinesoft")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, only_geco=args.only_geco, only_amfinesoft=args.only_amfinesoft)
