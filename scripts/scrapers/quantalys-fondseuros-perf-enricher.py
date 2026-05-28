#!/usr/bin/env python3
"""
quantalys-fondseuros-perf-enricher.py — performance_3y + performance_5y pour FE_Q_QUA*
========================================================================================
Les fonds euros Quantalys (FE_Q_QUA*) n'ont que performance_1y (taux 2024).
Ce script re-scrape chaque page /SupportEuro/{ID} pour extraire les taux servis
des années précédentes, puis calcule :
  - performance_3y  = cumul (1+r2022)(1+r2023)(1+r2024) - 1
  - performance_5y  = cumul (1+r2020)...(1+r2024) - 1

Le taux retenu pour chaque année est le PREMIER taux trouvé sur la page
(peut être un millesime si le fonds est trop ancien/ferme).

Usage :
    python3 scripts/scrapers/quantalys-fondseuros-perf-enricher.py
    python3 scripts/scrapers/quantalys-fondseuros-perf-enricher.py --apply
    python3 scripts/scrapers/quantalys-fondseuros-perf-enricher.py --apply --limit 50
"""

import re
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

try:
    from scrapling.fetchers import FetcherSession
    _USE_SCRAPLING = True
except ImportError:
    import requests as _requests
    _USE_SCRAPLING = False

QUANTALYS_FE_URL = "https://www.quantalys.com/SupportEuro/{fe_id}"
RATE_LIMIT_SEC   = 1.5
TIMEOUT          = 25
CACHE_PATH       = Path(__file__).parent.parent.parent / "data" / "qfe-perf-cache.json"

TARGET_YEARS = list(range(2020, 2025))  # 2020, 2021, 2022, 2023, 2024


def fetch_html(url: str, sess) -> str | None:
    try:
        if _USE_SCRAPLING:
            r = sess.get(url, timeout=TIMEOUT)
            if r.status != 200:
                return None
            return r.body.decode("utf-8", errors="replace")
        else:
            r = sess.get(url, timeout=TIMEOUT)
            if r.status_code != 200:
                return None
            return r.text
    except Exception:
        return None


def parse_historical_rates(html: str) -> dict[int, float]:
    """Extrait les taux servis par année. Retourne {année: taux_%}."""
    rates: dict[int, float] = {}
    for m in re.finditer(
        r"(?:Taux\s+(?:net\s+)?servi\s+en|en)\s+(\d{4})\s*[:\-–]?\s*<[^>]*>\s*(\d+[,.\s]\d+)\s*%",
        html,
        re.IGNORECASE,
    ):
        yr  = int(m.group(1))
        val = float(m.group(2).replace(",", ".").replace(" ", ""))
        if 2018 <= yr <= 2025 and 0 < val < 20:
            rates[yr] = val

    # Fallback pattern moins strict
    if not rates:
        for m in re.finditer(r"(\d{4})\s*[:\-–]\s*(\d+[,.]\d+)\s*%", html):
            yr  = int(m.group(1))
            val = float(m.group(2).replace(",", "."))
            if 2018 <= yr <= 2025 and 0 < val < 20:
                rates.setdefault(yr, val)

    return rates


def compute_cumulative(rates: dict[int, float], years: list[int]) -> float | None:
    """Cumule les taux sur une liste d'années. Retourne None si trop peu de données."""
    factors = []
    for yr in years:
        if yr in rates:
            factors.append(1 + rates[yr] / 100)
    if len(factors) < len(years) - 1:
        return None
    cum = 1.0
    for f in factors:
        cum *= f
    return round((cum - 1) * 100, 4)


def run(apply: bool, limit: int | None) -> None:
    print("=" * 68)
    print("  Quantalys Fonds Euros — Performance 3y/5y")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Charger les FE_Q_QUA* sans perf_3y
    all_funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,name,performance_3y,performance_5y") \
            .eq("product_type", "fonds_euros") \
            .like("isin", "FE_Q_%") \
            .or_("performance_3y.is.null,performance_5y.is.null") \
            .range(offset, offset + 999) \
            .execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if limit:
        all_funds = all_funds[:limit]

    print(f"  {len(all_funds)} fonds à traiter (FE_Q_QUA* sans perf_3y ou perf_5y)")

    # Cache disque pour éviter les re-scrapes
    cache: dict = {}
    if CACHE_PATH.exists():
        try:
            cache = json.loads(CACHE_PATH.read_text())
        except Exception:
            pass

    if _USE_SCRAPLING:
        sess = FetcherSession(impersonate="chrome")
    else:
        sess = _requests.Session()
        sess.headers.update({"User-Agent": "Mozilla/5.0 Chrome/124"})

    to_update: list[dict] = []
    no_data   = 0

    for i, fund in enumerate(all_funds, 1):
        isin = fund["isin"]
        # Extraire l'ID Quantalys depuis l'ISIN (FE_Q_QUA002071588 → 2071588)
        id_m = re.search(r"QUA0*(\d+)$", isin)
        if not id_m:
            no_data += 1
            continue
        fe_id = id_m.group(1)

        # Cache
        if fe_id in cache:
            rates = cache[fe_id]
        else:
            time.sleep(RATE_LIMIT_SEC)
            url  = QUANTALYS_FE_URL.format(fe_id=fe_id)
            html = fetch_html(url, sess)
            if not html:
                no_data += 1
                cache[fe_id] = None
                continue
            rates = parse_historical_rates(html) or None
            cache[fe_id] = rates

        if not rates:
            no_data += 1
            continue

        changes: dict = {}
        if fund.get("performance_3y") is None:
            p3 = compute_cumulative(rates, [2022, 2023, 2024])
            if p3 is not None:
                changes["performance_3y"] = p3
        if fund.get("performance_5y") is None:
            p5 = compute_cumulative(rates, [2020, 2021, 2022, 2023, 2024])
            if p5 is not None:
                changes["performance_5y"] = p5

        if changes:
            to_update.append({"isin": isin, **changes})

        if i <= 10 or i % 50 == 0:
            r3 = changes.get("performance_3y", "—")
            r5 = changes.get("performance_5y", "—")
            print(f"  [{i:4d}/{len(all_funds)}] {isin} | p3y={r3} | p5y={r5} | {fund['name'][:45]}")

    # Sauver le cache
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=0))

    print(f"\n  {len(to_update)} fonds avec p3y/p5y trouvés, {no_data} sans données")
    p3_count = sum(1 for r in to_update if "performance_3y" in r)
    p5_count = sum(1 for r in to_update if "performance_5y" in r)
    print(f"    perf_3y : {p3_count} | perf_5y : {p5_count}")

    if not apply:
        print("\n  [DRY-RUN] Pas d'écriture. Ajouter --apply pour persister.")
        return

    print("\n  Application en base...", flush=True)
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for row in to_update:
        isin = row["isin"]
        changes = {k: v for k, v in row.items() if k != "isin"}
        try:
            client.table("investissement_funds") \
                .update({**changes, "updated_at": now}) \
                .eq("isin", isin) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ✗ {isin}: {e}", flush=True)

    print(f"\n  → {ok} fonds enrichis, {fail} erreurs")
    log_run("quantalys-fondseuros-perf-enricher", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Enrichit performance_3y/5y des fonds euros Quantalys"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
