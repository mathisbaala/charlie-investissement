#!/usr/bin/env python3
"""
boursorama-cffi-enricher.py — Enrichissement OPCVM via Boursorama (Scrapling)
==============================================================================
Version améliorée de boursorama-enricher.py utilisant Scrapling FetcherSession pour contourner
le challenge JavaScript anti-bot de Boursorama.

Données extraites :
  - performance_1y, performance_3y, performance_5y  (tableau FONDS)
  - srri / sri  (jauge 1-7, data-gauge-current-step)
  - morningstar_rating  (1-5 étoiles)
  - aum_eur  (Actif net)

Note : Boursorama n'affiche pas le TER (frais courants) sur les pages OPCVM.

Couverture : ~90 % des OPCVM sans performance_1y (basé sur tests réels).
Les 10 % manquants sont essentiellement des fonds court terme / monétaires.

Nécessite : scrapling (pip install 'scrapling[fetchers]')

Usage :
    python3 scripts/scrapers/boursorama-cffi-enricher.py [--apply] [--limit N] [--isin ISIN]
    python3 scripts/scrapers/boursorama-cffi-enricher.py --apply            (tous)
    python3 scripts/scrapers/boursorama-cffi-enricher.py --apply --isin FR0010135103
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

WORKERS    = 3
RATE_LIMIT = 0.8          # secondes entre requêtes par worker
TIMEOUT    = 15

BOURSO_URL     = "https://www.boursorama.com/bourse/opcvm/cours/{isin}/"
BOURSO_ETF_URL = "https://www.boursorama.com/bourse/trackers/cours/{isin}/"
BOURSO_GENERIC = "https://www.boursorama.com/cours/{isin}/"

SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ")


# ─── Parseurs ─────────────────────────────────────────────────────────────────

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
    s = s.split("/")[0].strip()  # "6 643M  / 30.04.26" → "6 643M"
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


# ─── Scraper Boursorama ───────────────────────────────────────────────────────

def fetch_boursorama(sess: FetcherSession, isin: str) -> dict:
    """
    Scrape la page Boursorama et retourne : perf 1Y/3Y/5Y, SRRI, MS rating, AUM.

    scrapling FetcherSession impersonate='chrome' contourne le JS challenge (redirect) de Boursorama
    que requests standard ne peut pas suivre.
    """
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

    # ── Performances 1Y / 3Y / 5Y ──────────────────────────────────────────
    # Table colonnes : 1er JANV | 1 MOIS | 6 MOIS | 1 AN | 3 ANS | 5 ANS | 10 ANS
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
        # Indices: 0=1erJANV, 1=1MOIS, 2=6MOIS, 3=1AN, 4=3ANS, 5=5ANS, 6=10ANS
        p1 = _pct(vals[3]) if n > 3 else None
        p3 = _pct(vals[4]) if n > 4 else None
        p5 = _pct(vals[5]) if n > 5 else None
        if p1 is not None:
            result["performance_1y"] = p1
        if p3 is not None:
            result["performance_3y"] = p3
        if p5 is not None:
            result["performance_5y"] = p5

    # ── SRRI (jauge 1-7) ────────────────────────────────────────────────────
    srri_m = re.search(r'data-gauge-current-step="(\d+)"', html)
    if srri_m:
        v = int(srri_m.group(1))
        if 1 <= v <= 7:
            result["srri"] = v
            result["sri"] = v

    # ── Notation Morningstar ─────────────────────────────────────────────────
    ms_m = re.search(r"Notation Morningstar\s+(\d)\s+[éeè]toile", html, re.IGNORECASE)
    if ms_m:
        v = int(ms_m.group(1))
        if 1 <= v <= 5:
            result["morningstar_rating"] = v

    # ── AUM / Actif net ──────────────────────────────────────────────────────
    aum_m = re.search(r"Actif net[^<]*</p>[^<]*<p[^>]*>\s*([^<\n]+)", html, re.IGNORECASE)
    if aum_m:
        aum = _parse_aum(aum_m.group(1).strip())
        if aum and aum > 0:
            result["aum_eur"] = aum

    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, isin_filter: str | None) -> None:
    print("=" * 60)
    print("  Boursorama CFFI Enricher — Perf + SRRI + MS Rating + AUM")
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
        funds: list[dict] = []
        page_size = 1000
        offset = 0
        # Cibler les OPCVM/ETF sans performance_1y, triés par AUM desc
        while True:
            q = (
                client.table("investissement_funds")
                .select("isin, name, product_type, aum_eur")
                .in_("product_type", ["opcvm", "etf"])
                .is_("performance_1y", "null")
                .not_.is_("aum_eur", "null")
                .order("aum_eur", desc=True)
                .range(offset, offset + page_size - 1)
            )
            raw_batch = q.execute().data or []
            batch = [
                r for r in raw_batch
                if not any(p in (r.get("name") or "").lower() for p in SKIP_PATTERNS)
            ]
            funds.extend(batch)
            if len(raw_batch) < page_size:
                break
            if limit and len(funds) >= limit:
                funds = funds[:limit]
                break
            offset += page_size

        # Compléter avec les fonds sans AUM
        offset = 0
        while len(funds) < (limit or 50000):
            q = (
                client.table("investissement_funds")
                .select("isin, name, product_type, aum_eur")
                .in_("product_type", ["opcvm", "etf"])
                .is_("performance_1y", "null")
                .is_("aum_eur", "null")
                .range(offset, offset + page_size - 1)
            )
            raw_batch = q.execute().data or []
            batch = [
                r for r in raw_batch
                if not any(p in (r.get("name") or "").lower() for p in SKIP_PATTERNS)
            ]
            # Dédupliquer
            seen_isins = {f["isin"] for f in funds}
            batch = [r for r in batch if r["isin"] not in seen_isins]
            funds.extend(batch)
            if len(raw_batch) < page_size:
                break
            offset += page_size

        if limit:
            funds = funds[:limit]

    print(f"  {len(funds)} fonds à enrichir via Boursorama")
    print()

    found = failed = 0
    lock = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, failed
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        # Chaque thread crée sa propre session scrapling
        local_sess = FetcherSession(impersonate="chrome").__enter__()

        time.sleep(RATE_LIMIT)
        data = fetch_boursorama(local_sess, isin)

        # Valider : au moins SRRI ou performance_1y
        has_data = data.get("srri") is not None or data.get("performance_1y") is not None

        with lock:
            if has_data:
                found += 1
                if apply:
                    upsert_fund({"isin": isin, **data})
                if i <= 30 or i % 200 == 0:
                    p1 = f"{data['performance_1y']:+.1f}%" if data.get("performance_1y") is not None else "N/A"
                    srri = data.get("srri", "?")
                    ms = f"★{data['morningstar_rating']}" if data.get("morningstar_rating") else "★?"
                    aum = f"{data['aum_eur']//1_000_000}M" if data.get("aum_eur") else "N/A"
                    print(f"  ✓ [{i:5d}] {isin} | {p1:8} | SRRI:{srri} | {ms} | AUM:{aum:8} | {name}")
            else:
                failed += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ✗ [{i:5d}] {isin} | no data | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} fonds enrichis, {failed} non trouvés")

    if apply:
        log_run("boursorama-cffi-enricher", "success", found, failed, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Boursorama CFFI Enricher")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int,            help="Limiter à N fonds")
    parser.add_argument("--isin",  type=str,            help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
