#!/usr/bin/env python3
"""
ms-emea-fees-enricher.py — Frais courants (TER) via Morningstar EMEA screener
==============================================================================
Comble `ter` / `ongoing_charges` des OPCVM/ETF sans frais, à partir du screener
Morningstar EMEA (ecint) — la MÊME requête qui résout déjà l'ISIN→secId dans
populate-holdings-morningstar.py, en ajoutant simplement le data point frais.
Donc AUCUN appel supplémentaire par fonds au-delà d'un GET screener.

Pourquoi ce chantier : GECO = prix seulement, ms-emea-perf = perf seulement,
ft-enricher couvre mal les OPCVM FR, et 96 % des OPCVM FR sans TER n'ont pas de
kid_url → le KID est hors-jeu. Morningstar couvre l'univers FR/Europe → c'est le
seul levier frais à l'échelle. Cf. mémoire enrichment-frontier-findings-20260707.

FILL-ONLY strict (safe_fill_funds) : n'écrit que les colonnes NULL, trace la
source dans field_sources, n'écrase jamais une valeur existante.

⚠ Le nom EXACT du data point frais Morningstar est incertain à l'aveugle (creds
CI-only, non testable en local) → on demande plusieurs candidats et on lit le
premier renseigné. Le mode --debug imprime les champs bruts des premiers fonds
pour confirmer le bon nom avant un run complet.

Usage :
    python3 scripts/scrapers/ms-emea-fees-enricher.py [--apply] [--min-aum N] [--limit N] [--debug]
"""

import os
import sys
import time
import base64
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, safe_fill_funds, log_run

# ─── Config API EMEA (même socle que populate-holdings-morningstar) ───────────
OAUTH_URL = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER  = "https://www.emea-api.morningstar.com/ecint/v1/screener"
UNIVERSES = ["FOFRA$$ALL", "FEEUR$$ALL"]   # FR + Europe (couvre LU/IE)
SOURCE    = "morningstar"

# Candidats data point « frais courants » (nom exact incertain → on lit le 1er
# renseigné). OngoingCharge = frais courants KIID ; les autres = filets.
FEE_DATAPOINTS = ["OngoingCharge", "ExpenseRatioNet", "ExpenseRatio", "ManagementFee"]

RATE_LIMIT_SEC = 0.25
TOKEN_REFRESH_EVERY = 400   # les tokens oauth expirent : on refait un token régulièrement


# ─── Auth ─────────────────────────────────────────────────────────────────────
def _creds_b64() -> str:
    user = os.environ.get("MS_EMEA_USER", "").strip()
    pwd  = os.environ.get("MS_EMEA_PASS", "").strip()
    if not user or not pwd:
        raise EnvironmentError("MS_EMEA_USER et MS_EMEA_PASS requis (secrets repo).")
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
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json",
               "Referer": "https://www.linxea.com/"}
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


# ─── Résolution frais ─────────────────────────────────────────────────────────
def resolve_fees(isin: str, token: str, debug: bool = False) -> dict:
    """ISIN → {ter, ongoing_charges} en FRACTION, ou {} si rien trouvé.

    Morningstar renvoie les frais en POURCENT (ex. 1.25) ; la base stocke une
    FRACTION (ter_pct = ter*100). Garde-fou : 0 < frais ≤ 10 %."""
    dp = "SecId|ISIN|Name|" + "|".join(FEE_DATAPOINTS)
    for universe in UNIVERSES:
        data = _api_get(SCREENER, {
            "languageId": "fr-FR", "currencyId": "EUR",
            "universeIds": universe, "outputType": "json",
            "securityDataPoints": dp, "term": isin, "pageSize": 1, "page": 1,
        }, token)
        for row in (data or {}).get("rows", []):
            if debug:
                raw = {f: row.get(f) for f in FEE_DATAPOINTS}
                print(f"    [debug] {isin} {universe} → {raw}")
            for f in FEE_DATAPOINTS:
                v = row.get(f)
                if v is None or v == "":
                    continue
                try:
                    pct = float(v)
                except (TypeError, ValueError):
                    continue
                if 0 < pct <= 10:
                    frac = round(pct / 100, 6)
                    return {"ter": frac, "ongoing_charges": frac}
    return {}


# ─── Sélection cible ──────────────────────────────────────────────────────────
def select_targets(client, min_aum: int, limit: int | None) -> list[str]:
    """opcvm/etf avec ter NULL, triés encours décroissant. min_aum : early-stop
    (le tri desc garantit que sous le seuil tout le reste est plus petit)."""
    targets, page, size = [], 0, 1000
    while True:
        rows = (client.table("investissement_funds")
                .select("isin,aum_eur")
                .in_("product_type", ["opcvm", "etf"])
                .is_("ter", "null")
                .order("aum_eur", desc=True, nullsfirst=False)
                .range(page * size, page * size + size - 1)
                .execute().data or [])
        if not rows:
            break
        for r in rows:
            if min_aum and (r.get("aum_eur") or 0) < min_aum:
                return targets   # trié desc → plus rien au-dessus du seuil
            targets.append(r["isin"])
            if limit and len(targets) >= limit:
                return targets
        if len(rows) < size:
            break
        page += 1
    return targets


# ─── Main ─────────────────────────────────────────────────────────────────────
def run(apply: bool, min_aum: int, limit: int | None, debug: bool):
    print("=" * 70)
    print("  Morningstar EMEA — Frais courants (TER)")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'} | min_aum={min_aum:,}€ | limit={limit}")
    print("=" * 70)

    started = datetime.now(timezone.utc)
    client = get_client()
    token = get_token()

    targets = select_targets(client, min_aum, limit)
    print(f"  {len(targets)} fonds ter-null à tenter\n")

    records, resolved, empty = [], 0, 0
    for i, isin in enumerate(targets, 1):
        if i % TOKEN_REFRESH_EVERY == 0:
            try:
                token = get_token()
            except Exception as e:
                print(f"  ⚠ refresh token échoué : {e}")
        fees = resolve_fees(isin, token, debug=debug and i <= 8)
        if fees:
            records.append({"isin": isin, **fees})
            resolved += 1
        else:
            empty += 1
        time.sleep(RATE_LIMIT_SEC)
        if i % 200 == 0:
            print(f"  [{i}/{len(targets)}] résolus={resolved} vides={empty}")

    print(f"\n  → {resolved} frais résolus, {empty} sans donnée Morningstar")
    if records[:5]:
        print("  Échantillon :", [(r['isin'], f"{r['ter']*100:.2f}%") for r in records[:5]])

    if not apply:
        print("\n  DRY-RUN — pas d'écriture.")
        return

    stats = safe_fill_funds(records, source=SOURCE)
    print(f"\n  ✓ écriture fill-only : {stats}")
    log_run(
        scraper="ms-emea-fees",
        status="success",
        records_processed=stats.get("rows_updated", 0),
        records_failed=stats.get("failed", 0),
        started_at=started,
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--min-aum", type=int, default=10_000_000,
                    help="AUM minimum en euros (défaut 10M ; 0 = tous)")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--debug", action="store_true",
                    help="Imprime les data points frais bruts des 8 premiers fonds")
    args = ap.parse_args()
    run(apply=args.apply, min_aum=args.min_aum, limit=args.limit, debug=args.debug)
