#!/usr/bin/env python3
"""
justetf-fields-enricher.py — region, inception_date, management_company, category
===================================================================================
Pour chaque ETF avec au moins un de ces champs manquant, visite la page JustETF FR
et extrait :
  - region_exposure   (ex: "Actions, Monde" → region="global", category="actions")
  - inception_date    (ex: "25 septembre 2009" → "2009-09-25")
  - management_company (ex: "iShares")
  - category          (ex: "actions", "obligations", etc.)

Usage :
    python3 scripts/scrapers/justetf-fields-enricher.py [--apply] [--limit N]

IMPORTANT : JustETF limite les requêtes à 1 scraper à la fois.
  - Ne pas lancer simultanément avec d'autres scrapers JustETF
  - RATE_LIMIT minimum 3.5s entre requêtes
  - En cas de 403 répété, attendre 2-4h avant de relancer
"""

import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

RATE_LIMIT = 3.5
TIMEOUT    = 15
WORKERS    = 1

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
    "Referer":         "https://www.justetf.com/fr/",
}

BASE_URL = "https://www.justetf.com/fr/etf-profile.html?isin={isin}"


def _val(html: str, testid: str) -> str | None:
    m = re.search(rf'data-testid="{re.escape(testid)}"[^>]*>([^<]+)<', html)
    return m.group(1).strip() if m else None


MONTH_FR = {
    "janvier": "01", "février": "02", "mars": "03", "avril": "04",
    "mai": "05", "juin": "06", "juillet": "07", "août": "08",
    "septembre": "09", "octobre": "10", "novembre": "11", "décembre": "12",
}


def parse_date(s: str | None) -> str | None:
    """Parse '25 septembre 2009' → '2009-09-25'"""
    if not s:
        return None
    s = s.strip().lower()
    for fr, num in MONTH_FR.items():
        if fr in s:
            parts = s.replace(fr, num).split()
            if len(parts) == 3:
                try:
                    return f"{parts[2]}-{parts[1]}-{int(parts[0]):02d}"
                except (ValueError, IndexError):
                    pass
    m = re.search(r'(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})', s)
    if m:
        return f"{m.group(3)}-{m.group(2):0>2}-{m.group(1):0>2}"
    return None


REGION_MAP = {
    "monde": "global", "world": "global", "global": "global",
    "états-unis": "usa", "etats-unis": "usa", "usa": "usa", "us": "usa",
    "europe": "europe", "eurozone": "europe", "zone euro": "europe",
    "marchés émergents": "emerging", "emerging markets": "emerging", "emerging": "emerging",
    "asie": "asia", "asia pacific": "asia", "asia-pacific": "asia", "asie-pacifique": "asia",
    "japon": "japan", "japan": "japan",
    "chine": "china", "china": "china",
    "inde": "india", "india": "india",
    "france": "france",
    "allemagne": "germany", "germany": "germany",
    "italie": "italy", "italy": "italy",
    "royaume-uni": "united_kingdom", "uk": "united_kingdom", "grande-bretagne": "united_kingdom",
    "suisse": "switzerland", "switzerland": "switzerland",
    "amérique latine": "latin_america", "latin america": "latin_america",
    "amérique du nord": "north_america", "north america": "north_america",
    "arabie saoudite": "saudi_arabia", "saudi arabia": "saudi_arabia",
    "corée du sud": "south_korea", "south korea": "south_korea",
    "taiwan": "taiwan", "taïwan": "taiwan",
    "brésil": "brazil", "brazil": "brazil",
    "pays-bas": "netherlands", "netherlands": "netherlands",
    "afrique": "africa", "africa": "africa",
    "canada": "canada",
    "australie": "australia", "australia": "australia",
    "indonésie": "indonesia", "indonesia": "indonesia",
    "hong kong": "hong_kong", "hong-kong": "hong_kong",
    "mexique": "mexico", "mexico": "mexico",
    "turquie": "turkey", "turkey": "turkey",
    "europe de l'est": "eastern_europe", "eastern europe": "eastern_europe",
    "singapour": "singapore", "singapore": "singapore",
    "vietnam": "vietnam", "viet nam": "vietnam",
    "latam": "latin_america",
    "métaux industriels": None, "metals": None, "commodities": None,
    "vaste marché": None,
}

CAT_MAP = {
    "actions": "actions", "equities": "actions", "equity": "actions", "stocks": "actions",
    "obligations": "obligations", "bonds": "obligations", "fixed income": "obligations",
    "matières premières": "matieres-premieres", "commodities": "matieres-premieres",
    "immobilier": "immobilier", "real estate": "immobilier",
    "monétaire": "monetaire", "money market": "monetaire",
    "multi-actifs": "diversifie", "mixed": "diversifie", "allocation": "diversifie",
    "crypto": "crypto", "cryptocurrency": "crypto",
}

NON_REGIONS = {
    "usd", "eur", "gbp", "chf", "jpy", "or", "argent", "pétrole", "énergie",
    "or et argent", "diversifié", "high yield", "investment grade", "gouvernemental",
    "inflation", "court terme", "long terme", "tech", "santé", "finance",
    "consommation", "industrie", "matières", "infrastructure", "eau", "robotique",
    "défense", "agri", "agribusiness", "métaux industriels", "métaux précieux",
    "énergie propre", "intelligence artificielle", "cybersécurité", "semi-conducteurs",
}


def parse_region(focus: str | None) -> tuple[str | None, str | None]:
    """'Actions, Monde' → ('global', 'actions')"""
    if not focus:
        return None, None
    parts = [p.strip().lower() for p in focus.split(",")]
    raw_region = parts[1].strip() if len(parts) > 1 else None
    raw_cat    = parts[0].strip() if parts else None

    region = REGION_MAP.get(raw_region, raw_region) if raw_region else None
    # REGION_MAP can explicitly return None for non-geographic terms (e.g. "vaste marché")
    if raw_region in REGION_MAP and REGION_MAP[raw_region] is None:
        region = None
    elif region and (region in NON_REGIONS or (len(region) <= 3 and region.isalpha())):
        region = None

    cat = CAT_MAP.get(raw_cat, raw_cat)
    return region, cat


def fetch_fields(session: FetcherSession, isin: str) -> dict:
    url = BASE_URL.format(isin=isin)
    try:
        r = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
        if r.status_code != 200:
            return {}
        html = r.text
    except Exception:
        return {}

    result = {}

    provider = _val(html, "tl_etf-basics_value_fund-provider")
    if provider:
        result["management_company"] = provider

    launch = _val(html, "tl_etf-basics_value_launch-date")
    if launch:
        dt = parse_date(launch)
        if dt:
            result["inception_date"] = dt

    focus = _val(html, "tl_etf-basics_value_investment-focus")
    if focus:
        region, cat = parse_region(focus)
        if region:
            result["region_exposure"] = region
        if cat:
            result["category"] = cat

    return result


def run(apply: bool, limit: int | None) -> None:
    print("=" * 60)
    print("  JustETF Fields Enricher — region/date/provider")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin,name")
            .eq("product_type", "etf")
            .or_("region_exposure.is.null,inception_date.is.null,management_company.is.null")
            .range(offset, offset + 499)
            .execute().data or []
        )
        funds.extend(batch)
        if len(batch) < 500:
            break
        offset += 500

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} ETFs à enrichir (region/date/mgmt manquants)\n")

    session    = FetcherSession(impersonate="chrome").__enter__()
    found      = not_found = 0
    now        = datetime.now(timezone.utc).isoformat()

    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]
        time.sleep(RATE_LIMIT)

        data = fetch_fields(session, isin)
        if data:
            found += 1
            if i <= 20 or i % 100 == 0:
                print(
                    f"  ✓ [{i:4d}] {isin} | "
                    f"prov:{data.get('management_company','?')[:20]} | "
                    f"reg:{data.get('region_exposure','?')} | "
                    f"date:{data.get('inception_date','?')}"
                )
            if apply:
                try:
                    client.table("investissement_funds") \
                        .update({**data, "updated_at": now}) \
                        .eq("isin", isin) \
                        .execute()
                except Exception as e:
                    if found <= 3:
                        print(f"  ✗ DB {isin}: {e}")
        else:
            not_found += 1
            if i <= 10 or i % 200 == 0:
                print(f"  ✗ [{i:4d}] {isin} | not found | {name}")

    print(f"\n  → {found} enrichis, {not_found} non trouvés")
    if apply:
        log_run("justetf-fields-enricher", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
