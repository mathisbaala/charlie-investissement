#!/usr/bin/env python3
"""
sfdr-enricher.py — Durabilité DDA depuis les DICI/KID (best-effort, fill-only)
================================================================================
Le recueil des préférences de durabilité (DDA / MiFID II) porte sur 3 catégories
précises absentes de la base : % aligné taxonomie, % d'investissement durable
(SFDR art. 2(17)), prise en compte des PAI. Quand elles figurent dans le DICI/KID
(souvent dans l'annexe SFDR), on les extrait et on les écrit en FILL-ONLY.

Best-effort assumé : beaucoup de KID renvoient à une annexe SFDR séparée qu'on
n'a pas → couverture partielle. Non destructif : on ne remplit QUE les colonnes
nulles, on n'écrase jamais une valeur existante, et un fonds illisible est ignoré.
Sourcing « en fond » : tourne mensuellement, enrichit au fil de l'eau.

Écrit : taxonomy_alignment_pct, sustainable_investment_pct, pai_considered,
sustainability_source='kid', sustainability_computed_at. Complète aussi
sfdr_article s'il manque (fill-only).

Usage :
    python3 scripts/enrichers/sfdr-enricher.py [--apply] [--limit N] [--isin ISIN]
"""

import re
import sys
import io
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, update_funds_bulk, log_run, reset_client, now_iso

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CharlieBot/1.0)"}
TIMEOUT = 25

# ─── Extraction texte PDF ────────────────────────────────────────────────────

def download_pdf(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        if r.status_code != 200 or not r.content:
            return None
        if not r.content[:5].startswith(b"%PDF"):
            return None
        return r.content
    except Exception:
        return None


def extract_text(pdf_bytes: bytes) -> str | None:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = []
            for page in pdf.pages:
                t = page.extract_text(x_tolerance=2, y_tolerance=2)
                if t:
                    pages.append(t)
            return "\n".join(pages) if pages else None
    except Exception:
        return None


# ─── Parsing durabilité ──────────────────────────────────────────────────────

def _pct(text: str, patterns: list[str]) -> float | None:
    """Premier pourcentage 0-100 trouvé via une des regexes."""
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE | re.DOTALL)
        if m:
            try:
                v = float(m.group(1).replace(",", "."))
            except (ValueError, IndexError):
                continue
            if 0 <= v <= 100:
                return round(v, 2)
    return None


def parse_sustainability(text: str) -> dict:
    out: dict = {}
    low = text.lower()

    # % investissement durable (SFDR 2(17))
    out_si = _pct(low, [
        r"investissements?\s+durables?[^.%]{0,90}?(\d{1,3}(?:[.,]\d)?)\s*%",
        r"(\d{1,3}(?:[.,]\d)?)\s*%[^.%]{0,50}?investissements?\s+durables?",
        r"proportion\s+minimale[^.%]{0,90}?durables?[^.%]{0,40}?(\d{1,3}(?:[.,]\d)?)\s*%",
    ])
    if out_si is not None:
        out["sustainable_investment_pct"] = out_si

    # % aligné taxonomie UE
    out_tx = _pct(low, [
        r"taxonomie[^.%]{0,90}?(\d{1,3}(?:[.,]\d)?)\s*%",
        r"(\d{1,3}(?:[.,]\d)?)\s*%[^.%]{0,50}?taxonomie",
    ])
    if out_tx is not None:
        out["taxonomy_alignment_pct"] = out_tx

    # Prise en compte des PAI (principales incidences négatives)
    if re.search(r"ne\s+prend\s+pas\s+en\s+compte[^.]{0,60}incidences?\s+négatives?", low):
        out["pai_considered"] = False
    elif re.search(r"prend\s+en\s+compte[^.]{0,60}incidences?\s+négatives?", low) or \
            "incidences négatives en matière de durabilité" in low:
        out["pai_considered"] = True

    # Article SFDR (fill-only si manquant en base)
    if re.search(r"article\s*9\b", low):
        out["sfdr_article"] = 9
    elif re.search(r"article\s*8\b", low):
        out["sfdr_article"] = 8

    return out


# ─── Run ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, isin_filter: str | None) -> None:
    print("=" * 60)
    print("  SFDR enricher — durabilité DDA (fill-only, best-effort)")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}\n")

    started = datetime.now(timezone.utc)
    client = get_client()

    # Fonds avec un KID mais sans aucune donnée durabilité DDA encore extraite.
    sel = "isin, name, kid_url, sfdr_article"
    funds: list[dict] = []
    if isin_filter:
        funds = client.table("investissement_funds").select(sel) \
            .eq("isin", isin_filter).execute().data or []
    else:
        offset, page = 0, 1000
        while True:
            chunk = client.table("investissement_funds").select(sel) \
                .not_.is_("kid_url", "null") \
                .is_("sustainability_computed_at", "null") \
                .order("isin").range(offset, offset + page - 1).execute().data or []
            funds.extend(chunk)
            if len(chunk) < page:
                break
            offset += page
    if limit:
        funds = funds[:limit]
    print(f"  {len(funds)} fonds à examiner (KID, durabilité non extraite)\n")

    updates: list[dict] = []
    parsed = found = 0
    for i, fund in enumerate(funds, 1):
        if i % 1000 == 0:
            client = reset_client()
            print(f"  [{i}/{len(funds)}] parsés:{parsed} trouvés:{found}")

        pdf = download_pdf(fund["kid_url"])
        if not pdf:
            continue
        text = extract_text(pdf)
        if not text:
            continue
        parsed += 1

        data = parse_sustainability(text)
        # sfdr_article : fill-only (ne pas écraser l'existant).
        if "sfdr_article" in data and fund.get("sfdr_article") is not None:
            data.pop("sfdr_article")
        # On ne garde que les 3 catégories DDA + sfdr fill-only.
        keep = {k: v for k, v in data.items() if k in (
            "taxonomy_alignment_pct", "sustainable_investment_pct",
            "pai_considered", "sfdr_article")}
        # Marquer TOUT KID lu (trouvaille ou non) pour ne pas le re-télécharger
        # au prochain run mensuel (filtre sustainability_computed_at IS NULL).
        row = {
            "isin": fund["isin"],
            "sustainability_source": "kid" if keep else "kid-none",
            "sustainability_computed_at": now_iso(),
            **keep,
        }
        updates.append(row)
        if keep:
            found += 1

    print(f"\n  → {parsed} KID lus, {found} fonds enrichis en durabilité")

    if apply and updates:
        # Fill-only : update_funds_bulk fait un upsert ciblé (jamais d'insert,
        # ISIN absent = no-op). Les valeurs None sont absentes des dicts → pas
        # d'écrasement. sustainability_computed_at marque le passage (évite de
        # re-télécharger le KID au prochain run, même si rien n'a été trouvé...
        # NB : seuls les fonds AVEC trouvaille portent ce marqueur ici).
        print(f"  Écriture ({len(updates)} fonds)…", end=" ", flush=True)
        ok, fail = update_funds_bulk(updates, batch_size=200)
        print(f"✓ {ok} OK, {fail} échec")
        log_run(scraper="sfdr-enricher", status="success",
                records_processed=ok, records_failed=fail, started_at=started)
    elif not apply:
        for r in updates[:8]:
            print(f"  {r['isin']} | "
                  f"durable:{r.get('sustainable_investment_pct')} "
                  f"taxo:{r.get('taxonomy_alignment_pct')} "
                  f"pai:{r.get('pai_considered')} sfdr:{r.get('sfdr_article')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Durabilité DDA depuis les KID (fill-only)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    parser.add_argument("--isin", type=str, help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
