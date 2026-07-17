#!/usr/bin/env python3
"""
euronext-pea-pme-list.py — Liste officielle Euronext des valeurs éligibles PEA-PME
===================================================================================
Récolte GRATUITE et DÉTERMINISTE du fichier Excel officiel publié par Euronext
(mis à jour trimestriellement) listant les entreprises dont les titres sont
éligibles au dispositif PEA-PME (critères légaux : <5 000 salariés, CA <1,5 Md€
ou bilan <2 Md€).

Deux étapes :
  1. La page publique https://live.euronext.com/fr/products/equities/pea-pme
     référence le fichier du trimestre (liste_pea_pme_<date>.xlsx) ;
  2. Téléchargement + parsing openpyxl → ISIN (validés clé ISO 6166), nom,
     marché de cotation.

Objectif : poser pea_pme_eligible (et pea_eligible, tout titre PEA-PME étant
aussi éligible PEA) sur les ACTIONS de la base — aujourd'hui seuls les fonds
portent ces drapeaux — et découvrir les small caps absentes. Intégration via
scripts/migrations/apply-pea-pme-from-euronext.py.

Sortie : scripts/data/pea-pme-euronext.json
  { meta, companies: [{isin, name, market, source_file}] }

Usage :
    python3 scripts/scrapers/euronext-pea-pme-list.py
"""

import io
import re
import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as creq

try:
    import openpyxl
except ImportError:
    print("ERREUR : openpyxl non installé — pip install openpyxl")
    sys.exit(1)

PAGE_URL = "https://live.euronext.com/fr/products/equities/pea-pme"
OUT_PATH = Path(__file__).parent.parent / "data" / "pea-pme-euronext.json"
TIMEOUT = 40

ISIN_RE = re.compile(r"^[A-Z]{2}[0-9A-Z]{9}[0-9]$")


def isin_valid(isin: str) -> bool:
    """Clé de contrôle ISO 6166 (Luhn, chiffres doublés aux index impairs depuis la droite)."""
    if not ISIN_RE.match(isin):
        return False
    digits = "".join(str(int(c, 36)) for c in isin)
    total = 0
    for i, d in enumerate(reversed(digits)):
        n = int(d)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def run() -> None:
    print("=" * 64)
    print("  Euronext — liste officielle des valeurs éligibles PEA-PME")
    print("=" * 64)

    session = creq.Session(impersonate="chrome")

    # ── 1. Trouver le fichier du trimestre ──
    r = session.get(PAGE_URL, timeout=TIMEOUT)
    if r.status_code != 200:
        print(f"ERREUR : page Euronext HTTP {r.status_code}")
        sys.exit(1)
    links = re.findall(r'href="(https?://[^"]+liste_pea_pme[^"]*\.xlsx?)"', r.text)
    if not links:
        print("ERREUR : aucun lien liste_pea_pme_*.xlsx trouvé sur la page")
        sys.exit(1)
    file_url = links[0]
    print(f"  Fichier : {file_url}")

    # ── 2. Télécharger + parser ──
    rf = session.get(file_url, timeout=TIMEOUT)
    if rf.status_code != 200:
        print(f"ERREUR : téléchargement HTTP {rf.status_code}")
        sys.exit(1)
    wb = openpyxl.load_workbook(io.BytesIO(rf.content), read_only=True, data_only=True)
    ws = wb.worksheets[0]

    # ── Localiser la ligne d'en-tête et mapper les colonnes par leur libellé ──
    # (ligne « Société/Company | CodeISIN/ISINCode | Marché/Market | … »)
    companies: dict[str, dict] = {}
    rejected = 0
    cols: dict[str, int] = {}
    for row in ws.iter_rows(values_only=True):
        cells = [str(c).strip() if c is not None else "" for c in row]
        if not cols:
            for idx, c in enumerate(cells):
                low = c.lower().replace(" ", "")
                if "isin" in low:
                    cols["isin"] = idx
                elif "société" in low or "company" in low:
                    cols["name"] = idx
                elif "marché" in low or "market" in low:
                    cols["market"] = idx
                elif "compartiment" in low or "compartment" in low:
                    cols["compartment"] = idx
                elif "pays" in low or "country" in low:
                    cols["country"] = idx
            if "isin" not in cols or "name" not in cols:
                cols = {}
            continue
        isin = cells[cols["isin"]] if cols["isin"] < len(cells) else ""
        if not ISIN_RE.match(isin):
            continue
        if not isin_valid(isin):
            rejected += 1
            continue
        def col(key):
            i = cols.get(key)
            return cells[i] if i is not None and i < len(cells) and cells[i] else None
        name = col("name")
        if name:
            companies.setdefault(isin, {
                "isin": isin, "name": name, "market": col("market"),
                "compartment": col("compartment"), "country": col("country"),
                "source_file": file_url,
            })

    payload = {
        "meta": {
            "harvested_at": datetime.now(timezone.utc).isoformat(),
            "source": "live.euronext.com — liste officielle trimestrielle des valeurs éligibles PEA-PME",
            "method": "téléchargement du xlsx référencé sur la page publique, parsing openpyxl, clé ISO 6166 validée",
            "cost": "0 € — fichier public Euronext",
            "source_file": file_url,
            "nb_companies": len(companies),
            "nb_isin_rejected": rejected,
        },
        "companies": sorted(companies.values(), key=lambda c: c["isin"]),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    tmp.replace(OUT_PATH)

    by_country: dict[str, int] = {}
    for c in companies:
        by_country[c[:2]] = by_country.get(c[:2], 0) + 1
    print(f"\n  {len(companies)} sociétés éligibles PEA-PME ({rejected} ISIN à clé invalide rejetés)")
    print("  Par pays :", dict(sorted(by_country.items(), key=lambda x: -x[1])))
    print(f"  → {OUT_PATH}")
    print("=" * 64)


if __name__ == "__main__":
    argparse.ArgumentParser(description="Liste PEA-PME officielle Euronext (gratuit)").parse_args()
    run()
