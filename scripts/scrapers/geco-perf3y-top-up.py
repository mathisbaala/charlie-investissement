#!/usr/bin/env python3
"""
geco-perf3y-top-up.py — Perf 3Y/5Y + AUM pour OPCVM qui ont déjà perf_1y

Cible les fonds (liste ISIN en argument ou filtre DB) qui ont perf_1y mais
manquent perf_3y ou aum_eur. Réutilise la même API GECO que geco-performance-enricher.

Usage :
    python3 scripts/scrapers/geco-perf3y-top-up.py [--apply] [--isin-file /tmp/list.txt]
    python3 scripts/scrapers/geco-perf3y-top-up.py --apply --isin-file /tmp/opcvm-near80-targets.txt
"""

import sys, json, time, concurrent.futures, threading
from datetime import datetime, date, timedelta, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

WORKERS        = 3
RATE_LIMIT_SEC = 1.2
GECO_BASE      = "https://geco.amf-france.org/back-office"

SESSION = FetcherSession(impersonate="chrome").__enter__()


def _ok(r) -> bool:
    return r.status == 200 and bool(r.body)


def _json(r):
    return json.loads(r.body.decode("utf-8"))


def get_share_id(isin: str) -> tuple[int, str] | None:
    try:
        r = SESSION.get(f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{isin}", timeout=15)
        if _ok(r) and r.body:
            raw = _json(r)
            shares = raw if isinstance(raw, list) else [raw]
            for share in shares:
                if isinstance(share, dict) and share.get("idInterne"):
                    return int(share["idInterne"]), share.get("parNom", "")
    except Exception:
        pass
    try:
        payload = {"first": 0, "rows": 10, "sortOrder": 1, "filters": {}, "globalFilter": isin}
        r = SESSION.post(f"{GECO_BASE}/funds/getCompartmentsBycriteria?productType=FR",
                         json=payload, timeout=15)
        if _ok(r):
            data = _json(r)
            items = data.get("compartmentDtos") or (data if isinstance(data, list) else [])
            for cmp in items:
                code = cmp.get("cmpCodeParPrincp")
                cmp_id = cmp.get("idInterne")
                if code:
                    r2 = SESSION.get(f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{code}", timeout=10)
                    if _ok(r2):
                        raw2 = _json(r2)
                        for share in (raw2 if isinstance(raw2, list) else [raw2]):
                            if isinstance(share, dict) and share.get("idInterne"):
                                return int(share["idInterne"]), share.get("parNom", "")
                if cmp_id:
                    r3 = SESSION.get(f"{GECO_BASE}/funds/compartment/{cmp_id}/shares", timeout=10)
                    if _ok(r3):
                        shares = _json(r3)
                        if shares:
                            sid = shares[0].get("idInterne") if shares else None
                            if sid:
                                return int(sid), cmp.get("cmpNom", "")
    except Exception:
        pass
    return None


def fetch_nav(share_id: int) -> list[tuple[date, float]]:
    from datetime import datetime as _dt
    start = (_dt.now() - timedelta(days=6 * 365 + 30)).strftime("%Y-%m-%d")
    end   = _dt.now().strftime("%Y-%m-%d")
    try:
        r = SESSION.get(
            f"{GECO_BASE}/funds/chart/{share_id}",
            params={"startDate": start, "endDate": end},
            timeout=20,
        )
        if not _ok(r):
            return []
        raw = _json(r)
        xs = raw.get("x", [])
        ys = raw.get("y", [])
        if not xs or not ys or len(xs) != len(ys):
            return []
        nav_series = []
        for d_str, nav in zip(xs, ys):
            if nav is None:
                continue
            try:
                d = _dt.strptime(d_str, "%d-%m-%Y").date()
                nav_series.append((d, float(nav)))
            except (ValueError, TypeError):
                pass
        return sorted(nav_series)
    except Exception:
        return []


def _perf_at(nav_series: list, target_date: date, tolerance: int = 20) -> float | None:
    if not nav_series:
        return None
    last_nav = nav_series[-1][1]
    # Find closest point to target_date within tolerance
    best = None
    best_delta = tolerance + 1
    for d, v in nav_series:
        delta = abs((d - target_date).days)
        if delta <= tolerance and delta < best_delta:
            best, best_delta = v, delta
    if best is None or best == 0:
        return None
    return round((last_nav / best - 1) * 100, 2)


def compute_perfs(nav_series: list) -> dict:
    today = date.today()
    result = {}
    for years, key in [(1, "performance_1y"), (3, "performance_3y"), (5, "performance_5y")]:
        p = _perf_at(nav_series, today - timedelta(days=years * 365))
        if p is not None:
            result[key] = p
    return result


def get_aum_from_geco(isin: str) -> int | None:
    try:
        r = SESSION.get(f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{isin}", timeout=15)
        if _ok(r):
            raw = _json(r)
            shares = raw if isinstance(raw, list) else [raw]
            for share in shares:
                if isinstance(share, dict) and share.get("idInterne"):
                    sid = share["idInterne"]
                    r2 = SESSION.get(f"{GECO_BASE}/funds/chart/{sid}?typeGraph=encours", timeout=15)
                    if _ok(r2):
                        data = _json(r2)
                        points = data.get("chartPoints") or []
                        if points:
                            last = points[-1]
                            val = last.get("encours") or last.get("nav") or last.get("y")
                            if val and float(val) > 0:
                                return int(float(val) * 1000)
    except Exception:
        pass
    return None


lock = threading.Lock()


def run(apply: bool, isin_file: str | None):
    print("=" * 60)
    print("  GECO Perf3Y Top-Up — perf_3y/5y + AUM")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Load target ISINs
    if isin_file and Path(isin_file).exists():
        isins = [l.strip() for l in Path(isin_file).read_text().splitlines() if l.strip()]
        funds = [{"isin": i} for i in isins]
        print(f"  {len(funds)} ISINs depuis {isin_file}")
    else:
        # Fallback: all amf-geco OPCVM with p1y but missing p3y
        funds_raw = []
        page_size, offset = 1000, 0
        while True:
            batch = (client.table("investissement_funds")
                     .select("isin, name, data_completeness")
                     .in_("product_type", ["opcvm", "etf"])
                     .like("isin", "FR%")
                     .not_.is_("performance_1y", "null")
                     .is_("performance_3y", "null")
                     .range(offset, offset + page_size - 1)
                     .execute().data or [])
            funds_raw.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        funds = funds_raw
        print(f"  {len(funds)} fonds cibles (FR OPCVM/ETF avec p1y sans p3y)")

    print()

    ok_perf = ok_aum = fail = 0

    def process(args):
        nonlocal ok_perf, ok_aum, fail
        i, fund = args
        isin = fund["isin"]
        time.sleep(RATE_LIMIT_SEC)

        result = get_share_id(isin)
        if not result:
            with lock:
                fail += 1
            return

        share_id, _ = result
        nav_series = fetch_nav(share_id)
        if not nav_series:
            with lock:
                fail += 1
            return

        perfs = compute_perfs(nav_series)
        update = {}
        if perfs.get("performance_3y") is not None:
            update["performance_3y"] = perfs["performance_3y"]
        if perfs.get("performance_5y") is not None:
            update["performance_5y"] = perfs["performance_5y"]
        # Also backfill p1y if missing
        if perfs.get("performance_1y") is not None:
            update["performance_1y"] = perfs["performance_1y"]

        with lock:
            if update:
                ok_perf += 1
                if apply:
                    update["isin"] = isin
                    upsert_fund(update)
                p1 = f"{perfs.get('performance_1y', 0):+.1f}%" if perfs.get("performance_1y") else "—"
                p3 = f"{perfs.get('performance_3y', 0):+.1f}%" if perfs.get("performance_3y") else "—"
                p5 = f"{perfs.get('performance_5y', 0):+.1f}%" if perfs.get("performance_5y") else "—"
                if i % 20 == 0:
                    print(f"  [{i:4d}] {isin}  p1={p1:8} p3={p3:8} p5={p5:8}")
            else:
                fail += 1

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        ex.map(process, enumerate(funds, 1))

    print(f"\n  perf3y enrichis : {ok_perf}  |  aum enrichis : {ok_aum}  |  non trouvés : {fail}")
    status = "success" if fail < len(funds) * 0.5 else "partial"
    log_run("geco-perf3y-top-up", status, ok_perf, fail, started_at=started)
    print(f"  Terminé en {(datetime.now(timezone.utc) - started).seconds}s")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply",     action="store_true", help="Écrire en DB")
    parser.add_argument("--isin-file", type=str,            help="Fichier texte d'ISINs (1 par ligne)")
    args = parser.parse_args()
    run(apply=args.apply, isin_file=args.isin_file)
