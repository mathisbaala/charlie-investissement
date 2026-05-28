#!/usr/bin/env python3
"""
quantalys-direct-enricher.py — Enrichissement OPCVM via Quantalys (lookup direct ISIN→ID)
===========================================================================================
Quantalys expose un endpoint non documenté :
    GET /Recherche/Produits  → JSON [{sCodeISIN, sNom, ID_Produit}, ...]   (62 000 fonds)

Ce catalogue est téléchargé une fois en mémoire, puis pour chaque ISIN cible on fetch
la page /Fonds/{ID_Produit} qui contient :
  - performance_1y, performance_3y, performance_5y  (Perf. N ans)
  - ter / ongoing_charges (Frais courants PRIIPS)
  - sri (SRI 1-7, jauge indic-srri-selected)
  - sfdr_article (Article 6/8/9)
  - sharpe_3y, volatility_3y (bloc Données 3 ans)

Couverture : ~16.5 % des OPCVM en base (2 481 / 15 005), dont 384 sans performance_1y.

Nécessite : scrapling (pip install 'scrapling[fetchers]')

Usage :
    python3 scripts/scrapers/quantalys-direct-enricher.py [--apply] [--limit N]
    python3 scripts/scrapers/quantalys-direct-enricher.py --apply            (tous)
    python3 scripts/scrapers/quantalys-direct-enricher.py --apply --ter-only (sans TER)
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

_thread_local = threading.local()


def get_thread_session() -> FetcherSession:
    """Une session initialisée par thread worker (home-page auth une seule fois)."""
    if not hasattr(_thread_local, "sess"):
        _thread_local.sess = init_session()
    return _thread_local.sess

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS        = 2            # Quantalys tolère 2 workers sans ban notable
RATE_LIMIT_SEC = 1.5          # entre chaque requête par worker
TIMEOUT_SEC    = 25
HOME_URL       = "https://www.quantalys.com/"
CATALOG_URL    = "https://www.quantalys.com/Recherche/Produits"
FUND_URL       = "https://www.quantalys.com/Fonds/{fund_id}"

SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ", "fcp dédié", "fcpr ", "fpci ")


# ─── Session bootstrap ────────────────────────────────────────────────────────

def init_session() -> FetcherSession:
    """Initialise une session Scrapling avec TLS fingerprint Chrome pour Quantalys."""
    sess = FetcherSession(impersonate="chrome").__enter__()
    page = sess.get(HOME_URL, stealthy_headers=True, timeout=TIMEOUT_SEC)
    m = re.search(r"location\.href='(/[^']+)'", page.body.decode("utf-8") if page.body else "")
    if m:
        sess.get(f"https://www.quantalys.com{m.group(1)}", stealthy_headers=True, timeout=TIMEOUT_SEC)
    return sess


# ─── Catalogue ISIN → ID_Produit ─────────────────────────────────────────────

def fetch_catalog(sess: FetcherSession) -> dict[str, int]:
    """
    Télécharge le catalogue complet Quantalys (~62 000 fonds, ~5.5 Mo JSON).
    Retourne un dict ISIN → ID_Produit.
    Gère le challenge JS/cookie de Quantalys (redirect intermédiaire).
    """
    def _get_catalog(s: FetcherSession) -> bytes | None:
        page = s.get(
            CATALOG_URL,
            headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"},
            timeout=60,
        )
        if page.status != 200 or not page.body:
            raise RuntimeError(f"Catalogue Quantalys : HTTP {page.status}")
        return page.body

    body = _get_catalog(sess)
    raw = body.decode("utf-8")

    # Quantalys peut retourner un challenge JS à résoudre (redirect cookie)
    if raw.strip().startswith("<"):
        m = re.search(r"location\.href='(/[^']+)'", raw)
        if m:
            sess.get(f"https://www.quantalys.com{m.group(1)}", stealthy_headers=True, timeout=15)
            body = _get_catalog(sess)
            raw = body.decode("utf-8")

    funds = json.loads(raw)
    return {f["sCodeISIN"]: f["ID_Produit"] for f in funds if f.get("sCodeISIN")}


# ─── Parseurs ─────────────────────────────────────────────────────────────────

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
      - performance_1y, performance_3y, performance_5y
      - ter / ongoing_charges (Frais courants PRIIPS)
      - sri (1-7)
      - sfdr_article (6/8/9)
      - sharpe_3y, volatility_3y
    """
    result: dict = {}

    # ── Performances 1/3/5 ans ────────────────────────────────────────────────
    for n, key in ((1, "performance_1y"), (3, "performance_3y"), (5, "performance_5y")):
        pat = rf"Perf\.\s*{n}\s*ans?</td>\s*<td[^>]*>\s*([+-]?\d+[.,]\d+)\s*%"
        m = re.search(pat, html, re.DOTALL)
        if m:
            val = _pct(m.group(1))
            if val is not None:
                result[key] = val

    # ── TER (Frais courants PRIIPS, ignorer "-") ──────────────────────────────
    ter_patterns = [
        r"Frais\s+courants\s+PRIIPS.*?</td>\s*<td[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*%",
        r"Frais\s+courants.*?</td>\s*<td[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*%",
    ]
    for pat in ter_patterns:
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m and m.group(1) != "-":
            ter_pct = _pct(m.group(1))
            if ter_pct is not None and 0 < ter_pct < 20:
                result["ter"] = round(ter_pct / 100, 6)
                result["ongoing_charges"] = result["ter"]
                break

    # ── SRI (jauge 1-7) ───────────────────────────────────────────────────────
    sri_m = re.search(r'indic-srri-selected">\s*(\d)\s*</div>', html)
    if sri_m:
        v = int(sri_m.group(1))
        if 1 <= v <= 7:
            result["sri"] = v
            result["srri"] = v

    # ── SFDR Article ──────────────────────────────────────────────────────────
    sfdr_m = re.search(r"[Aa]rticle\s*([689])\s*(?:SFDR|du\s+r[eè]glement|PRIIPs)?", html)
    if sfdr_m:
        result["sfdr_article"] = int(sfdr_m.group(1))

    # ── Sharpe 3 ans ──────────────────────────────────────────────────────────
    sharpe_m = re.search(r"Ratio\s+de\s+Sharpe.*?</td>\s*<td[^>]*>\s*([+-]?\d+[.,]\d+)", html, re.DOTALL)
    if sharpe_m:
        v = _pct(sharpe_m.group(1))
        if v is not None:
            result["sharpe_3y"] = v

    # ── Volatilité 3 ans ──────────────────────────────────────────────────────
    vol_m = re.search(r"Volatilit[eé].*?</td>\s*<td[^>]*>\s*([0-9]+[.,][0-9]+)\s*%", html, re.DOTALL | re.IGNORECASE)
    if vol_m:
        v = _pct(vol_m.group(1))
        if v is not None and 0 < v < 200:
            result["volatility_3y"] = v

    return result


# ─── Fetch fonds ──────────────────────────────────────────────────────────────

def fetch_fund(sess: FetcherSession, fund_id: int) -> dict:
    """Charge la page /Fonds/{fund_id} et retourne les métriques parsées."""
    try:
        page = sess.get(FUND_URL.format(fund_id=fund_id), stealthy_headers=True, timeout=TIMEOUT_SEC)
        if page.status != 200 or not page.body or len(page.body) < 5000:
            return {}
        html = page.body.decode("utf-8")
        if "indic-srri" not in html and "Perf." not in html:
            return {}
        return parse_quantalys_page(html)
    except Exception:
        return {}


# ─── Requêtes cibles ──────────────────────────────────────────────────────────

def fetch_target_funds(
    client, ter_only: bool, limit: int | None,
    score_min: int | None = None, score_max: int | None = None
) -> list[dict]:
    """Retourne les OPCVM/ETF sans perf_1y ou sans TER (triés par AUM desc).
    score_min/score_max filtrent par data_completeness pour cibler les near-80."""
    funds: list[dict] = []
    seen: set[str] = set()
    page_size = 1000

    def _fetch(null_field: str, with_aum: bool) -> None:
        offset = 0
        while True:
            q = (
                client.table("investissement_funds")
                .select("isin, name, product_type")
                .in_("product_type", ["opcvm", "etf"])
                .is_(null_field, "null")
            )
            if score_min is not None:
                q = q.gte("data_completeness", score_min)
            if score_max is not None:
                q = q.lte("data_completeness", score_max)
            if with_aum:
                q = q.not_.is_("aum_eur", "null").order("aum_eur", desc=True)
            else:
                q = q.is_("aum_eur", "null")
            batch = q.range(offset, offset + page_size - 1).execute().data or []
            for row in batch:
                if row["isin"] not in seen:
                    name_lower = (row.get("name") or "").lower()
                    if not any(p in name_lower for p in SKIP_PATTERNS):
                        seen.add(row["isin"])
                        funds.append(row)
            if len(batch) < page_size:
                break
            offset += page_size

    if not ter_only:
        _fetch("performance_1y", True)
        _fetch("performance_1y", False)

    _fetch("ter", True)
    _fetch("ter", False)

    if limit:
        funds = funds[:limit]
    return funds


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(
    apply: bool, limit: int | None, ter_only: bool,
    score_min: int | None = None, score_max: int | None = None
) -> None:
    print("=" * 60)
    print("  Quantalys Direct Enricher — TER + Perf + SRI")
    print("=" * 60)
    print(f"  Mode       : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  TER seulement : {ter_only}")
    if score_min is not None or score_max is not None:
        print(f"  Score cible   : {score_min or '?'} – {score_max or '?'}")
    if limit:
        print(f"  Limite     : {limit}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    print("  Initialisation session Quantalys…")
    sess = init_session()

    print("  Téléchargement catalogue ISIN → ID…", end=" ", flush=True)
    isin_to_id = fetch_catalog(sess)
    print(f"{len(isin_to_id):,} entrées")
    print()

    funds = fetch_target_funds(client, ter_only, limit, score_min, score_max)
    # Filtrer uniquement les fonds présents dans le catalogue Quantalys
    funds_with_id = [(f, isin_to_id[f["isin"]]) for f in funds if f["isin"] in isin_to_id]

    print(f"  {len(funds)} fonds cibles, {len(funds_with_id)} présents dans Quantalys")
    print()

    found = 0
    no_data = 0
    lock = threading.Lock()

    def process(args: tuple[int, tuple[dict, int]]) -> None:
        nonlocal found, no_data
        i, (fund, fund_id) = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        # Session par thread (initialisée une fois, réutilisée)
        local_sess = get_thread_session()

        time.sleep(RATE_LIMIT_SEC)
        data = fetch_fund(local_sess, fund_id)

        with lock:
            if data and len(data) >= 1:
                found += 1
                if apply:
                    upsert_fund({"isin": isin, **data})
                if i <= 30 or i % 100 == 0:
                    p1 = f"{data['performance_1y']:+.1f}%" if "performance_1y" in data else "N/A"
                    ter = f"{data['ter']*100:.2f}%" if "ter" in data else "N/A"
                    sri = data.get("sri", "?")
                    print(f"  ✓ [{i:5d}] {isin} | perf:{p1:8} | TER:{ter:6} | SRI:{sri} | {name}")
            else:
                no_data += 1
                if i <= 10 or i % 200 == 0:
                    print(f"  ✗ [{i:5d}] {isin} (ID={fund_id}) | no data | {name}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(process, enumerate(funds_with_id, 1)))

    print()
    print(f"  ✓ {found} fonds enrichis, {no_data} sans données")

    if apply:
        log_run("quantalys-direct-enricher", "success", found, no_data, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Quantalys Direct Enricher (ISIN→ID lookup)")
    parser.add_argument("--apply",     action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",     type=int,            help="Limiter à N fonds")
    parser.add_argument("--ter-only",  action="store_true", help="Ne cibler que les fonds sans TER")
    parser.add_argument("--score-min", type=int, default=None, help="Score completeness minimum")
    parser.add_argument("--score-max", type=int, default=None, help="Score completeness maximum")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, ter_only=args.ter_only,
        score_min=args.score_min, score_max=args.score_max)
