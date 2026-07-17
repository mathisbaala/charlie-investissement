#!/usr/bin/env python3
"""
geco-natures-harvest.py — Natures juridiques + labels ELTIF/EuVECA via GECO
============================================================================
Récolte GRATUITE et DÉTERMINISTE (API liste GECO, aucune visite de fiche) des
~15 600 produits FRANÇAIS et ~15 700 produits ÉTRANGERS commercialisés en
France agréés/enregistrés AMF, avec pour chaque ISIN :

  • nature juridique  : prdNature / prdSsNature (OPCI, SPPICAV, FCPR, FPCI,
    FIP, FCPI, SCPI, SCI, GFV/GFI, SLP, FCT, SCR, OPCVM, OTHERAIF…)
  • labels européens  : cmpLblEltif, cmpLblEuveca, cmpLblEusef
  • métadonnées       : nom, gestionnaire, domicile, statut (VIV/LQD),
    date de création, catégorie AMF

Objectif : combler les trous CGP de la base (OPCI grand public, FCPR retail,
GFI/GFV, ELTIF commercialisés en France) et reclassifier les product_type
génériques — l'intégration se fait ensuite par
scripts/migrations/apply-natures-from-harvest.py.

Sortie : scripts/data/geco-natures-harvest.json
  { meta, products: [{isin, name, nature, sub_nature, nature_label, domicile,
                      management_company, status, inception_date, amf_category,
                      eltif, euveca, eusef, register}] }

Usage :
    python3 scripts/scrapers/geco-natures-harvest.py            # FR + étrangers
    python3 scripts/scrapers/geco-natures-harvest.py --limit 500

Source : POST geco.amf-france.org/back-office/funds/getCompartmentsBycriteria
         (?productType=FR puis ?productType=FOREIGN), 100 résultats/page.
Rate limit : 1.1 s/page (politesse API AMF) — ~12 min au total.
"""

import re
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as creq

# ─── Config ────────────────────────────────────────────────────────────────────

GECO_URL = "https://geco.amf-france.org/back-office/funds/getCompartmentsBycriteria?productType={register}"
OUT_PATH = Path(__file__).parent.parent / "data" / "geco-natures-harvest.json"
PAGE_SIZE = 100
RATE_LIMIT_SEC = 1.1
TIMEOUT = 30
MAX_EMPTY_PAGES = 3

HEADERS = {
    "Referer": "https://geco.amf-france.org/",
    "Origin":  "https://geco.amf-france.org",
    "Accept":  "application/json",
}

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{10}$")


def valid_isin(s) -> str | None:
    if s and ISIN_RE.match(str(s).strip()):
        return str(s).strip()
    return None


def parse_date(val) -> str | None:
    if not val:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(val).strip()[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return None


def map_record(r: dict, register: str) -> dict | None:
    """Un compartiment GECO → un produit par ISIN de part (dict de base sans isin)."""
    name = (r.get("cmpNom") or "").strip()
    if not name:
        return None
    return {
        "name":               name,
        "nature":             r.get("prdNature"),
        "sub_nature":         r.get("prdSsNature"),
        "nature_label":       r.get("prdSsNatureLib") or r.get("prdNatureLib"),
        "domicile":           r.get("prdDomcltn"),
        "management_company": (r.get("gestionnaire") or "").strip() or None,
        "status":             r.get("cmpStatutCode"),
        "inception_date":     parse_date(r.get("cmpDateCreation")),
        "amf_category":       (r.get("cmpClssFndAmfLib") or "").strip() or None,
        "eltif":              bool(r.get("cmpLblEltif")),
        "euveca":             bool(r.get("cmpLblEuveca")),
        "eusef":              bool(r.get("cmpLblEusef")),
        "register":           register,
    }


def record_isins(r: dict) -> list[str]:
    """Tous les ISIN de parts valides d'un compartiment."""
    isins = []
    for cand in [r.get("cmpIsin"), *(r.get("sharesIsins") or []), r.get("cmpCodeParPrincp")]:
        v = valid_isin(cand)
        if v and v not in isins:
            isins.append(v)
    return isins


def fetch_page(session: creq.Session, register: str, offset: int) -> tuple[list[dict], int | None]:
    payload = {"first": offset, "rows": PAGE_SIZE, "sortOrder": 1, "filters": {}, "globalFilter": None}
    for attempt in range(4):
        try:
            r = session.post(GECO_URL.format(register=register), json=payload,
                             headers=HEADERS, timeout=TIMEOUT)
            if r.status_code == 200:
                d = r.json()
                return d.get("compartmentDtos") or [], d.get("total")
            time.sleep(3 * (attempt + 1))
        except Exception:
            time.sleep(3 * (attempt + 1))
    return [], None


def run(limit: int | None) -> None:
    print("=" * 64)
    print("  GECO — natures juridiques + labels ELTIF/EuVECA (FR + étrangers)")
    print("=" * 64)

    session = creq.Session(impersonate="chrome")
    products: dict[str, dict] = {}    # isin → produit
    stats: dict[str, int] = {}

    for register in ("FR", "FOREIGN"):
        print(f"\n  Registre {register}…")
        offset, empty, total = 0, 0, None
        while True:
            rows, tot = fetch_page(session, register, offset)
            total = total or tot
            if not rows:
                empty += 1
                if empty >= MAX_EMPTY_PAGES:
                    break
                offset += PAGE_SIZE
                continue
            empty = 0
            for r in rows:
                base = map_record(r, register)
                if base is None:
                    continue
                for isin in record_isins(r):
                    products.setdefault(isin, {"isin": isin, **base})
            offset += PAGE_SIZE
            if offset % 2000 == 0:
                print(f"    {offset}/{total or '?'} lignes — {len(products)} ISIN")
            if total is not None and offset >= total:
                break
            if limit and len(products) >= limit:
                break
            time.sleep(RATE_LIMIT_SEC)
        stats[register] = len(products)
        print(f"  → cumul {len(products)} ISIN après registre {register}")
        if limit and len(products) >= limit:
            break

    # ── Sortie ──
    nature_counts: dict[str, int] = {}
    eltif_count = 0
    for p in products.values():
        nature_counts[p["nature"] or "?"] = nature_counts.get(p["nature"] or "?", 0) + 1
        if p["eltif"]:
            eltif_count += 1

    payload = {
        "meta": {
            "harvested_at": datetime.now(timezone.utc).isoformat(),
            "source": "geco.amf-france.org — API liste getCompartmentsBycriteria, registres FR + FOREIGN",
            "method": "balayage paginé déterministe (100/page), natures et labels lus dans la réponse liste, aucune visite de fiche",
            "cost": "0 € — API publique AMF",
            "nb_isins": len(products),
            "nb_eltif": eltif_count,
            "nature_counts": dict(sorted(nature_counts.items(), key=lambda x: -x[1])),
        },
        "products": sorted(products.values(), key=lambda p: p["isin"]),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    tmp.replace(OUT_PATH)

    print()
    print("=" * 64)
    print(f"  Récolte : {len(products)} ISIN — {eltif_count} ELTIF")
    print("  Natures :", ", ".join(f"{k}:{v}" for k, v in sorted(nature_counts.items(), key=lambda x: -x[1])[:12]))
    print(f"  → {OUT_PATH}")
    print("=" * 64)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Récolte natures juridiques + labels via GECO (gratuit)")
    parser.add_argument("--limit", type=int, help="arrêter après N ISIN (test)")
    args = parser.parse_args()
    run(limit=args.limit)
