#!/usr/bin/env python3
"""
fetch-ter-fundinfo.py — TER / frais courants depuis FundInfo + Boursorama
=========================================================================
Pour chaque fonds dans investissement_funds sans ongoing_charges,
cherche les frais courants (TER/OCF) dans :
  1. FundInfo (doc.fundinfo.com) — hébergeur européen des KIDs, APIs partielles
  2. Boursorama (pages fonds publiques)
  3. Linxea (catalogue UC assurance-vie — bonus : éligibilité AV)

FundInfo host les KIDs de ~8 000 fonds européens et expose quelques données
de façon programmatique via leurs URLs structurées.

Usage :
    python3 scripts/scrapers/fetch-ter-fundinfo.py [--apply] [--limit N]
    python3 scripts/scrapers/fetch-ter-fundinfo.py --apply  (tous les fonds sans TER)
"""

import re
import sys
import time
import argparse
import threading
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT_SEC = 0.8   # par worker — Boursorama rate limit
TIMEOUT        = 12
WORKERS        = 5     # workers parallèles (conservateur pour éviter ban)

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
}

# ─── Utilitaires ──────────────────────────────────────────────────────────────

def parse_ter(s: str | None) -> float | None:
    if not s:
        return None
    try:
        val = float(str(s).replace(",", ".").replace("%", "").strip())
        if 0 < val < 20:
            return round(val / 100, 6)  # 0.85% → 0.0085
    except (ValueError, TypeError):
        pass
    return None


# ─── Source 1 : FundInfo ──────────────────────────────────────────────────────

def fetch_ter_fundinfo(session: FetcherSession, isin: str) -> dict | None:
    """
    FundInfo héberge des KIDs pour ~8 000 fonds européens.
    Ils ont des URLs structurées : doc.fundinfo.com/doc/{isin}/
    et une API de métadonnées partielles.
    """
    urls_to_try = [
        f"https://doc.fundinfo.com/doc/{isin}/",
        f"https://www.fundinfo.com/en/fund/{isin}",
    ]

    for url in urls_to_try:
        try:
            page = session.get(url, stealthy_headers=True, timeout=TIMEOUT, allow_redirects=True)
            if page.status != 200:
                continue
            html = page.body.decode("utf-8")

            # Chercher TER dans la page
            patterns = [
                r"(?:ongoing charges?|TER|total expense ratio|OCF)[^\d%]*(\d+[.,]\d+)\s*%",
                r"(?:frais courants|charges courantes)[^\d%]*(\d+[.,]\d+)\s*%",
                r'"ongoingCharge[s]?"[:\s]*"?(\d+[.,]\d+)"?',
                r'"ter"[:\s]*"?(\d+[.,]\d+)"?',
            ]
            for pat in patterns:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    ter = parse_ter(m.group(1))
                    if ter:
                        # Chercher aussi SRI / risque
                        result = {"ter": ter, "ongoing_charges": ter, "source": "fundinfo"}
                        sri_m = re.search(r"(?:SRI|summary risk)[^\d]*(\d)\s*/\s*7", html, re.IGNORECASE)
                        if sri_m:
                            result["sri"] = int(sri_m.group(1))
                        # KID URL
                        kid_m = re.search(r'href="([^"]*(?:kid|dici|kiid)[^"]*\.pdf)"', html, re.IGNORECASE)
                        if kid_m:
                            kid_url = kid_m.group(1)
                            if kid_url.startswith("http"):
                                result["kid_url"] = kid_url
                            else:
                                result["kid_url"] = f"https://doc.fundinfo.com{kid_url}"
                        return result

        except Exception:
            continue

    return None


# ─── Source 2 : Boursorama ────────────────────────────────────────────────────

def fetch_ter_boursorama(session: FetcherSession, isin: str) -> dict | None:
    """Récupère les frais courants depuis la page fonds Boursorama."""
    urls = [
        f"https://www.boursorama.com/bourse/opcvm/cours/{isin}/",
        f"https://www.boursorama.com/cours/{isin}/",
    ]
    for url in urls:
        try:
            page = session.get(url, stealthy_headers=True, timeout=TIMEOUT, allow_redirects=True)
            if page.status != 200:
                continue
            html = page.body.decode("utf-8")

            # Chercher les frais
            patterns = [
                r"frais courants[^%\d]*(\d+[.,]\d+)\s*%",
                r"charges courantes[^%\d]*(\d+[.,]\d+)\s*%",
                r"TER[^%\d]*(\d+[.,]\d+)\s*%",
                r"frais de gestion[^%\d]*(\d+[.,]\d+)\s*%",
            ]
            for pat in patterns:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    ter = parse_ter(m.group(1))
                    if ter:
                        result = {"ter": ter, "ongoing_charges": ter, "source": "boursorama"}
                        # Chercher SRRI/risque
                        srri_m = re.search(r"SRRI[^\d]*(\d)\s*(?:/\s*7)?", html, re.IGNORECASE)
                        if srri_m:
                            result["srri"] = int(srri_m.group(1))
                        return result
        except Exception:
            continue
    return None


# ─── Source 3 : Morningstar (pages publiques individuelles, non-bulk) ─────────

def fetch_ter_morningstar(session: FetcherSession, isin: str) -> dict | None:
    """
    Page fonds Morningstar publique — données de base (non protégées).
    Uniquement pour les fonds déjà dans la base, pas de scraping bulk.
    """
    url = f"https://www.morningstar.fr/fr/funds/snapshot/snapshot.aspx?id={isin}"
    try:
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if page.status != 200:
            return None
        html = page.body.decode("utf-8")

        patterns = [
            r"Frais courants[^\d%]*(\d+[.,]\d+)\s*%",
            r"Ongoing charges[^\d%]*(\d+[.,]\d+)\s*%",
            r"Frais de gestion[^\d%]*(\d+[.,]\d+)\s*%",
        ]
        for pat in patterns:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                ter = parse_ter(m.group(1))
                if ter:
                    return {"ter": ter, "ongoing_charges": ter, "source": "morningstar"}
    except Exception:
        pass
    return None


# ─── Dispatcher ───────────────────────────────────────────────────────────────

# Décision (2026-06-23) : Boursorama est le SEUL finder actif ici.
#  - fetch_ter_fundinfo   : retiré — doc.fundinfo.com injoignable (DNS mort).
#  - fetch_ter_morningstar: retiré DÉFINITIVEMENT — le TER Morningstar est désormais
#    possédé par l'enricher dédié `morningstar-ter-fill.py` (cible rating connu sans TER)
#    et `morningstar-lt-enricher.py` (rating NULL). Le re-câbler ici ferait double emploi
#    et doublerait le throttle Morningstar (source déjà sous tension, cf. mémoire
#    `morningstar-emea-holdings-enricher`). Les fonctions sont conservées plus haut
#    comme fallback manuel ad hoc, mais ne sont pas dans le dispatcher.
FINDERS = [
    fetch_ter_boursorama,
]

def find_ter(session: FetcherSession, isin: str) -> dict | None:
    for finder in FINDERS:
        time.sleep(RATE_LIMIT_SEC)
        result = finder(session, isin)
        if result:
            return result
    return None


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Fetch TER — FundInfo + Boursorama + Morningstar")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Fonds sans frais courants, triés par AUM décroissant
    # Paginer tous les fonds sans TER
    resp_data = []
    page_sz   = 1000
    off       = 0
    while True:
        q = client.table("investissement_funds") \
            .select("isin, name, aum_eur") \
            .is_("ongoing_charges", "null") \
            .is_("ter", "null") \
            .range(off, off + page_sz - 1)
        chunk = q.execute().data or []
        resp_data.extend(chunk)
        if len(chunk) < page_sz or (limit and len(resp_data) >= limit):
            break
        off += page_sz
    if limit:
        resp_data = resp_data[:limit]

    class _Resp:
        data = resp_data
    resp = _Resp()
    funds = resp.data or []
    print(f"  {len(funds)} fonds sans TER à enrichir")
    print()

    found = 0
    not_found = 0
    counter_lock = threading.Lock()

    def process_fund(args):
        nonlocal found, not_found
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]
        session = FetcherSession(impersonate="chrome").__enter__()
        result = find_ter(session, isin)
        # DB write outside lock to avoid serializing HTTP calls
        source = (result or {}).pop("source", "unknown")  # remove before upsert
        if result and apply:
            upsert_fund({"isin": isin, **result})
        with counter_lock:
            if result:
                found += 1
                if i <= 30 or i % 200 == 0:
                    ter_pct = f"{(result.get('ter') or 0)*100:.2f}%"
                    print(f"  ✓ [{i:5d}] {isin} | TER:{ter_pct:6} | src:{source:12} | {name}")
            else:
                not_found += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ✗ [{i:5d}] {isin} | not found | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as executor:
        list(executor.map(process_fund, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} TERs trouvés, {not_found} introuvables")

    if apply:
        log_run("fetch-ter-fundinfo", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch TER depuis FundInfo+Boursorama")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
