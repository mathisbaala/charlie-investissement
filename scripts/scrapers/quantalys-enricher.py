#!/usr/bin/env python3
"""
quantalys-enricher.py — TER + perf + AUM + SRI depuis Quantalys
================================================================
Quantalys est un agrégateur français de données de fonds. Leurs pages publiques
contiennent : TER (frais courants), performance 1Y/3Y/5Y, AUM, SRRI/SRI,
catégorie, SFDR article.

Cible : fonds OPCVM/ETF sans performance_1y OU sans TER, triés par AUM décroissant.

URL : https://www.quantalys.com/fonds/{ISIN}

Usage :
    python3 scripts/scrapers/quantalys-enricher.py [--apply] [--limit N]
    python3 scripts/scrapers/quantalys-enricher.py --apply             (tous)
    python3 scripts/scrapers/quantalys-enricher.py --apply --ter-only  (seulement TER manquant)
"""

import re
import sys
import json
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

WORKERS        = 4
RATE_LIMIT_SEC = 1.0
TIMEOUT        = 15

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
    "Referer":         "https://www.quantalys.com/",
}

FUND_URL = "https://www.quantalys.com/fonds/{isin}"


# ─── Parseurs ─────────────────────────────────────────────────────────────────

def _pct(s: str | None) -> float | None:
    if not s:
        return None
    try:
        val = float(str(s).replace(",", ".").replace("%", "").replace("\xa0", "").replace(" ", "").strip())
        if -100 < val < 10_000:
            return round(val, 2)
    except ValueError:
        pass
    return None

def _ter(s: str | None) -> float | None:
    """Convertit 0.85 (%) en 0.0085 (fraction)."""
    v = _pct(s)
    if v is not None and 0 < v < 20:
        return round(v / 100, 6)
    return None

def _aum(raw: str | None) -> int | None:
    if not raw:
        return None
    raw = raw.replace("\xa0", " ").replace(",", ".").strip()
    m = re.match(r"([\d\s.]+)\s*(Mrd|Md|M|K|B)?", raw, re.IGNORECASE)
    if not m:
        return None
    try:
        num = float(m.group(1).replace(" ", ""))
        unit = (m.group(2) or "M").lower()
        if unit in ("mrd", "md", "b"):
            return int(num * 1_000_000_000)
        if unit == "k":
            return int(num * 1_000)
        return int(num * 1_000_000)
    except (ValueError, TypeError):
        return None


# ─── Scraper Quantalys ────────────────────────────────────────────────────────

def fetch_quantalys(session: FetcherSession, isin: str) -> dict:
    """
    Scrape la page fonds Quantalys.
    Extrait : TER, performance 1Y/3Y/5Y, AUM, SRI, SFDR article, catégorie.
    """
    url = FUND_URL.format(isin=isin)
    result: dict = {}

    try:
        page = session.get(url, stealthy_headers=True, timeout=TIMEOUT, allow_redirects=True)
        if page.status != 200 or len(page.body.decode("utf-8")) < 500:
            return {}
        html = page.body.decode("utf-8")

        # ── Vérifier qu'on est bien sur une page fonds ──────────────────
        if isin not in html and "fonds introuvable" in html.lower():
            return {}

        # ── JSON embarqué (data island) ─────────────────────────────────
        json_blobs = re.findall(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', html, re.DOTALL)
        fund_json: dict = {}
        for blob in json_blobs:
            try:
                obj = json.loads(blob.strip())
                if isinstance(obj, dict) and any(k in obj for k in ("ter", "performance", "sri", "isin", "encours")):
                    fund_json = obj
                    break
            except (ValueError, TypeError):
                continue

        # ── TER / Frais courants ────────────────────────────────────────
        # From JSON
        ter_val = fund_json.get("ter") or fund_json.get("frais_courants") or fund_json.get("ongoingCharges")
        if not ter_val:
            # From HTML patterns
            for pat in [
                r"frais\s+courants[^\d%]*(\d+[.,]\d+)\s*%",
                r"charges\s+courantes[^\d%]*(\d+[.,]\d+)\s*%",
                r"TER[^\d%]*(\d+[.,]\d+)\s*%",
                r"Total\s+Expense\s+Ratio[^\d%]*(\d+[.,]\d+)\s*%",
                r'"ter"[^:]*:\s*"?(\d+[.,]\d+)"?',
                r'"frais_courants"[^:]*:\s*"?(\d+[.,]\d+)"?',
                r"Frais\s+courants[^<\d%]*(\d+[.,]\d+)\s*%",
            ]:
                m = re.search(pat, html, re.IGNORECASE)
                if m:
                    ter_val = m.group(1)
                    break

        ter = _ter(str(ter_val)) if ter_val else None
        if ter:
            result["ter"] = ter
            result["ongoing_charges"] = ter

        # ── Performances ────────────────────────────────────────────────
        # Quantalys affiche les performances en % sur 1/3/5 ans
        perf_patterns = {
            "performance_1y": [
                r"perf(?:ormance)?\s+1\s*an[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
                r"1\s*an\s*[:|]\s*([+-]?\d+[.,]\d+)\s*%",
                r'"performance_1an"[^:]*:\s*"?([+-]?\d+[.,]\d+)"?',
                r'"perf_1y"[^:]*:\s*"?([+-]?\d+[.,]\d+)"?',
                r"Rendement\s+1\s*an[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
            ],
            "performance_3y": [
                r"perf(?:ormance)?\s+3\s*ans?[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
                r'"performance_3ans"[^:]*:\s*"?([+-]?\d+[.,]\d+)"?',
                r'"perf_3y"[^:]*:\s*"?([+-]?\d+[.,]\d+)"?',
            ],
            "performance_5y": [
                r"perf(?:ormance)?\s+5\s*ans?[^\d%-]*([+-]?\d+[.,]\d+)\s*%",
                r'"performance_5ans"[^:]*:\s*"?([+-]?\d+[.,]\d+)"?',
                r'"perf_5y"[^:]*:\s*"?([+-]?\d+[.,]\d+)"?',
            ],
        }
        for field, patterns in perf_patterns.items():
            for pat in patterns:
                m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
                if m:
                    val = _pct(m.group(1))
                    if val is not None:
                        result[field] = val
                        break

        # ── AUM / Encours ────────────────────────────────────────────────
        aum_patterns = [
            r"[Ee]ncours[^\d]*(\d[\d\s,.]*)\s*(Mrd|M|K|Md)?[^%\d]",
            r"Actif[s]?\s+net[s]?[^\d]*(\d[\d\s,.]*)\s*(Mrd€|M€|Md€|M|Mrd)?",
            r'"aum"[^:]*:\s*"?(\d+)"?',
            r'"encours"[^:]*:\s*"?(\d+)"?',
        ]
        for pat in aum_patterns:
            m = re.search(pat, html, re.IGNORECASE)
            if m:
                raw_num = m.group(1).replace(" ", "").replace("\xa0", "")
                unit = m.group(2).strip() if len(m.groups()) > 1 and m.group(2) else "M"
                aum = _aum(f"{raw_num} {unit}")
                if aum and aum > 0:
                    result["aum_eur"] = aum
                    break

        # ── SRI / SRRI ──────────────────────────────────────────────────
        for pat in [
            r'(?:SRI|SRRI|indicateur\s+de\s+risque)[^\d]*(\d)\s*/\s*7',
            r'"srri?"[^:]*:\s*"?(\d)"?',
            r'"sri"[^:]*:\s*"?(\d)"?',
            r'data-srri="(\d)"',
            r'data-sri="(\d)"',
        ]:
            m = re.search(pat, html, re.IGNORECASE)
            if m and 1 <= int(m.group(1)) <= 7:
                result["sri"] = int(m.group(1))
                result["srri"] = int(m.group(1))
                break

        # ── SFDR Article ────────────────────────────────────────────────
        sfdr_m = re.search(r"[Aa]rticle\s*([689])\s*(?:SFDR|du\s+r[eè]glement\s+SFDR|PRIIPs)?", html)
        if sfdr_m:
            result["sfdr_article"] = int(sfdr_m.group(1))

        # ── Notation Morningstar ────────────────────────────────────────
        ms_m = re.search(r"[Nn]otation\s+Morningstar[^\d]*(\d)\s+[eé]toile", html)
        if ms_m and 1 <= int(ms_m.group(1)) <= 5:
            result["morningstar_rating"] = int(ms_m.group(1))

    except Exception:
        pass

    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def _query_funds(client, filters: dict, seen: set, page_size: int = 1000) -> list[dict]:
    """Requête paginée avec nulls-last simulé : AUM connu d'abord, NULL ensuite."""
    results: list[dict] = []
    for with_aum in (True, False):
        offset = 0
        while True:
            q = (
                client.table("investissement_funds")
                .select("isin, name, product_type, management_company")
                .in_("product_type", ["opcvm", "etf"])
            )
            for k, v in filters.items():
                q = q.is_(k, v)
            if with_aum:
                q = q.not_.is_("aum_eur", "null").order("aum_eur", desc=True)
            batch = q.range(offset, offset + page_size - 1).execute().data or []
            for row in batch:
                if row["isin"] not in seen:
                    seen.add(row["isin"])
                    results.append(row)
            if len(batch) < page_size:
                break
            offset += page_size
    return results


def fetch_target_funds(client, ter_only: bool, limit: int | None) -> list[dict]:
    funds: list[dict] = []
    seen: set = set()

    if not ter_only:
        funds.extend(_query_funds(client, {"performance_1y": "null"}, seen))

    # Fonds sans TER (quelle que soit la perf)
    funds.extend(_query_funds(client, {"ter": "null", "ongoing_charges": "null"}, seen))

    if limit:
        funds = funds[:limit]
    return funds


def run(apply: bool, limit: int | None, ter_only: bool):
    print("=" * 60)
    print("  Quantalys Enricher — TER + Perf + AUM + SRI")
    print("=" * 60)
    print(f"  Mode       : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  TER seulement : {ter_only}")
    if limit:
        print(f"  Limite     : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds = fetch_target_funds(client, ter_only, limit)

    # Filtrer fonds dédiés institutionnels non présents sur Quantalys
    SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ")
    funds = [
        f for f in funds
        if not any(p in (f.get("name") or "").lower() for p in SKIP_PATTERNS)
    ]

    print(f"  {len(funds)} fonds à enrichir via Quantalys")
    print()

    found    = 0
    no_data  = 0
    lock     = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, no_data
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT_SEC)
        data = fetch_quantalys(session, isin)

        with lock:
            if data and len(data) >= 1:
                found += 1
                if apply:
                    upsert_fund({"isin": isin, **data})
                if i <= 30 or i % 200 == 0:
                    p1  = f"{data['performance_1y']:+.1f}%"  if "performance_1y"   in data else "N/A"
                    ter = f"{data['ter']*100:.2f}%"          if "ter"              in data else "N/A"
                    sri = data.get("sri", "?")
                    print(f"  ✓ [{i:5d}] {isin} | perf:{p1:7} | TER:{ter:6} | SRI:{sri} | {name}")
            else:
                no_data += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ✗ [{i:5d}] {isin} | no data | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} fonds enrichis, {no_data} sans données")

    if apply:
        log_run("quantalys-enricher", "success", found, no_data, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Quantalys Enricher")
    parser.add_argument("--apply",    action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",    type=int,            help="Limiter à N fonds")
    parser.add_argument("--ter-only", action="store_true", help="Ne cibler que les fonds sans TER")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, ter_only=args.ter_only)
