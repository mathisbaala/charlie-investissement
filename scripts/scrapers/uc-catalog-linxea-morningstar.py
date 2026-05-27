#!/usr/bin/env python3
"""
uc-catalog-linxea-morningstar.py — Catalogue UC Linxea via API Morningstar EMEA
================================================================================
Alimente les tables de catalogue UC (unités de compte) :
  - investissement_insurer_contracts  : un enregistrement par contrat assureur
  - investissement_contract_uc        : jonction ISIN ↔ contrat (1 ligne / fonds disponible)

Sources : API ECINT Morningstar (Bearer OAuth) — mêmes credentials que linxea-ms-enricher.py

Contrats couverts (8 univers Morningstar → 10 contrats Linxea) :
  FEEUR$$ALL_5627 → Linxea Spirit 2 + Linxea Spirit PER       (Spirica)
  FEEUR$$ALL_7170 → Linxea Avenir 2                            (Suravenir)
  FEEUR$$ALL_842  → Linxea Vie                                  (Suravenir)
  FEEUR$$ALL_2659 → Linxea Zen                                  (Suravenir)
  FEEUR$$ALL_5650 → Linxea Spirit Capitalisation 2              (Spirica)
  FEEUR$$ALL_5649 → Linxea Avenir Capitalisation 2              (Suravenir)
  FEEUR$$ALL_5252 → Linxea Suravenir PER                        (Suravenir)
  FOFRA$$ALL_7306 → Linxea PER                                  (Suravenir)

Usage :
    # Dry-run (affiche stats, aucun upsert)
    python3 scripts/scrapers/uc-catalog-linxea-morningstar.py

    # Écriture en base
    python3 scripts/scrapers/uc-catalog-linxea-morningstar.py --apply

    # Contrats spécifiques seulement
    python3 scripts/scrapers/uc-catalog-linxea-morningstar.py --apply --only spirit2 avenir2

    # Forcer le rafraîchissement des UC marquées unavailable
    python3 scripts/scrapers/uc-catalog-linxea-morningstar.py --apply --reset-unavailable
"""

import sys
import time
import json
import base64
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Auth Morningstar EMEA ────────────────────────────────────────────────────

OAUTH_URL = "https://www.emea-api.morningstar.com/token/oauth"
SCREENER  = "https://www.emea-api.morningstar.com/ecint/v1/screener"

_CREDS      = base64.b64encode(b"ec-Linxe-2022@eamsecservice.com:LinxeB*j91").decode()
AUTH_HEADER = f"Basic {_CREDS}"

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept":          "application/json",
    "Referer":         "https://www.linxea.com/",
}

# ─── Mapping univers → contrats ───────────────────────────────────────────────
# Chaque univers peut couvrir plusieurs contrats (ex : Spirit 2 + Spirit PER
# partagent le même univers Morningstar).
# Format : universe_id → liste de (contract_name, insurer, distributor, contract_type)

UNIVERSE_CONTRACTS: dict[str, list[tuple[str, str, str, str]]] = {
    "FEEUR$$ALL_5627": [
        ("Linxea Spirit 2",   "spirica",    "linxea", "AV"),
        ("Linxea Spirit PER", "spirica",    "linxea", "PER"),
    ],
    "FEEUR$$ALL_7170": [("Linxea Avenir 2",               "suravenir", "linxea", "AV")],
    "FEEUR$$ALL_842":  [("Linxea Vie",                    "suravenir", "linxea", "AV")],
    "FEEUR$$ALL_2659": [("Linxea Zen",                    "suravenir", "linxea", "AV")],
    "FEEUR$$ALL_5650": [("Linxea Spirit Capitalisation 2","spirica",   "linxea", "CAPI")],
    "FEEUR$$ALL_5649": [("Linxea Avenir Capitalisation 2","suravenir", "linxea", "CAPI")],
    "FEEUR$$ALL_5252": [("Linxea Suravenir PER",          "suravenir", "linxea", "PER")],
    "FOFRA$$ALL_7306": [("Linxea PER",                   "suravenir", "linxea", "PER")],
}

# Alias CLI → universe_id (pour --only)
ALIAS: dict[str, str] = {
    "spirit2":       "FEEUR$$ALL_5627",
    "spirit-per":    "FEEUR$$ALL_5627",
    "avenir2":       "FEEUR$$ALL_7170",
    "vie":           "FEEUR$$ALL_842",
    "zen":           "FEEUR$$ALL_2659",
    "spirit-capi":   "FEEUR$$ALL_5650",
    "avenir-capi":   "FEEUR$$ALL_5649",
    "suravenir-per": "FEEUR$$ALL_5252",
    "per":           "FOFRA$$ALL_7306",
}

SOURCE      = "linxea-morningstar"
SOURCE_URL  = "https://www.linxea.com/outils/liste-des-supports-xray/"
PAGE_SIZE   = 2200
RATE_LIMIT  = 0.4   # secondes entre pages


# ─── Auth ─────────────────────────────────────────────────────────────────────

def get_token() -> str:
    r = requests.post(
        OAUTH_URL,
        headers={**HEADERS, "Authorization": AUTH_HEADER},
        timeout=20,
    )
    r.raise_for_status()
    token = r.json().get("access_token") or r.json().get("token")
    if not token:
        raise ValueError(f"Pas de token dans la réponse : {r.text[:200]}")
    return token


# ─── Screener ─────────────────────────────────────────────────────────────────

def fetch_universe(token: str, universe_id: str) -> list[dict]:
    """Pagine l'API ECINT pour un univers et retourne toutes les rows."""
    bearer = f"Bearer {token}"
    params = {
        "languageId":         "fr-FR",
        "currencyId":         "EUR",
        "universeIds":        universe_id,
        "outputType":         "json",
        "securityDataPoints": "SecId|ISIN|LegalName|universe",
        "filters":            "",
        "subUniverseId":      "",
        "page":               1,
        "pageSize":           PAGE_SIZE,
    }

    rows_all: list[dict] = []
    page = 1

    while True:
        params["page"] = page
        r = requests.get(
            SCREENER,
            params=params,
            headers={**HEADERS, "Authorization": bearer},
            timeout=30,
        )
        r.raise_for_status()
        data  = r.json()
        total = data.get("total", 0)
        rows  = data.get("rows", [])

        if not rows:
            break

        rows_all.extend(rows)

        if page == 1:
            print(f"    Total API : {total}")

        if len(rows_all) >= total:
            break

        page += 1
        time.sleep(RATE_LIMIT)

    return rows_all


# ─── Upsert contrat ───────────────────────────────────────────────────────────

def upsert_contract(
    db,
    contract_name: str,
    insurer: str,
    distributor: str,
    contract_type: str,
    universe_id: str,
    uc_count: int,
    apply: bool,
) -> str | None:
    """
    Upsert investissement_insurer_contracts.
    Retourne l'UUID du contrat (nécessaire pour investissement_contract_uc).
    """
    row = {
        "insurer":                  insurer,
        "distributor":              distributor,
        "contract_name":            contract_name,
        "contract_type":            contract_type,
        "morningstar_universe_id":  universe_id,
        "uc_count":                 uc_count,
        "source_url":               SOURCE_URL,
        "source":                   SOURCE,
        "scraped_at":               datetime.now(timezone.utc).isoformat(),
        "updated_at":               datetime.now(timezone.utc).isoformat(),
    }

    if not apply:
        return None

    try:
        res = (
            db.table("investissement_insurer_contracts")
            .upsert(row, on_conflict="insurer,contract_name")
            .execute()
        )
        contract_id = res.data[0]["id"] if res.data else None

        if not contract_id:
            existing = (
                db.table("investissement_insurer_contracts")
                .select("id")
                .eq("insurer", insurer)
                .eq("contract_name", contract_name)
                .limit(1)
                .execute()
            )
            contract_id = existing.data[0]["id"] if existing.data else None

        return contract_id
    except Exception as e:
        print(f"    [erreur] upsert contrat '{contract_name}' : {e}")
        return None


# ─── Upsert UC (jonction) ─────────────────────────────────────────────────────

BATCH_SIZE = 500

def upsert_uc_batch(db, contract_id: str, rows: list[dict], apply: bool) -> tuple[int, int]:
    """Upsert en batch investissement_contract_uc. Retourne (ok, fail)."""
    if not apply:
        return len(rows), 0

    now_str = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        records = [
            {
                "contract_id":    contract_id,
                "isin":           r["ISIN"].strip(),
                "fund_name":      (r.get("LegalName") or "").strip() or None,
                "morningstar_id": (r.get("SecId") or "").strip() or None,
                "available":      True,
                "source":         SOURCE,
                "scraped_at":     now_str,
            }
            for r in batch
            if r.get("ISIN", "").strip()
        ]

        if not records:
            continue

        try:
            db.table("investissement_contract_uc") \
                .upsert(records, on_conflict="contract_id,isin") \
                .execute()
            ok += len(records)
        except Exception as e:
            print(f"    [erreur] batch UC ({i}-{i+len(batch)}) : {e}")
            fail += len(batch)

    return ok, fail


# ─── Stats couverture ─────────────────────────────────────────────────────────

def coverage_stats(db, isins: list[str]) -> tuple[int, int]:
    """
    Compte combien d'ISINs sont déjà dans investissement_funds.
    Retourne (connus, total).
    """
    if not isins:
        return 0, 0

    known = 0
    for i in range(0, len(isins), 500):
        batch = isins[i : i + 500]
        try:
            res = (
                db.table("investissement_funds")
                .select("isin", count="exact")
                .in_("isin", batch)
                .execute()
            )
            known += res.count or 0
        except Exception:
            pass

    return known, len(isins)


# ─── Pipeline principal ───────────────────────────────────────────────────────

def run(apply: bool, only: list[str] | None, reset_unavailable: bool, verbose: bool):
    db = get_client()

    # Résoudre les alias CLI en universe IDs
    if only:
        targets = set()
        for key in only:
            uid = ALIAS.get(key.lower()) or key
            if uid in UNIVERSE_CONTRACTS:
                targets.add(uid)
            else:
                print(f"  ⚠  Univers inconnu : {key} (ignoré)")
        universe_ids = [uid for uid in UNIVERSE_CONTRACTS if uid in targets]
    else:
        universe_ids = list(UNIVERSE_CONTRACTS.keys())

    print(f"  Univers à traiter : {len(universe_ids)}")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")

    print("\n  Authentification Morningstar EMEA...")
    try:
        token = get_token()
        print("  Token OK")
    except Exception as e:
        print(f"  ERREUR auth : {e}")
        sys.exit(1)

    total_ok = total_fail = total_uc = 0
    coverage_known = coverage_total = 0

    for universe_id in universe_ids:
        contracts = UNIVERSE_CONTRACTS[universe_id]
        contract_labels = " + ".join(c[0] for c in contracts)
        print(f"\n  ── {universe_id} → {contract_labels}")

        try:
            rows = fetch_universe(token, universe_id)
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 401:
                print("  Token expiré, renouvellement...")
                try:
                    token = get_token()
                    rows  = fetch_universe(token, universe_id)
                except Exception as e2:
                    print(f"  ERREUR : {e2}")
                    total_fail += 1
                    continue
            else:
                print(f"  ERREUR HTTP : {e}")
                total_fail += 1
                continue
        except Exception as e:
            print(f"  ERREUR : {e}")
            total_fail += 1
            continue

        valid = [r for r in rows if r.get("ISIN", "").strip()]
        print(f"    Fonds : {len(valid)} ISINs valides / {len(rows)} rows")
        total_uc += len(valid)

        # Stats couverture vs investissement_funds
        isins = [r["ISIN"].strip() for r in valid]
        known, total = coverage_stats(db, isins)
        coverage_known  += known
        coverage_total  += total
        pct = round(100 * known / total, 1) if total else 0
        print(f"    Couverture : {known}/{total} déjà dans investissement_funds ({pct}%)")

        # Pour chaque contrat mappé à cet univers
        for (contract_name, insurer, distributor, contract_type) in contracts:
            print(f"    Contrat : {contract_name} ({insurer}, {contract_type})")

            contract_id = upsert_contract(
                db, contract_name, insurer, distributor, contract_type,
                universe_id, len(valid), apply,
            )

            if apply and not contract_id:
                print(f"    [erreur] Impossible de récupérer l'UUID du contrat")
                total_fail += 1
                continue

            ok, fail = upsert_uc_batch(db, contract_id, valid, apply)
            total_ok   += ok
            total_fail += fail

            if apply:
                print(f"    UC upsertés : {ok} OK, {fail} erreurs")

        time.sleep(RATE_LIMIT)

    # ─── Bilan ────────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"  UC catalogue totales  : {total_uc}")
    cov_pct = round(100 * coverage_known / coverage_total, 1) if coverage_total else 0
    print(f"  Couverture fonds      : {coverage_known}/{coverage_total} ({cov_pct}%)")
    if apply:
        print(f"  Lignes upsertées      : {total_ok} OK  |  {total_fail} erreurs")
    else:
        print(f"  (dry-run — aucun upsert)")
    print("=" * 60)

    if apply:
        try:
            log_run(
                scraper="uc-catalog-linxea-morningstar",
                status="success" if total_fail == 0 else "partial",
                records_processed=total_ok,
                records_failed=total_fail,
            )
        except Exception:
            pass


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Catalogue UC Linxea via API Morningstar EMEA"
    )
    parser.add_argument("--apply",             action="store_true",
                        help="Écrire en base (défaut : dry-run)")
    parser.add_argument("--only",              nargs="+",
                        metavar="CONTRAT",
                        help=f"Univers/alias à traiter. Alias : {', '.join(ALIAS)}")
    parser.add_argument("--reset-unavailable", action="store_true",
                        help="Remettre available=TRUE pour tous les ISINs avant upsert")
    parser.add_argument("--verbose",           action="store_true")
    args = parser.parse_args()

    run(
        apply=args.apply,
        only=args.only,
        reset_unavailable=args.reset_unavailable,
        verbose=args.verbose,
    )
