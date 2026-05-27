#!/usr/bin/env python3
"""
morningstar-enhanced.py — Données Morningstar enrichies
========================================================
Collecte depuis Morningstar France les données financières des fonds
qui n'ont pas encore de métriques complètes :
  - Notation Morningstar (1-5 étoiles)
  - Catégorie Morningstar (Actions US Large Cap, etc.)
  - Performance 1Y/3Y/5Y officielles
  - Volatilité / Sharpe (Morningstar calcule ces métriques)
  - Indice de référence
  - Frais courants (TER)
  - Actifs sous gestion (AUM)
  - SFDR Article
  - SRI

Sources :
  1. API Morningstar publique (search + détail)
  2. Pages fonds publiques morningstar.fr

Usage :
    python3 scripts/scrapers/morningstar-enhanced.py [--apply] [--limit N]
    python3 scripts/scrapers/morningstar-enhanced.py --apply  (tous les fonds sans note)
"""

import re
import sys
import time
import json
import argparse
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, quote

from scrapling.fetchers import FetcherSession, StealthyFetcher

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, update_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

RATE_LIMIT = 0.6
TIMEOUT    = 15
WORKERS    = 5

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "application/json, text/html, */*",
    "Referer":         "https://www.morningstar.fr/fr/",
}

MS_SEARCH_URL  = "https://www.morningstar.fr/fr/util/SecuritySearch.ashx"
MS_DETAIL_URL  = "https://www.morningstar.fr/fr/funds/snapshot/snapshot.aspx"
MS_API_BASE    = "https://api.morningstar.com"

# API Morningstar non-documentée (reverse-engineered)
MS_FUND_SEARCH = "https://www.morningstar.fr/fr/util/SecuritySearch.ashx?q={isin}&limit=1&universe=FOUSA%2CFOESP"
MS_FUND_DETAIL = "https://www.morningstar.fr/fr/funds/snapshot/snapshot.aspx?id={ms_id}&tab=0"

# ─── Fallback StealthyFetcher ──────────────────────────────────────────────────

_stealth_mode = threading.Event()


def _is_blocked(page) -> bool:
    if page.status not in (200, 201):
        return True
    if not page.body or len(page.body) < 10:
        return True
    return False


def _ms_get(session: FetcherSession, url: str, params: dict | None = None) -> object:
    params = params or {}
    if not _stealth_mode.is_set():
        page = session.get(url, params=params, stealthy_headers=True, timeout=TIMEOUT)
        if not _is_blocked(page):
            return page
        _stealth_mode.set()
        print("\n  ⚠️  Blocage Morningstar détecté → StealthyFetcher (Chrome headless) activé")
    full_url = f"{url}?{urlencode(params)}" if params else url
    return StealthyFetcher.fetch(full_url, headless=True, network_idle=True)


def parse_ter(s) -> float | None:
    if not s:
        return None
    try:
        val = float(str(s).replace(",", ".").replace("%", "").strip())
        if 0 < val < 20:
            return round(val / 100 if val > 1 else val, 6)
    except (ValueError, TypeError):
        pass
    return None


def parse_perf(s) -> float | None:
    if not s:
        return None
    try:
        val = float(str(s).replace(",", ".").replace("%", "").strip())
        if -100 < val < 1000:
            return round(val, 2)
    except (ValueError, TypeError):
        pass
    return None


def _parse_ms_text(text: str) -> list[dict]:
    """Parse la réponse text/plain de SecuritySearch.ashx (format pipe-séparé)."""
    results = []
    for line in text.strip().splitlines():
        parts = line.split("|")
        if len(parts) >= 2:
            try:
                obj = json.loads(parts[1])
                results.append(obj)
            except (ValueError, IndexError):
                pass
    return results


def search_morningstar(session: FetcherSession, isin: str, name: str = "") -> dict | None:
    """Cherche un fonds sur Morningstar et retourne ses données (sr=rating, etc.)."""
    for query in [isin] + ([name[:30]] if name else []):
        if not query:
            continue
        try:
            url = "https://www.morningstar.fr/fr/util/SecuritySearch.ashx"
            params = {
                "q": query,
                "limit": "3",
                "universe": "FOUSA,FOESP,FR",
                "preferedList": "",
                "clients": "undefined",
            }
            page = _ms_get(session, url, params)
            if page.status != 200:
                continue
            results = _parse_ms_text(page.body.decode("utf-8"))
            if not results:
                continue
            # Pour une recherche par ISIN, prendre le premier résultat
            if query == isin:
                return results[0]
            # Pour une recherche par nom, vérifier la similarité
            q_upper = query.upper()
            for r in results:
                r_name = (r.get("n") or "").upper()
                if q_upper[:12] in r_name or r_name[:12] in q_upper:
                    return r
        except Exception:
            pass
    return None


def search_morningstar_id(session: FetcherSession, isin: str, name: str = "") -> str | None:
    """Rétrocompat : retourne juste l'ID."""
    r = search_morningstar(session, isin, name)
    return (r or {}).get("i") if r else None


def fetch_morningstar_data(session: FetcherSession, isin: str, name: str = "") -> dict | None:
    """
    Récupère les données financières Morningstar pour un ISIN.
    Utilise plusieurs endpoints dans l'ordre de fiabilité.
    """
    result = {}

    # Étape 1 : chercher via l'API de recherche (retourne sr=rating directement)
    ms_obj = search_morningstar(session, isin, name=name)
    ms_id = (ms_obj or {}).get("i")

    # Extraire le rating directement depuis la réponse de recherche
    if ms_obj:
        sr = ms_obj.get("sr")
        if sr and str(sr).strip().isdigit() and 1 <= int(sr) <= 5:
            result["morningstar_rating"] = int(sr)

    # Étape 2 : page fonds Morningstar
    for page_url in [
        f"https://www.morningstar.fr/fr/funds/snapshot/snapshot.aspx?id={isin}&tab=0",
        f"https://www.morningstar.fr/fr/funds/snapshot/snapshot.aspx?id={ms_id}&tab=0" if ms_id else None,
        f"https://www.morningstar.fr/fr/etf/snapshot/snapshot.aspx?id={isin}&tab=0",
    ]:
        if not page_url:
            continue
        try:
            time.sleep(RATE_LIMIT * 0.5)
            page = _ms_get(session, page_url)
            if page.status != 200:
                continue

            html = page.body.decode("utf-8")

            # Notation Morningstar (1-5 étoiles)
            # Dans le HTML, souvent sous forme de data-rating ou de texte "★★★★"
            star_patterns = [
                r'data-rating="(\d)"',
                r'starRating["\s:]+(\d)',
                r'"starRating"\s*:\s*(\d)',
                r'"overallRating"\s*:\s*(\d)',
                r'class=".*?star.*?(\d).*?rated',
            ]
            for pat in star_patterns:
                m = re.search(pat, html, re.IGNORECASE)
                if m and 1 <= int(m.group(1)) <= 5:
                    result["morningstar_rating"] = int(m.group(1))
                    break

            # Frais courants
            ter_patterns = [
                r"Frais courants[^\d%]*(\d+[.,]\d+)\s*%",
                r"Ongoing charges[^\d%]*(\d+[.,]\d+)\s*%",
                r"Total expense ratio[^\d%]*(\d+[.,]\d+)\s*%",
                r'"netExpenseRatio"\s*:\s*"?(\d+[.,]\d+)"?',
                r'"annualReportExpenseRatio"\s*:\s*(\d+[.,]\d+)',
            ]
            for pat in ter_patterns:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    ter = parse_ter(m.group(1))
                    if ter:
                        result["ter"] = ter
                        result["ongoing_charges"] = ter
                        break

            # Performances
            perf_patterns_1y = [
                r"1 an[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
                r"Perf\s+1\s+an[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
                r'"returns1Year"\s*:\s*([+-]?\d+[.,]\d+)',
                r'"trailingReturnY1"\s*:\s*([+-]?\d+[.,]\d+)',
            ]
            for pat in perf_patterns_1y:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    p = parse_perf(m.group(1))
                    if p is not None:
                        result["performance_1y"] = p
                        break

            perf_patterns_3y = [
                r"3 ans?[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
                r'"returns3Year"\s*:\s*([+-]?\d+[.,]\d+)',
                r'"trailingReturnY3"\s*:\s*([+-]?\d+[.,]\d+)',
            ]
            for pat in perf_patterns_3y:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    p = parse_perf(m.group(1))
                    if p is not None:
                        result["performance_3y"] = p
                        break

            # AUM
            aum_patterns = [
                r"Actif[s]?\s+g[eé]r[eé][s]?[^\d]*(\d[\d\s,.]*)(?:\s*(M€|Md€|M\$|Md\$|million|milliard))",
                r'"totalAssets"\s*:\s*([0-9]+)',
                r'"fundAum"\s*:\s*([0-9]+)',
            ]
            for pat in aum_patterns:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    try:
                        val_str = m.group(1).replace(",", ".").replace("\xa0", "").replace(" ", "")
                        unit = m.group(2).lower() if len(m.groups()) > 1 else ""
                        mult = 1_000_000_000 if "md" in unit or "milliard" in unit else 1_000_000 if "m" in unit else 1
                        result["aum_eur"] = int(float(val_str) * mult)
                        break
                    except (ValueError, TypeError, IndexError):
                        pass

            # Catégorie Morningstar
            cat_patterns = [
                r'"categoryName"\s*:\s*"([^"]+)"',
                r"Catégorie Morningstar[^\n]*?([A-ZÀ-Ú][^<\n]{10,60})",
            ]
            for pat in cat_patterns:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    cat = m.group(1).strip()
                    if len(cat) > 5:
                        result["category"] = cat[:100]
                        break

            # SFDR
            sfdr_m = re.search(r"article\s*([689])\s*(?:SFDR|du règlement)", html, re.IGNORECASE)
            if sfdr_m:
                result["sfdr_article"] = int(sfdr_m.group(1))

            # SRI
            sri_m = re.search(r"(?:SRI|Risque)[^\d]*(\d)\s*/\s*7", html, re.IGNORECASE)
            if sri_m and 1 <= int(sri_m.group(1)) <= 7:
                result["sri"] = int(sri_m.group(1))

            if result:
                break

        except Exception:
            continue

    # Étape 3 : API rapide Morningstar (données JSON)
    if not result.get("morningstar_rating") and ms_id:
        try:
            api_url = (
                f"https://www.morningstar.fr/fr/funds/snapshot/snapshot.aspx"
                f"?id={ms_id}&tab=0&itype=3"
            )
            page = _ms_get(session, api_url)
            if page.status == 200:
                try:
                    data = json.loads(page.body.decode("utf-8"))
                    # Chercher les données dans la réponse JSON
                    if isinstance(data, dict):
                        rating = data.get("Rating") or data.get("starRating") or data.get("overallRating")
                        if rating and 1 <= int(rating) <= 5:
                            result["morningstar_rating"] = int(rating)
                except Exception:
                    pass
        except Exception:
            pass

    return result if result else None


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Morningstar Enhanced — Notations + Performances")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Récupérer les fonds sans notation Morningstar, par ordre d'AUM décroissant
    all_funds = []
    page_size = 1000
    offset    = 0
    while True:
        q = client.table("investissement_funds") \
            .select("isin, name, management_company, aum_eur") \
            .in_("product_type", ["opcvm", "etf"]) \
            .is_("morningstar_rating", "null") \
            .order("aum_eur", desc=True) \
            .range(offset, offset + page_size - 1)
        resp = q.execute()
        batch = resp.data or []
        all_funds.extend(batch)
        if len(batch) < page_size:
            break
        if limit and len(all_funds) >= limit:
            all_funds = all_funds[:limit]
            break
        offset += page_size

    # Filtrer les fonds dédiés institutionnels non publics
    SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ", "spécial ")
    all_funds = [
        f for f in all_funds
        if not any(p in (f.get("name") or "").lower() for p in SKIP_PATTERNS)
        and f.get("aum_eur") is not None  # forcer les fonds avec AUM connu
    ]

    print(f"  {len(all_funds)} fonds sans notation Morningstar (hors institutionnels)")
    print()

    found = 0
    not_found = 0
    updates = []

    with FetcherSession(impersonate="chrome").__enter__() as session:
        for i, fund in enumerate(all_funds, 1):
            isin = fund["isin"]
            name = (fund.get("name") or "")[:40]

            time.sleep(RATE_LIMIT)
            data = fetch_morningstar_data(session, isin, name=name)

            if data:
                found += 1
                updates.append({"isin": isin, **data})

                if apply and len(updates) >= 50:
                    ok, fail = update_funds_bulk(updates, batch_size=50)
                    print(f"  [batch] {ok} OK, {fail} échec")
                    updates = []

                if i <= 30 or i % 100 == 0:
                    rating = data.get("morningstar_rating", "?")
                    ter_pct = f"{data.get('ter', 0)*100:.2f}%" if data.get("ter") else "N/A"
                    print(f"  ✓ [{i:4d}] {isin} | ★{rating} | TER:{ter_pct} | {name}")
            else:
                not_found += 1
                if i <= 10 or i % 200 == 0:
                    print(f"  ✗ [{i:4d}] {isin} | {name}")

    # Flush final
    if apply and updates:
        ok, fail = update_funds_bulk(updates, batch_size=50)
        print(f"  [flush final] {ok} OK, {fail} échec")

    print()
    print(f"  ✓ {found} fonds enrichis, {not_found} introuvables")

    if apply:
        log_run("morningstar-enhanced", "success", found, not_found, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Morningstar Enhanced")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
