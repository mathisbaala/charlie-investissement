#!/usr/bin/env python3
"""
justetf-scraper.py — ETFs européens depuis JustETF
===================================================
Collecte jusqu'à 2 500+ ETFs cotés en Europe avec métadonnées complètes :
ISIN, nom, TER, méthode de réplication, indice sous-jacent, AUM, devise,
domicile, politique de dividende, éligibilité PEA, bourse(s) de cotation.

Usage :
    python3 scripts/scrapers/justetf-scraper.py [--apply] [--limit N] [--country fr]

Sans --apply : dry-run (affiche sans écrire).
--country    : fr (défaut), de, gb — prioritise les ETFs cotés dans ce pays.
--limit N    : limite à N ETFs (test).

Source : JustETF public search API (JSON, pas d'auth requise).
Rate limit : 0.5 req/sec conseillé.
"""

import sys
import time
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

from scrapling.fetchers import FetcherSession

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import upsert_funds_bulk, log_run

# ─── Config ────────────────────────────────────────────────────────────────────

JUSTETF_SEARCH_URL  = "https://www.justetf.com/api/etfs"
JUSTETF_DETAIL_URL  = "https://www.justetf.com/api/etfs/{isin}"
PAGE_SIZE           = 100
RATE_LIMIT_SEC      = 0.5
BATCH_UPSERT        = 150

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept":          "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer":         "https://www.justetf.com/fr/find-etf.html",
    "X-Requested-With": "XMLHttpRequest",
}

# Domiciles européens courants → standardisés
DOMICILE_MAP = {
    "IE": "Irlande", "LU": "Luxembourg", "FR": "France",
    "DE": "Allemagne", "CH": "Suisse", "GB": "Royaume-Uni",
    "AT": "Autriche", "BE": "Belgique", "NL": "Pays-Bas",
}

# ─── Mapping ───────────────────────────────────────────────────────────────────

def parse_ter(val) -> float | None:
    if val is None:
        return None
    try:
        return round(float(str(val).replace(",", ".").replace("%", "").strip()) / 100, 6)
    except (ValueError, TypeError):
        return None

def parse_aum(val) -> int | None:
    """Convertit '1.2B' ou '850M' ou 1200000000 en entier euros."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).replace(",", "").replace(" ", "").upper()
    multipliers = {"B": 1_000_000_000, "M": 1_000_000, "K": 1_000}
    for suffix, mult in multipliers.items():
        if s.endswith(suffix):
            try:
                return int(float(s[:-1]) * mult)
            except ValueError:
                return None
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return None

def replication_label(method: str | None) -> str | None:
    if not method:
        return None
    m = method.lower()
    if "physi" in m or "direct" in m:
        return "physical"
    if "synth" in m or "swap" in m:
        return "synthetic"
    if "sampl" in m or "optimis" in m:
        return "sampling"
    return method

def dividend_label(policy: str | None) -> str | None:
    if not policy:
        return None
    p = policy.lower()
    if "accum" in p or "capitaliz" in p or "thésauris" in p:
        return "accumulation"
    if "distrib" in p:
        return "distribution"
    return policy

def map_justetf_record(r: dict) -> dict | None:
    """Convertit un enregistrement JustETF en row investissement_funds."""
    isin = (r.get("isin") or "").strip().upper()
    if not isin or len(isin) != 12:
        return None

    name = (r.get("name") or r.get("shortName") or "").strip()
    if not name:
        return None

    # Frais — JustETF fournit le TER en %
    ter_raw = r.get("ter") or r.get("totalExpenseRatio") or r.get("expenseRatio")
    ter = parse_ter(ter_raw)

    # AUM
    aum_raw = r.get("fundSize") or r.get("aum") or r.get("totalAssets")
    aum_eur = parse_aum(aum_raw)

    # Indice
    index_name = (
        r.get("indexName") or r.get("benchmark") or
        r.get("replicatedIndex") or r.get("underlyingIndex") or ""
    ).strip() or None

    # Réplication
    rep_raw = (
        r.get("replicationMethod") or r.get("replication") or
        r.get("replicationType") or ""
    )
    replication = replication_label(rep_raw)

    # Distribution
    div_raw = r.get("dividendPolicy") or r.get("distribution") or r.get("dividend")
    distribution = dividend_label(div_raw)

    # Domicile / émetteur
    domicile_code = (r.get("domicile") or r.get("countryOfDomicile") or "").upper()[:2]
    issuer = (r.get("provider") or r.get("issuer") or r.get("fundCompany") or "").strip() or None

    # Currency
    currency = (r.get("currency") or r.get("currencyCode") or "EUR").upper().strip()[:3]

    # PEA — JustETF tague les ETFs PEA pour les investisseurs français
    pea_raw = r.get("peaEligible") or r.get("isPEAEligible") or r.get("pea")
    pea_eligible = bool(pea_raw) if pea_raw is not None else False

    # Date de lancement
    launch_raw = r.get("launchDate") or r.get("inceptionDate") or r.get("foundingDate")
    inception_date = None
    if launch_raw:
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y"):
            try:
                inception_date = datetime.strptime(str(launch_raw).strip(), fmt).date().isoformat()
                break
            except ValueError:
                pass

    # Asset class depuis la catégorie JustETF
    cat = (r.get("assetClass") or r.get("category") or r.get("type") or "").lower()
    if "equit" in cat or "stock" in cat or "action" in cat:
        asset_class = "actions"
    elif "bond" in cat or "obligat" in cat or "fixed" in cat or "credit" in cat:
        asset_class = "obligations"
    elif "commodit" in cat or "matieres" in cat or "gold" in cat or "silver" in cat:
        asset_class = "alternatif"
    elif "real estate" in cat or "reit" in cat or "immo" in cat:
        asset_class = "immobilier"
    elif "money" in cat or "monetair" in cat or "cash" in cat:
        asset_class = "monetaire"
    else:
        asset_class = "diversifie"

    # Region
    region_raw = r.get("region") or r.get("geographicFocus") or ""
    region = (region_raw or "").strip() or None

    row = {
        "isin":               isin,
        "name":               name,
        "product_type":       "etf",
        "management_company": issuer,
        "asset_class":        asset_class,
        "currency":           currency,
        "inception_date":     inception_date,
        "pea_eligible":       pea_eligible,
        "distributor_france": True,
        "aum_eur":            aum_eur,
        "ter":                ter,
        "ongoing_charges":    ter,
        "data_source":        "justetf",
        "region_exposure":    region,
    }

    # Champs enrichis stockés dans la colonne category (on y met l'index + réplication)
    meta_parts = []
    if index_name:
        meta_parts.append(index_name)
    if replication:
        meta_parts.append(replication)
    if distribution:
        meta_parts.append(distribution)
    if domicile_code:
        meta_parts.append(domicile_code)
    if meta_parts:
        row["category"] = " | ".join(meta_parts)

    return row


def fetch_page(session: FetcherSession, country: str, offset: int) -> list[dict]:
    params = {
        "country":    country.upper(),
        "currency":   "EUR",
        "lang":       "fr" if country == "fr" else "en",
        "page":       offset // PAGE_SIZE,
        "pageSize":   PAGE_SIZE,
        "sortField":  "fundSize",
        "sortOrder":  "desc",
    }
    for attempt in range(4):
        try:
            page = session.get(
                JUSTETF_SEARCH_URL, params=params, stealthy_headers=True, timeout=20
            )
            if page.status == 200:
                data = json.loads(page.body.decode("utf-8"))
                # JustETF renvoie {"etfs": [...], "total": N} ou juste [...]
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return (
                        data.get("etfs") or
                        data.get("data") or
                        data.get("results") or
                        data.get("items") or
                        []
                    )
            elif page.status == 429:
                wait = 15 * (attempt + 1)
                print(f"\n    Rate-limited — attente {wait}s...", end="", flush=True)
                time.sleep(wait)
            else:
                print(f"\n    HTTP {page.status} à l'offset {offset}")
                return []
        except Exception as e:
            wait = 5 * (attempt + 1)
            print(f"\n    Erreur réseau : {e} — attente {wait}s")
            time.sleep(wait)
    return []


def run(apply: bool, limit: int | None, country: str):
    print("=" * 60)
    print("  JustETF — Collecte ETFs européens")
    print("=" * 60)
    print(f"  Mode : {'APPLY (écriture Supabase)' if apply else 'DRY-RUN'}")
    print(f"  Pays cible : {country.upper()}")
    if limit:
        print(f"  Limite : {limit} ETFs")
    print()

    started = datetime.now(timezone.utc)
    session = FetcherSession(impersonate="chrome").__enter__()

    all_rows: list[dict] = []
    offset   = 0
    total    = 0
    empty_streak = 0

    while True:
        if limit and total >= limit:
            break

        print(f"  Page {offset // PAGE_SIZE + 1:4d} (offset={offset})...", end=" ", flush=True)
        time.sleep(RATE_LIMIT_SEC)

        raw = fetch_page(session, country, offset)
        if not raw:
            empty_streak += 1
            print(f"✗ vide (streak={empty_streak})")
            if empty_streak >= 3:
                print("  → Fin détectée.")
                break
            offset += PAGE_SIZE
            continue

        empty_streak = 0
        mapped = [map_justetf_record(r) for r in raw]
        valid  = [m for m in mapped if m is not None]
        total += len(valid)

        print(f"✓ {len(raw)} bruts → {len(valid)} valides (total={total})")
        all_rows.extend(valid)
        offset += PAGE_SIZE

        if apply and len(all_rows) >= BATCH_UPSERT:
            ok, fail = upsert_funds_bulk(all_rows[:BATCH_UPSERT])
            print(f"    → Upsert {BATCH_UPSERT} ETFs : {ok} OK, {fail} échec")
            all_rows = all_rows[BATCH_UPSERT:]

    # Flush
    if apply and all_rows:
        ok, fail = upsert_funds_bulk(all_rows)
        print(f"  → Flush final {len(all_rows)} ETFs : {ok} OK, {fail} échec")

    print()
    print(f"  ✓ {total} ETFs collectés depuis JustETF")

    if not apply and all_rows:
        print()
        print("  Aperçu des 5 premiers ETFs :")
        for r in all_rows[:5]:
            ter_pct = f"{r['ter']*100:.2f}%" if r.get('ter') else "N/A"
            aum_m   = f"{r['aum_eur']//1_000_000}M€" if r.get('aum_eur') else "N/A"
            print(f"    {r['isin']} | TER {ter_pct:6} | AUM {aum_m:8} | {r['name'][:45]}")

    if apply:
        log_run(
            scraper="justetf-scraper",
            status="success",
            records_processed=total,
            started_at=started,
        )
        print("  Pipeline run loggé.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JustETF — collecte ETFs européens")
    parser.add_argument("--apply",   action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--limit",   type=int,            help="Limiter à N ETFs")
    parser.add_argument("--country", default="FR",        help="Pays (FR, DE, GB)")
    args = parser.parse_args()
    run(apply=args.apply, limit=args.limit, country=args.country.lower())
