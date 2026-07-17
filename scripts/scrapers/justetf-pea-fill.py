#!/usr/bin/env python3
"""
justetf-pea-fill.py — Flag pea_eligible des ETF depuis le filtre PEA JustETF
=============================================================================
L'éligibilité PEA d'un ETF ne se déduit PAS de son nom/indice/domicile : les
ETF SYNTHÉTIQUES répliquant des indices non européens sont éligibles (Amundi
PEA S&P 500 FR0011871128, BNP Easy S&P 500, iShares MSCI World Swap PEA
domicilié en IRLANDE IE0002XZSHO1…). L'heuristique de pea-eligibility-fix.py
les excluait à tort (mots-clés « s&p 500 », « nasdaq »…).

Source AUTORITAIRE (repérage 2026-07-17) : le screener JustETF, filtre officiel
`pea=true`. Le HTML de liste est vide (table Wicket AJAX) mais le flux se
sonde en 2 temps avec requests :
  1. GET /fr/search.html?search=ETFS&pea=true (cookies) → extraire
     `var fetchCallbackUrl = '...'` du HTML ;
  2. POST sur cette URL (mêmes cookies, X-Requested-With) avec le payload
     DataTables (`etfsParams=search%3DETFS%26pea%3Dtrue`) → JSON
     {recordsTotal: ~210, data: [{isin, name, replicationMethod, …}]}.

Écriture (ETF uniquement) : FULL-REFRESH du flag — pea_eligible=True pour les
ISIN de la liste, False pour les autres product_type='etf' (corrige aussi les
faux positifs de l'heuristique). Garde-fou : < 150 lignes → on n'écrit RIEN
(filtre/format cassé). Les actions et OPCVM ne sont jamais touchés
(pea-eligibility-fix.py garde ce périmètre).

Contraintes JustETF (docs/SCRAPER_MAP.md) : UN SEUL script JustETF à la fois,
≥ 3,5 s entre requêtes — ici 2-3 requêtes au total.

Usage :
    python3 scripts/scrapers/justetf-pea-fill.py            # dry-run
    python3 scripts/scrapers/justetf-pea-fill.py --apply
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run  # noqa: E402

BASE = "https://www.justetf.com"
LIST_URL = f"{BASE}/fr/search.html?search=ETFS&pea=true"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
}

RATE_LIMIT = 3.5
PAGE_SIZE = 200
MIN_EXPECTED = 150  # ~210 ETF PEA ; en dessous = filtre cassé, ne rien écrire.
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")


def fetch_pea_isins() -> list[str]:
    """ISIN des ETF éligibles PEA via le flux Wicket de JustETF."""
    s = requests.Session()
    s.headers.update(HEADERS)

    r = s.get(LIST_URL, timeout=45)
    if r.status_code != 200:
        print(f"  ✗ GET liste : HTTP {r.status_code}")
        return []
    m = re.search(r"var fetchCallbackUrl = '([^']+)'", r.text or "")
    if not m:
        print("  ✗ fetchCallbackUrl introuvable (gabarit JustETF changé ?)")
        return []
    callback = BASE + m.group(1)

    isins: set[str] = set()
    start, total = 0, None
    while True:
        time.sleep(RATE_LIMIT)
        payload = {
            "draw": "1", "start": str(start), "length": str(PAGE_SIZE),
            "lang": "fr", "country": "FR", "universeType": "private",
            "defaultCurrency": "EUR", "etfsParams": "search=ETFS&pea=true",
        }
        rr = s.post(callback, data=payload,
                    headers={"X-Requested-With": "XMLHttpRequest"}, timeout=45)
        if rr.status_code != 200:
            print(f"  ✗ POST start={start} : HTTP {rr.status_code}")
            break
        j = rr.json()
        if total is None:
            total = int(j.get("recordsTotal") or 0)
            print(f"  recordsTotal = {total}")
        rows = j.get("data") or []
        if not rows:
            break
        for row in rows:
            isin = str((row or {}).get("isin") or "").strip().upper()
            if ISIN_RE.match(isin):
                isins.add(isin)
        start += PAGE_SIZE
        if total and start >= total:
            break
    return sorted(isins)


def run(apply: bool):
    print("=" * 64)
    print("  JustETF — flag pea_eligible des ETF (synthétiques inclus)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print("=" * 64)
    started = datetime.now(timezone.utc)

    pea = fetch_pea_isins()
    print(f"  ETF éligibles PEA : {len(pea)}")

    if len(pea) < MIN_EXPECTED:
        print(f"  ✗ sous le seuil ({MIN_EXPECTED}) — rien n'est écrit (garde anti-régression).")
        if apply:
            log_run("justetf-pea-fill", "failed", 0, 0, started_at=started)
        return

    if not apply:
        print("  Aperçu :", ", ".join(pea[:8]), "…")
        print("  DRY-RUN — rien écrit.")
        return

    client = get_client()

    # ETF du catalogue, paginé.
    etfs: list[str] = []
    off = 0
    while True:
        rows = client.table("investissement_funds").select("isin") \
            .eq("product_type", "etf").range(off, off + 999).execute().data
        if not rows:
            break
        etfs += [r["isin"] for r in rows]
        if len(rows) < 1000:
            break
        off += 1000

    pea_set = set(pea)
    to_true = [i for i in etfs if i in pea_set]
    to_false = [i for i in etfs if i not in pea_set]
    print(f"  ETF en base : {len(etfs)} | → True : {len(to_true)} | → False : {len(to_false)}")

    ok = fail = 0
    for value, batch_isins in ((True, to_true), (False, to_false)):
        for i in range(0, len(batch_isins), 200):
            chunk = batch_isins[i:i + 200]
            try:
                client.table("investissement_funds") \
                    .update({"pea_eligible": value}) \
                    .in_("isin", chunk).execute()
                ok += len(chunk)
            except Exception as e:
                fail += len(chunk)
                print(f"    ✗ batch {value} : {str(e)[:80]}")

    absent = len(pea_set - set(etfs))
    if absent:
        print(f"  ({absent} ETF PEA de JustETF absents du catalogue — pistes d'enrichissement)")
    print(f"  Flags écrits : {ok} OK, {fail} échec")
    log_run("justetf-pea-fill", "success" if fail == 0 else "partial", ok, fail,
            started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Flag PEA des ETF via JustETF (source autoritaire)")
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
