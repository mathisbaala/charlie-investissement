#!/usr/bin/env python3
"""
boursorama-srri-fill.py — SRRI pour OPCVM qui ont déjà perf_1y mais pas de SRRI
=================================================================================
Cible : OPCVM/ETF avec performance_1y remplie mais srri IS NULL.
Boursorama est la seule source gratuite qui expose le SRRI (jauge 1-7).

Usage :
    python3 scripts/scrapers/boursorama-srri-fill.py [--apply] [--limit N]
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

WORKERS    = 3
RATE_LIMIT = 0.8
TIMEOUT    = 15

BOURSO_URL     = "https://www.boursorama.com/bourse/opcvm/cours/{isin}/"
BOURSO_ETF_URL = "https://www.boursorama.com/bourse/trackers/cours/{isin}/"
BOURSO_GENERIC = "https://www.boursorama.com/cours/{isin}/"

SKIP_PATTERNS = (
    "fonds dédié", "***", "fcpe ", "ficpv ",
    "fcpr", "fcpi", " fip ", "fpci", " slp", "co-invest",
    "compartiment ", "novaxia", "tikehau", "arkea",
)


def _pct(s: str | None) -> float | None:
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


def _parse_aum(s: str | None) -> int | None:
    if not s:
        return None
    s = s.split("/")[0].strip()
    s = s.replace("\xa0", " ").replace(",", ".")
    m = re.match(r"([\d\s.]+)\s*(Mrd|Md|M|B|K)?", s.strip(), re.IGNORECASE)
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


def fetch_boursorama(sess: FetcherSession, isin: str) -> dict:
    urls = [
        BOURSO_URL.format(isin=isin),
        BOURSO_ETF_URL.format(isin=isin),
        BOURSO_GENERIC.format(isin=isin),
    ]
    result: dict = {}
    html = ""

    for url in urls:
        try:
            page = sess.get(url, stealthy_headers=True, timeout=TIMEOUT)
            if page.status == 200 and (len(page.body) if page.body else 0) > 10000:
                html = page.body.decode("utf-8")
                break
        except Exception:
            continue

    if not html:
        return {}

    # SRRI (jauge 1-7)
    srri_m = re.search(r'data-gauge-current-step="(\d+)"', html)
    if srri_m:
        v = int(srri_m.group(1))
        if 1 <= v <= 7:
            result["srri"] = v
            result["sri"] = v

    # Performances (backfill si manquantes)
    cell = r"<td[^>]*>\s*([^<]*?)\s*</td>"
    perf_m = re.search(
        r"FONDS\s*</th>" + (r"\s*" + cell) * 7,
        html, re.DOTALL | re.IGNORECASE,
    )
    if not perf_m:
        perf_m = re.search(
            r"FONDS\s*</th>" + (r"\s*" + cell) * 4,
            html, re.DOTALL | re.IGNORECASE,
        )
    if perf_m:
        n = perf_m.lastindex
        vals = [perf_m.group(i + 1).strip() for i in range(n)]
        p1 = _pct(vals[3]) if n > 3 else None
        p3 = _pct(vals[4]) if n > 4 else None
        p5 = _pct(vals[5]) if n > 5 else None
        if p1 is not None:
            result["performance_1y"] = p1
        if p3 is not None:
            result["performance_3y"] = p3
        if p5 is not None:
            result["performance_5y"] = p5

    # AUM
    aum_m = re.search(r"Actif net[^<]*</p>[^<]*<p[^>]*>\s*([^<\n]+)", html, re.IGNORECASE)
    if aum_m:
        aum = _parse_aum(aum_m.group(1).strip())
        if aum and aum > 0:
            result["aum_eur"] = aum

    # MS rating
    ms_m = re.search(r"Notation Morningstar\s+(\d)\s+[éeè]toile", html, re.IGNORECASE)
    if ms_m:
        v = int(ms_m.group(1))
        if 1 <= v <= 5:
            result["morningstar_rating"] = v

    return result


def run(apply: bool, limit: int | None):
    print("=" * 60)
    print("  Boursorama SRRI Fill — srri pour OPCVM sans SRRI")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    funds: list[dict] = []
    page_size = 1000
    offset = 0

    # Cible : OPCVM/ETF avec perf_1y remplie mais SRRI absent
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin, name, product_type, aum_eur")
            .in_("product_type", ["opcvm", "etf"])
            .not_.is_("performance_1y", "null")
            .is_("srri", "null")
            .is_("sri", "null")
            .order("aum_eur", desc=True, nullsfirst=False)
            .range(offset, offset + page_size - 1)
            .execute().data or []
        )
        clean = [
            r for r in batch
            if not any(p in (r.get("name") or "").lower() for p in SKIP_PATTERNS)
        ]
        funds.extend(clean)
        if len(batch) < page_size:
            break
        if limit and len(funds) >= limit:
            break
        offset += page_size

    if limit:
        funds = funds[:limit]

    print(f"  {len(funds)} fonds OPCVM/ETF avec perf_1y mais sans SRRI")
    print()

    found = failed = 0
    lock = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, failed
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        local_sess = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT)
        data = fetch_boursorama(local_sess, isin)

        with lock:
            if data.get("srri") is not None:
                found += 1
                if apply:
                    upsert_fund({"isin": isin, **data})
                if i <= 30 or i % 200 == 0:
                    srri = data.get("srri", "?")
                    p1 = f"{data['performance_1y']:+.1f}%" if data.get("performance_1y") is not None else "—"
                    aum = f"{data['aum_eur']//1_000_000}M" if data.get("aum_eur") else "—"
                    print(f"  ✓ [{i:5d}] {isin} | SRRI:{srri} | p1={p1:8} | AUM:{aum:8} | {name}")
            else:
                failed += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ✗ [{i:5d}] {isin} | no SRRI | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} SRRI enrichis, {failed} non trouvés")

    if apply:
        log_run("boursorama-srri-fill", "success", found, failed, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Boursorama SRRI Fill")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
