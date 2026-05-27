#!/usr/bin/env python3
"""
scpi-lab-category-enricher.py — Catégorie + SGP + AUM des SCPIs depuis scpi-lab.com
=====================================================================================
scpi-lab.com liste ~135 SCPIs avec type d'actifs prépondérant, société de gestion,
capitalisation et DVM.

Champs enrichis :
  - category         (type d'actifs normalisé)
  - management_company (SGP)
  - aum_eur           (capitalisation en €)
  - performance_1y    (DVM %)

Matching : par nom normalisé (majuscules, sans accents, sans caractères spéciaux).

Usage :
    python3 scripts/scrapers/scpi-lab-category-enricher.py [--apply] [--limit N]
"""

import re
import sys
import unicodedata
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
}
TIMEOUT = 25
LAB_URL = "https://www.scpi-lab.com/scpi/"

# Normaliser les catégories scpi-lab → taxonomy DB
CAT_MAPPING = {
    "BUREAUX": "Bureaux",
    "COMMERCES": "Commerces",
    "LOGISTIQUE": "Logistique",
    "SANTE": "Santé",
    "SANTE EDUCATION": "Santé et Éducation",
    "RESIDENTIEL": "Résidentiel",
    "HOTEL": "Hôtels",
    "DIVERSIFIE": "Diversifiée",
    "EUROPE": "Europe Diversifiée",
    "DIVERSIFICATION ALLEMAGNE": "Bureaux Allemagne",
    "COMMERCES EUROPE": "Commerces Europe",
    "DIVERSIFICATION EUROPE": "Europe Diversifiée",
}


def normalize(s: str) -> str:
    s = (s or "").upper().strip()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


def normalize_category(raw: str) -> str | None:
    """Convertit une catégorie scpi-lab en taxonomy DB."""
    clean = raw.strip()
    # Retirer l'année éventuelle " - 2024/2025"
    clean = re.sub(r'\s*-\s*20\d{2}$', '', clean).strip().upper()
    # Normaliser les accents
    clean_norm = "".join(c for c in unicodedata.normalize("NFD", clean) if not unicodedata.combining(c))
    # Chercher dans le mapping (correspondance partielle)
    for key, val in CAT_MAPPING.items():
        if key == clean_norm or clean_norm.startswith(key):
            return val
    # Fallback : capitaliser proprement si raisonnablement clair
    if len(clean) > 2:
        return clean.title()
    return None


def pct(s: str) -> float | None:
    if not s:
        return None
    m = re.search(r"([\-\+]?\d+(?:[\.,]\d+)?)\s*%?$", s.strip())
    if not m:
        return None
    try:
        return round(float(m.group(1).replace(",", ".")), 4)
    except ValueError:
        return None


def eur(s: str) -> int | None:
    """Parse '1 829 M€' → 1829000000."""
    m = re.search(r"([\d\s]+(?:[\.,]\d+)?)\s*(M|Md|G|B|K)?€?", s.replace("\xa0", " ").strip())
    if not m:
        return None
    try:
        base = float(m.group(1).replace(" ", "").replace(",", "."))
        mult = m.group(2) or ""
        if mult in ("Md", "G", "B"):
            return int(base * 1_000_000_000)
        elif mult == "M":
            return int(base * 1_000_000)
        elif mult == "K":
            return int(base * 1_000)
        return int(base)
    except ValueError:
        return None


def fetch_scpi_lab() -> list[dict]:
    r = requests.get(LAB_URL, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    rows = soup.select("table tbody tr")

    results = []
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 4:
            continue

        # Cellule 1 : name + SGP + bouton
        cell1_text = cells[0].get_text(separator="\n", strip=True)
        cell1_lines = [l for l in cell1_text.split("\n") if l and l != "playlist_add"]
        if not cell1_lines:
            continue
        name = cell1_lines[0].strip()
        sgp = cell1_lines[1].strip() if len(cell1_lines) > 1 else ""

        # Cellule 2 : type d'actifs prépondérant + TOF
        cell2_text = cells[1].get_text(separator="\n", strip=True)
        cell2_lines = [l for l in cell2_text.split("\n") if l]
        raw_cat = cell2_lines[0].strip() if cell2_lines else ""
        cat = normalize_category(raw_cat) if raw_cat else None

        # Cellule 4 : AUM en M€
        cell4_text = cells[3].get_text(strip=True) if len(cells) > 3 else ""
        aum = eur(cell4_text)

        # Cellule 5 : DVM % (performance)
        cell5_text = cells[4].get_text(strip=True) if len(cells) > 4 else ""
        # Format : "20253,85%" → enlever l'année
        dvm_raw = re.sub(r'^\d{4}', '', cell5_text)
        dvm = pct(dvm_raw)

        if name:
            results.append({
                "name": name,
                "sgp": sgp,
                "category": cat,
                "aum_eur": aum,
                "performance_1y": dvm,
            })

    return results


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  SCPI Lab Category Enricher — catégorie + SGP + AUM")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    print("  Téléchargement scpi-lab.com…")
    lab_data = fetch_scpi_lab()
    print(f"  {len(lab_data)} SCPIs trouvées sur scpi-lab.com")

    # Index par nom normalisé
    lab_index: dict[str, dict] = {}
    for d in lab_data:
        nk = normalize(d["name"])
        if nk:
            lab_index[nk] = d

    # Charger les SCPIs de la base
    all_scpi = client.table("investissement_funds") \
        .select("isin, name, category, management_company, aum_eur, performance_1y") \
        .eq("product_type", "scpi") \
        .execute().data or []

    print(f"  {len(all_scpi)} SCPIs en base")

    to_update: list[dict] = []
    for row in all_scpi:
        nk = normalize(row.get("name") or "")
        match = lab_index.get(nk)
        if not match:
            continue

        updates: dict = {}
        if not row.get("category") and match.get("category"):
            updates["category"] = match["category"]
        if not row.get("management_company") and match.get("sgp"):
            updates["management_company"] = match["sgp"]
        if row.get("aum_eur") is None and match.get("aum_eur"):
            updates["aum_eur"] = match["aum_eur"]
        if row.get("performance_1y") is None and match.get("performance_1y") is not None:
            updates["performance_1y"] = match["performance_1y"]

        if updates:
            to_update.append({"isin": row["isin"], "name": row.get("name", ""), **updates})

    if limit:
        to_update = to_update[:limit]

    print(f"  {len(to_update)} SCPIs à mettre à jour")
    print()

    updated = skipped = 0
    for r in to_update:
        isin = r["isin"]
        name = (r.get("name") or "")[:35]
        changes = {k: v for k, v in r.items() if k not in ("isin", "name")}
        parts = []
        if "category" in changes:
            parts.append(f"cat={changes['category'][:25]}")
        if "management_company" in changes:
            parts.append(f"mgmt={changes['management_company'][:20]}")
        if "aum_eur" in changes:
            parts.append(f"aum={changes['aum_eur']//1_000_000}M€")
        if "performance_1y" in changes:
            parts.append(f"dvm={changes['performance_1y']:+.2f}%")
        print(f"  ✓ {isin:22}  {' | '.join(parts)}  {name}")
        if apply:
            try:
                client.table("investissement_funds") \
                    .update(changes) \
                    .eq("isin", isin) \
                    .execute()
                updated += 1
            except Exception as e:
                print(f"    ⚠ {e}")
                skipped += 1
        else:
            updated += 1

    print()
    print(f"  ✓ {updated} SCPIs enrichies, {skipped} erreurs")

    if apply:
        log_run("scpi-lab-category-enricher", "success", updated, skipped, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SCPI Lab Category Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
