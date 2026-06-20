#!/usr/bin/env python3
"""
populate-holdings-morningstar.py — Composition des OPCVM via Morningstar EMEA
=============================================================================
Comble la VENTILATION (géo / secteur / top holdings) des OPCVM qui n'en ont
aucune. Deux APIs Morningstar combinées :
  1. RÉSOLUTION ISIN → secId : screener ecint EMEA authentifié (token/oauth,
     credentials Linxea MS_EMEA_USER/PASS) — le même socle que ms-emea-perf.
  2. VENTILATION : API consommateur publique sal-service v1 (api-global) avec
     apikey statique — pas d'oauth (le realm oauth EMEA n'entitle PAS sal-service,
     testé : 401). Endpoints découverts via mstarpy / pp-portfolio-classifier :
       region   : sal-service/v1/{type}/portfolio/regionalSector/{sec}/data
       secteur  : sal-service/v1/{type}/portfolio/v2/sector/{sec}/data
       holdings : sal-service/v1/{type}/portfolio/holding/v2/{sec}/data
Source statique HTTP (pas de navigateur), compatible GitHub Actions.

Tables alimentées (FILL-ONLY STRICT, source = 'morningstar') :
  - investissement_fund_geos      (répartition géographique, % → fraction)
  - investissement_fund_sectors   (répartition sectorielle GICS)
  - investissement_fund_holdings  (top positions)

N'écrit JAMAIS dans investissement_funds. Ne traite QUE les fonds SANS géo en
base (ne réécrit pas une ventilation déjà sourcée — FT, émetteur, JustETF…).

Gisement : ~7 100 OPCVM ont un morningstar_rating (donc résolvables côté
Morningstar) mais aucune ventilation. Priorité AUM décroissant : on remplit
d'abord les fonds les plus consultés / référencés.

Pipeline (par fonds) :
  1. Résolution ISIN → secId  via ecint/v1/screener (term=ISIN, universe EMEA).
  2. Ventilation via sal-service v1 (api-global, apikey statique) : 3 GET JSON
     (regionalSector / v2/sector / holding/v2).
  3. Écriture fill-only delete+insert par ISIN sur les 3 tables (idempotent).

⚠️  Identifiants requis : MS_EMEA_USER / MS_EMEA_PASS (secrets repo, comme les
    autres ms-emea-*) — uniquement pour résoudre le secId via le screener
    entitlé. Sans eux, le script s'arrête proprement (exit 0, aucun write).

Usage :
    # Sonde le format réel de l'API pour quelques ISIN (n'écrit pas) :
    python3 scripts/scrapers/populate-holdings-morningstar.py --probe --isin LU0328684104

    # Dry-run priorisé AUM :
    python3 scripts/scrapers/populate-holdings-morningstar.py --limit 20

    # Run réel, fill-only, priorité AUM, batchable :
    python3 scripts/scrapers/populate-holdings-morningstar.py --apply --limit 500
    python3 scripts/scrapers/populate-holdings-morningstar.py --apply --limit 500 --offset 500
"""

import os
import sys
import time
import json
import signal
import base64
import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import Counter

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Config API EMEA (même socle que ms-emea-perf-enricher) ───────────────────

OAUTH_URL   = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER    = "https://www.emea-api.morningstar.com/ecint/v1/screener"
UNIVERSES   = ["FOFRA$$ALL", "FEEUR$$ALL"]   # FR + Europe (couvre LU/IE)

# API consommateur publique sal-service v1 (mstarpy) : pas d'oauth, apikey statique.
SAL_URL    = "https://api-global.morningstar.com/sal-service/v1/{type}/{field}/{sec}/data"
SAL_APIKEY = "lstzFDEOhfFNMLikKa0am9mgEKLBl49T"
SAL_PARAMS = {"clientId": "MDC", "version": "4.71.0", "languageId": "en"}
SAL_TYPE   = "fund"   # fonctionne pour OPCVM et ETF (même secId Morningstar)

RATE_LIMIT_SEC = 0.30     # API publique : courtoisie
SOURCE         = "morningstar"

# Deadline DUR par fonds. L'API publique sal-service « dribble » parfois (octets
# très espacés) : le read-timeout de requests mesure l'écart INTER-octets, pas le
# total, donc il ne se déclenche jamais sur un flux qui goutte → un seul fonds
# pathologique peut figer un run entier de 350 min (constaté 20/06). SIGALRM
# coupe net au-delà de ce délai et on passe au fonds suivant (re-tenté + TTL).
FUND_DEADLINE_S = 20   # un fonds légitime répond en <10s ; au-delà = hang à skipper
_HAS_ALARM      = hasattr(signal, "SIGALRM")


class _FundTimeout(Exception):
    pass


def _on_alarm(signum, frame):
    raise _FundTimeout()


def _arm_deadline(seconds: int) -> None:
    if _HAS_ALARM:
        signal.alarm(seconds)


def _disarm_deadline() -> None:
    if _HAS_ALARM:
        signal.alarm(0)

# ─── Mapping secteurs Morningstar → labels (alignés sur source financial-times,
# pour que la ventilation agrégée /lookthrough blende par label identique) ────

SECTOR_MAP = {
    "basicmaterials":        "Basic Materials",
    "consumercyclical":      "Consumer Cyclical",
    "financialservices":     "Financial Services",
    "realestate":            "Real Estate",
    "consumerdefensive":     "Consumer Defensive",
    "healthcare":            "Healthcare",
    "utilities":             "Utilities",
    "communicationservices": "Communication Services",
    "energy":                "Energy",
    "industrials":           "Industrials",
    "technology":            "Technology",
}

# ─── Régions Morningstar (clés du bloc fundPortfolio de regionalSector) ───────
# label aligné sur les buckets FT là où ils coïncident (United Kingdom, Japan,
# Australasia, Latin America) ; code ISO-ish pour le reste.

GEO_MAP = {
    "northamerica":     ("North America",   "NA"),
    "unitedkingdom":    ("United Kingdom",  "GB"),
    "europedeveloped":  ("Europe Developed", "EU"),
    "europeemerging":   ("Emerging Europe", "EE"),
    "africamiddleeast": ("Middle East",     "AME"),
    "japan":            ("Japan",           "JP"),
    "australasia":      ("Australasia",     "AU"),
    "asiadeveloped":    ("Developed Asia",  "ASD"),
    "asiaemerging":     ("Emerging Asia",   "ASE"),
    "latinamerica":     ("Latin America",   "LA"),
}


# ─── Auth ─────────────────────────────────────────────────────────────────────

def _creds_b64() -> str:
    user = os.environ.get("MS_EMEA_USER", "").strip()
    pwd  = os.environ.get("MS_EMEA_PASS", "").strip()
    if not user or not pwd:
        raise EnvironmentError(
            "MS_EMEA_USER et MS_EMEA_PASS sont requis (secrets repo / variables "
            "d'environnement). Exportez-les pour un lancement local.")
    return base64.b64encode(f"{user}:{pwd}".encode()).decode()


def get_token() -> str:
    r = requests.post(
        OAUTH_URL,
        headers={"Authorization": f"Basic {_creds_b64()}", "Accept": "application/json"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _api_get(url: str, params: dict, token: str, retries: int = 3) -> dict | None:
    # Timeout court (fail-fast) : un endpoint qui pendouille saute vite et le
    # fonds est re-tenté au run suivant, plutôt que de bloquer le run entier.
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Referer": "https://www.linxea.com/",
    }
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=20)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


# ─── Résolution secId ─────────────────────────────────────────────────────────

def resolve_sec_id(isin: str, token: str) -> str | None:
    """ISIN → Morningstar secId via le screener EMEA (term=ISIN)."""
    for universe in UNIVERSES:
        data = _api_get(SCREENER, {
            "languageId": "fr-FR", "currencyId": "EUR",
            "universeIds": universe, "outputType": "json",
            "securityDataPoints": "SecId|ISIN|Name",
            "term": isin, "pageSize": 1, "page": 1,
        }, token)
        for row in (data or {}).get("rows", []):
            sec = row.get("SecId") or row.get("secId")
            if sec:
                return sec
    return None


def _sal_get(field: str, sec_id: str, retries: int = 2) -> dict | None:
    """GET sal-service v1 (api-global, apikey statique). field ∈
    {portfolio/regionalSector, portfolio/v2/sector, portfolio/holding/v2}.

    Fail-fast : timeout court + peu de retries. L'API publique throttle (206)
    sous charge soutenue ; insister bloque le run. On saute vite, le fonds non
    écrit n'entre pas dans le set « fait » → il est re-tenté au run suivant."""
    url = SAL_URL.format(type=SAL_TYPE, field=field, sec=sec_id)
    headers = {"apikey": SAL_APIKEY, "Accept": "application/json",
               "User-Agent": "Mozilla/5.0 (compatible; charlie-enricher)"}
    for attempt in range(retries):
        try:
            r = requests.get(url, params=SAL_PARAMS, headers=headers, timeout=20)
            if r.status_code == 404:
                return None
            # 206 + corps texte = throttle transitoire de l'API publique → retry.
            if r.status_code == 206 or "json" not in r.headers.get("content-type", ""):
                raise ValueError(f"non-json {r.status_code}")
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(1.0 * (attempt + 1))
    return None


def fetch_portfolio(sec_id: str, token: str) -> dict | None:
    """Récupère les 3 blocs de ventilation sal-service. Renvoie un dict
    {region, sector, holding} (chaque valeur = JSON brut ou None)."""
    region  = _sal_get("portfolio/regionalSector", sec_id)
    time.sleep(RATE_LIMIT_SEC)
    sector  = _sal_get("portfolio/v2/sector", sec_id)
    time.sleep(RATE_LIMIT_SEC)
    holding = _sal_get("portfolio/holding/v2", sec_id)
    if region is None and sector is None and holding is None:
        return None
    return {"region": region, "sector": sector, "holding": holding}


# ─── Parseurs (structure SAL réelle, figée par probe 19/06) ───────────────────

def _to_frac(val) -> float | None:
    """% Morningstar (0-100) → fraction (0-1). Ignore 0/None/négatif."""
    try:
        f = float(str(val).replace(",", "."))
    except (ValueError, TypeError):
        return None
    if f <= 0:
        return None
    return round(f / 100, 6)


def parse_geos(data: dict) -> list[dict]:
    """region → $.fundPortfolio : dict plat {northAmerica, unitedKingdom, ...}
    valeurs en % (0-100)."""
    region = (data or {}).get("region") or {}
    fp = region.get("fundPortfolio")
    if not isinstance(fp, dict):
        return []
    results: list[dict] = []
    for raw_k, val in fp.items():
        norm = raw_k.lower()
        if norm not in GEO_MAP:
            continue                       # ignore portfolioDate/masterPortfolioId
        frac = _to_frac(val)
        if frac:
            label, code = GEO_MAP[norm]
            results.append({"country_code": code, "country_label": label,
                            "weight": frac, "source": SOURCE})
    return results


def parse_sectors(data: dict) -> list[dict]:
    """sector → $.EQUITY.fundPortfolio : dict plat {basicMaterials, ...} en %."""
    sector = (data or {}).get("sector") or {}
    eq = sector.get("EQUITY")
    fp = (eq or {}).get("fundPortfolio") if isinstance(eq, dict) else None
    if not isinstance(fp, dict):
        return []
    results: list[dict] = []
    for raw_k, val in fp.items():
        norm = raw_k.lower()
        if norm not in SECTOR_MAP:
            continue                       # ignore portfolioDate
        frac = _to_frac(val)
        if frac:
            results.append({"sector_name": SECTOR_MAP[norm],
                            "weight": frac, "source": SOURCE})
    return results


def parse_holdings(data: dict) -> list[dict]:
    """holding → top positions. equityHoldingPage (actions) ou boldHoldingPage
    (obligataires) → holdingList[*] {securityName, weighting, country, sector...}."""
    holding = (data or {}).get("holding") or {}
    rows: list[dict] = []
    for page_key in ("equityHoldingPage", "boldHoldingPage", "otherHoldingPage"):
        page = holding.get(page_key)
        if isinstance(page, dict):
            rows.extend(page.get("holdingList") or [])
    # Dédup par nom, tri par poids décroissant.
    seen: set[str] = set()
    parsed: list[dict] = []
    for h in sorted(rows, key=lambda x: _to_frac(x.get("weighting")) or 0, reverse=True):
        name = (h.get("securityName") or "").strip()
        frac = _to_frac(h.get("weighting"))
        if not name or not frac or name.lower() in seen:
            continue
        seen.add(name.lower())
        ident = (h.get("ticker") or h.get("isin") or "")
        parsed.append({
            "rank": len(parsed) + 1,
            "position_name": name[:200],
            "ticker": (str(ident)[:20] or None),
            "asset_type": (h.get("holdingType") or None),
            "sector": (h.get("sector") or None),
            "country": (h.get("country") or None),
            "weight": frac,
            "source": SOURCE,
        })
        if len(parsed) >= 10:
            break
    return parsed


# ─── Sélection des cibles (fill-only, priorité AUM) ───────────────────────────

def _paginate_isins(client, table: str, source: str | None = None) -> set[str]:
    """Tous les ISIN distincts d'une table (clé-set par pagination keyset)."""
    have: set[str] = set()
    after = ""
    while True:
        q = (client.table(table).select("isin").gt("isin", after)
             .order("isin").limit(1000))
        if source is not None:
            q = q.eq("source", source)
        rows = q.execute().data or []
        if not rows:
            break
        have.update(r["isin"] for r in rows)
        if len(rows) < 1000:
            break
        after = rows[-1]["isin"]
    return have


ATTEMPTS_TABLE = "investissement_fund_holdings_attempts"
ATTEMPT_TTL_DAYS = 30   # ré-essaie un fonds en échec après ce délai (MS s'enrichit)


def _isins_recently_attempted(client, days: int = ATTEMPT_TTL_DAYS) -> set[str]:
    """ISIN tentés par cette source il y a moins de `days` jours (succès comme
    ÉCHECS). Sans ce filtre, les fonds en échec (sans secId / sans compo, donc
    sans données écrites) remontent en tête de CHAQUE run et masquent les ~72 %
    de fonds couvrables plus profonds dans le tri AUM (mesuré 20/06 : offset 0 =
    0 % ventilés = couche d'échecs ; offset 2000 = 72 %). Ré-essayés après TTL."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    have: set[str] = set()
    after = ""
    while True:
        rows = (client.table(ATTEMPTS_TABLE)
                .select("isin").eq("source", SOURCE).gte("attempted_at", cutoff)
                .gt("isin", after).order("isin").limit(1000)
                .execute().data or [])
        if not rows:
            break
        have.update(r["isin"] for r in rows)
        if len(rows) < 1000:
            break
        after = rows[-1]["isin"]
    return have


def _isins_already_done(client) -> set[str]:
    """ISIN à NE PAS retraiter. Un fonds est « fait » s'il a :
      - une ventilation GÉO (peu importe la source) — fill-only inter-sources ; OU
      - des HOLDINGS Morningstar — couvre les MONÉTAIRES, qui n'ont jamais de géo
        mais reçoivent leurs holdings ; OU
      - une TENTATIVE Morningstar récente (< TTL) — couvre les ÉCHECS, qui sinon
        remontent en tête à chaque run et bloquent la progression dans la traîne.
    """
    done = _paginate_isins(client, "investissement_fund_geos")
    done |= _paginate_isins(client, "investissement_fund_holdings", source=SOURCE)
    done |= _isins_recently_attempted(client)
    return done


def _record_attempts(client, attempts: list[dict]) -> None:
    """Upsert en masse des tentatives (PK isin,source) — idempotent.

    Dédoublonne par (isin,source) AVANT l'upsert : Postgres refuse deux lignes de
    même PK dans un seul ON CONFLICT (« cannot affect row a second time »). Un
    fonds peut être noté 2× dans le buffer — typiquement « ok » puis « timeout »
    si SIGALRM se déclenche pendant le write. On garde la DERNIÈRE issue."""
    if not attempts:
        return
    dedup: dict[tuple, dict] = {}
    for a in attempts:
        dedup[(a["isin"], a["source"])] = a
    rows = list(dedup.values())
    for i in range(0, len(rows), 500):
        client.table(ATTEMPTS_TABLE).upsert(
            rows[i:i + 500], on_conflict="isin,source").execute()


def select_targets(client, limit: int | None, offset: int,
                   include_unrated: bool = False) -> list[dict]:
    """OPCVM/ETF SANS géo, triés AUM décroissant.

    Par défaut on se restreint aux fonds notés Morningstar (morningstar_rating
    non nul) : pré-filtre prudent qui évite de gaspiller des appels de résolution
    sur des fonds que Morningstar ne couvre pas. Mais `resolve_sec_id` cherche en
    réalité par ISIN dans le screener EMEA — il ne DÉPEND pas du rating, et
    Morningstar référence beaucoup plus de fonds qu'il n'en note. `include_unrated`
    élargit donc la cible aux non-notés pour attaquer le mur des OPCVM sans
    ventilation (taux de résolution plus faible, à mesurer en --probe d'abord)."""
    done = _isins_already_done(client)
    out: list[dict] = []
    page = 1000
    db_offset = 0
    while True:
        q = (client.table("investissement_funds")
             .select("isin, name, aum_eur")
             .in_("product_type", ["opcvm", "etf", "fcp", "sicav"]))
        if not include_unrated:
            q = q.not_.is_("morningstar_rating", "null")
        rows = (q.order("aum_eur", desc=True, nullsfirst=False)
                .range(db_offset, db_offset + page - 1)
                .execute().data or [])
        if not rows:
            break
        for r in rows:
            if r["isin"] not in done:
                out.append(r)
        if len(rows) < page:
            break
        db_offset += page
        # Sur-récupère pour appliquer offset+limit après filtrage « déjà fait ».
        if limit and len(out) >= offset + limit + page:
            break
    sliced = out[offset:]
    if limit:
        sliced = sliced[:limit]
    return sliced


# ─── Écriture fill-only (idempotente) ─────────────────────────────────────────

def write_breakdowns(client, isin: str, geos, sectors, holdings, now_iso: str) -> None:
    if geos:
        rows = [{"isin": isin, **g, "updated_at": now_iso} for g in geos]
        client.table("investissement_fund_geos").delete().eq("isin", isin).execute()
        client.table("investissement_fund_geos").insert(rows).execute()
    if sectors:
        rows = [{"isin": isin, **s, "updated_at": now_iso} for s in sectors]
        client.table("investissement_fund_sectors").delete().eq("isin", isin).execute()
        client.table("investissement_fund_sectors").insert(rows).execute()
    if holdings:
        rows = [{"isin": isin, **h, "updated_at": now_iso} for h in holdings]
        client.table("investissement_fund_holdings").delete().eq("isin", isin).execute()
        client.table("investissement_fund_holdings").insert(rows).execute()


# ─── Run ──────────────────────────────────────────────────────────────────────

def run(apply: bool, limit: int | None, offset: int,
        single_isin: str | None, probe: bool, include_unrated: bool = False) -> None:
    print("=" * 60)
    print("  Populate Holdings — Morningstar EMEA (fill-only, priorité AUM)")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}"
          f"{'  [PROBE: dump JSON brut]' if probe else ''}"
          f"{'  [INCLUDE-UNRATED]' if include_unrated else ''}")

    started = datetime.now(timezone.utc)
    client  = get_client()
    now_iso = started.isoformat()
    stats   = Counter()

    print("  Auth Morningstar EMEA...", flush=True)
    try:
        token = get_token()
    except EnvironmentError as e:
        print(f"  ⚠️  {e}")
        print("  → Aucun identifiant : arrêt propre (exit 0, aucune écriture).")
        return

    if single_isin:
        funds = [{"isin": single_isin, "name": single_isin, "aum_eur": None}]
    else:
        funds = select_targets(client, limit, offset, include_unrated)

    print(f"  {len(funds)} fonds cibles (sans géo & non tentés <{ATTEMPT_TTL_DAYS}j, "
          f"AUM desc, offset {offset})", flush=True)

    # Buffer de tentatives (toute issue : ok/no_sec_id/no_portfolio/no_data) →
    # enregistré en apply pour que les ÉCHECS ne remontent pas au run suivant.
    attempts: list[dict] = []

    def _note(isin_: str, status: str) -> None:
        if apply:
            attempts.append({"isin": isin_, "source": SOURCE,
                             "status": status, "attempted_at": now_iso})

    if _HAS_ALARM:
        signal.signal(signal.SIGALRM, _on_alarm)

    for i, fund in enumerate(funds, 1):
        isin = fund["isin"]
        name = (fund.get("name") or isin)[:40]

        if len(attempts) >= 200:
            _record_attempts(client, attempts)
            attempts = []

        # Deadline dur : tout le traitement réseau d'un fonds est borné ; au-delà,
        # SIGALRM lève _FundTimeout, on note « timeout » et on passe au suivant.
        _arm_deadline(FUND_DEADLINE_S)
        try:
            time.sleep(RATE_LIMIT_SEC)
            sec_id = resolve_sec_id(isin, token)
            if not sec_id:
                stats["no_sec_id"] += 1
                _note(isin, "no_sec_id")
                continue

            time.sleep(RATE_LIMIT_SEC)
            data = fetch_portfolio(sec_id, token)

            if probe:
                print(f"\n=== {isin} / secId={sec_id} ===")
                if data is None:
                    print("  (aucune réponse / 404)")
                else:
                    print(f"  géo={parse_geos(data)}")
                    print(f"  sect={parse_sectors(data)}")
                    print(f"  holdings={[(h['rank'], h['position_name'], h['weight']) for h in parse_holdings(data)]}")
                continue

            if data is None:
                stats["no_portfolio"] += 1
                _note(isin, "no_portfolio")
                continue

            geos     = parse_geos(data)
            sectors  = parse_sectors(data)
            holdings = parse_holdings(data)

            if not (geos or sectors or holdings):
                stats["no_data"] += 1
                _note(isin, "no_data")
                continue

            stats["ok"] += 1
            _note(isin, "ok")
            geo_sum = round(sum(g["weight"] for g in geos) * 100, 1)
            if i <= 30 or i % 50 == 0:
                print(f"  ✓ {isin} ({name}) — {len(holdings)} pos, "
                      f"{len(sectors)} sect, {len(geos)} géo (Σ {geo_sum}%)", flush=True)

            if apply:
                try:
                    write_breakdowns(client, isin, geos, sectors, holdings, now_iso)
                except Exception as e:
                    stats["write_err"] += 1
                    if stats["write_err"] <= 3:
                        print(f"  ✗ write({isin}) : {e}", flush=True)
        except _FundTimeout:
            stats["timeout"] += 1
            _note(isin, "timeout")
            if stats["timeout"] <= 10:
                print(f"  ⏱ {isin} — deadline {FUND_DEADLINE_S}s dépassé, skip", flush=True)
        finally:
            _disarm_deadline()

    _record_attempts(client, attempts)   # flush final

    print(f"\n  Résumé :")
    print(f"    ✓ ventilés          : {stats['ok']}")
    print(f"    ✗ sans secId        : {stats['no_sec_id']}")
    print(f"    ✗ sans portfolio    : {stats['no_portfolio']}")
    print(f"    ✗ données vides     : {stats['no_data']}")
    if stats["timeout"]:
        print(f"    ⏱ timeouts (skip)   : {stats['timeout']}")
    if stats["write_err"]:
        print(f"    ✗ erreurs écriture  : {stats['write_err']}")
    if not apply and not probe:
        print("\n  ⚠  Dry-run — relancer avec --apply pour persister.")

    if apply:
        log_run("populate-holdings-morningstar", "success",
                stats["ok"], stats["no_sec_id"] + stats["no_portfolio"] + stats["no_data"],
                started_at=started)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply",  action="store_true", help="Écrire dans Supabase")
    ap.add_argument("--limit",  type=int, help="Limiter à N fonds (après filtrage géo)")
    ap.add_argument("--offset", type=int, default=0, help="Décalage dans la liste priorisée AUM")
    ap.add_argument("--isin",   type=str, help="Un seul ISIN (test)")
    ap.add_argument("--probe",  action="store_true",
                    help="Dump le JSON brut de l'API (figer le format avant le run de masse)")
    ap.add_argument("--include-unrated", action="store_true",
                    help="Viser AUSSI les fonds sans morningstar_rating (mur OPCVM "
                         "non-notés). Taux de résolution plus faible : --probe d'abord.")
    args = ap.parse_args()
    run(apply=args.apply, limit=args.limit, offset=args.offset,
        single_isin=args.isin, probe=args.probe, include_unrated=args.include_unrated)


if __name__ == "__main__":
    main()
