#!/usr/bin/env python3
"""
quantalys-sitemap-scanner.py — Scan sitemap Quantalys + enrichissement TER/perf/SRI
======================================================================================
Quantalys utilise des URLs /Fonds/{ID_NUMÉRIQUE} (54731 fonds dans le sitemap).
L'URL /fonds/{ISIN} retourne 404, donc le scraper existant (quantalys-enricher.py)
ne fonctionnait pas. Ce script :

  1. Télécharge sitemap1 (54731 URLs /Fonds/{ID})
  2. Pour chaque ID, fetch la page, extrait l'ISIN + métriques
  3. Cache le mapping ID → ISIN dans data/quantalys-mapping.json (resumable)
  4. Si ISIN ∈ cible (OPCVMs FR/LU sans perf/TER), upsert dans investissement_funds

Rate limit : 1.5s/page (54731 × 1.5s ≈ 23h en background nocturne).
Cache persistant : interrompre/reprendre safe.

Données extraites par page :
  - ISIN (matching)
  - performance_1y, performance_3y, performance_5y (Perf. N ans)
  - volatility_3y, sharpe_3y (block Données 3 ans)
  - ter / ongoing_charges (Frais courants PRIIPS)
  - sri (1-7, optionnel)

Usage :
    python3 scripts/scrapers/quantalys-sitemap-scanner.py [--apply] [--limit N] [--resume]
    nohup python3 scripts/scrapers/quantalys-sitemap-scanner.py --apply > logs/quantalys-scan.log 2>&1 &
"""

import json
import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

SITEMAP_URL    = "https://www.quantalys.com/sitemap/sitemapproduits1.xml"
FUND_URL       = "https://www.quantalys.com/Fonds/{fund_id}"
HOME_URL       = "https://www.quantalys.com/"
RATE_LIMIT_SEC = 1.5
TIMEOUT_SEC    = 25

CACHE_PATH    = Path(__file__).parent.parent.parent / "data" / "quantalys-mapping.json"
SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ", "fcp dédié", "fcpr ", "fpci ")


# ─── Cookie session bootstrap ──────────────────────────────────────────────────

def init_session() -> FetcherSession:
    """Initialise la session avec les cookies anti-bot Quantalys."""
    sess = FetcherSession(impersonate="chrome").__enter__()
    page = sess.get(HOME_URL, stealthy_headers=True, timeout=TIMEOUT_SEC)
    m = re.search(r"location\.href='(/[^']+)'", page.body.decode("utf-8") if page.body else "")
    if m:
        sess.get(f"https://www.quantalys.com{m.group(1)}", stealthy_headers=True, timeout=TIMEOUT_SEC)
    return sess


# ─── Parsers ──────────────────────────────────────────────────────────────────

def _pct(s: str | None) -> float | None:
    if not s:
        return None
    s = str(s).replace("\xa0", "").replace(" ", "").replace(",", ".").replace("%", "").strip()
    try:
        v = float(s)
        if -1000 < v < 10000:
            return round(v, 4)
    except ValueError:
        pass
    return None


def parse_quantalys_page(html: str) -> dict:
    """
    Extrait depuis une page /Fonds/{id} :
      - isin
      - performance_1y, performance_3y, performance_5y
      - volatility_3y, sharpe_3y (du block "Données 3 ans")
      - ter (Frais courants PRIIPS)
      - sri (1-7)
    """
    result: dict = {}

    # ── ISIN ─────────────────────────────────────────────────────────────────
    isin_m = re.search(r'\b([A-Z]{2}\d{10})\b', html)
    if isin_m:
        result["isin"] = isin_m.group(1)

    # ── Performances 1/3/5 ans ────────────────────────────────────────────────
    for n, key in ((1, "performance_1y"), (3, "performance_3y"), (5, "performance_5y")):
        pat = rf'Perf\.\s*{n}\s*ans?</td>\s*<td[^>]*>\s*([+-]?\d+[.,]\d+)\s*%'
        m = re.search(pat, html)
        if m:
            v = _pct(m.group(1))
            if v is not None:
                result[key] = v

    # ── Block "Données 3 ans" → volatility_3y + sharpe_3y ─────────────────────
    block_m = re.search(r'<strong>Données\s+3\s*ans?\s+au[^<]*</strong>(.*?)(?:<strong>Données|</tbody>)', html, re.DOTALL)
    if block_m:
        block = block_m.group(1)
        # Le label contient <span data-content="...">...</span>, donc DOTALL et .*?
        vol_m = re.search(r'Volatilité.*?</td>\s*<td[^>]*>\s*([+-]?\d+[.,]\d+)\s*%', block, re.DOTALL)
        if vol_m:
            v = _pct(vol_m.group(1))
            if v is not None:
                result["volatility_3y"] = v
        sh_m = re.search(r'Sharpe.*?</td>\s*<td[^>]*>\s*([+-]?\d+[.,]\d+)', block, re.DOTALL)
        if sh_m:
            try:
                result["sharpe_3y"] = round(float(sh_m.group(1).replace(",", ".")), 4)
            except ValueError:
                pass

    # ── TER (Frais courants PRIIPS, accepte entier ou décimal) ────────────────
    ter_patterns = [
        r'Frais\s+courants\s+PRIIPS.*?</td>\s*<td[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*%',
        r'Frais\s+courants.*?</td>\s*<td[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*%',
    ]
    for pat in ter_patterns:
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m:
            ter_pct = _pct(m.group(1))
            if ter_pct is not None and 0 < ter_pct < 20:
                result["ter"] = round(ter_pct / 100, 6)
                result["ongoing_charges"] = result["ter"]
                break

    # ── SRI : <div class="indic-srri indic-srri-selected">N</div> ─────────────
    sri_m = re.search(r'indic-srri-selected">\s*(\d)\s*</div>', html)
    if sri_m:
        try:
            v = int(sri_m.group(1))
            if 1 <= v <= 7:
                result["sri"] = v
                result["srri"] = v
        except ValueError:
            pass

    return result


# ─── Cache mapping ─────────────────────────────────────────────────────────────

def load_cache() -> dict:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text())
        except Exception:
            return {"scanned": {}, "errors": {}}
    return {"scanned": {}, "errors": {}}


def save_cache(cache: dict):
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=0))
    tmp.replace(CACHE_PATH)


# ─── Targets ──────────────────────────────────────────────────────────────────

def fetch_target_isins(client) -> set[str]:
    """OPCVMs FR/LU sans perf_1y, sans TER, sans fonds dédié."""
    out: list[dict] = []
    off = 0
    while True:
        r = (
            client.table("investissement_funds")
            .select("isin, name")
            .eq("product_type", "opcvm")
            .is_("performance_1y", "null")
            .is_("ter", "null")
            .is_("ongoing_charges", "null")
            .range(off, off + 999)
            .execute()
        )
        out.extend(r.data or [])
        if not r.data or len(r.data) < 1000:
            break
        off += 1000

    return {
        f["isin"]
        for f in out
        if f["isin"].startswith(("FR", "LU"))
        and not any(p in (f.get("name") or "").lower() for p in SKIP_PATTERNS)
    }


# ─── Main ──────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, resume: bool):
    print("=" * 72)
    print("  Quantalys Sitemap Scanner — TER/perf/SRI via /Fonds/{ID}")
    print("=" * 72)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Resume  : {resume}")
    print(f"  Cache   : {CACHE_PATH}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # ── Étape 1 : cibles ──────────────────────────────────────────────────────
    print("  [1/4] Chargement des ISINs cibles…", end=" ", flush=True)
    targets = fetch_target_isins(client)
    print(f"{len(targets)} OPCVMs FR/LU à enrichir")

    # ── Étape 2 : cache + sitemap ─────────────────────────────────────────────
    cache = load_cache() if resume else {"scanned": {}, "errors": {}}
    print(f"  [2/4] Cache existant : {len(cache['scanned'])} IDs déjà scannés")

    print("  [3/4] Téléchargement sitemap1.xml…", end=" ", flush=True)
    sess = init_session()
    r = sess.get(SITEMAP_URL, stealthy_headers=True, timeout=60)
    all_ids = re.findall(r"/Fonds/(\d+)", r.body.decode("utf-8") if r.body else "")
    print(f"{len(all_ids)} IDs trouvés")

    # IDs restants à scanner
    todo = [fid for fid in all_ids if fid not in cache["scanned"]]
    if limit:
        todo = todo[:limit]
    print(f"  → {len(todo)} IDs à scanner")
    print()

    # ── Étape 3 : boucle scan ─────────────────────────────────────────────────
    print("  [4/4] Scan en cours…")
    matched = 0
    upserted = 0
    errors = 0
    cache_dirty = 0

    for i, fid in enumerate(todo, 1):
        time.sleep(RATE_LIMIT_SEC)

        try:
            resp = sess.get(FUND_URL.format(fund_id=fid), stealthy_headers=True, timeout=TIMEOUT_SEC)
            body_size = len(resp.body) if resp.body else 0
            if resp.status != 200 or body_size < 5000:
                cache["errors"][fid] = f"HTTP {resp.status} size={body_size}"
                cache["scanned"][fid] = None  # marquer scanné mais sans ISIN
                errors += 1
                continue

            html = resp.body.decode("utf-8")
            data = parse_quantalys_page(html)
            isin = data.get("isin")
            cache["scanned"][fid] = isin or None
            cache_dirty += 1

            if isin and isin in targets:
                matched += 1
                # Garder uniquement les champs utiles
                upsert_data = {
                    k: v for k, v in data.items()
                    if k in (
                        "isin", "performance_1y", "performance_3y", "performance_5y",
                        "volatility_3y", "sharpe_3y", "ter", "ongoing_charges",
                        "sri", "srri",
                    ) and v is not None
                }
                upsert_data["data_source"] = "quantalys"
                if apply and len(upsert_data) > 2:  # au moins une métrique
                    if upsert_fund(upsert_data):
                        upserted += 1

                if matched <= 30 or matched % 50 == 0:
                    perf1 = data.get("performance_1y", "—")
                    ter   = data.get("ter")
                    ter_str = f"{ter*100:.2f}%" if ter else "—"
                    sri   = data.get("sri", "—")
                    print(
                        f"    [{i:5d}/{len(todo)}] /Fonds/{fid:>7} → {isin} "
                        f"| perf1y={perf1!s:>7} | TER={ter_str:>6} | SRI={sri} | MATCH ✓"
                    )

        except Exception as e:
            cache["errors"][fid] = f"{type(e).__name__}: {e}"
            cache["scanned"][fid] = None
            errors += 1
            cache_dirty += 1

        # Persist cache régulièrement
        if cache_dirty >= 50:
            save_cache(cache)
            cache_dirty = 0

        # Logging général
        if i % 100 == 0:
            pct = i / len(todo) * 100
            print(
                f"    [{i:5d}/{len(todo)}] {pct:5.1f}% "
                f"| matchés={matched} | upserts={upserted} | err={errors}"
            )

    # Persist final
    save_cache(cache)

    # ── Log ───────────────────────────────────────────────────────────────────
    print()
    print(f"  ✓ Scan terminé : {len(todo)} IDs traités")
    print(f"    → matchés cibles : {matched}")
    print(f"    → upserts DB    : {upserted}")
    print(f"    → erreurs       : {errors}")

    if apply:
        log_run(
            scraper="quantalys-sitemap-scanner",
            status="success" if errors < len(todo) / 4 else "partial",
            records_processed=upserted,
            records_failed=errors,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scan Quantalys sitemap (54k fonds) + enrichissement des cibles."
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en DB (sans : dry-run)")
    parser.add_argument("--limit", type=int, default=None, help="Limiter à N IDs (test)")
    parser.add_argument("--no-resume", action="store_true", help="Repartir de zéro (ignore cache)")
    args = parser.parse_args()

    run(apply=args.apply, limit=args.limit, resume=not args.no_resume)
