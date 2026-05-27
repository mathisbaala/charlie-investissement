#!/usr/bin/env python3
"""
geco-performance-enricher.py — Performances OPCVM depuis AMF GECO
==================================================================
Calcule les performances 1Y/3Y/5Y depuis l'historique de VL officiel
publié par l'AMF (API GECO interne, reverse-engineered).

Pipeline par fonds :
  1. POST /back-office/funds/getCompartmentsBycriteria → trouver cmpCodeParPrincp
  2. GET  /back-office/funds/shareByCmpCodeParPrincp/{code} → shareId interne
  3. GET  /back-office/funds/chart/{shareId}?startDate=...&endDate=... → NAV historique
  4. Calculer performance_1y, performance_3y, performance_5y depuis les VL

Usage :
    python3 scripts/scrapers/geco-performance-enricher.py [--apply] [--limit N] [--isin ISIN]
"""

import sys
import time
import json
import argparse
import threading
import concurrent.futures
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS          = 3
RATE_LIMIT_SEC   = 1.2   # respecter le rate limit AMF
TIMEOUT          = 15
GECO_BASE        = "https://geco.amf-france.org/back-office"

HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    "User-Agent":   "Mozilla/5.0 (compatible; Charlie-Investissement/1.0; data@charlie.fr)",
    "Referer":      "https://geco.amf-france.org/",
    "Origin":       "https://geco.amf-france.org",
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _find_share_id(session: FetcherSession, isin: str) -> tuple[int | None, str | None]:
    """
    Retourne (shareId, cmpNom) depuis GECO pour un ISIN donné.
    shareId = idInterne de la part (utilisé pour le chart NAV).

    Stratégie :
      1. GET shareByCmpCodeParPrincp/{ISIN} — fonctionne pour les ISINs FR stockés comme code
      2. Fallback : POST compartments globalFilter, puis shareByCmpCodeParPrincp sur le code trouvé
    """
    # Stratégie 1 : ISIN direct comme cmpCodeParPrincp
    try:
        r = session.get(
            f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{isin}",
            stealthy_headers=True, timeout=TIMEOUT,
        )
        if r.status == 200 and r.body.decode("utf-8").strip() not in ("", "null", "{}"):
            share = json.loads(r.body.decode("utf-8"))
            if isinstance(share, dict) and share.get("idInterne"):
                return int(share["idInterne"]), share.get("parNom", "")
    except (Exception, ValueError):
        pass

    # Stratégie 2 : recherche dans les compartiments par ISIN (sharesIsins)
    payload = {"first": 0, "rows": 10, "sortOrder": 1, "filters": {}, "globalFilter": isin}
    try:
        r2 = session.post(
            f"{GECO_BASE}/funds/getCompartmentsBycriteria?productType=FR",
            stealthy_headers=True, json=payload, timeout=TIMEOUT,
        )
        if r2.status != 200:
            return None, None
        compartments = json.loads(r2.body.decode("utf-8")).get("compartmentDtos", [])
    except (Exception, ValueError):
        return None, None

    # Trouver le bon compartiment
    target_cmp = None
    for cmp in compartments:
        if isin in (cmp.get("sharesIsins") or []):
            target_cmp = cmp
            break

    if not target_cmp:
        return None, None

    code = target_cmp.get("cmpCodeParPrincp")
    id_interne = target_cmp.get("idInterne")
    cmp_nom = target_cmp.get("cmpNom", "")

    if code:
        try:
            r3 = session.get(
                f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{code}",
                stealthy_headers=True, timeout=TIMEOUT,
            )
            if r3.status == 200 and r3.body.decode("utf-8").strip() not in ("", "null", "{}"):
                share = json.loads(r3.body.decode("utf-8"))
                if isinstance(share, dict) and share.get("idInterne"):
                    return int(share["idInterne"]), cmp_nom
        except (Exception, ValueError):
            pass

    if id_interne:
        try:
            r4 = session.get(
                f"{GECO_BASE}/funds/compartment/{id_interne}/shares",
                stealthy_headers=True, timeout=TIMEOUT,
            )
            if r4.status == 200:
                shares = json.loads(r4.body.decode("utf-8"))
                if isinstance(shares, list) and shares:
                    sid = shares[0].get("idInterne")
                    return (int(sid) if sid else None), cmp_nom
        except (Exception, ValueError):
            pass

    return None, cmp_nom


def _fetch_nav_chart(session: FetcherSession, share_id: int, years_back: int = 6) -> list[tuple[date, float]]:
    """
    Récupère l'historique NAV depuis GECO chart.
    Retourne liste de (date, nav) triée par date.
    """
    start = (datetime.now() - timedelta(days=years_back * 365 + 30)).strftime("%Y-%m-%d")
    end   = datetime.now().strftime("%Y-%m-%d")
    try:
        r = session.get(
            f"{GECO_BASE}/funds/chart/{share_id}",
            headers=HEADERS,
            params={"startDate": start, "endDate": end},
            timeout=TIMEOUT,
        )
        if r.status != 200:
            return []
        data = json.loads(r.body.decode("utf-8"))
        xs = data.get("x", [])
        ys = data.get("y", [])
        if not xs or not ys or len(xs) != len(ys):
            return []

        result = []
        for d_str, nav in zip(xs, ys):
            if nav is None:
                continue
            try:
                # Format: "DD-MM-YYYY"
                d = datetime.strptime(d_str, "%d-%m-%Y").date()
                result.append((d, float(nav)))
            except (ValueError, TypeError):
                pass
        return sorted(result)
    except (Exception, ValueError):
        return []


def _calc_perf_at(nav_series: list[tuple[date, float]], target_date: date, tolerance_days: int = 20) -> float | None:
    """Trouve la NAV la plus proche de target_date et calcule le rendement vs last."""
    if not nav_series:
        return None
    last_nav = nav_series[-1][1]
    if not last_nav:
        return None

    best = None
    best_delta = float("inf")
    for d, nav in nav_series:
        delta = abs((d - target_date).days)
        if delta < best_delta:
            best_delta = delta
            best = nav

    if best is None or best_delta > tolerance_days:
        return None
    if best == 0:
        return None

    raw = (last_nav / best - 1) * 100
    return round(raw, 2)


def compute_performances(nav_series: list[tuple[date, float]]) -> dict:
    """Calcule performance_1y / performance_3y / performance_5y en % cumulatif."""
    if not nav_series:
        return {}
    today = nav_series[-1][0]
    result = {}
    p1 = _calc_perf_at(nav_series, today - timedelta(days=365))
    if p1 is not None and -9999 < p1 < 9999:
        result["performance_1y"] = p1
    p3 = _calc_perf_at(nav_series, today - timedelta(days=3 * 365))
    if p3 is not None and -9999 < p3 < 9999:
        result["performance_3y"] = p3
    p5 = _calc_perf_at(nav_series, today - timedelta(days=5 * 365))
    if p5 is not None and -9999 < p5 < 9999:
        result["performance_5y"] = p5
    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, isin_filter: str | None):
    print("=" * 60)
    print("  GECO Performance Enricher — VL historiques AMF")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite  : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    if isin_filter:
        funds = [{"isin": isin_filter, "name": ""}]
    else:
        # Cibler OPCVM sans performance_1y, triés par AUM décroissant (mais sans exclure AUM null)
        SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ", "spécial ")
        funds = []
        seen: set[str] = set()
        page_size = 1000
        offset = 0

        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin, name, product_type")
                .in_("product_type", ["opcvm", "etf"])
                .is_("performance_1y", "null")
                .like("isin", "FR%")
                .range(offset, offset + page_size - 1)
                .execute().data or []
            )
            for row in batch:
                isin = row["isin"]
                if isin not in seen and len(isin) == 12:
                    name_lower = (row.get("name") or "").lower()
                    if not any(p in name_lower for p in SKIP_PATTERNS):
                        seen.add(isin)
                        funds.append(row)
            if len(batch) < page_size:
                break
            if limit and len(funds) >= limit * 3:
                break
            offset += page_size

        if limit:
            funds = funds[:limit]

    print(f"  {len(funds)} fonds à enrichir")
    print()

    found    = 0
    no_share = 0
    no_nav   = 0
    lock     = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, no_share, no_nav
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:35]

        session = FetcherSession(impersonate="chrome").__enter__()
        time.sleep(RATE_LIMIT_SEC)

        share_id, cmp_nom = _find_share_id(session, isin)
        if not share_id:
            with lock:
                no_share += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ~ [{i:5d}] {isin} | no share | {name}")
            return

        time.sleep(RATE_LIMIT_SEC * 0.5)
        nav_series = _fetch_nav_chart(session, share_id)
        if not nav_series:
            with lock:
                no_nav += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ~ [{i:5d}] {isin} | no nav | {name}")
            return

        perfs = compute_performances(nav_series)
        if not perfs:
            with lock:
                no_nav += 1
            return

        row = {"isin": isin, **perfs}
        with lock:
            found += 1
            if apply:
                upsert_fund(row)
            if i <= 30 or i % 200 == 0:
                p1  = f"{perfs.get('performance_1y', 0):+.1f}%"  if perfs.get("performance_1y") is not None else "N/A"
                p3  = f"{perfs.get('performance_3y', 0):+.1f}%"  if perfs.get("performance_3y") is not None else "N/A"
                nav_pts = len(nav_series)
                print(f"  ✓ [{i:5d}] {isin} | {p1:8} | 3Y:{p3:8} | pts:{nav_pts:4} | {name[:25]}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds, 1)))

    print()
    print(f"  ✓ {found} enrichis, {no_share} sans shareId, {no_nav} sans NAV")

    if apply:
        log_run(
            "geco-performance-enricher",
            "success",
            found,
            no_share + no_nav,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GECO Performance Enricher")
    parser.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",  type=int,            help="Limiter à N fonds")
    parser.add_argument("--isin",   type=str,            help="Un seul ISIN (test)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, isin_filter=args.isin)
