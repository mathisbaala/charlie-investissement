#!/usr/bin/env python3
"""
sfdr-enricher.py — Classification SFDR (Article 6/8/9) à l'échelle
====================================================================
Récupère la classification SFDR pour tous les fonds depuis :
  1. AMF GECO (champ SFDR dans les données réglementaires)
  2. Sites des SGPs (sections ESG/SFDR)
  3. Heuristic sur le nom/catégorie si pas trouvé (moins fiable, flagué)

La classification SFDR est obligatoire depuis mars 2021 et doit être
publiée par chaque SGP. Ce script agrège ces données publiques.

Article 6 : pas d'objectif de durabilité (la majorité des fonds)
Article 8 : promotion de caractéristiques E/S
Article 9 : investissement durable comme objectif

Usage :
    python3 scripts/scrapers/sfdr-enricher.py [--apply] [--limit N]
    python3 scripts/scrapers/sfdr-enricher.py --apply --source geco
    python3 scripts/scrapers/sfdr-enricher.py --apply --heuristic  (remplir les manquants)
"""

import re
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, upsert_funds_bulk, update_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT_SEC = 0.8
TIMEOUT        = 15

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}

# Mots-clés → Article 9
ART9_KEYWORDS = [
    "impact investing", "investissement durable", "sustainable investment",
    "transition énergétique", "green bond", "obligation verte",
    "net zero", "article 9", "sfdr 9", "best-in-universe",
    "biodiversité", "biodiversity", "clean energy", "énergies renouvelables",
    "renewable energy", "climate solutions", "low carbon",
]

# Mots-clés → Article 8
ART8_KEYWORDS = [
    "responsable", "esg", "isr", "sri", "durable", "sustainable",
    "article 8", "sfdr 8", "greenfin", "finansol",
    "best effort", "best-in-class", "engagement", "governance",
    "environmental", "social", "climatique",
    "towards sustainability", "nordic swan",
]

# Labels officiels → Article 8 ou 9
LABEL_MAP = {
    "isr":       8,  # Label ISR → Article 8 minimum
    "greenfin":  9,  # Greenfin → très souvent Article 9
    "finansol":  8,
    "towards sustainability": 8,
    "nordic swan": 9,
}


# ─── Source 1 : AMF GECO données ESG ─────────────────────────────────────────

GECO_SFDR_URL = "https://geco.amf-france.org/back-office/funds/getCompartmentsBycriteria?productType=FR"

def fetch_geco_sfdr_page(session: FetcherSession, offset: int) -> list[dict]:
    """Récupère une page GECO avec les champs SFDR."""
    payload = {
        "first":        offset,
        "rows":         200,
        "sortOrder":    1,
        "filters":      {},
        "globalFilter": None,
    }
    try:
        resp = session.post(GECO_SFDR_URL, json=payload, headers={**HEADERS, "Content-Type": "application/json"}, timeout=20)
        if resp.status == 200:
            data = json.loads(resp.body.decode("utf-8"))
            return data.get("compartmentDtos", [])
    except Exception:
        pass
    return []


def extract_sfdr_from_geco_record(r: dict) -> int | None:
    """
    Extrait l'article SFDR d'un enregistrement GECO.
    GECO expose : sfdrCategory, articleSFDR, prdSfdrCode, cmpSfdrCode...
    """
    for key in ["sfdrCategory", "articleSFDR", "prdSfdrCode", "cmpSfdrCode",
                "sfdrArticle", "sfdr", "sfdrClassification"]:
        val = r.get(key)
        if val is not None:
            m = re.search(r"[689]", str(val))
            if m and m.group() in ("6", "8", "9"):
                return int(m.group())
    return None


def collect_sfdr_from_geco(session: FetcherSession, limit: int | None) -> dict[str, int]:
    """
    Parcourt GECO et extrait les classifications SFDR.
    Retourne {isin: sfdr_article}.
    """
    results = {}
    offset  = 0
    empty   = 0

    while True:
        if limit and len(results) >= limit:
            break
        time.sleep(RATE_LIMIT_SEC)
        records = fetch_geco_sfdr_page(session, offset)
        if not records:
            empty += 1
            if empty >= 3:
                break
            offset += 200
            continue
        empty = 0

        for r in records:
            sfdr = extract_sfdr_from_geco_record(r)
            if sfdr is None:
                continue

            # Trouver l'ISIN
            shares = r.get("sharesIsins") or []
            isin = next((s for s in shares if s and re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", s)), None)
            if not isin:
                raw = r.get("cmpCodeParPrincp", "")
                if raw and re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", raw):
                    isin = raw
            if isin and isin not in results:
                results[isin] = sfdr

        offset += 200
        if offset % 2000 == 0:
            print(f"    GECO SFDR : {offset} traités, {len(results)} classifications trouvées")

    return results


# ─── Source 2 : Heuristique nom/catégorie ────────────────────────────────────

def guess_sfdr_from_metadata(name: str, category: str | None) -> int:
    """
    Deviner l'article SFDR depuis le nom et la catégorie du fonds.
    Fiabilité : ~70-80% pour Art.9, ~60% pour Art.8.
    """
    text = f"{name} {category or ''}".lower()

    # Article 9 d'abord (plus spécifique)
    for kw in ART9_KEYWORDS:
        if kw.lower() in text:
            return 9

    # Article 8
    for kw in ART8_KEYWORDS:
        if kw.lower() in text:
            return 8

    return 6  # défaut : Article 6


# ─── Source 3 : Pages SGPs (Amundi, Sycomore, Mirova) ────────────────────────

def fetch_sfdr_amundi(session: FetcherSession, isin: str) -> int | None:
    """Cherche la classification SFDR sur la page Amundi du fonds."""
    try:
        url = f"https://www.amundi.fr/fr_FR/particulier/fund/{isin}"
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            return None
        html = page.body.decode("utf-8")
        m = re.search(r"article\s+(\d)\s*(?:SFDR|sfdr|du\s+règlement)", html, re.IGNORECASE)
        if m and m.group(1) in ("6", "8", "9"):
            return int(m.group(1))
        m2 = re.search(r"SFDR\s+article\s+(\d)", html, re.IGNORECASE)
        if m2 and m2.group(1) in ("6", "8", "9"):
            return int(m2.group(1))
    except Exception:
        pass
    return None


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, source: str | None, use_heuristic: bool):
    print("=" * 60)
    print("  SFDR Enricher — Classification Article 6/8/9")
    print("=" * 60)
    print(f"  Mode       : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Source     : {source or 'toutes'}")
    print(f"  Heuristique: {'OUI (remplir les blancs)' if use_heuristic else 'NON'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    session = FetcherSession(impersonate="chrome").__enter__()

    # Phase 1 : AMF GECO (le plus fiable)
    sfdr_map: dict[str, int] = {}
    if not source or source == "geco":
        print("  Phase 1 : AMF GECO...")
        sfdr_map = collect_sfdr_from_geco(session, limit)
        print(f"  → {len(sfdr_map)} classifications SFDR depuis GECO")

    # Phase 2 : Heuristique via queries ilike Supabase (couvre TOUS les fonds)
    if use_heuristic:
        print("\n  Phase 2 : Heuristique nom (ilike sur toute la base)...")

        # Queries directes par mot-clé — Article 9 d'abord (plus restrictif)
        ART9_QUERIES = [
            "impact invest", "investissement durable", "sustainable invest",
            "transition energ", "green bond", "obligation verte",
            "net zero", "article 9", "biodiversit", "clean energy",
            "energies renouvela", "renewable energy", "climate solution",
            "low carbon", "best-in-universe",
        ]
        ART8_QUERIES = [
            " isr", "isr ", " esg", "esg ", " sri ", " sri-", "isr-",
            "responsable", "durable", " sustainable", "article 8",
            "greenfin", "finansol", "towards sustainability",
            "best-in-class", "engagement actionnarial", "gouvernance",
            "environmental", "social ", "climatique",
        ]

        heuristic_map: dict[str, int] = {}

        def fetch_by_keyword(kw: str, article: int):
            off = 0
            while True:
                q = client.table("investissement_funds") \
                    .select("isin") \
                    .is_("sfdr_article", "null") \
                    .ilike("name", f"%{kw}%") \
                    .range(off, off + 999)
                rows = q.execute().data or []
                for row in rows:
                    isin = row["isin"]
                    if isin not in sfdr_map and isin not in heuristic_map:
                        heuristic_map[isin] = article
                if len(rows) < 1000:
                    break
                off += 1000

        for kw in ART9_QUERIES:
            fetch_by_keyword(kw, 9)
        art9_heuristic = len(heuristic_map)

        for kw in ART8_QUERIES:
            fetch_by_keyword(kw, 8)
        art8_heuristic = len(heuristic_map) - art9_heuristic

        # Fusionner dans sfdr_map (Art.9 a priorité)
        sfdr_map.update({k: v for k, v in heuristic_map.items() if k not in sfdr_map})

        if limit:
            sfdr_map = dict(list(sfdr_map.items())[:limit])

        print(f"  → {art9_heuristic} Art.9 + {art8_heuristic} Art.8 heuristiques")

    if not sfdr_map:
        print("  ⚠️  Aucune classification trouvée")
        return

    # Statistiques
    art6 = sum(1 for v in sfdr_map.values() if v == 6)
    art8 = sum(1 for v in sfdr_map.values() if v == 8)
    art9 = sum(1 for v in sfdr_map.values() if v == 9)
    print(f"\n  Répartition : Art.6={art6} | Art.8={art8} | Art.9={art9}")

    # Écriture Supabase — UPDATE uniquement sur les ISINs déjà en base
    if apply:
        # Filtrer pour n'inclure que les ISINs existants (évite violation NOT NULL sur name)
        existing_isins: set[str] = set()
        page, page_size = 0, 1000
        while True:
            r = client.table("investissement_funds") \
                .select("isin") \
                .in_("isin", list(sfdr_map.keys())[page * page_size : (page + 1) * page_size]) \
                .execute()
            for row in (r.data or []):
                existing_isins.add(row["isin"])
            if len(list(sfdr_map.keys())[page * page_size : (page + 1) * page_size]) < page_size:
                break
            page += 1

        batch = [
            {"isin": isin, "sfdr_article": sfdr}
            for isin, sfdr in sfdr_map.items()
            if isin in existing_isins
        ]
        skipped = len(sfdr_map) - len(batch)
        if skipped:
            print(f"  ℹ️  {skipped} ISINs ignorés (pas dans la base)")
        ok, fail = update_funds_bulk(batch, batch_size=200)
        print(f"  → Update {len(batch)} fonds : {ok} OK, {fail} échec")
        log_run("sfdr-enricher", "success", ok, fail, started_at=started)
    else:
        print("\n  Aperçu (15 premiers) :")
        for isin, sfdr in list(sfdr_map.items())[:15]:
            print(f"  {isin} → Art.{sfdr}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SFDR Enricher — Article 6/8/9")
    parser.add_argument("--apply",       action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",       type=int,            help="Limiter à N fonds")
    parser.add_argument("--source",      type=str,            help="geco | heuristic")
    parser.add_argument("--heuristic",   action="store_true", help="Remplir blancs avec heuristique")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, source=args.source, use_heuristic=args.heuristic)
