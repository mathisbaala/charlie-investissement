#!/usr/bin/env python3
"""
geco-nav.py — VL (cours) des OPCVM français via l'API AMF GECO
===============================================================
Source de prix OFFICIELLE et de SECOURS pour les OPCVM domiciliés en France
(ISIN FR…) que Financial Times ne résout pas (FT couvre ≈ 42 % du top par
encours) : sans elle, ces fonds restent figés sur des VL Yahoo périmées.

GECO a migré en SPA Angular : l'ancien HTML `rech_part.aspx` est mort (cf.
[[geco-vl-api]]). Les VL passent désormais par une API JSON back-office,
reverse-engineered, en 2 temps par ISIN :

  1. GET /back-office/funds/shareByCmpCodeParPrincp/{ISIN}
        → { "idInterne": 43691, … }          (idInterne = id de la PART)
  2. GET /back-office/funds/chart/{idInterne}?startDate=…&endDate=…
        → { "x": ["27-06-2025", …], "y": [341.72, …] }   (séries VL)

La résolution + le fetch sont les mêmes briques (éprouvées) que
geco-performance-enricher.py ; ce script écrit la SÉRIE VL au lieu de
calculer des perfs.

Écriture FILL/ADDITIVE et INCRÉMENTALE dans investissement_fund_prices
(source='amf-geco') :
  - si l'ISIN a déjà des VL : on n'écrit que les points POSTÉRIEURS à sa
    dernière date connue (rafraîchissement bon marché) ;
  - sinon : backfill complet borné à LOOKBACK_YEARS pour que
    compute-metrics ait de l'historique.
L'upsert (conflit isin,price_date) est idempotent : aucune VL existante
n'est écrasée par une autre source.

Cible par défaut : OPCVM FR (product_type='opcvm', ISIN FR…) sans VL
fraîche (aucune VL, ou dernière VL > STALE_DAYS jours), priorité aux plus
gros encours. Complémentaire de justetf-nav.py (ETF) et de ft-enricher.

Usage :
    python3 scripts/scrapers/geco-nav.py --isin FR0010315770        (test 1 ISIN)
    python3 scripts/scrapers/geco-nav.py --limit 50                 (dry-run)
    python3 scripts/scrapers/geco-nav.py --apply --limit 500        (écrit)
    python3 scripts/scrapers/geco-nav.py --apply                    (tous les OPCVM périmés)
    python3 scripts/scrapers/geco-nav.py --apply --offset 5000 --limit 5000  (rotation)
"""

import re
import sys
import json
import time
import argparse
import threading
import concurrent.futures
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_prices, log_run

# ─── Config ──────────────────────────────────────────────────────────────────

SOURCE         = "amf-geco"
GECO_BASE      = "https://geco.amf-france.org/back-office"
HEADERS        = {
    "Content-Type":    "application/json",
    "Accept":          "application/json",
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Referer":         "https://geco.amf-france.org/",
    "Origin":          "https://geco.amf-france.org",
}
WORKERS        = 3        # GECO est sensible au rate limit — concurrence modérée
RATE_LIMIT_SEC = 1.2      # pause par requête (respect du rate limit AMF)
STALE_DAYS     = 5        # une VL ≤ 5 j (FT vient de rafraîchir) est ignorée → pas de
                          # mélange de sources ; une VL couverte par GECO seul (7 j)
                          # repasse chaque semaine et reste fraîche. Cf. justetf-nav.py.
LOOKBACK_YEARS = 5        # backfill borné pour les fonds sans historique
TIMEOUT        = 15
# GECO ne sert que les fonds domiciliés en France (ISIN FR…).
ISIN_RE        = re.compile(r"^FR[A-Z0-9]{9}[0-9]$")
# Placeholders AMF / parts non cotées au quotidien (cf. geco-performance-enricher).
SKIP_PATTERNS  = ("fonds dédié", "***", "fcpe ", "ficpv ", "spécial ")
# Cache ISIN→idInterne : évite de re-résoudre tout l'univers (2 appels AMF/fonds)
# à chaque run. Un hit → on saute la résolution. Un miss est re-tenté après
# MISS_TTL_DAYS (au cas où GECO ajoute le fonds). Les hits sont permanents
# (idInterne stable pour une part).
SHARE_MAP_TABLE = "investissement_geco_share_map"
MISS_TTL_DAYS   = 30


# ─── Cache ISIN → idInterne ─────────────────────────────────────────────────────

def load_share_cache(client, isins: list[str]) -> dict:
    """{isin: {'share_id': int|None, 'miss': bool, 'resolved_at': str}} depuis le cache."""
    out = {}
    for i in range(0, len(isins), 300):
        chunk = isins[i:i + 300]
        try:
            r = (client.table(SHARE_MAP_TABLE)
                 .select("isin,share_id,miss,resolved_at").in_("isin", chunk).execute())
            for row in (r.data or []):
                out[row["isin"]] = row
        except Exception as e:
            print(f"  ⚠️  lecture cache share_id : {e}")
    return out


def persist_share_cache(client, rows: list[dict]) -> None:
    """Upsert des résolutions (share_id ou miss) dans le cache, par lots."""
    if not rows:
        return
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        try:
            client.table(SHARE_MAP_TABLE).upsert(batch, on_conflict="isin").execute()
        except Exception as e:
            print(f"  ⚠️  écriture cache share_id (lot {i//500+1}) ignorée : {e}")


# ─── Sélection des cibles ──────────────────────────────────────────────────────

def _coverage_map(client, isins: list[str]) -> dict:
    """{isin: last_price_date 'YYYY-MM-DD'} pour les ISIN ayant déjà des VL."""
    out = {}
    for i in range(0, len(isins), 300):
        chunk = isins[i:i + 300]
        try:
            r = (client.table("investissement_fund_price_coverage")
                 .select("isin,last_price_date").in_("isin", chunk).execute())
            for row in (r.data or []):
                out[row["isin"]] = row.get("last_price_date")
        except Exception as e:
            print(f"  ⚠️  lecture coverage : {e}")
    return out


def select_targets(client, limit: int | None, offset: int = 0,
                   stale_days: int = STALE_DAYS, ignore_stale: bool = False):
    """OPCVM FR avec ISIN valide, triés par encours décroissant. Renvoie
    [{isin, last}] où `last` est la dernière date de VL connue (None si aucune,
    sert à l'écriture incrémentale).

    Deux modes :
      - défaut : ne garde que les fonds dont la VL est absente ou périmée
        (> stale_days). offset/limit s'appliquent sur cette liste filtrée
        (catch-up ciblé / lancement manuel).
      - ignore_stale=True (rotation hebdo) : ne filtre PAS sur la fraîcheur ;
        offset/limit indexent le RANG dans l'univers complet trié par encours,
        donc stable d'une semaine à l'autre (≠ liste « périmés » qui se
        re-trie). Re-toucher un fonds déjà frais coûte ~0 écriture (incrémental
        ne renvoie aucun point neuf)."""
    cutoff = (date.today() - timedelta(days=stale_days)).isoformat()
    targets, page, size, skipped = [], 0, 1000, 0
    while True:
        rows = (client.table("investissement_funds")
                .select("isin,name")
                .eq("product_type", "opcvm")
                .like("isin", "FR%")
                .order("aum_eur", desc=True, nullsfirst=False)
                .range(page * size, page * size + size - 1)
                .execute().data or [])
        if not rows:
            break
        valid = []
        for r in rows:
            isin = (r.get("isin") or "").strip()
            if not ISIN_RE.match(isin):
                continue
            name_lower = (r.get("name") or "").lower()
            if any(p in name_lower for p in SKIP_PATTERNS):
                continue
            valid.append(isin)
        cov = _coverage_map(client, valid)
        for isin in valid:
            last = cov.get(isin)
            if not ignore_stale and last is not None and last >= cutoff:
                continue  # déjà frais
            if skipped < offset:
                skipped += 1
                continue
            targets.append({"isin": isin, "last": last})
            if limit and len(targets) >= limit:
                return targets
        if len(rows) < size:
            break
        page += 1
    return targets


# ─── Résolution share_id + fetch série VL (briques GECO back-office) ───────────

def _share_from_json(text: str) -> int | None:
    """Extrait idInterne d'une réponse shareByCmpCodeParPrincp (ou None)."""
    if text.strip() in ("", "null", "{}"):
        return None
    try:
        share = json.loads(text)
    except ValueError:
        return None
    if isinstance(share, dict) and share.get("idInterne"):
        return int(share["idInterne"])
    return None


def _find_share_id(session: requests.Session, isin: str) -> int | None:
    """idInterne de la PART pour un ISIN (None si introuvable).

    1. GET shareByCmpCodeParPrincp/{ISIN} — direct pour les ISIN FR.
    2. Fallback : POST compartments (globalFilter=ISIN) → cmpCodeParPrincp →
       shareByCmpCodeParPrincp, puis compartment/{id}/shares.
    Même recette que geco-performance-enricher.py, en requests (pas de scrapling)."""
    try:
        r = session.get(
            f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{isin}",
            headers=HEADERS, timeout=TIMEOUT,
        )
        if r.status_code == 200:
            sid = _share_from_json(r.text)
            if sid:
                return sid
    except Exception:
        pass

    payload = {"first": 0, "rows": 10, "sortOrder": 1, "filters": {}, "globalFilter": isin}
    try:
        r2 = session.post(
            f"{GECO_BASE}/funds/getCompartmentsBycriteria?productType=FR",
            headers=HEADERS, json=payload, timeout=TIMEOUT,
        )
        if r2.status_code != 200:
            return None
        compartments = r2.json().get("compartmentDtos", [])
    except (Exception, ValueError):
        return None

    target_cmp = next((c for c in compartments if isin in (c.get("sharesIsins") or [])), None)
    if not target_cmp:
        return None
    code = target_cmp.get("cmpCodeParPrincp")
    id_interne = target_cmp.get("idInterne")

    if code:
        try:
            r3 = session.get(
                f"{GECO_BASE}/funds/shareByCmpCodeParPrincp/{code}",
                headers=HEADERS, timeout=TIMEOUT,
            )
            if r3.status_code == 200:
                sid = _share_from_json(r3.text)
                if sid:
                    return sid
        except Exception:
            pass

    if id_interne:
        try:
            r4 = session.get(
                f"{GECO_BASE}/funds/compartment/{id_interne}/shares",
                headers=HEADERS, timeout=TIMEOUT,
            )
            if r4.status_code == 200:
                shares = r4.json()
                if isinstance(shares, list) and shares and shares[0].get("idInterne"):
                    return int(shares[0]["idInterne"])
        except (Exception, ValueError):
            pass

    return None


def parse_chart_payload(data: dict) -> list[dict]:
    """Convertit la réponse chart GECO {x:[…], y:[…]} en
    [{date 'YYYY-MM-DD', nav, currency}], triée par date.
    GECO renvoie les dates au format DD-MM-YYYY ; les NAV None/≤0 sont écartées.
    Pur (sans I/O) → testable."""
    xs, ys = data.get("x", []), data.get("y", [])
    if not xs or not ys or len(xs) != len(ys):
        return []
    # GECO renvoie parfois DEUX points pour la même date → on déduplique par date
    # (dernière valeur de la série gardée). Sans ça, upsert(on_conflict=isin,
    # price_date) plante : « ON CONFLICT cannot affect row a second time » (21000),
    # et tout le batch de 500 VL est perdu.
    by_date: dict[str, float] = {}
    for d_str, nav in zip(xs, ys):
        if nav is None:
            continue
        try:
            d = datetime.strptime(d_str, "%d-%m-%Y").date().isoformat()  # GECO : DD-MM-YYYY
            v = float(nav)
        except (ValueError, TypeError):
            continue
        if v > 0:
            by_date[d] = v  # une date en double écrase → un seul point/date
    return [{"date": d, "nav": by_date[d], "currency": "EUR"}
            for d in sorted(by_date)]


def incremental_points(series: list[dict], last: str | None,
                       min_backfill: str) -> list[dict]:
    """Points à écrire : strictement postérieurs à la dernière VL connue (`last`),
    sinon backfill borné à `min_backfill` (inclus). Les dates ISO se comparent
    lexicographiquement. Pur → testable."""
    if last:
        return [p for p in series if p["date"] > last]
    return [p for p in series if p["date"] >= min_backfill]


def fetch_series(session: requests.Session, share_id: int) -> list[dict]:
    """Renvoie [{date 'YYYY-MM-DD', nav, currency}] depuis l'API chart GECO, ou []."""
    start = (date.today() - timedelta(days=365 * LOOKBACK_YEARS + 30)).isoformat()
    end   = date.today().isoformat()
    try:
        r = session.get(
            f"{GECO_BASE}/funds/chart/{share_id}",
            headers=HEADERS, params={"startDate": start, "endDate": end}, timeout=TIMEOUT,
        )
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}")
        data = r.json()
    except (Exception, ValueError) as e:
        raise RuntimeError(str(e)[:120])
    return parse_chart_payload(data)


# ─── Run ─────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, isin_arg: str | None,
        offset: int = 0, delay: float = RATE_LIMIT_SEC, workers: int = WORKERS,
        ignore_stale: bool = False):
    print("=" * 64)
    print("  GECO NAV — cours OPCVM FR via l'API AMF back-office")
    print("=" * 64)
    print(f"  Mode      : {'APPLY' if apply else 'DRY-RUN'}")
    client = get_client()
    started = datetime.now(timezone.utc)

    if isin_arg:
        targets = [{"isin": isin_arg.strip().upper(), "last": None}]
    else:
        scope = "univers complet par rang (rotation)" if ignore_stale \
            else "OPCVM FR sans VL fraîche"
        print(f"  Sélection des cibles ({scope})…", flush=True)
        targets = select_targets(client, limit, offset=offset, ignore_stale=ignore_stale)
    print(f"  {len(targets)} fonds à traiter   (workers={workers}, délai={delay}s)")

    # Cache ISIN→idInterne : on ne résout en live que les ISIN absents du cache
    # (ou dont le miss a expiré). En régime permanent, presque tout est en cache
    # → 1 seul appel chart/fonds au lieu de 3.
    cache = load_share_cache(client, [t["isin"] for t in targets])
    miss_cutoff = (datetime.now(timezone.utc) - timedelta(days=MISS_TTL_DAYS)).isoformat()
    hits = sum(1 for c in cache.values() if c.get("share_id"))
    print(f"  cache share_id : {hits} hits / {len(cache)} entrées\n")

    min_backfill = (date.today() - timedelta(days=365 * LOOKBACK_YEARS)).isoformat()
    lock = threading.Lock()
    state = {"ok": 0, "no_share": 0, "no_nav": 0, "prices": 0, "done": 0, "resolved": 0}
    errors = []
    new_cache: list[dict] = []  # résolutions live à persister en fin de run

    def process(args):
        n, t = args
        isin, last = t["isin"], t.get("last")
        session = requests.Session()

        # 1) Cache : hit → share_id direct ; miss récent → on saute (pas de re-résolution).
        cached = cache.get(isin)
        share_id = cached.get("share_id") if cached else None
        if share_id is None and cached and cached.get("miss") \
                and (cached.get("resolved_at") or "") >= miss_cutoff:
            with lock:
                state["no_share"] += 1
                state["done"] += 1
            return

        # 2) Inconnu / miss expiré → résolution live (1 ou 2 appels), puis cache.
        if share_id is None:
            time.sleep(delay)
            share_id = _find_share_id(session, isin)
            with lock:
                state["resolved"] += 1
                new_cache.append({"isin": isin, "share_id": share_id,
                                  "miss": share_id is None})
        if not share_id:
            with lock:
                state["no_share"] += 1
                state["done"] += 1
            return

        time.sleep(delay * 0.5)
        try:
            series = fetch_series(session, share_id)
        except Exception as e:
            with lock:
                errors.append({"isin": isin, "error": str(e)[:120]})
                state["no_nav"] += 1
                state["done"] += 1
            return
        if not series:
            with lock:
                state["no_nav"] += 1
                state["done"] += 1
            return

        # Incrémental : seulement les points postérieurs à la dernière VL connue.
        # Sans historique → backfill borné à LOOKBACK_YEARS.
        new_points = incremental_points(series, last, min_backfill)

        with lock:
            state["ok"] += 1
            state["done"] += 1
            done = state["done"]
            if new_points:
                latest = max(p["date"] for p in new_points)
                if apply:
                    ins, _ = upsert_prices(isin, new_points, SOURCE)
                    state["prices"] += ins
                else:
                    state["prices"] += len(new_points)
                if state["ok"] <= 5 or state["ok"] % 200 == 0:
                    print(f"    {isin}: +{len(new_points)} VL (→ {latest})"
                          + ("" if apply else "  [dry-run]"))
            if done % 25 == 0 or done == len(targets):
                print(f"  [{done:5d}/{len(targets)}] ok:{state['ok']} "
                      f"no_share:{state['no_share']} no_nav:{state['no_nav']} "
                      f"VL:{state['prices']}", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(process, enumerate(targets, 1)))

    # Persiste les résolutions live (hits permanents + miss avec TTL) pour les
    # prochains runs. En dry-run on ne touche pas le cache.
    if apply and new_cache:
        persist_share_cache(client, new_cache)

    print(f"\n  → {state['ok']}/{len(targets)} OPCVM résolus sur GECO | "
          f"{state['no_share']} sans share | {state['no_nav']} sans VL | "
          f"{state['prices']} VL {'écrites' if apply else '(dry-run)'}")
    print(f"  cache : {state['resolved']} résolutions live "
          f"({len(new_cache)} mises en cache), reste servi par le cache")
    if errors:
        print(f"  {len(errors)} erreurs (5 premières) : "
              + ", ".join(f"{e['isin']}:{e['error']}" for e in errors[:5]))

    if apply:
        status = "success" if state["ok"] else "partial"
        log_run(SOURCE, status, records_processed=state["ok"],
                records_failed=state["no_share"] + state["no_nav"],
                errors=errors[:50], started_at=started)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="VL des OPCVM FR via l'API AMF GECO")
    ap.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit", type=int, help="Limiter à N fonds")
    ap.add_argument("--offset", type=int, default=0,
                    help="Sauter les N premières cibles (tri encours décroissant) — rotation")
    ap.add_argument("--isin", type=str, help="Un seul ISIN (test)")
    ap.add_argument("--workers", type=int, default=WORKERS,
                    help=f"Threads concurrents (défaut {WORKERS})")
    ap.add_argument("--delay", type=float, default=RATE_LIMIT_SEC,
                    help=f"Pause/req en s (défaut {RATE_LIMIT_SEC})")
    ap.add_argument("--all", dest="ignore_stale", action="store_true",
                    help="Ignorer le filtre de fraîcheur : offset/limit indexent "
                         "le rang dans l'univers complet (rotation hebdo stable)")
    a = ap.parse_args()
    sys.exit(run(apply=a.apply, limit=a.limit, isin_arg=a.isin,
                 offset=a.offset, delay=a.delay, workers=a.workers,
                 ignore_stale=a.ignore_stale))
