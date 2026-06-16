#!/usr/bin/env python3
"""
openfigi-tickers.py — Tickers boursiers des ETF via OpenFIGI (fill-only)
========================================================================
Les ETF cotés s'échangent sous un (ou plusieurs) ticker boursier — p. ex.
l'Amundi PEA Monde MSCI World (FR001400U5Q4) cote sous « DCAM » sur Euronext
Paris. La base ne stockait aucun ticker → une recherche « DCAM » ne renvoyait
rien (retour utilisateur). Ce script remplit la colonne `investissement_funds.tickers`
(text[]) pour les ETF, à partir de l'endpoint OpenFIGI /v3/mapping (Bloomberg,
gratuit, sans clé) qui mappe un ISIN → toutes ses cotations (multi-bourses).

FILL-ONLY ET SÛR :
  - n'interroge que des ISINs DÉJÀ en base (product_type='etf') ;
  - n'écrit QUE la colonne `tickers` via update_funds_bulk (UPDATE-only, jamais
    d'insert, jamais d'écrasement d'autres colonnes — cf. db.update_funds_bulk) ;
  - par défaut, ne traite que les ETF dont `tickers` est NULL (reprise/incrémental) ;
    --refresh pour tout retraiter.

Usage :
    python3 scripts/scrapers/openfigi-tickers.py                 # dry-run, 20 ISINs
    python3 scripts/scrapers/openfigi-tickers.py --limit 50       # dry-run, 50 ISINs
    python3 scripts/scrapers/openfigi-tickers.py --apply          # écrit tout l'univers ETF
    python3 scripts/scrapers/openfigi-tickers.py --apply --refresh  # ré-enrichit même les déjà remplis

Avec une clé OpenFIGI (env OPENFIGI_API_KEY) : lots de 100 ISINs et 250 req/min.
Sans clé : lots de 10 et ~25 req/min (rythme par défaut).
"""

import os
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, update_funds_bulk, log_run

# ─── Config ──────────────────────────────────────────────────────────────────

MAPPING_URL = "https://api.openfigi.com/v3/mapping"
TIMEOUT     = 30
MAX_TICKERS = 12          # cap par ISIN — évite les ETF ultra-cross-listés bavards

API_KEY = os.environ.get("OPENFIGI_API_KEY", "").strip()

# Limites OpenFIGI : avec clé, lots de 100 & 250 req/min ; sans clé, 10 & 25 req/min.
DEFAULT_BATCH = 100 if API_KEY else 10
DEFAULT_SLEEP = 0.25 if API_KEY else 2.5    # marge sous le plafond req/min

# Places Euronext / européennes mises en tête : le ticker « maison » (DCAM) d'abord.
PREFERRED_EXCH = ["FP", "EP", "NA", "BB", "LI", "MI", "EO", "EZ", "GR", "TH", "SW"]

HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    "User-Agent":   "charlie-investissement/openfigi-tickers",
}
if API_KEY:
    HEADERS["X-OPENFIGI-APIKEY"] = API_KEY


# ─── Étape 1 : ISINs ETF à traiter ────────────────────────────────────────────

def fetch_etf_isins(refresh: bool, page: int = 1000) -> list[str]:
    """ISINs des ETF en base. Par défaut, uniquement ceux sans tickers (incrémental)."""
    client = get_client()
    isins: list[str] = []
    start = 0
    while True:
        q = (
            client.table("investissement_funds")
            .select("isin")
            .eq("product_type", "etf")
            .order("isin")
            .range(start, start + page - 1)
        )
        if not refresh:
            q = q.is_("tickers", "null")
        rows = q.execute().data or []
        isins.extend(r["isin"] for r in rows if r.get("isin"))
        if len(rows) < page:
            break
        start += page
    return isins


# ─── Étape 2 : OpenFIGI mapping ───────────────────────────────────────────────

def _exch_rank(exch: str) -> int:
    """Rang de tri : places préférées d'abord, le reste ensuite (ordre stable)."""
    return PREFERRED_EXCH.index(exch) if exch in PREFERRED_EXCH else len(PREFERRED_EXCH)


def tickers_for_listings(listings: list[dict]) -> list[str]:
    """Extrait les tickers distincts d'un ISIN, places préférées en tête, cappé."""
    # Trie par place préférée (tri stable → conserve l'ordre OpenFIGI à rang égal).
    ordered = sorted(listings, key=lambda it: _exch_rank(it.get("exchCode", "")))
    out: list[str] = []
    seen: set[str] = set()
    for it in ordered:
        t = (it.get("ticker") or "").strip().upper()
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= MAX_TICKERS:
            break
    return out


def map_batch(isins: list[str], max_retries: int = 4) -> dict[str, list[str]]:
    """Mappe un lot d'ISINs → {isin: [tickers]} via OpenFIGI. Respecte les 429."""
    payload = [{"idType": "ID_ISIN", "idValue": i} for i in isins]
    for attempt in range(max_retries):
        try:
            r = requests.post(MAPPING_URL, headers=HEADERS, json=payload, timeout=TIMEOUT)
        except requests.RequestException:
            time.sleep(2 ** attempt)
            continue

        if r.status_code == 429:
            # Quota req/min dépassé : back-off exponentiel puis on rejoue le lot.
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code != 200:
            time.sleep(2 ** attempt)
            continue

        data = r.json()
        # Réponse = liste alignée sur l'ordre des jobs envoyés.
        result: dict[str, list[str]] = {}
        for isin, entry in zip(isins, data):
            listings = entry.get("data") if isinstance(entry, dict) else None
            if listings:
                tk = tickers_for_listings(listings)
                if tk:
                    result[isin] = tk
        return result

    print(f"  ⚠️  lot abandonné après {max_retries} tentatives ({isins[0]}…)")
    return {}


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, refresh: bool, batch: int, sleep_s: float):
    print("=" * 60)
    print("  OpenFIGI — tickers ETF (fill-only)")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Clé API : {'oui' if API_KEY else 'non (rythme bridé)'}")
    print(f"  Lot     : {batch} ISINs | pause : {sleep_s}s")
    print(f"  Cible   : {'TOUS les ETF' if refresh else 'ETF sans tickers'}")
    print()

    started = datetime.now(timezone.utc)

    isins = fetch_etf_isins(refresh)
    print(f"  {len(isins)} ETF à traiter")
    if limit:
        isins = isins[:limit]
        print(f"  → limité à {len(isins)}")
    if not isins:
        print("  Rien à faire.")
        return

    mapped: dict[str, list[str]] = {}
    n_batches = (len(isins) + batch - 1) // batch
    for bi in range(n_batches):
        chunk = isins[bi * batch : (bi + 1) * batch]
        res = map_batch(chunk)
        mapped.update(res)
        done = (bi + 1) * batch
        if (bi + 1) % 10 == 0 or bi == n_batches - 1:
            print(f"  [{min(done, len(isins)):5d}/{len(isins)}] {len(mapped)} ETF avec tickers")
        if bi < n_batches - 1:
            time.sleep(sleep_s)

    hit = len(mapped)
    pct = f"{hit / len(isins) * 100:.0f}%" if isins else "N/A"
    print(f"\n  ✓ {hit}/{len(isins)} ETF résolus ({pct})")

    if not apply:
        print("\n  Aperçu (15 premiers) :")
        for isin in list(mapped)[:15]:
            print(f"    {isin} → {', '.join(mapped[isin])}")
        print("\n  (dry-run — relance avec --apply pour écrire en base)")
        return

    rows = [{"isin": isin, "tickers": tk} for isin, tk in mapped.items()]
    ok, fail = update_funds_bulk(rows, batch_size=200)
    print(f"\n  → UPDATE {len(rows)} ETF : {ok} OK, {fail} échec")

    # Recalcule la colonne de recherche `tickers_search` AVEC propagation à
    # travers les parts (le représentant primaire d'un groupe doit être trouvable
    # par le ticker de n'importe quelle part sœur — cf. migration 20260616140000).
    # Sans cet appel, les tickers fraîchement écrits resteraient introuvables.
    try:
        get_client().rpc("inv_refresh_tickers_search").execute()
        print("  → tickers_search rafraîchi (propagation share-class)")
    except Exception as e:
        print(f"  ⚠️  inv_refresh_tickers_search échoué : {e}")

    status = "success" if fail == 0 else "partial"
    log_run("openfigi-tickers", status, ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tickers ETF via OpenFIGI (fill-only)")
    parser.add_argument("--apply",   action="store_true", help="Écrire en base (sinon dry-run)")
    parser.add_argument("--refresh", action="store_true", help="Retraiter même les ETF déjà pourvus de tickers")
    parser.add_argument("--limit",   type=int,            help="Limiter à N ETF")
    parser.add_argument("--batch",   type=int,   default=DEFAULT_BATCH, help="ISINs par requête mapping")
    parser.add_argument("--sleep",   type=float, default=DEFAULT_SLEEP, help="Pause entre requêtes (s)")
    args = parser.parse_args()

    # Garde-fou : OpenFIGI plafonne les lots à 10 sans clé, 100 avec.
    cap = 100 if API_KEY else 10
    batch = max(1, min(args.batch, cap))

    run(apply=args.apply, limit=args.limit, refresh=args.refresh, batch=batch, sleep_s=args.sleep)
