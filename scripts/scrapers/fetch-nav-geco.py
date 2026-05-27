#!/usr/bin/env python3
"""
fetch-nav-geco.py — VL historiques depuis AMF GECO rech_part.aspx
==================================================================
Complément de fetch-opcvm-nav.py (Yahoo Finance) pour les ~24% de fonds
qui ne sont pas couverts par Yahoo Finance.

Pour chaque ISIN dans investissement_funds sans historique de prix
(ou avec moins de MIN_WEEKS semaines), scrappe l'interface HTML de GECO
qui publie les VL officielles au format tabulaire.

Source : https://geco.amf-france.org/Bio/rech_part.aspx?CodeISIN={isin}
  → HTML paginé avec tableau : Date | VL | Devise

Fréquence : quotidien (complète le fetch Yahoo Finance)
Usage :
    python3 scripts/scrapers/fetch-nav-geco.py [--apply] [--limit N] [--isin ISIN]
    python3 scripts/scrapers/fetch-nav-geco.py --apply --missing-only
"""

import re
import sys
import time
import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from html.parser import HTMLParser

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_prices, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

GECO_NAV_URL  = "https://geco.amf-france.org/Bio/rech_part.aspx"
RATE_LIMIT_SEC = 1.5          # respecter le rate limit AMF
MIN_WEEKS      = 26            # seuil : si un fonds a moins de 26 semaines → scrapper
LOOKBACK_YEARS = 5             # 5 ans d'historique max
TIMEOUT        = 20

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer":         "https://geco.amf-france.org/",
}

# ─── Parser HTML GECO ─────────────────────────────────────────────────────────

class GECONavParser(HTMLParser):
    """Parse le tableau HTML de rech_part.aspx → liste de {date, nav}."""

    def __init__(self):
        super().__init__()
        self._in_table  = False
        self._in_row    = False
        self._in_cell   = False
        self._cells     = []
        self._current   = ""
        self.rows       = []  # [{date, nav}]

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        if tag == "table":
            self._in_table = True
        elif tag == "tr" and self._in_table:
            self._in_row  = True
            self._cells   = []
        elif tag == "td" and self._in_row:
            self._in_cell   = True
            self._current   = ""

    def handle_endtag(self, tag):
        if tag == "table":
            self._in_table = False
        elif tag == "tr" and self._in_table:
            self._in_row = False
            if len(self._cells) >= 2:
                self._parse_row(self._cells)
        elif tag == "td":
            if self._in_cell:
                self._cells.append(self._current.strip())
            self._in_cell = False

    def handle_data(self, data):
        if self._in_cell:
            self._current += data

    def _parse_row(self, cells: list[str]):
        # Format attendu : [Date, VL, Devise] ou [Date, VL]
        date_raw = cells[0].strip()
        nav_raw  = cells[1].strip().replace(" ", "").replace(",", ".")

        # Date : DD/MM/YYYY ou YYYY-MM-DD
        parsed_date = None
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                parsed_date = datetime.strptime(date_raw, fmt).date().isoformat()
                break
            except ValueError:
                pass
        if not parsed_date:
            return

        # VL : nombre décimal
        try:
            nav = float(nav_raw)
        except ValueError:
            return

        if nav > 0 and parsed_date >= (date.today() - timedelta(days=365 * LOOKBACK_YEARS)).isoformat():
            self.rows.append({"date": parsed_date, "nav": nav})


def scrape_nav_for_isin(session: FetcherSession, isin: str) -> list[dict]:
    """Récupère toutes les VL disponibles pour un ISIN depuis GECO."""
    all_prices = []
    page = 1

    while True:
        params = {
            "CodeISIN": isin,
            "Classement": "Date",
            "Sens": "D",  # décroissant
            "Periode": str(LOOKBACK_YEARS * 12),  # en mois
            "Nb_ligne": "1000",
            "page": str(page),
        }
        try:
            page = session.get(GECO_NAV_URL, params=params, stealthy_headers=True, timeout=TIMEOUT)
            if page.status != 200:
                break
            html = page.body.decode("utf-8")

            # Parser le tableau
            parser = GECONavParser()
            parser.feed(html)

            if not parser.rows:
                break  # Plus de données

            all_prices.extend(parser.rows)

            # Vérifier si pagination nécessaire (> 1000 lignes sur la page = pas de pagination GECO)
            # GECO retourne tout en une page en général avec Nb_ligne=1000
            break

        except Exception:
            break

        page += 1
        time.sleep(RATE_LIMIT_SEC)

    # Dédupliquer par date
    seen = set()
    unique = []
    for p in all_prices:
        if p["date"] not in seen:
            seen.add(p["date"])
            unique.append(p)

    return sorted(unique, key=lambda x: x["date"])


def get_funds_needing_nav(client, min_weeks: int, limit: int | None, isin_filter: str | None) -> list[dict]:
    """Fonds sans historique suffisant dans investissement_fund_prices."""
    if isin_filter:
        resp = client.table("investissement_funds") \
            .select("isin, name") \
            .eq("isin", isin_filter) \
            .execute()
        return resp.data or []

    # Compter les VL existantes par ISIN (semaines)
    # On sélectionne les fonds OPCVM qui n'ont pas ou peu de VL dans fund_prices
    cutoff = (date.today() - timedelta(days=365)).isoformat()

    resp_prices = client.table("investissement_fund_prices") \
        .select("isin") \
        .gte("price_date", cutoff) \
        .execute()

    # Compter les entrées par ISIN
    from collections import Counter
    price_counts = Counter(r["isin"] for r in (resp_prices.data or []))

    # Récupérer tous les fonds OPCVM avec pagination
    all_funds = []
    page_size = 1000
    offset    = 0
    while True:
        query = client.table("investissement_funds") \
            .select("isin, name, management_company, aum_eur") \
            .eq("product_type", "opcvm") \
            .range(offset, offset + page_size - 1)
        resp = query.execute()
        batch = resp.data or []
        all_funds.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    # Filtrer ceux qui n'ont pas assez de données
    needing = [
        f for f in all_funds
        if price_counts.get(f["isin"], 0) < min_weeks
    ]

    return needing[:limit] if limit else needing


def run(apply: bool, limit: int | None, isin_filter: str | None, missing_only: bool):
    print("=" * 60)
    print("  Fetch NAV GECO — VL historiques depuis AMF GECO")
    print("=" * 60)
    print(f"  Mode        : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Seuil min   : {MIN_WEEKS} semaines de VL existantes")
    print(f"  Lookback    : {LOOKBACK_YEARS} ans")
    if limit:
        print(f"  Limite      : {limit} fonds")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()
    session = FetcherSession(impersonate="chrome").__enter__()

    funds = get_funds_needing_nav(client, MIN_WEEKS, limit, isin_filter)
    print(f"  {len(funds)} fonds à enrichir en VL")
    print()

    total_ok    = 0
    total_fail  = 0
    total_prices = 0

    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        time.sleep(RATE_LIMIT_SEC)
        prices = scrape_nav_for_isin(session, isin)

        if not prices:
            total_fail += 1
            if i <= 10 or i % 100 == 0:
                print(f"  ✗ [{i:4d}] {isin} (0 VL) {name}")
            continue

        total_prices += len(prices)

        if apply:
            n_inserted, n_fail = upsert_prices(isin, prices, source="amf-geco")
            total_ok   += 1
        else:
            n_inserted = len(prices)

        if i <= 20 or i % 100 == 0:
            first = prices[0]["date"]
            last  = prices[-1]["date"]
            print(f"  ✓ [{i:4d}] {isin} ({len(prices):4d} VL : {first} → {last}) {name}")

    print()
    print(f"  ✓ {total_ok} fonds enrichis, {total_fail} sans VL, {total_prices:,} lignes de prix")

    if apply:
        log_run(
            scraper="fetch-nav-geco",
            status="success",
            records_processed=total_ok,
            records_failed=total_fail,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch NAV historiques depuis AMF GECO")
    parser.add_argument("--apply",        action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",        type=int,            help="Limiter à N fonds")
    parser.add_argument("--isin",         type=str,            help="Un seul ISIN")
    parser.add_argument("--missing-only", action="store_true", help="Seulement fonds sans VL")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin, missing_only=args.missing_only)
