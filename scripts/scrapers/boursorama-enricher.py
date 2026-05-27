#!/usr/bin/env python3
"""
boursorama-enricher.py — Enrichissement complet depuis Boursorama
=================================================================
Pour chaque fonds sans performance_1y, visite la page Boursorama et extrait :
  - Performance 1Y, 3Y, 5Y, 10Y
  - SRRI (indicateur risque 1-7)
  - Notation Morningstar (1-5 étoiles)
  - AUM / Actif net en EUR
  - TER / Frais courants

Source : pages publiques Boursorama (HTML statique, pas de JS nécessaire)
URL    : https://www.boursorama.com/bourse/opcvm/cours/{ISIN}/

Usage :
    python3 scripts/scrapers/boursorama-enricher.py [--apply] [--limit N] [--isin ISIN]
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

RATE_LIMIT = 0.6
WORKERS    = 4
TIMEOUT    = 15

BOURSO_URL     = "https://www.boursorama.com/bourse/opcvm/cours/{isin}/"
BOURSO_ETF_URL = "https://www.boursorama.com/bourse/trackers/cours/{isin}/"


def parse_pct(s: str | None) -> float | None:
    if not s:
        return None
    s = s.replace(",", ".").replace("%", "").replace("\xa0", "").replace(" ", "").strip()
    try:
        val = float(s)
        if -100 < val < 10000:
            return round(val, 2)
    except ValueError:
        pass
    return None


def parse_aum(s: str | None) -> int | None:
    if not s:
        return None
    s = s.replace("\xa0", "").replace(" ", "").replace(",", ".")
    m = re.match(r"([\d.]+)(M|Mrd|Md|B|K)?", s, re.IGNORECASE)
    if not m:
        return None
    try:
        val = float(m.group(1))
        unit = (m.group(2) or "").lower()
        if unit in ("mrd", "md", "b"):
            val *= 1_000_000_000
        elif unit in ("m",):
            val *= 1_000_000
        elif unit in ("k",):
            val *= 1_000
        return int(val)
    except (ValueError, TypeError):
        return None


def fetch_boursorama(session: FetcherSession, isin: str) -> dict:
    """Scrape la page Boursorama et retourne toutes les données disponibles."""
    urls = [
        BOURSO_URL.format(isin=isin),
        BOURSO_ETF_URL.format(isin=isin),
        f"https://www.boursorama.com/cours/{isin}/",
    ]
    result = {}
    html = ""

    for url in urls:
        try:
            page = session.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if page.status == 200 and (len(page.body) if page.body else 0) > 1000:
                html = page.body.decode("utf-8")
                break
        except Exception:
            continue

    if not html:
        return {}

    # ── Performances 1Y / 3Y / 5Y ──────────────────────────────────────
    # Table columns: 1er JANV | 1 MOIS | 6 MOIS | 1 AN | 3 ANS | 5 ANS | 10 ANS
    # FONDS row is the first tbody row; capture all 7 cells and pick by index
    cell = r'<td[^>]*>\s*([^<]*?)\s*</td>'
    perf_m = re.search(
        r"FONDS\s*</th>" + (r"\s*" + cell) * 7,
        html, re.DOTALL | re.IGNORECASE,
    )
    if not perf_m:
        # Fallback: some pages have fewer trailing cells
        perf_m = re.search(
            r"FONDS\s*</th>" + (r"\s*" + cell) * 4,
            html, re.DOTALL | re.IGNORECASE,
        )
    if perf_m:
        n = perf_m.lastindex
        vals = [perf_m.group(i + 1).strip() for i in range(n)]
        # Indices: 0=1erJANV, 1=1MOIS, 2=6MOIS, 3=1AN, 4=3ANS, 5=5ANS, 6=10ANS
        p1 = parse_pct(vals[3]) if n > 3 else None
        p3 = parse_pct(vals[4]) if n > 4 else None
        p5 = parse_pct(vals[5]) if n > 5 else None
        if p1 is not None:
            result["performance_1y"] = p1
        if p3 is not None:
            result["performance_3y"] = p3
        if p5 is not None:
            result["performance_5y"] = p5

    # ── SRRI (jauge 1-7) ───────────────────────────────────────────────
    srri_m = re.search(r'data-gauge-current-step="(\d+)"', html)
    if srri_m:
        v = int(srri_m.group(1))
        if 1 <= v <= 7:
            result["srri"] = v
            result["sri"] = v

    # ── Notation Morningstar ───────────────────────────────────────────
    ms_m = re.search(r"Notation Morningstar\s+(\d)\s+étoile", html, re.IGNORECASE)
    if ms_m:
        v = int(ms_m.group(1))
        if 1 <= v <= 5:
            result["morningstar_rating"] = v

    # ── AUM / Actif net ────────────────────────────────────────────────
    aum_ctx = re.search(r"Actif net[^<]*</p>[^<]*<p[^>]*>\s*([^<\n]+)", html, re.IGNORECASE)
    if aum_ctx:
        raw = aum_ctx.group(1).strip().split("/")[0].strip()
        m = re.match(r"([\d\s]+(?:[.,]\d+)?)\s*(Mrd|M|Md|B|K)?", raw.replace("\xa0", " "), re.IGNORECASE)
        if m:
            num_str = m.group(1).replace(" ", "").replace(",", ".")
            unit = (m.group(2) or "M").lower()
            try:
                num = float(num_str)
                if unit in ("mrd", "md", "b"):
                    result["aum_eur"] = int(num * 1_000_000_000)
                else:
                    result["aum_eur"] = int(num * 1_000_000)
            except ValueError:
                pass

    # ── TER / Frais courants ───────────────────────────────────────────
    for pat in [
        r"frais courants[^%\d]*(\d+[.,]\d+)\s*%",
        r"charges courantes[^%\d]*(\d+[.,]\d+)\s*%",
    ]:
        ter_m = re.search(pat, html, re.IGNORECASE)
        if ter_m:
            val_str = ter_m.group(1).replace(",", ".")
            try:
                ter = float(val_str) / 100
                if 0 < ter < 0.20:
                    result["ongoing_charges"] = round(ter, 6)
                    result["ter"] = round(ter, 6)
            except ValueError:
                pass
            break

    return result


def run(apply: bool, limit: int | None, isin_filter: str | None):
    print("=" * 60)
    print("  Boursorama Enricher — Perf + SRRI + MS Rating + AUM")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    if isin_filter:
        funds = [{"isin": isin_filter, "name": ""}]
    else:
        # Cibler les fonds FR sans SRRI (Boursorama couvre principalement les fonds FR)
        funds = []
        page_size = 1000
        offset = 0
        skip_patterns = ("fonds dédié", "***", "ficpv ", "fcpe ")
        while True:
            q = client.table("investissement_funds") \
                .select("isin, name, product_type, aum_eur") \
                .in_("product_type", ["opcvm", "etf"]) \
                .is_("srri", "null") \
                .like("isin", "FR%") \
                .order("aum_eur", desc=True) \
                .range(offset, offset + page_size - 1)
            raw_batch = q.execute().data or []
            batch = [r for r in raw_batch if not any(p in (r.get("name") or "").lower() for p in skip_patterns)]
            funds.extend(batch)
            if len(raw_batch) < page_size:
                break
            if limit and len(funds) >= limit:
                funds = funds[:limit]
                break
            offset += page_size

    print(f"  {len(funds)} fonds FR sans SRRI à enrichir")
    print()

    lock  = threading.Lock()
    found = failed = 0

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, failed
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT)
        data = fetch_boursorama(session, isin)

        # Stocker dès qu'on a au moins SRRI ou performance_1y
        has_data = data.get("srri") is not None or data.get("performance_1y") is not None
        with lock:
            if has_data:
                found += 1
                if apply:
                    upsert_fund({"isin": isin, **data})
                if i <= 30 or i % 200 == 0:
                    p1 = f"{data.get('performance_1y', 0):+.1f}%" if data.get("performance_1y") is not None else "N/A"
                    srri = data.get("srri", "?")
                    ms = f"★{data.get('morningstar_rating')}" if data.get("morningstar_rating") else "★?"
                    ter_pct = f"{data.get('ongoing_charges', 0)*100:.2f}%" if data.get("ongoing_charges") else "N/A"
                    print(f"  ✓ [{i:5d}] {isin} | {p1:7} | SRRI:{srri} | {ms} | TER:{ter_pct} | {name}")
            else:
                failed += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ✗ [{i:5d}] {isin} | no data | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} fonds enrichis, {failed} non trouvés")

    if apply:
        log_run("boursorama-enricher", "success", found, failed, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Boursorama Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    parser.add_argument("--isin", type=str, help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
