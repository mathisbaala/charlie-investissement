#!/usr/bin/env python3
"""
kid-ter-fill.py — Remplissage FILL-ONLY STRICT du TER depuis les KID/DICI déjà référencés
==========================================================================================
Objectif : remplir UNIQUEMENT les frais courants (ter / ongoing_charges) des OPCVM
qui n'en ont pas, à partir du PDF KID/DICI référencé en base (colonne kid_url).

Pourquoi un script dédié (et pas kid-bulk-parser.py --ter-null --apply) :
  - kid-bulk-parser écrit AUSSI sri/entry_fee/sfdr… via un update « KID autoritaire »
    qui peut écraser des valeurs non-NULL existantes. Ici on veut un fill-only STRICT.
  - On réutilise le téléchargement + le parsing PRIIPs de kid-bulk-parser (mêmes regex,
    même conversion %→fraction, mêmes garde-fous), mais on ne propage QUE ter/ongoing.
  - L'écriture passe par db.safe_fill_funds → ne remplit que les colonnes NULL, merge
    field_sources (tag 'kid_ter'). Aucun upsert destructif. N'écrase JAMAIS un TER existant.

Convention frais (mémoire projet) : ter/ongoing_charges stockés en FRACTION
(0.015 = 1,5 %). Le KID donne un % → le parser divise par 100. ter_pct est une colonne
GÉNÉRÉE (ne pas écrire). Contrainte CHECK ter ∈ [0, 0.5] gérée par le parser (val<10%).

Usage :
    python3 scripts/enrichers/kid-ter-fill.py [--apply] [--limit N] [--workers W]
                                              [--offset N] [--min-aum N]
Sans --apply : DRY-RUN (télécharge, parse, rapporte le taux d'extraction, n'écrit rien).
"""

import sys
import time
import argparse
import importlib.util
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import safe_fill_funds, log_run, get_client

# Réutilise download_document + parse_kid_text + extract_*_text de kid-bulk-parser
_kbp_path = Path(__file__).parent.parent / "scrapers" / "kid-bulk-parser.py"
_spec = importlib.util.spec_from_file_location("kid_bulk_parser", str(_kbp_path))
kbp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kbp)

from scrapling.fetchers import FetcherSession

PAGE = 1000


def fetch_cohort(client, limit, offset, min_aum):
    """OPCVM avec kid_url et SANS ter (ter IS NULL), triés par AUM décroissant."""
    rows = []
    page_off = offset
    while True:
        q = (client.table("investissement_funds")
             .select("isin,name,kid_url,aum_eur")
             .eq("product_type", "opcvm")
             .is_("ter", "null")
             .not_.is_("kid_url", "null")
             .neq("kid_url", ""))
        if min_aum:
            q = q.gte("aum_eur", min_aum)
        q = q.order("aum_eur", desc=True).range(page_off, page_off + PAGE - 1)
        batch = q.execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        if limit and len(rows) >= limit:
            break
        page_off += PAGE
    return rows[:limit] if limit else rows


def parse_one(fund, session):
    """Télécharge + parse le KID, retourne (isin, ter_frac|None, status)."""
    isin = fund["isin"]
    url = fund.get("kid_url") or ""
    if not url:
        return isin, None, "no_url"
    time.sleep(kbp.RATE_LIMIT_SEC)
    data, fmt = kbp.download_document(session, url)
    if not data:
        return isin, None, "download_failed"
    try:
        text = kbp.extract_docx_text(data) if fmt == "docx" else kbp.extract_pdf_text(data)
    except Exception as e:
        return isin, None, f"parse_error:{type(e).__name__}"
    extracted = kbp.parse_kid_text(text)
    ter = extracted.get("ter")
    if ter is None:
        return isin, None, "no_ter"
    # Garde-fou convention : fraction plausible 0.1%–5% (parser borne déjà <10%)
    if not (0.0005 <= ter <= 0.05):
        return isin, None, f"implausible:{ter}"
    return isin, round(ter, 6), "ok"


def run(apply, limit, workers, offset, min_aum):
    print("=" * 64)
    print("  KID TER Fill — FILL-ONLY STRICT (ter/ongoing_charges)")
    print("=" * 64)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Workers : {workers}   Offset : {offset}   Min AUM : {min_aum or 'tous'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()
    funds = fetch_cohort(client, limit, offset, min_aum)
    print(f"  {len(funds)} OPCVM (ter NULL + kid_url) à traiter\n")

    session = FetcherSession(impersonate="chrome").__enter__()
    results = {}
    counters = {"ok": 0, "no_ter": 0, "download_failed": 0, "no_url": 0,
                "parse_error": 0, "implausible": 0}
    pending_writes = []

    def _proc(f):
        return parse_one(f, session)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_proc, f): f for f in funds}
        for i, fut in enumerate(concurrent.futures.as_completed(futs), 1):
            try:
                isin, ter, status = fut.result()
            except Exception as e:
                isin, ter, status = futs[fut]["isin"], None, f"exc:{type(e).__name__}"
            key = status.split(":")[0]
            counters[key] = counters.get(key, 0) + 1
            if status == "ok":
                results[isin] = ter
                pending_writes.append({"isin": isin, "ter": ter, "ongoing_charges": ter})
                # Écriture au fil de l'eau par lots de 100
                if apply and len(pending_writes) >= 100:
                    stats = safe_fill_funds(pending_writes, source="kid_ter")
                    print(f"    flush: filled={stats['fields_filled']} rows={stats['rows_updated']}")
                    pending_writes = []
            if i % 50 == 0 or i == len(funds):
                print(f"  [{i:5d}/{len(funds)}] ok:{counters['ok']} no_ter:{counters['no_ter']} "
                      f"dl_fail:{counters['download_failed']} parse_err:{counters['parse_error']}")

    if apply and pending_writes:
        stats = safe_fill_funds(pending_writes, source="kid_ter")
        print(f"    flush final: filled={stats['fields_filled']} rows={stats['rows_updated']}")

    print()
    print(f"  TER extraits : {counters['ok']}/{len(funds)} "
          f"({100*counters['ok']/max(len(funds),1):.1f}%)")
    # Échantillon de valeurs
    sample = list(results.items())[:12]
    for isin, ter in sample:
        print(f"    {isin}  frac={ter}  pct={round(ter*100,4)}%")

    if apply:
        log_run(scraper="kid-ter-fill",
                status="success" if counters["ok"] > 0 else "partial",
                records_processed=counters["ok"],
                records_failed=counters["download_failed"] + counters["no_ter"],
                started_at=started)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Fill-only TER depuis KID/DICI")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--min-aum", type=int, default=0)
    a = ap.parse_args()
    run(apply=a.apply, limit=a.limit, workers=a.workers, offset=a.offset, min_aum=a.min_aum)
