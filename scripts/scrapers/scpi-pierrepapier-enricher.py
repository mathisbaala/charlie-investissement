#!/usr/bin/env python3
"""
scpi-pierrepapier-enricher.py — Enrichissement SCPI via Pierrepapier.fr (Infograms IEIF)
==========================================================================================
Pierrepapier.fr publie les données SCPI dans des embeds Infogram accessibles sans auth.

Sources utilisées :
  - TD 2024  : https://e.infogram.com/_/zlj2wYJ4O9rhhPVW9JGn
    → Nom | SGP | Année création | Taux de Distribution 2024
  - TD 2023  : https://e.infogram.com/_/md6MMtVgX5n7eb5raL31
    → Nom | SGP | Type Capital | Catégorie | TD 2023

Champs enrichis :
  - performance_1y  (TD 2024 en priorité, TD 2023 en fallback)

Pas d'ISIN dans les données → matching par nom normalisé (même logique que primaliance).

Usage :
    python3 scripts/scrapers/scpi-pierrepapier-enricher.py [--apply] [--limit N]
"""

import re
import sys
import json
import unicodedata
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

import requests

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
}
TIMEOUT = 20

INFOGRAMS = {
    "td_2024": "_/zlj2wYJ4O9rhhPVW9JGn",
    "td_2023": "_/md6MMtVgX5n7eb5raL31",
}


# ─── Normalisation ─────────────────────────────────────────────────────────────

def normalize(s: str) -> str:
    s = (s or "").upper().strip()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


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


# ─── Extraction infogram ───────────────────────────────────────────────────────

def fetch_infogram_table(ig_id: str) -> list[list[str]]:
    """Retourne les lignes du premier tableau chartData dans l'infogram."""
    try:
        r = requests.get(f"https://e.infogram.com/{ig_id}", headers=HEADERS, timeout=TIMEOUT)
        if not r.ok:
            return []
        m = re.search(r"window\.infographicData\s*=\s*(\{.*?\});", r.text, re.DOTALL)
        if not m:
            return []
        data = json.loads(m.group(1))
        entities = data.get("elements", {}).get("content", {}).get("content", {}).get("entities", {})
        for ent in entities.values():
            cd = ent.get("props", {}).get("chartData", {}).get("data")
            if cd and isinstance(cd, list) and cd:
                table = cd[0]
                if isinstance(table, list) and len(table) > 5:
                    rows = []
                    for row in table:
                        cells = [c.get("value", "") for c in row if isinstance(c, dict)]
                        if any(cells):
                            rows.append(cells)
                    return rows
    except Exception:
        pass
    return []


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  SCPI Pierrepapier Enricher — TD 2024/2023 via Infograms")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    # Charger les SCPIs de la base
    all_scpi = client.table("investissement_funds") \
        .select("isin, name, performance_1y, management_company, category") \
        .eq("product_type", "scpi") \
        .execute().data or []

    name_to_isin: dict[str, str] = {}
    for row in all_scpi:
        nk = normalize(row["name"] or "")
        if nk:
            name_to_isin[nk] = row["isin"]

    print(f"  {len(all_scpi)} SCPIs en base")

    # Récupérer les tables Infogram
    perf_map:  dict[str, float] = {}   # isin → performance_1y
    mgmt_map:  dict[str, str]   = {}   # isin → management_company
    cat_map:   dict[str, str]   = {}   # isin → category

    for label, ig_id in INFOGRAMS.items():
        print(f"  Téléchargement Infogram {label}…")
        rows = fetch_infogram_table(ig_id)
        if not rows:
            print(f"    ⚠ Aucune donnée")
            continue
        header = rows[0]
        print(f"    {len(rows)-1} SCPIs — colonnes : {header}")

        # Détecter les index des colonnes utiles
        sgp_col = next((i for i, h in enumerate(header) if "gestion" in h.lower()), None)
        cat_col = next((i for i, h in enumerate(header) if "catég" in h.lower()), None)

        matched = 0
        for row in rows[1:]:
            if len(row) < 2:
                continue
            nom = row[0]
            nk  = normalize(nom)
            isin = name_to_isin.get(nk)
            if not isin:
                continue

            # SGP
            if sgp_col is not None and sgp_col < len(row):
                sgp = (row[sgp_col] or "").strip()
                if sgp and isin not in mgmt_map:
                    mgmt_map[isin] = sgp

            # Catégorie (colonne présente dans TD 2023)
            if cat_col is not None and cat_col < len(row):
                cat = (row[cat_col] or "").strip()
                if cat and isin not in cat_map:
                    cat_map[isin] = cat

            # TD (taux de distribution) : dernière colonne non-vide
            td_raw = row[-1] if row else ""
            val = pct(td_raw)
            if val is not None and isin not in perf_map:
                perf_map[isin] = val
                matched += 1

        print(f"    {matched} matchées")

    mgmt_count = len(mgmt_map)
    print(f"\n  {len(perf_map)} SCPIs avec performance_1y trouvée")
    print(f"  {mgmt_count} SCPIs avec management_company trouvée")
    print(f"  {len(cat_map)} SCPIs avec category trouvée")

    # Construire la liste des mises à jour nécessaires
    isin_db = {r["isin"]: r for r in all_scpi}
    to_update: list[dict] = []
    for isin, row in isin_db.items():
        updates: dict = {}
        if isin in perf_map and row.get("performance_1y") is None:
            updates["performance_1y"] = perf_map[isin]
        if isin in mgmt_map and not row.get("management_company"):
            updates["management_company"] = mgmt_map[isin]
        if isin in cat_map and not row.get("category"):
            updates["category"] = cat_map[isin]
        if updates:
            to_update.append({"isin": isin, "name": row.get("name", ""), **updates})

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
        if "performance_1y" in changes:
            parts.append(f"p1y={changes['performance_1y']:+.2f}%")
        if "management_company" in changes:
            parts.append(f"mgmt={changes['management_company'][:30]}")
        if "category" in changes:
            parts.append(f"cat={changes['category'][:30]}")
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
        log_run("scpi-pierrepapier-enricher", "success", updated, skipped, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SCPI Pierrepapier Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
