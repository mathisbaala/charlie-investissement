#!/usr/bin/env python3
"""
morningstar-lt-enricher.py — Enrichissement complet via l'API lt.morningstar.com
=================================================================================
Deux appels par fonds :
  1. Recherche ISIN → Morningstar ID + star rating
     https://www.morningstar.fr/fr/util/SecuritySearch.ashx?q={isin}&limit=1
  2. Détails complets → performance, risque, TER, KID
     https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{ms_id}
     ?viewId=snapshot&locale=fr-FR&languageId=fr-FR&currencyId=EUR&responseViewFormat=json

Champs extraits :
  - performance_1y  (M12, déjà en %)
  - performance_3y  (M36 annualisé → converti en cumul total sur 3 ans)
  - performance_5y  (M60 annualisé → converti en cumul total sur 5 ans)
  - morningstar_rating (1-5 étoiles, depuis sr dans la recherche)
  - ongoing_charges / ter
  - volatility_1y / volatility_3y  (StandardDeviations EUR, annualisées, en %)
  - sharpe_1y / sharpe_3y          (SharpeRatios EUR)
  - kid_url  (Document KID/KIID le plus récent, marché FRA prioritaire)

Usage :
    python3 scripts/scrapers/morningstar-lt-enricher.py [--apply] [--limit N] [--isin ISIN]
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

from urllib.parse import urlencode
from scrapling.fetchers import FetcherSession, StealthyFetcher, StealthySession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_fund, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

WORKERS          = 1        # 2+ workers déclenchent un blocage IP (~4h) — garder à 1
RATE_LIMIT_SEC   = 1.5    # entre chaque requête HTTP par worker
TIMEOUT          = 5       # secondes (réduit pour éviter blocage sur fonds non trouvés)

SEARCH_URL  = "https://www.morningstar.fr/fr/util/SecuritySearch.ashx"
DETAILS_URL = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{ms_id}"
KID_URL_TPL = "https://doc.morningstar.com/document/{encoded_id}.pdf"

# ─── Fallback StealthySession (persistante) ────────────────────────────────────

_stealth_mode         = threading.Event()   # auto-set à la première détection de blocage
_stealth_session_obj: StealthySession | None = None
_stealth_init_lock    = threading.Lock()
_stealth_fetch_lock   = threading.Lock()    # StealthySession n'est pas thread-safe


def _get_stealth_session() -> StealthySession:
    """Crée ou retourne la StealthySession partagée (1 navigateur pour tout le run)."""
    global _stealth_session_obj
    with _stealth_init_lock:
        if _stealth_session_obj is None:
            _stealth_session_obj = StealthySession(headless=True)
            _stealth_session_obj.__enter__()
    return _stealth_session_obj


def _close_stealth_session() -> None:
    global _stealth_session_obj
    with _stealth_init_lock:
        if _stealth_session_obj is not None:
            try:
                _stealth_session_obj.__exit__(None, None, None)
            except Exception:
                pass
            _stealth_session_obj = None


def _is_blocked(page) -> bool:
    """Détecte un blocage Morningstar : 503, corps vide, ou HTML d'erreur."""
    if page.status not in (200, 201):
        return True
    if not page.body or len(page.body) < 10:
        return True
    return False


def _ms_get(session: FetcherSession, url: str, params: dict | None = None) -> object:
    """Fetch Morningstar via HTTP statique. Si blocage, retourne la page bloquée."""
    params = params or {}
    page = session.get(url, params=params, stealthy_headers=True, timeout=TIMEOUT)
    return page


# ─── Parseurs ─────────────────────────────────────────────────────────────────

def search_ms_id(session: FetcherSession, isin: str) -> tuple[str | None, int | None]:
    """Retourne (ms_id, star_rating) via l'API de recherche Morningstar."""
    try:
        page = _ms_get(session, SEARCH_URL, {"q": isin, "limit": 1})
        if _is_blocked(page):
            return None, None

        # Format : "Nom du fonds|{json}|TYPE|||Categorie"
        parts = page.body.decode("utf-8").strip().split("|")
        if len(parts) < 2:
            return None, None

        # Trouver le bloc JSON (contient "i" pour id)
        ms_id = star = None
        for part in parts:
            part = part.strip()
            if part.startswith("{") and '"i"' in part:
                try:
                    obj = json.loads(part)
                    ms_id = obj.get("i") or obj.get("pi")
                    sr = obj.get("sr")
                    if sr is not None:
                        try:
                            v = int(sr)
                            if 1 <= v <= 5:
                                star = v
                        except (ValueError, TypeError):
                            pass
                except json.JSONDecodeError:
                    pass

        return ms_id, star

    except Exception:
        return None, None


def _get_trailing_perf(item: dict) -> dict[str, float]:
    """Extrait les performances M12/M36/M60 depuis TrailingPerformance."""
    perfs: dict[str, float] = {}
    for entry in item.get("TrailingPerformance", []):
        for ret in entry.get("Return", []):
            period = ret.get("TimePeriod")
            val = ret.get("Value")
            if period in ("M12", "M36", "M60") and val is not None:
                try:
                    perfs[period] = float(val)
                except (ValueError, TypeError):
                    pass
    return perfs


def _get_risk_stats(item: dict) -> dict[str, float]:
    """Extrait StandardDeviations + SharpeRatios en EUR."""
    out: dict[str, float] = {}
    for rs in item.get("RiskStatistics", []):
        if rs.get("CurrencyId") != "EUR":
            continue
        for sd in rs.get("StandardDeviations", []):
            p = sd.get("TimePeriod")
            v = sd.get("Value")
            if p == "M12" and v is not None:
                out["vol_1y"] = float(v)
            elif p == "M36" and v is not None:
                out["vol_3y"] = float(v)
        for sh in rs.get("SharpeRatios", []):
            p = sh.get("TimePeriod")
            v = sh.get("Value")
            if p == "M12" and v is not None:
                out["sharpe_1y"] = float(v)
            elif p == "M36" and v is not None:
                out["sharpe_3y"] = float(v)
        break  # prendre seulement le premier bloc EUR
    return out


def _best_kid_url(item: dict) -> str | None:
    """Retourne l'URL du KID le plus récent (marché FRA prioritaire)."""
    docs = [d for d in item.get("Documents", []) if "4" in d.get("DocumentTypes", [])]
    if not docs:
        return None

    # Trier par date de dépôt décroissante
    docs_sorted = sorted(docs, key=lambda d: d.get("FilingDate", ""), reverse=True)

    # Préférer un document avec marché FRA
    for d in docs_sorted:
        if "FRA" in d.get("Markets", []):
            enc = d.get("EncodedDocumentId")
            if enc:
                return KID_URL_TPL.format(encoded_id=enc)

    # Fallback : premier document disponible
    enc = docs_sorted[0].get("EncodedDocumentId")
    return KID_URL_TPL.format(encoded_id=enc) if enc else None


def fetch_ms_details(session: FetcherSession, ms_id: str) -> dict | None:
    """Appelle l'API lt.morningstar.com et retourne les métriques extraites."""
    try:
        url = DETAILS_URL.format(ms_id=ms_id)
        page = _ms_get(session, url, {
            "viewId": "snapshot",
            "locale": "fr-FR",
            "languageId": "fr-FR",
            "currencyId": "EUR",
            "responseViewFormat": "json",
        })
        if _is_blocked(page):
            return None

        data = json.loads(page.body.decode("utf-8"))
        if not data or not isinstance(data, list):
            return None

        item = data[0]
        result: dict = {}

        # ── Performances ───────────────────────────────────────────────
        # M12 = total 1Y (identique annualisé vs total sur 1 an)
        # M36/M60 = annualisés → conversion en cumul total pour cohérence avec compute-metrics
        perfs = _get_trailing_perf(item)
        if "M12" in perfs:
            result["performance_1y"] = round(perfs["M12"], 4)
        if "M36" in perfs:
            result["performance_3y"] = round(((1 + perfs["M36"] / 100) ** 3 - 1) * 100, 4)
        if "M60" in perfs:
            result["performance_5y"] = round(((1 + perfs["M60"] / 100) ** 5 - 1) * 100, 4)

        # ── TER / Frais courants ───────────────────────────────────────
        oc_raw = item.get("OngoingCharge")
        if oc_raw:
            try:
                oc = float(str(oc_raw).replace(",", "."))
                if 0 < oc < 20:
                    result["ongoing_charges"] = round(oc / 100, 6)
                    result["ter"]             = round(oc / 100, 6)
            except (ValueError, TypeError):
                pass

        # ── Volatilité + Sharpe (EUR annualisé) ───────────────────────
        risk = _get_risk_stats(item)
        if "vol_1y" in risk:
            result["volatility_1y"] = round(risk["vol_1y"], 4)
        if "vol_3y" in risk:
            result["volatility_3y"] = round(risk["vol_3y"], 4)
        if "sharpe_1y" in risk:
            result["sharpe_1y"] = round(risk["sharpe_1y"], 4)
        if "sharpe_3y" in risk:
            result["sharpe_3y"] = round(risk["sharpe_3y"], 4)

        # ── KID URL ────────────────────────────────────────────────────
        kid = _best_kid_url(item)
        if kid:
            result["kid_url"] = kid

        # ── Management company ─────────────────────────────────────────
        # ProviderCompany.Name = société de gestion (jamais ManagerList qui contient des personnes)
        provider = (item.get("ProviderCompany") or {}).get("Name", "").strip()
        if provider and len(provider) > 2:
            result["management_company"] = provider

        # ── Catégorie Morningstar ──────────────────────────────────────
        cat = (item.get("CategoryName") or "").strip()
        if not cat:
            cat = (item.get("InvestmentType") or "").strip()
        if cat and len(cat) > 2:
            result["category"] = cat

        # ── Date de création ───────────────────────────────────────────
        inception_raw = (item.get("InceptionDate") or "").strip()
        if inception_raw:
            # Format : "2018-04-18T00:00:00" → "2018-04-18"
            result["inception_date"] = inception_raw[:10]

        # Domicile ignoré : colonne `country` absente du schéma DB

        return result if result else None

    except (ValueError, KeyError, Exception):
        return None


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(
    apply: bool, limit: int | None, isin_filter: str | None,
    score_min: int | None = None, score_max: int | None = None,
    ter_only: bool = False,
):
    print("=" * 60)
    print("  Morningstar LT Enricher — Performance + TER + Sharpe + KID")
    print("=" * 60)
    print(f"  Mode    : {'APPLY' if apply else 'DRY-RUN'}")
    if limit:
        print(f"  Limite  : {limit}")
    if score_min is not None or score_max is not None:
        print(f"  Score   : {score_min or '?'} – {score_max or '?'}")
    if ter_only:
        print("  TER only: oui")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    if isin_filter:
        funds = [{"isin": isin_filter, "name": ""}]
    else:
        # Cibler les fonds sans morningstar_rating OU sans performance_1y
        # (en pratique : l'union des deux groupes sans doublon)
        funds: list[dict] = []
        seen: set[str] = set()
        page_size = 1000

        SKIP_PATTERNS = ("fonds dédié", "***", "fcpe ", "ficpv ")

        # Préfixes ISIN non-standard → absents de Morningstar
        SKIP_PREFIXES = ("CS", "QS", "QUA", "XS", "OT", "AM", "SC", "GF", "SU", "MS", "XF", "US", "JP")

        null_fields = ("ter",) if ter_only else ("morningstar_rating", "performance_1y", "management_company", "category", "inception_date", "ter")

        # Phase 1 : fonds avec AUM connu → triés par AUM desc (meilleure couverture Morningstar)
        # Phase 2 : fonds sans AUM (peuvent quand même être sur Morningstar)
        for phase, aum_filter in [(1, True), (2, False)]:
            for null_field in null_fields:
                offset = 0
                while True:
                    q = (
                        client.table("investissement_funds")
                        .select("isin, name, product_type, aum_eur, management_company, category, inception_date")
                        .in_("product_type", ["opcvm", "etf"])
                        .is_(null_field, "null")
                    )
                    if score_min is not None:
                        q = q.gte("data_completeness", score_min)
                    if score_max is not None:
                        q = q.lte("data_completeness", score_max)
                    if aum_filter:
                        q = q.not_.is_("aum_eur", "null").order("aum_eur", desc=True)
                    else:
                        q = q.is_("aum_eur", "null")
                    q = q.range(offset, offset + page_size - 1)
                    batch = q.execute().data or []
                    for row in batch:
                        isin = row["isin"]
                        if isin in seen:
                            continue
                        if any(isin.startswith(pfx) for pfx in SKIP_PREFIXES):
                            continue
                        name_lower = (row.get("name") or "").lower()
                        if not any(p in name_lower for p in SKIP_PATTERNS):
                            seen.add(isin)
                            funds.append(row)
                    if len(batch) < page_size:
                        break
                    if limit and len(funds) >= limit * 2:
                        break
                    offset += page_size

        if limit:
            funds = funds[:limit]

    print(f"  {len(funds)} fonds à enrichir")
    print()

    found       = 0
    not_found   = 0
    no_ms_id    = 0
    lock        = threading.Lock()

    def process(args: tuple[int, dict]) -> None:
        nonlocal found, not_found, no_ms_id
        i, fund = args
        isin = fund["isin"]
        name = (fund.get("name") or "")[:40]

        with FetcherSession(impersonate="chrome") as session:
            time.sleep(RATE_LIMIT_SEC)
            ms_id, star = search_ms_id(session, isin)

            if not ms_id:
                with lock:
                    no_ms_id += 1
                    if i <= 10 or i % 500 == 0:
                        print(f"  ~ [{i:5d}] {isin} | no MS id | {name}")
                return

            time.sleep(RATE_LIMIT_SEC)
            details = fetch_ms_details(session, ms_id)

        row: dict = {"isin": isin}
        if star:
            row["morningstar_rating"] = star
        if details:
            # Ne pas écraser les champs déjà renseignés
            filtered = {
                k: v for k, v in details.items()
                if not (k in ("management_company", "category", "inception_date") and fund.get(k))
            }
            row.update(filtered)

        with lock:
            if len(row) > 1:
                found += 1
                if apply:
                    upsert_fund(row)
                if i <= 30 or i % 200 == 0:
                    p1   = f"{row.get('performance_1y', 0):+.1f}%"   if row.get("performance_1y") is not None else "N/A"
                    ms   = f"★{star}" if star else "★?"
                    ter  = f"{row.get('ongoing_charges', 0)*100:.2f}%" if row.get("ongoing_charges") else "N/A"
                    kid  = "KID✓" if row.get("kid_url") else "KID✗"
                    print(f"  ✓ [{i:5d}] {isin} | {p1:8} | {ms} | TER:{ter:6} | {kid} | {name}")
            else:
                not_found += 1
                if i <= 10 or i % 500 == 0:
                    print(f"  ✗ [{i:5d}] {isin} | no data | {name}")

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            list(ex.map(process, enumerate(funds, 1)))
    finally:
        _close_stealth_session()

    print()
    print(f"  ✓ {found} enrichis, {not_found} sans données, {no_ms_id} sans MS id")

    if apply:
        log_run(
            "morningstar-lt-enricher",
            "success",
            found,
            not_found + no_ms_id,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Morningstar LT Enricher")
    parser.add_argument("--apply",     action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",     type=int,            help="Limiter à N fonds")
    parser.add_argument("--isin",      type=str,            help="Un seul ISIN (test)")
    parser.add_argument("--score-min", type=int, default=None, help="Score completeness minimum")
    parser.add_argument("--score-max", type=int, default=None, help="Score completeness maximum")
    parser.add_argument("--ter-only",  action="store_true",  help="Ne cibler que les fonds sans TER")
    args = parser.parse_args()
    run(
        apply=args.apply, limit=args.limit, isin_filter=args.isin,
        score_min=args.score_min, score_max=args.score_max, ter_only=args.ter_only,
    )
