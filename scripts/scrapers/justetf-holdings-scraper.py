#!/usr/bin/env python3
"""
justetf-holdings-scraper.py — Composition ETF via JustETF (Playwright)
=======================================================================
Scrape les top holdings, la répartition sectorielle et géographique
des ETFs depuis justetf.com.

Tables alimentées :
  - investissement_fund_holdings  (top 10 positions)
  - investissement_fund_sectors   (répartition sectorielle)
  - investissement_fund_geos      (répartition géographique)

Usage :
    python3 scripts/scrapers/justetf-holdings-scraper.py
    python3 scripts/scrapers/justetf-holdings-scraper.py --apply
    python3 scripts/scrapers/justetf-holdings-scraper.py --apply --limit 50
    python3 scripts/scrapers/justetf-holdings-scraper.py --apply --isin IE00B5BMR087
"""

import sys
import re
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
except ImportError:
    print("ERREUR : playwright non installé. pip install playwright && playwright install chromium")
    sys.exit(1)

# ─── Config ───────────────────────────────────────────────────────────────────

BASE_URL     = "https://www.justetf.com/fr/etf-profile.html?isin={isin}"
RATE_LIMIT_S = 3.0
PAGE_TIMEOUT = 35_000  # ms
BATCH_SIZE   = 200

# Mots-clés pour identifier les sections répartition
SECTOR_KEYWORDS  = ["secteur", "sector", "industry", "allocation sectorielle", "sector allocation"]
GEO_KEYWORDS     = ["pays", "country", "countries", "région", "geographic", "répartition géographique"]

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _pct_to_float(s: str) -> float | None:
    """Convertit '7,57 %' ou '7.57%' en 0.0757."""
    try:
        clean = re.sub(r"[%\s\xa0]", "", s).replace(",", ".")
        v = float(clean)
        return round(v / 100, 6)
    except (ValueError, AttributeError):
        return None


def _is_pct_table(rows: list) -> bool:
    """Retourne True si la table contient au moins 3 lignes avec un pourcentage."""
    count = 0
    for row in rows[:12]:
        texts = [c.inner_text().strip() for c in row.locator("td, th").all()]
        if any("%" in t for t in texts):
            count += 1
    return count >= 3


def _extract_name_weight_rows(rows: list) -> list[dict]:
    """
    Extrait les paires (name, weight) depuis les lignes d'une table.
    Cherche la colonne qui contient % et prend la première colonne comme nom.
    """
    result = []
    for row in rows:
        cells = row.locator("td, th").all()
        texts = [c.inner_text().strip() for c in cells]
        if len(texts) < 2:
            continue
        weight_str = next((t for t in reversed(texts) if "%" in t), None)
        if not weight_str:
            continue
        weight = _pct_to_float(weight_str)
        if weight is None or weight <= 0 or weight > 1:
            continue
        name = texts[0] if texts[0] else None
        if not name or len(name) < 2 or name.startswith("#"):
            continue
        result.append({"name": name[:200], "weight": weight})
    return result


def _find_section_table(page, keywords: list[str]) -> list | None:
    """
    Cherche une section par ses mots-clés et retourne les lignes
    de la table la plus proche.
    """
    for kw in keywords:
        try:
            headers = page.locator(f"text=/{kw}/i").all()
            for h in headers:
                parent = h.locator("../../..")
                t = parent.locator("table")
                if t.count() > 0:
                    rows = t.first.locator("tr").all()
                    if len(rows) > 2:
                        return rows
        except Exception:
            continue
    return None


def scrape_etf(page, isin: str) -> dict | None:
    """
    Retourne un dict avec holdings / sectors / geos ou None si échec.
    """
    url = BASE_URL.format(isin=isin)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
        page.wait_for_timeout(4000)
    except PWTimeout:
        return None

    # Accept cookies
    try:
        btn = page.locator("#accept-all-button, button:has-text('Tout accepter'), button:has-text('Accept all')")
        if btn.count() > 0:
            btn.first.click()
            page.wait_for_timeout(800)
    except Exception:
        pass

    result = {"holdings": [], "sectors": [], "geos": []}

    # ─── Holdings : chercher la table avec des lignes (nom, %) ────────────────
    try:
        tables = page.locator("table").all()
        for table in tables:
            rows = table.locator("tr").all()
            if 5 <= len(rows) <= 20 and _is_pct_table(rows):
                items = _extract_name_weight_rows(rows)
                if len(items) >= 3:
                    # Exclure les tables de performance/volatilité/couverture/cotation
                    bad_kw = r"volatilit|rendement|perform|ann[eé]e|1 an|3 ans|mois|semaine|an courant|cotation|place|ticker|bloomberg|reut|\d{4}"
                    if not any(re.search(bad_kw, it["name"], re.I) for it in items[:3]):
                        for i, it in enumerate(items[:10], 1):
                            result["holdings"].append({
                                "rank": i,
                                "position_name": it["name"],
                                "weight": it["weight"],
                            })
                        break
    except Exception:
        pass

    # ─── Secteurs ─────────────────────────────────────────────────────────────
    try:
        rows = _find_section_table(page, SECTOR_KEYWORDS)
        if rows:
            items = _extract_name_weight_rows(rows)
            for it in items[:15]:
                result["sectors"].append({"label": it["name"], "weight": it["weight"]})
    except Exception:
        pass

    # ─── Géographies ──────────────────────────────────────────────────────────
    try:
        rows = _find_section_table(page, GEO_KEYWORDS)
        if rows:
            items = _extract_name_weight_rows(rows)
            for it in items[:20]:
                result["geos"].append({"label": it["name"], "weight": it["weight"]})
    except Exception:
        pass

    if not result["holdings"] and not result["sectors"] and not result["geos"]:
        return None
    return result


def save_to_db(client, isin: str, data: dict, scraped_at: str) -> dict:
    counts = {"holdings": 0, "sectors": 0, "geos": 0}

    if data["holdings"]:
        client.table("investissement_fund_holdings").delete().eq("isin", isin).execute()
        rows = [{"isin": isin, "scraped_at": scraped_at, **h} for h in data["holdings"]]
        client.table("investissement_fund_holdings").insert(rows).execute()
        counts["holdings"] = len(rows)

    if data["sectors"]:
        client.table("investissement_fund_sectors").delete().eq("isin", isin).execute()
        rows = [{"isin": isin, "scraped_at": scraped_at, "sector_name": s["label"], "weight": s["weight"]} for s in data["sectors"]]
        client.table("investissement_fund_sectors").insert(rows).execute()
        counts["sectors"] = len(rows)

    if data["geos"]:
        client.table("investissement_fund_geos").delete().eq("isin", isin).execute()
        rows = [{"isin": isin, "scraped_at": scraped_at, "country_label": g["label"], "weight": g["weight"]} for g in data["geos"]]
        client.table("investissement_fund_geos").insert(rows).execute()
        counts["geos"] = len(rows)

    return counts


def run(apply: bool, limit: int | None, isin_filter: str | None) -> None:
    print("=" * 64)
    print("  JustETF Holdings Scraper (Playwright)")
    print("=" * 64)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite: {limit}")
    if isin_filter:
        print(f"  ISIN  : {isin_filter}")
    print()

    started    = datetime.now(timezone.utc)
    client     = get_client()
    stats      = Counter()
    scraped_at = started.isoformat()

    # Sélectionner les ETFs à scraper
    if isin_filter:
        etfs = [{"isin": isin_filter.upper(), "name": "—"}]
    else:
        already_done = {
            r["isin"] for r in
            client.table("investissement_fund_holdings").select("isin").execute().data
        }
        all_etfs = client.table("investissement_funds") \
            .select("isin,name,aum_eur") \
            .eq("product_type", "etf") \
            .not_.is_("isin", "null") \
            .order("aum_eur", desc=True) \
            .execute().data
        etfs = [e for e in all_etfs if e["isin"] not in already_done]
        if limit:
            etfs = etfs[:limit]

    print(f"  ETFs à scraper : {len(etfs)}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0.0.0 Safari/537.36",
            locale="fr-FR",
            viewport={"width": 1280, "height": 900},
        )
        page = context.new_page()
        page.route("**/*.{png,jpg,jpeg,gif,woff,woff2,mp4,webp}", lambda r: r.abort())

        for i, etf in enumerate(etfs, 1):
            isin = etf["isin"]
            name = (etf.get("name") or "")[:50]

            data = scrape_etf(page, isin)
            time.sleep(RATE_LIMIT_S)

            if data is None:
                stats["error"] += 1
                print(f"  [{i:4d}] {isin} — ERREUR scraping")
                continue

            n_hold = len(data["holdings"])
            n_sec  = len(data["sectors"])
            n_geo  = len(data["geos"])

            stats["ok"] += 1
            print(f"  [{i:4d}] {isin} — {n_hold} holdings, {n_sec} secteurs, {n_geo} pays ({name})")
            if data["holdings"]:
                top = data["holdings"][0]
                print(f"         Top: {top['position_name']} {top['weight']*100:.1f}%")

            if apply:
                try:
                    save_to_db(client, isin, data, scraped_at)
                except Exception as db_err:
                    stats["db_error"] += 1
                    print(f"         DB ERROR: {db_err}")

            if i % 20 == 0:
                elapsed = (datetime.now(timezone.utc) - started).total_seconds()
                print(f"  ... {i}/{len(etfs)} — {elapsed:.0f}s — {dict(stats)}")

        context.close()
        browser.close()

    print()
    print(f"  Résultat final : {dict(stats)}")
    log_run(
        scraper="justetf-holdings",
        status="success" if apply else "partial",
        records_processed=stats.get("ok", 0),
        records_failed=stats.get("error", 0) + stats.get("db_error", 0),
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply",  action="store_true")
    parser.add_argument("--limit",  type=int, default=None)
    parser.add_argument("--isin",   type=str, default=None)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
