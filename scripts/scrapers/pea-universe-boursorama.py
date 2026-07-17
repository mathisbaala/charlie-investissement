#!/usr/bin/env python3
"""
pea-universe-boursorama.py — Univers complet des fonds éligibles PEA / PEA-PME
===============================================================================
Récolte GRATUITE (pages publiques Boursorama, aucune API payante) de tous les
OPCVM et ETF déclarés éligibles PEA et PEA-PME, en vue d'une intégration
ultérieure en base (fichier JSON de récolte, AUCUNE écriture Supabase ici).

Deux phases :
  1. Listing  — la recherche publique Boursorama expose un filtre éligibilité :
       OPCVM : /bourse/opcvm/recherche/?beginnerFundSearch[eligibility][]=taxation
       ETF   : /bourse/trackers/recherche/?beginnerEtfSearch[eligibility][]=taxation
       (valeur `taxation` = PEA, `taxationPEAPME` = PEA-PME)
     Pagination /page-N, ~25 fonds/page, arrêt sur page vide.
     → symboles internes Boursorama (0P… Morningstar, MP-…) + noms.
  2. Détail   — chaque fiche /bourse/{segment}/cours/{symbole}/ affiche l'ISIN
     (classe faceplate__isin + <title>). Extraction + validation clé ISO 6166.

Sortie : scripts/data/pea-harvest-boursorama.json
  { meta, funds: [{isin, name, product_type, pea_eligible, pea_pme_eligible,
                   bourso_symbol, management_company, currency, source_url}] }

Checkpoint : le JSON est réécrit tous les CHECKPOINT_EVERY détails résolus ;
relancer le script reprend là où il s'était arrêté (symboles déjà résolus
sautés). --reset ignore le checkpoint et repart de zéro.

Usage :
    python3 scripts/scrapers/pea-universe-boursorama.py             # récolte complète
    python3 scripts/scrapers/pea-universe-boursorama.py --limit 50  # test
    python3 scripts/scrapers/pea-universe-boursorama.py --reset     # repartir de zéro

Nécessite : curl_cffi (déjà dans scripts/requirements.txt).
Rate limit : ~0.45 s/requête/worker, 4 workers — soit ~15-20 min au total.
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

from curl_cffi import requests as creq

# ─── Config ────────────────────────────────────────────────────────────────────

BASE           = "https://www.boursorama.com"
OUT_PATH       = Path(__file__).parent.parent / "data" / "pea-harvest-boursorama.json"
WORKERS        = 3
RATE_LIMIT_SEC = 0.6
TIMEOUT        = 25
MAX_PAGES      = 300           # garde-fou pagination
CHECKPOINT_EVERY = 100

# (segment URL, préfixe du formulaire, product_type Charlie)
SEGMENTS = [
    ("opcvm",    "beginnerFundSearch", "opcvm"),
    ("trackers", "beginnerEtfSearch",  "etf"),
]
# valeur du filtre éligibilité → drapeau
ELIGIBILITIES = [
    ("taxation",       "pea_eligible"),
    ("taxationPEAPME", "pea_pme_eligible"),
]

LINK_RE  = re.compile(r'href="/bourse/(opcvm|trackers)/cours/([^/"]+)/"[^>]*>([^<]+)</a>')
ISIN_RE  = re.compile(r"\b([A-Z]{2}[0-9A-Z]{9}[0-9])\b")
FACEPLATE_ISIN_RE = re.compile(r"faceplate__isin[^>]*>\s*([A-Z]{2}[0-9A-Z]{9}[0-9])\s*(?:-\s*([^<]+?))?\s*<")
TITLE_RE = re.compile(r"<title>([^<]+)</title>")

_print_lock = threading.Lock()


# ─── ISIN — clé de contrôle ISO 6166 (Luhn sur chiffres convertis) ────────────

def isin_valid(isin: str) -> bool:
    if not re.match(r"^[A-Z]{2}[0-9A-Z]{9}[0-9]$", isin):
        return False
    digits = "".join(str(int(c, 36)) for c in isin)
    total = 0
    # Luhn : en partant de la droite, doubler un chiffre sur deux à partir
    # du DEUXIÈME (le chiffre de contrôle, index 0, n'est jamais doublé).
    for i, d in enumerate(reversed(digits)):
        n = int(d)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


# ─── HTTP ──────────────────────────────────────────────────────────────────────

def new_session() -> creq.Session:
    return creq.Session(impersonate="chrome")


def get(session: creq.Session, url: str, params: dict | None = None) -> str | None:
    last = None
    for attempt in range(3):
        try:
            r = session.get(url, params=params, timeout=TIMEOUT)
            if r.status_code == 200:
                return r.text
            last = f"HTTP {r.status_code}"
            if r.status_code in (403, 429):
                time.sleep(5 * (attempt + 1))
                continue
            break
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(2 * (attempt + 1))
    with _print_lock:
        print(f"    ! échec GET {url} — {last}")
    return None


# ─── Phase 1 : listing paginé ─────────────────────────────────────────────────

def sweep_listing(session: creq.Session, segment: str, form: str, value: str) -> dict[str, str]:
    """Balaye la recherche filtrée ; retourne {symbole: nom}."""
    params = {f"{form}[eligibility][]": value}
    found: dict[str, str] = {}
    empty_streak = 0
    for page in range(1, MAX_PAGES + 1):
        url = f"{BASE}/bourse/{segment}/recherche/" if page == 1 \
            else f"{BASE}/bourse/{segment}/recherche/page-{page}"
        html = get(session, url, params)
        if html is None:
            empty_streak += 1
            if empty_streak >= 2:
                break
            continue
        # ne garder que le bloc résultats (écarte palmarès/sidebars de la page 1)
        anchor = html.find('id="search-results"')
        body = html[anchor:] if anchor != -1 else html
        page_syms = {}
        for seg, sym, label in LINK_RE.findall(body):
            if seg == segment:
                page_syms.setdefault(sym, label.strip())
        new = {s: n for s, n in page_syms.items() if s not in found}
        found.update(new)
        if not page_syms:
            break
        print(f"    page {page:>3} : {len(page_syms):>3} fonds ({len(found)} cumulés)")
        time.sleep(RATE_LIMIT_SEC)
    return found


# ─── Phase 2 : résolution ISIN sur les fiches ─────────────────────────────────

def resolve_detail(session: creq.Session, segment: str, symbol: str) -> dict | None:
    url = f"{BASE}/bourse/{segment}/cours/{symbol}/"
    html = get(session, url)
    if html is None:
        return None
    isin = mgmt = currency = None
    m = FACEPLATE_ISIN_RE.search(html)
    if m:
        isin = m.group(1)
        mgmt = (m.group(2) or "").strip() or None
    if not isin:
        mt = TITLE_RE.search(html)
        if mt:
            mi = ISIN_RE.search(mt.group(1))
            if mi:
                isin = mi.group(1)
    mt = TITLE_RE.search(html)
    if mt:
        mc = re.search(r"\b(EUR|USD|GBP|CHF)\b", mt.group(1))
        if mc:
            currency = mc.group(1)
    if not isin or not isin_valid(isin):
        return None
    return {"isin": isin, "management_company": mgmt, "currency": currency, "source_url": url}


# ─── Sortie ────────────────────────────────────────────────────────────────────

def write_output(catalog: dict[str, dict], listing_counts: dict[str, int]) -> None:
    funds = [v for v in catalog.values() if v.get("isin")]
    payload = {
        "meta": {
            "harvested_at": datetime.now(timezone.utc).isoformat(),
            "source": "boursorama.com — recherche publique OPCVM + trackers, filtre éligibilité PEA / PEA-PME",
            "method": "listing paginé (25/page) puis résolution ISIN par fiche (faceplate__isin), clé ISO 6166 validée",
            "cost": "0 € — pages publiques uniquement",
            "listing_counts": listing_counts,
            "nb_symbols": len(catalog),
            "nb_isins_resolved": len(funds),
        },
        "funds": sorted(funds, key=lambda f: f["isin"]),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    tmp.replace(OUT_PATH)


def load_checkpoint() -> dict[str, dict]:
    """Recharge une récolte partielle ; clé = bourso_symbol."""
    if not OUT_PATH.exists():
        return {}
    try:
        data = json.loads(OUT_PATH.read_text())
        return {f["bourso_symbol"]: f for f in data.get("funds", []) if f.get("bourso_symbol")}
    except (json.JSONDecodeError, KeyError):
        return {}


# ─── Main ──────────────────────────────────────────────────────────────────────

def run(limit: int | None, reset: bool) -> None:
    print("=" * 64)
    print("  Univers PEA / PEA-PME — récolte Boursorama (gratuite)")
    print("=" * 64)

    session = new_session()

    # ── Phase 1 : les 4 listings ──
    # catalog[symbol] = {name, product_type, segment, pea_eligible, pea_pme_eligible, …}
    catalog: dict[str, dict] = {}
    listing_counts: dict[str, int] = {}
    for segment, form, ptype in SEGMENTS:
        for value, flag in ELIGIBILITIES:
            print(f"\n  Listing {segment} / {flag} …")
            syms = sweep_listing(session, segment, form, value)
            listing_counts[f"{segment}:{flag}"] = len(syms)
            for sym, name in syms.items():
                entry = catalog.setdefault(sym, {
                    "bourso_symbol": sym, "name": name, "product_type": ptype,
                    "segment": segment,
                    "pea_eligible": False, "pea_pme_eligible": False,
                })
                entry[flag] = True
            print(f"  → {len(syms)} fonds {segment} ({flag})")

    print(f"\n  Total symboles uniques : {len(catalog)}")
    if limit:
        kept = dict(list(catalog.items())[:limit])
        catalog = kept
        print(f"  --limit {limit} → {len(catalog)} symboles conservés")

    # ── Reprise checkpoint ──
    if not reset:
        prev = load_checkpoint()
        reused = 0
        for sym, entry in catalog.items():
            old = prev.get(sym)
            if old and old.get("isin"):
                entry.update({k: old[k] for k in
                              ("isin", "management_company", "currency", "source_url")
                              if k in old})
                reused += 1
        if reused:
            print(f"  Checkpoint : {reused} ISIN déjà résolus, sautés")

    # ── Phase 2 : détails ──
    todo = [s for s, e in catalog.items() if not e.get("isin")]
    print(f"  Fiches à résoudre : {len(todo)}\n")

    done = failed = 0
    counter_lock = threading.Lock()
    sessions = threading.local()

    def worker(sym: str) -> tuple[str, dict | None]:
        if not hasattr(sessions, "s"):
            sessions.s = new_session()
        time.sleep(RATE_LIMIT_SEC)
        return sym, resolve_detail(sessions.s, catalog[sym]["segment"], sym)

    failed_syms: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for sym, detail in pool.map(worker, todo):
            with counter_lock:
                if detail:
                    catalog[sym].update(detail)
                    done += 1
                else:
                    failed += 1
                    failed_syms.append(sym)
                n = done + failed
                if n % CHECKPOINT_EVERY == 0:
                    write_output(catalog, listing_counts)
                    with _print_lock:
                        print(f"    {n}/{len(todo)} fiches ({done} ok, {failed} sans ISIN) — checkpoint")

    # ── Passe de rattrapage séquentielle (échecs transitoires antibot) ──
    if failed_syms:
        print(f"\n  Rattrapage séquentiel : {len(failed_syms)} fiches en échec…")
        retry_session = new_session()
        for i, sym in enumerate(failed_syms):
            time.sleep(1.2)
            detail = resolve_detail(retry_session, catalog[sym]["segment"], sym)
            if detail:
                catalog[sym].update(detail)
                done += 1
                failed -= 1
            if (i + 1) % 50 == 0:
                write_output(catalog, listing_counts)
                print(f"    rattrapage {i + 1}/{len(failed_syms)} ({failed} restants)")

    write_output(catalog, listing_counts)

    resolved = [e for e in catalog.values() if e.get("isin")]
    pea      = sum(1 for e in resolved if e["pea_eligible"])
    pme      = sum(1 for e in resolved if e["pea_pme_eligible"])
    etf      = sum(1 for e in resolved if e["product_type"] == "etf")
    print()
    print("=" * 64)
    print(f"  Récolte : {len(resolved)} ISIN résolus / {len(catalog)} symboles")
    print(f"    PEA : {pea}   PEA-PME : {pme}   (ETF : {etf}, OPCVM : {len(resolved) - etf})")
    print(f"    échecs fiche : {failed}")
    print(f"  → {OUT_PATH}")
    print("=" * 64)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Récolte l'univers PEA/PEA-PME depuis Boursorama (gratuit)")
    parser.add_argument("--limit", type=int, help="limiter à N symboles (test)")
    parser.add_argument("--reset", action="store_true", help="ignorer le checkpoint existant")
    args = parser.parse_args()
    run(limit=args.limit, reset=args.reset)
