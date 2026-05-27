#!/usr/bin/env python3
"""
quantalys-scpi-scanner.py — Scanner SCPI Quantalys (sitemapothers)
====================================================================
Quantalys liste 732 SCPI dans son sitemapothers.xml. On en a 61 en base.
Gros gap potentiel pour CGP français.

Pour chaque URL `/SCPI/{ID}`, on extrait :
  - ISIN (souvent FR* ou code synthétique SCPI*/QUA*)
  - Nom (depuis title)
  - TDVM (Taux de Distribution sur Valeur de Marché) → performance_1y
  - Capitalisation → aum_eur
  - Date création → inception_date

Rate limit : 2s/page (1 worker), ~25 min pour 732 SCPI.

Usage :
    python3 scripts/scrapers/quantalys-scpi-scanner.py [--apply] [--limit N]
"""

import json
import re
import sys
import time
import argparse
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession  # noqa: F401 (used via init_session import)

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# Import init_session depuis quantalys-sitemap-scanner
_spec = importlib.util.spec_from_file_location(
    "qs", Path(__file__).parent / "quantalys-sitemap-scanner.py"
)
_qs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_qs)
init_session = _qs.init_session

SITEMAP_URL    = "https://www.quantalys.com/sitemap/sitemapothers.xml"
SCPI_URL       = "https://www.quantalys.com/SCPI/{scpi_id}"
RATE_LIMIT_SEC = 2.0
TIMEOUT_SEC    = 25
CACHE_PATH     = Path(__file__).parent.parent.parent / "data" / "quantalys-scpi-mapping.json"


def _pct(s: str) -> float | None:
    if not s:
        return None
    try:
        v = float(str(s).replace(",", ".").replace("%", "").strip())
        if -50 < v < 50:
            return round(v, 4)
    except ValueError:
        pass
    return None


def parse_scpi_page(html: str) -> dict:
    out: dict = {}

    # ISIN — réel FR* ou code synth Quantalys (SCPI/QUA)
    isin_m = re.search(r'<title>[^|]+\|\s*([A-Z]{2}\d{10}|SCPI\d{6,10}|QUA\d{6,10})', html)
    if isin_m:
        out["isin"] = isin_m.group(1)

    # Nom (avant le |)
    name_m = re.search(r'<title>([^|]+)\s*\|', html)
    if name_m:
        out["name"] = name_m.group(1).strip()

    # TDVM
    tdvm_patterns = [
        r"TDVM[^<]*</td>\s*<td[^>]*>\s*([+-]?\d+[,.]\d+)\s*%",
        r"[Tt]aux\s+de\s+[Dd]istribution[^<]*</td>\s*<td[^>]*>\s*([+-]?\d+[,.]\d+)\s*%",
        r"<strong>TDVM</strong>[^<]*<[^>]+>([^<]+)",
        r"Distribution.*?(\d+[,.]\d+)\s*%",
    ]
    for pat in tdvm_patterns:
        m = re.search(pat, html, re.DOTALL | re.IGNORECASE)
        if m:
            v = _pct(m.group(1))
            if v is not None:
                out["performance_1y"] = v
                break

    # Capitalisation (AUM)
    aum_m = re.search(r"[Cc]apitalisation[^<]*<[^>]+>\s*([\d\s,]+)\s*(M€|million|Mrd|milliard)", html, re.DOTALL)
    if aum_m:
        try:
            num = float(aum_m.group(1).replace(" ", "").replace(",", "."))
            unit = aum_m.group(2).lower()
            mult = 1_000_000_000 if "mrd" in unit or "milliard" in unit else 1_000_000
            out["aum_eur"] = int(num * mult)
        except (ValueError, TypeError):
            pass

    # TOF (Taux d'occupation financier — info SCPI utile)
    tof_m = re.search(r"TOF[^<]*</td>\s*<td[^>]*>\s*(\d+[,.]\d+)\s*%", html)
    if tof_m:
        v = _pct(tof_m.group(1))
        if v is not None and 0 < v <= 100:
            out["occupancy_rate"] = v

    # Année de création
    inception_m = re.search(r"(?:cr[ée]ation|inception|lancement)[^\d]*(\d{4})", html, re.IGNORECASE)
    if inception_m:
        year = int(inception_m.group(1))
        if 1960 <= year <= 2030:
            out["inception_date"] = f"{year}-01-01"

    return out


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print("  Quantalys SCPI Scanner")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)

    sess = init_session()
    print("  [1/3] Téléchargement sitemapothers.xml…", end=" ", flush=True)
    r = sess.get(SITEMAP_URL, stealthy_headers=True, timeout=30)
    scpi_urls = re.findall(r"/SCPI/(\d+)", r.body.decode("utf-8") if r.body else "")
    scpi_ids = sorted(set(scpi_urls), key=int)
    print(f"{len(scpi_ids)} SCPI IDs")

    # Cache
    cache = {}
    if CACHE_PATH.exists():
        try:
            cache = json.loads(CACHE_PATH.read_text())
        except Exception:
            cache = {"scanned": {}}
    if "scanned" not in cache:
        cache["scanned"] = {}

    todo = [sid for sid in scpi_ids if sid not in cache["scanned"]]
    if limit:
        todo = todo[:limit]
    print(f"  [2/3] {len(todo)} SCPI à scanner (cache: {len(cache['scanned'])})")
    print()

    new_records = 0
    updated = 0
    errors = 0
    client = get_client() if apply else None

    for i, scpi_id in enumerate(todo, 1):
        time.sleep(RATE_LIMIT_SEC)
        try:
            resp = sess.get(SCPI_URL.format(scpi_id=scpi_id), stealthy_headers=True, timeout=TIMEOUT_SEC)
            body_size = len(resp.body) if resp.body else 0
            if resp.status != 200 or body_size < 5000:
                cache["scanned"][scpi_id] = None
                errors += 1
                continue
            html = resp.body.decode("utf-8")
            data = parse_scpi_page(html)
            cache["scanned"][scpi_id] = data.get("isin")

            if not data.get("isin"):
                errors += 1
                continue

            if apply:
                # Vérifier si la SCPI existe déjà
                existing = client.table("investissement_funds") \
                    .select("isin").eq("isin", data["isin"]).execute().data

                upsert_data = {
                    "isin":         data["isin"],
                    "name":         data.get("name") or data["isin"],
                    "product_type": "scpi",
                    "currency":     "EUR",
                    "data_source":  "quantalys",
                }
                # Ajouter les métriques optionnelles
                for k in ("performance_1y", "aum_eur", "occupancy_rate", "inception_date"):
                    if data.get(k) is not None:
                        upsert_data[k] = data[k]

                if upsert_fund(upsert_data):
                    if existing:
                        updated += 1
                    else:
                        new_records += 1

            if i <= 30 or i % 50 == 0:
                print(f"    [{i:>4}/{len(todo)}] /SCPI/{scpi_id:>7} → {data.get('isin','?'):14} | "
                      f"perf1y={data.get('performance_1y','—'):>6} | aum={data.get('aum_eur','—')} | "
                      f"{(data.get('name') or '?')[:30]}")

        except Exception as e:
            errors += 1
            cache["scanned"][scpi_id] = None

        if i % 20 == 0:
            CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=0))

    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=0))

    print()
    print(f"  [3/3] Terminé")
    print(f"    → {new_records} nouvelles SCPI ajoutées")
    print(f"    → {updated} SCPI existantes enrichies")
    print(f"    → {errors} erreurs")

    if apply:
        log_run(
            scraper="quantalys-scpi-scanner",
            status="success" if errors < len(todo) / 4 else "partial",
            records_processed=new_records + updated,
            records_failed=errors,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
