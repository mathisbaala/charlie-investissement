"""
db.py — Module Supabase partagé pour Charlie Data V2

Toutes les tables sont préfixées investissement_*.
Les scripts importent ce module plutôt que d'appeler Supabase directement.

Usage :
    from db import get_client, upsert_fund, upsert_prices, log_run, get_ecb_rate

Requiert dans .env (ou variables d'environnement) :
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY  (ou SUPABASE_SERVICE_KEY)
"""

import os
import time
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

try:
    from supabase import create_client, Client
except ImportError:
    raise ImportError("supabase non installé — run: pip install supabase")

# ─── Singleton client ──────────────────────────────────────────────────────────

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL", "").strip()
        key = (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
            or os.environ.get("SUPABASE_SERVICE_KEY", "")
        ).strip()
        if not url or not key:
            raise EnvironmentError(
                "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.\n"
                "Créez un .env à la racine du projet ou exportez les variables."
            )
        _client = create_client(url, key)
    return _client


# ─── Score de complétude ───────────────────────────────────────────────────────

def compute_completeness(fund: dict) -> int:
    """
    Calcule le score de complétude d'un fonds (0-100).
    Appelé à chaque upsert pour maintenir data_completeness à jour.
    """
    score = 0
    if fund.get("ongoing_charges") is not None or fund.get("ter") is not None:
        score += 14
    if fund.get("sri") is not None or fund.get("srri") is not None:
        score += 14
    if fund.get("performance_1y") is not None:
        score += 14
    if fund.get("performance_3y") is not None:
        score += 14
    if fund.get("sfdr_article") is not None:
        score += 14
    if fund.get("aum_eur") is not None:
        score += 14
    if fund.get("kid_parsed_at") is not None:
        score += 16  # bonus source primaire
    return min(score, 100)


# ─── Upsert fonds ─────────────────────────────────────────────────────────────

def upsert_fund(data: dict, retry: int = 3) -> bool:
    """
    Upsert un fonds dans investissement_funds.
    Si 'name' est absent → UPDATE uniquement (enrichissement d'un fonds existant).
    Si 'name' est présent → UPSERT complet (insertion ou mise à jour).

    Args:
        data: dict avec les colonnes de investissement_funds (snake_case)
        retry: nombre de tentatives en cas d'erreur réseau

    Returns:
        True si succès, False si toutes les tentatives ont échoué
    """
    client = get_client()
    isin   = data.get("isin")
    if not isin:
        return False

    # Pour les enrichissements partiels, récupérer les données existantes
    # afin de calculer un score de complétude exact (pas juste sur les champs upsertés)
    completeness_data = dict(data)
    if not data.get("name"):
        try:
            existing = client.table("investissement_funds") \
                .select("ter,ongoing_charges,sri,srri,performance_1y,performance_3y,sfdr_article,aum_eur,kid_parsed_at") \
                .eq("isin", isin).limit(1).execute().data
            if existing:
                for k, v in existing[0].items():
                    if k not in completeness_data or completeness_data[k] is None:
                        completeness_data[k] = v
        except Exception:
            pass

    row = {
        **data,
        "data_completeness": compute_completeness(completeness_data),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Sans name → enrichissement partiel : on ne fait qu'un UPDATE
    if not data.get("name"):
        # Exclure les valeurs None pour éviter d'écraser des données existantes
        fields = {k: v for k, v in row.items() if k != "isin" and v is not None}
        for attempt in range(retry):
            try:
                client.table("investissement_funds") \
                    .update(fields) \
                    .eq("isin", isin) \
                    .execute()
                return True
            except Exception as e:
                err_str = str(e)
                # 23502 = not-null constraint — fonds sans nom en base, skip silencieux
                if "23502" in err_str:
                    return True
                if attempt < retry - 1:
                    time.sleep(2 ** attempt)
                else:
                    print(f"  ✗ upsert_fund({isin}) échoué après {retry} tentatives : {e}")
                    return False
        return False

    # Avec name → upsert complet (INSERT ou UPDATE)
    for attempt in range(retry):
        try:
            client.table("investissement_funds") \
                .upsert(row, on_conflict="isin") \
                .execute()
            return True
        except Exception as e:
            if attempt < retry - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  ✗ upsert_fund({isin}) échoué après {retry} tentatives : {e}")
                return False
    return False


def upsert_funds_bulk(rows: list[dict], batch_size: int = 100) -> tuple[int, int]:
    """
    Upsert en masse dans investissement_funds.

    Returns:
        (n_success, n_failed)
    """
    client = get_client()
    success, failed = 0, 0

    prepared = [
        {
            **row,
            "data_completeness": compute_completeness(row),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        for row in rows
    ]

    for i in range(0, len(prepared), batch_size):
        batch = prepared[i : i + batch_size]
        for attempt in range(3):
            try:
                client.table("investissement_funds") \
                    .upsert(batch, on_conflict="isin") \
                    .execute()
                success += len(batch)
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                else:
                    failed += len(batch)
                    print(f"  ✗ Batch {i//batch_size + 1} échoué : {e}")

    return success, failed


def update_funds_bulk(rows: list[dict], batch_size: int = 100) -> tuple[int, int]:
    """
    UPDATE partiel en masse — enrichissement de fonds existants uniquement.
    N'insère pas de nouvelles lignes (contrairement à upsert_funds_bulk).
    Chaque row doit contenir 'isin' + les champs à mettre à jour.

    Returns:
        (n_success, n_failed)
    """
    client = get_client()
    success, failed = 0, 0

    for row in rows:
        isin = row.get("isin")
        if not isin:
            failed += 1
            continue
        fields = {k: v for k, v in row.items() if k != "isin"}
        fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        for attempt in range(3):
            try:
                client.table("investissement_funds") \
                    .update(fields) \
                    .eq("isin", isin) \
                    .execute()
                success += 1
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                else:
                    # 23502 = not-null sur name — fonds sans nom en base, skip silencieux
                    if "23502" in str(e):
                        break
                    failed += 1
                    print(f"  ✗ update_fund({isin}) échoué : {e}")

    return success, failed


# ─── Upsert prix (VL) ─────────────────────────────────────────────────────────

def upsert_prices(isin: str, prices: list[dict], source: str, batch_size: int = 500) -> tuple[int, int]:
    """
    Insère/met à jour des VL dans investissement_fund_prices.

    Args:
        isin: code ISIN du fonds
        prices: liste de dicts avec {date: str 'YYYY-MM-DD', nav: float}
        source: 'yahoo-finance' | 'amf-geco' | 'boursorama'
        batch_size: nombre de lignes par requête Supabase

    Returns:
        (n_inserted, n_failed)
    """
    client = get_client()
    if not prices:
        return 0, 0

    rows = [
        {
            "isin":       isin,
            "price_date": p["date"],
            "nav":        round(float(p["nav"]), 6) if p.get("nav") is not None else None,
            "currency":   p.get("currency", "EUR"),
            "source":     source,
        }
        for p in prices
        if p.get("date") and p.get("nav") is not None
    ]

    inserted, failed = 0, 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        for attempt in range(3):
            try:
                client.table("investissement_fund_prices") \
                    .upsert(batch, on_conflict="isin,price_date") \
                    .execute()
                inserted += len(batch)
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                else:
                    failed += len(batch)
                    print(f"  ✗ upsert_prices({isin}) batch {i//batch_size + 1} échoué : {e}")

    return inserted, failed


# ─── Log pipeline ──────────────────────────────────────────────────────────────

def log_run(
    scraper: str,
    status: str,
    records_processed: int = 0,
    records_failed: int = 0,
    errors: list[dict] | None = None,
    started_at: datetime | None = None,
) -> str | None:
    """
    Insère un enregistrement dans investissement_pipeline_runs.

    Args:
        scraper: nom du scraper (ex: 'yahoo-finance', 'amf-geco-bulk')
        status: 'success' | 'partial' | 'failed'
        records_processed: nombre de fonds traités avec succès
        records_failed: nombre de fonds en erreur
        errors: liste d'objets {isin, error} pour les échecs
        started_at: heure de début (now() si None)

    Returns:
        L'UUID du run créé, ou None si erreur
    """
    client = get_client()
    now = datetime.now(timezone.utc)
    row = {
        "scraper":            scraper,
        "started_at":         (started_at or now).isoformat(),
        "completed_at":       now.isoformat(),
        "records_processed":  records_processed,
        "records_failed":     records_failed,
        "errors":             errors or [],
        "status":             status,
    }
    try:
        resp = client.table("investissement_pipeline_runs").insert(row).execute()
        if resp.data:
            return resp.data[0].get("id")
    except Exception as e:
        print(f"  ⚠️  log_run({scraper}) échoué (non bloquant) : {e}")
    return None


# ─── Taux BCE (risk-free rate pour Sharpe) ────────────────────────────────────

_ecb_rate_cache: tuple[float, float] | None = None  # (rate, timestamp)
_ECB_CACHE_TTL = 86_400  # 24h


def get_ecb_rate() -> float:
    """
    Retourne le dernier taux BCE deposit facility (risk-free rate).
    Fetché depuis l'API ECB SDMX et mis en cache 24h.
    Fallback : 0.035 (taux approximatif 2024-2025).
    """
    global _ecb_rate_cache

    now = time.time()
    if _ecb_rate_cache and now - _ecb_rate_cache[1] < _ECB_CACHE_TTL:
        return _ecb_rate_cache[0]

    try:
        import urllib.request
        import json as _json

        # LEV = niveau (%) du taux de facilité de dépôt BCE
        url = (
            "https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV"
            "?format=jsondata&detail=dataonly&lastNObservations=1"
        )
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = _json.loads(r.read())

        # La série peut avoir une clé variable selon la version de l'API
        series = data.get("dataSets", [{}])[0].get("series", {})
        if series:
            first_series = next(iter(series.values()))
            observations = first_series.get("observations", {})
            if observations:
                last_val = list(observations.values())[-1][0]
                if last_val is not None:
                    rate = float(last_val) / 100  # converti de % en décimal
                    _ecb_rate_cache = (rate, now)
                    return rate

    except Exception:
        pass

    return 0.025  # fallback ~2025 (taux BCE deposit facility ~2.25%)


# ─── Utilitaires ──────────────────────────────────────────────────────────────

def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
