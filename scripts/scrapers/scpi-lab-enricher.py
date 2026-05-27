#!/usr/bin/env python3
"""
scpi-lab-enricher.py — Performance + AUM des SCPIs depuis scpi-lab.com
=======================================================================
scpi-lab.com liste 130+ SCPIs avec DVM (taux de distribution), AUM,
TOF (taux d'occupation financier) et type d'actifs.

Correspondance par nom normalisé (minuscules, sans accents, sans tirets/espaces).

Champs enrichis :
  - performance_1y  (DVM % annuel)
  - aum_eur         (capitalisation €)

Usage :
    python3 scripts/scrapers/scpi-lab-enricher.py [--apply]
"""

import re
import sys
import unicodedata
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

SCPI_LAB_URL = "https://www.scpi-lab.com/scpi/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
}
TIMEOUT = 15


def normalize(s: str) -> str:
    s = s.upper().strip()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


def parse_aum(s: str) -> int | None:
    # Format scpi-lab: "T1-2026 1 829 M€" ou "T2-2025 500 M€"
    # Extraire le nombre juste avant M€ (séparé par un espace)
    # Pattern: trimestre + année + espace + nombre (avec espaces optionnels) + M€
    m = re.search(r"T\d-\d{4}\s+([\d][\d\s\xa0,]*)\s*M€", s)
    if m:
        num_str = re.sub(r"[\s\xa0,]", "", m.group(1))
        try:
            num = float(num_str)
            if 1 <= num <= 100_000:
                return int(num * 1_000_000)
        except (ValueError, TypeError):
            pass
    # Fallback: tout nombre suivi de M€
    matches = re.findall(r"([\d][\d\s\xa0]*)\s*M€", s)
    for raw in reversed(matches):
        num_str = re.sub(r"[\s\xa0]", "", raw)
        try:
            num = float(num_str)
            if 1 <= num <= 100_000:
                return int(num * 1_000_000)
        except (ValueError, TypeError):
            continue
    return None


def parse_dvm(s: str) -> float | None:
    m = re.search(r"([\d,]+)\s*%", s)
    if not m:
        return None
    try:
        return round(float(m.group(1).replace(",", ".")), 4)
    except ValueError:
        return None


def scrape_scpi_lab() -> list[dict]:
    """Retourne [{name, aum_eur, performance_1y}] depuis scpi-lab.com."""
    resp = requests.get(SCPI_LAB_URL, timeout=TIMEOUT)
    if resp.status_code != 200:
        print(f"  ✗ HTTP {resp.status_code}")
        return []

    html = resp.text
    all_rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)

    def clean(c: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", c)).strip()

    records = []
    for row in all_rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.DOTALL)
        texts = [clean(c) for c in cells]
        if len(texts) < 4:
            continue

        # Cell 0: "NAME MGMT_CO Pour suivre..."
        name_cell = texts[0]
        # Take first part before " Pour suivre" or " Connectez"
        name_part = re.split(r"\s+Pour suivre|\s+Connectez", name_cell)[0].strip()

        # Try to split name and management company
        # The name is uppercase words, mgmt_co follows
        parts = name_part.split()
        # Find where name ends (last all-caps word before mgmt_co starts)
        # Simple heuristic: take everything before known separators
        scpi_name = name_part

        # Cell 3: "TQ-YYYY AUM M€"
        aum = parse_aum(texts[3]) if len(texts) > 3 else None

        # Cell 4: "YYYY DVM%"
        dvm = parse_dvm(texts[4]) if len(texts) > 4 else None

        if scpi_name and (aum or dvm):
            records.append({
                "name_raw": scpi_name,
                "name_norm": normalize(scpi_name),
                "aum_eur": aum,
                "performance_1y": dvm,
            })

    return records


def run(apply: bool):
    print("=" * 60)
    print("  SCPI Lab Enricher — DVM + AUM depuis scpi-lab.com")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # 1. Scraper scpi-lab.com
    print("  Scraping scpi-lab.com...")
    lab_data = scrape_scpi_lab()
    print(f"  {len(lab_data)} SCPIs collectées")
    print()

    if not lab_data:
        print("  ✗ Aucune donnée — scpi-lab.com indisponible ?")
        return

    # Index par nom normalisé
    lab_index: dict[str, dict] = {}
    for rec in lab_data:
        lab_index[rec["name_norm"]] = rec

    # 2. Charger toutes les SCPIs de la DB
    db_funds = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name, performance_1y, aum_eur")
            .eq("product_type", "scpi")
            .range(offset, offset + 999)
            .execute().data or []
        )
        db_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(db_funds)} SCPIs en base")
    print()

    # 3. Matcher et enrichir
    found = updated = 0
    now = datetime.now(timezone.utc).isoformat()

    for fund in db_funds:
        isin = fund["isin"]
        db_name_norm = normalize(fund.get("name") or "")

        # Trouver le meilleur match
        match = lab_index.get(db_name_norm)

        if not match:
            # Essayer des correspondances partielles
            for lab_norm, rec in lab_index.items():
                if len(db_name_norm) >= 6 and (
                    db_name_norm in lab_norm or lab_norm in db_name_norm
                ):
                    match = rec
                    break

        if not match:
            continue

        found += 1
        update: dict = {}

        if match.get("performance_1y") and fund.get("performance_1y") is None:
            update["performance_1y"] = match["performance_1y"]

        if match.get("aum_eur") and fund.get("aum_eur") is None:
            update["aum_eur"] = match["aum_eur"]

        if not update:
            continue

        updated += 1
        print(
            f"  ✓ {isin:20} | {match['name_raw'][:35]:35} | "
            f"p1y={update.get('performance_1y', '—')!s:6} | "
            f"aum={int(update.get('aum_eur', 0) or 0)//1_000_000}M€"
        )

        if apply:
            client.table("investissement_funds").update({
                **update,
                "updated_at": now,
            }).eq("isin", isin).execute()

    print()
    print(f"  {found} SCPIs matchées, {updated} enrichies (données manquantes complétées)")

    if apply:
        log_run("scpi-lab-enricher", "success", updated, len(db_funds) - found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SCPI Lab Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = parser.parse_args()
    run(apply=args.apply)
