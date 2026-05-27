#!/usr/bin/env python3
"""
quantalys-fondseuros-scanner.py — Fonds euros via /SupportEuro/{ID}
=====================================================================
Quantalys liste 1360 URLs SupportEuro (fonds en euros AV).
Beaucoup sont des fonds garantis temporaires (préfixés `**`) mais on filtre.

Pour chaque URL `/SupportEuro/{ID}`, extrait :
  - nom (title)
  - taux net (% performance_1y)
  - millésime éventuel (année dans le titre)
  - société/compagnie AV

ISIN code synthétique : `FE_QUANTALYS_{ID}` pour distinguer des FE_* existants.

Usage :
    python3 scripts/scrapers/quantalys-fondseuros-scanner.py [--apply] [--limit N]
"""

import json
import re
import sys
import time
import argparse
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from html import unescape

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

_spec = importlib.util.spec_from_file_location(
    "qs", Path(__file__).parent / "quantalys-sitemap-scanner.py"
)
_qs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_qs)
init_session = _qs.init_session

SITEMAP_URL    = "https://www.quantalys.com/sitemap/sitemapothers.xml"
FE_URL         = "https://www.quantalys.com/SupportEuro/{fe_id}"
RATE_LIMIT_SEC = 1.5
TIMEOUT_SEC    = 25
CACHE_PATH     = Path(__file__).parent.parent.parent / "data" / "quantalys-fondseuros-mapping.json"


def parse_fe_page(html: str) -> dict:
    out = {}

    # Title parsing : "2012-2013 : 3,375% FONDS GARANTI EUR | QUA009298218 - Synthèse"
    title_m = re.search(r'<title>([^|]+)\|\s*([A-Z0-9]+)', html)
    if title_m:
        raw_title = unescape(title_m.group(1).strip())
        # Nettoyer les '**' parasites
        raw_title = re.sub(r'^\*+\s*', '', raw_title).strip()
        out["name"] = raw_title[:200]
        qua_code = title_m.group(2).strip()
        out["isin"] = f"FE_Q_{qua_code}"

    # Taux net dans le titre OU dans la page
    # Pattern 1 : "X,XX %" dans le titre
    if "name" in out:
        rate_m = re.search(r"(\d+[,.]\d+)\s*%", out["name"])
        if rate_m:
            try:
                v = float(rate_m.group(1).replace(",", "."))
                if 0 < v < 20:
                    out["performance_1y"] = round(v, 4)
            except ValueError:
                pass

    # Pattern 2 : "Taux net X,XX %" dans le HTML
    if "performance_1y" not in out:
        rate_m = re.search(r"[Tt]aux\s*(?:net)?[^<]*<[^>]+>\s*(\d+[,.]\d+)\s*%", html)
        if rate_m:
            try:
                v = float(rate_m.group(1).replace(",", "."))
                if 0 < v < 20:
                    out["performance_1y"] = round(v, 4)
            except ValueError:
                pass

    # Année du fonds (millésime)
    year_m = re.search(r"\b(20\d{2})", out.get("name", ""))
    if year_m:
        out["inception_date"] = f"{year_m.group(1)}-01-01"

    # Compagnie (gestionnaire) — souvent dans le HTML
    cie_m = re.search(r"[Cc]ompagnie[^<]*<[^>]+>([^<]+)</", html)
    if cie_m:
        out["management_company"] = cie_m.group(1).strip()[:80]

    return out


def run(apply: bool, limit: int | None):
    print("=" * 64)
    print("  Quantalys Fonds Euros Scanner")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)

    sess = init_session()
    print("  [1/3] Téléchargement sitemapothers.xml…", end=" ", flush=True)
    r = sess.get(SITEMAP_URL, timeout=30)
    fe_ids = sorted(set(re.findall(r"/SupportEuro/(\d+)", r.text)), key=int)
    print(f"{len(fe_ids)} SupportEuro IDs")

    cache = {}
    if CACHE_PATH.exists():
        try:
            cache = json.loads(CACHE_PATH.read_text())
        except Exception:
            cache = {}
    if "scanned" not in cache:
        cache["scanned"] = {}

    todo = [fid for fid in fe_ids if fid not in cache["scanned"]]
    if limit:
        todo = todo[:limit]
    print(f"  [2/3] {len(todo)} à scanner (cache: {len(cache['scanned'])})")
    print()

    new_records = 0
    errors = 0
    skipped_no_rate = 0

    for i, fe_id in enumerate(todo, 1):
        time.sleep(RATE_LIMIT_SEC)
        try:
            resp = sess.get(FE_URL.format(fe_id=fe_id), timeout=TIMEOUT_SEC)
            if resp.status_code != 200 or len(resp.text) < 5000:
                cache["scanned"][fe_id] = None
                errors += 1
                continue
            data = parse_fe_page(resp.text)
            cache["scanned"][fe_id] = data.get("isin")

            # Filtres : pas de nom OU pas de taux → skip
            if not data.get("name") or not data.get("performance_1y"):
                skipped_no_rate += 1
                continue

            if apply:
                upsert_data = {
                    "isin":             data["isin"],
                    "name":             data["name"],
                    "product_type":     "fonds_euros",
                    "currency":         "EUR",
                    "data_source":      "quantalys-supporteuro",
                    "performance_1y":   data.get("performance_1y"),
                }
                for k in ("inception_date", "management_company"):
                    if data.get(k):
                        upsert_data[k] = data[k]
                if upsert_fund(upsert_data):
                    new_records += 1

            if i <= 30 or i % 100 == 0:
                print(f"    [{i:>4}/{len(todo)}] /SupportEuro/{fe_id:>7} → "
                      f"perf1y={data.get('performance_1y','—'):>6}% | "
                      f"{data.get('name','?')[:60]}")

        except Exception as e:
            errors += 1

        if i % 50 == 0:
            CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=0))

    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=0))

    print()
    print(f"  [3/3] Terminé")
    print(f"    → {new_records} nouveaux fonds euros ajoutés")
    print(f"    → {skipped_no_rate} skippés (pas de taux)")
    print(f"    → {errors} erreurs")

    if apply:
        log_run(
            scraper="quantalys-fondseuros-scanner",
            status="success" if errors < len(todo) / 4 else "partial",
            records_processed=new_records,
            records_failed=errors + skipped_no_rate,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit)
