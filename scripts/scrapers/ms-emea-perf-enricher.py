#!/usr/bin/env python3
"""
ms-emea-perf-enricher.py — Performances via Morningstar EMEA
========================================================================
Source : API Morningstar EMEA (univers FEEUR$$ALL = fonds Europe, dont les
OPCVM étrangers LU/IE) — ReturnM12, ReturnM36, ReturnM60, déjà en %.

Deux modes :
  - défaut (fill-only) : cible tous les OPCVM/ETF avec une perf NULL, n'écrit
    QUE les champs NULL (ne touche pas une perf existante).
  - --refresh : cible les OPCVM ÉTRANGERS (ISIN non-FR) SANS série de prix —
    ceux pour qui Morningstar est la SEULE source de perf (compute-metrics ne
    peut rien calculer sans VL). Écrase les perfs (refresh mensuel). Ce ciblage
    évite tout mélange de sources : on ne touche jamais une perf calculée depuis
    une VL FT/GECO/JustETF.

Identifiants Morningstar : credentials Linxea (env MS_EMEA_USER / MS_EMEA_PASS,
sinon valeur historique en dur).

Usage :
    python3 scripts/scrapers/ms-emea-perf-enricher.py [--apply] [--limit N]
    python3 scripts/scrapers/ms-emea-perf-enricher.py --apply --refresh   # OPCVM étrangers sans prix
"""

import os, sys, time, argparse, base64, requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

OAUTH_URL  = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER   = "https://www.emea-api.morningstar.com/ecint/v1/screener"
PAGE_SIZE  = 2000
UNIVERSES  = ["FOFRA$$ALL", "FEEUR$$ALL"]


def _creds_b64() -> str:
    """Identifiants Morningstar EMEA depuis l'environnement (secrets GitHub
    MS_EMEA_USER / MS_EMEA_PASS) — plus de credentials en dur dans le code."""
    user = os.environ.get("MS_EMEA_USER", "").strip()
    pwd  = os.environ.get("MS_EMEA_PASS", "").strip()
    if not user or not pwd:
        raise EnvironmentError(
            "MS_EMEA_USER et MS_EMEA_PASS sont requis (secrets repo / variables "
            "d'environnement). Exportez-les pour un lancement local.")
    return base64.b64encode(f"{user}:{pwd}".encode()).decode()


def annualized_to_cumul(annualized_pct: float, years: int) -> float:
    """Convertit un rendement ANNUALISÉ (Morningstar) en CUMULÉ (convention base).
    cumul = ((1+a/100)^n − 1)·100. À 1 an, cumulé = annualisé. Pur → testable."""
    if years == 1:
        return round(annualized_pct, 4)
    return round(((1 + annualized_pct / 100) ** years - 1) * 100, 4)


def get_token() -> str:
    r = requests.post(OAUTH_URL,
                      headers={"Authorization": f"Basic {_creds_b64()}", "Accept": "application/json"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def _screener_get(params: dict, headers: dict, retries: int = 4) -> dict:
    """GET screener avec retry/backoff (un 503 en pleine pagination ne doit pas
    faire perdre tout le scan)."""
    for attempt in range(retries):
        try:
            r = requests.get(SCREENER, params=params, headers=headers, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return {}


def _all_priced_isins(client) -> set[str]:
    """Tous les ISIN ayant une série de prix (table de couverture), pour les
    EXCLURE en mode refresh (leur perf vient déjà d'une VL via compute-metrics)."""
    priced: set[str] = set()
    after = ""
    while True:
        rows = (client.table("investissement_fund_price_coverage")
                .select("isin").gt("isin", after).order("isin").limit(1000)
                .execute().data or [])
        if not rows:
            break
        priced.update(r["isin"] for r in rows)
        if len(rows) < 1000:
            break
        after = rows[-1]["isin"]
    return priced


def select_targets(client, refresh: bool) -> set[str]:
    """Mode refresh : OPCVM étrangers (ISIN non-FR) SANS série de prix.
    Mode fill-only : tous les OPCVM/ETF avec au moins une perf NULL."""
    out: list[str] = []
    offset = 0
    while True:
        q = (client.table("investissement_funds").select("isin"))
        if refresh:
            q = q.eq("product_type", "opcvm").not_.like("isin", "FR%")
        else:
            q = (q.in_("product_type", ["opcvm", "etf"])
                 .or_("performance_1y.is.null,performance_3y.is.null,performance_5y.is.null"))
        batch = q.range(offset, offset + 999).execute().data or []
        out.extend(r["isin"] for r in batch)
        if len(batch) < 1000:
            break
        offset += 1000
    target = set(out)
    if refresh:
        # Ne garder que les fonds SANS prix : Morningstar est leur seule source
        # de perf → écrasement sans conflit avec FT/GECO/JustETF.
        target -= _all_priced_isins(client)
    return target


def fetch_perf_from_universe(token: str, universe: str, target: set[str]) -> dict[str, dict]:
    bearer  = f"Bearer {token}"
    headers = {"Authorization": bearer, "Accept": "application/json", "Referer": "https://www.linxea.com/"}
    params  = {
        "languageId": "fr-FR", "currencyId": "EUR",
        "universeIds": universe, "outputType": "json",
        "securityDataPoints": "ISIN|ReturnM12|ReturnM36|ReturnM60",
        "filters": "", "pageSize": PAGE_SIZE, "page": 1,
    }
    data  = _screener_get(params, headers)
    total = data.get("total", 0)
    rows  = data.get("rows", [])
    print(f"  {universe} Page 1 : {len(rows)}/{total}", flush=True)

    result: dict[str, dict] = {}
    page = 2
    while True:
        for row in rows:
            isin = (row.get("ISIN") or "").strip()
            if isin not in target:
                continue
            updates: dict = {}
            # Morningstar ReturnM36/M60 sont ANNUALISÉS (% par an) ; la base stocke
            # du CUMULÉ (cf. compute-metrics / FT / convention perf-fee). On convertit
            # annualisé→cumulé : cumul = ((1+a/100)^n − 1)·100. M12 = 1 an = identique.
            for ms_field, db_field, years in [("ReturnM12", "performance_1y", 1),
                                              ("ReturnM36", "performance_3y", 3),
                                              ("ReturnM60", "performance_5y", 5)]:
                val = row.get(ms_field)
                if val is None:
                    continue
                try:
                    a = float(val)
                except (ValueError, TypeError):
                    continue
                updates[db_field] = annualized_to_cumul(a, years)
            if updates:
                result[isin] = updates
        if len(rows) < PAGE_SIZE or (page - 1) * PAGE_SIZE >= total:
            break
        params["page"] = page
        rows = _screener_get(params, headers).get("rows", [])
        if page % 10 == 0:
            print(f"  {universe} Page {page} : ~{(page-1)*PAGE_SIZE}/{total}", flush=True)
        page += 1
        time.sleep(0.15)

    return result


def run(apply: bool, limit: int | None, refresh: bool = False):
    print("=" * 60)
    print("  MS EMEA Perf Enricher — performances Morningstar")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}"
          + ("  [REFRESH : OPCVM étrangers sans prix, écrase]" if refresh
             else "  [fill-only : perfs NULL des OPCVM/ETF]"))

    started = datetime.now(timezone.utc)
    client  = get_client()

    scope = "OPCVM étrangers sans série de prix" if refresh \
        else "OPCVM/ETF avec ≥1 perf manquante"
    print(f"  Sélection des cibles ({scope})...", flush=True)
    target = select_targets(client, refresh)
    print(f"  {len(target)} fonds ciblés")

    print("  Auth Morningstar EMEA...", flush=True)
    token = get_token()

    all_updates: dict[str, dict] = {}
    remaining = set(target)
    for universe in UNIVERSES:
        if not remaining:
            break
        print(f"  Screener {universe} ({len(remaining)} ISINs restants)...", flush=True)
        found = fetch_perf_from_universe(token, universe, remaining)
        # Fusionner (ne pas écraser les champs déjà trouvés)
        for isin, updates in found.items():
            if isin not in all_updates:
                all_updates[isin] = {}
            all_updates[isin].update(updates)
        remaining -= set(found.keys())
        print(f"  → {len(found)} trouvés dans {universe}", flush=True)

    print(f"  {len(all_updates)} ISINs avec au moins 1 performance trouvée")

    if limit:
        all_updates = dict(list(all_updates.items())[:limit])

    # Filtrer pour ne mettre à jour que les champs vraiment manquants en DB
    # (ne pas écraser des données déjà présentes)
    print("  Chargement des données actuelles pour filtrage...", flush=True)
    isins_list = list(all_updates.keys())
    db_data: dict[str, dict] = {}
    CHUNK = 500
    for i in range(0, len(isins_list), CHUNK):
        batch = client.table("investissement_funds") \
            .select("isin, performance_1y, performance_3y, performance_5y") \
            .in_("isin", isins_list[i:i+CHUNK]) \
            .execute().data or []
        for r in batch:
            db_data[r["isin"]] = r

    updated = skipped = 0
    now = datetime.now(timezone.utc).isoformat()

    for isin, updates in all_updates.items():
        db_row = db_data.get(isin, {})
        # refresh : écrase (réécrit si la valeur change) ; sinon fill-only (NULL).
        if refresh:
            changes = {k: v for k, v in updates.items() if db_row.get(k) != v}
        else:
            changes = {k: v for k, v in updates.items() if db_row.get(k) is None}
        if not changes:
            continue
        if apply:
            try:
                client.table("investissement_funds") \
                    .update({**changes, "updated_at": now}) \
                    .eq("isin", isin) \
                    .execute()
                updated += 1
            except Exception as e:
                if skipped < 3:
                    print(f"  ✗ {isin}: {e}", flush=True)
                skipped += 1
        else:
            updated += 1

    print(f"\n  → {updated} fonds enrichis en performance, {skipped} erreurs")
    if apply:
        log_run("ms-emea-perf-enricher", "success", updated, skipped, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Performances OPCVM via Morningstar EMEA")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    parser.add_argument("--refresh", action="store_true",
                        help="Cibler les OPCVM étrangers sans prix et écraser leurs perfs "
                             "(refresh mensuel). Sans : fill-only des perfs NULL.")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, refresh=args.refresh)
