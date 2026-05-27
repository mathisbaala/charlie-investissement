#!/usr/bin/env python3
"""
scpi-iroko-enricher.py — Enrichissement SCPI Iroko via API publique
===================================================================
Iroko expose une API Supabase publique (sans auth) avec les métriques
live de ses SCPIs : Zen, Atlas, Impact, Next.

API : https://cyrbbvxjkvmtgypnxlpw.supabase.co/rest/v1/key_figures
      apikey : sb_publishable_u1ro1KEtiWMi_HcgR5UV5w_w5AelhLM

Métriques extraites (valeur la plus récente par fund × metric) :
  distribution_yield        → dvm + performance_1y
  financial_occupancy_rate  → tof
  net_capital_raised        → capitalization + aum_eur
  share_redemption_price    → price_per_share
  physical_occupancy_rate   → loggé en verbose
  reconstitution_value      → loggé en verbose
  debt_ratio                → loggé en verbose

Tables mises à jour :
  investissement_scpi_metrics  (isin, dvm, tof, price_per_share, capitalization)
  investissement_funds         (isin, aum_eur, performance_1y)

Usage :
    python3 scripts/scrapers/scpi-iroko-enricher.py             # dry-run
    python3 scripts/scrapers/scpi-iroko-enricher.py --apply     # écrit en DB
    python3 scripts/scrapers/scpi-iroko-enricher.py --apply --verbose
"""

import sys
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run, now_iso

# ─── Config ───────────────────────────────────────────────────────────────────

API_BASE = "https://cyrbbvxjkvmtgypnxlpw.supabase.co/rest/v1"
API_KEY  = "sb_publishable_u1ro1KEtiWMi_HcgR5UV5w_w5AelhLM"

HEADERS = {
    "apikey": API_KEY,
    "Accept": "application/json",
}

TIMEOUT = 20

# Slug Iroko → patterns pour ilike dans investissement_funds.name
# Iroko Atlas (FR0014009MY9) peut ne pas encore être en base
FUND_SLUGS: dict[str, list[str]] = {
    "zen":    ["Iroko Zen", "IROKO ZEN"],
    "atlas":  ["Iroko Atlas", "IROKO ATLAS", "iroko atlas"],
    "impact": ["Iroko Impact", "IROKO IMPACT"],
    "next":   ["Iroko Next", "IROKO NEXT"],
}

# Métriques API → colonne investissement_scpi_metrics
SCPI_METRICS_MAP: dict[str, str] = {
    "distribution_yield":       "dvm",
    "financial_occupancy_rate": "tof",
    "net_capital_raised":       "capitalization",
    "share_redemption_price":   "price_per_share",
}

# Métriques API → colonne investissement_funds (enrichissement)
FUND_UPDATES_MAP: dict[str, str] = {
    "distribution_yield": "performance_1y",
    "net_capital_raised":  "aum_eur",
}

# Métriques supplémentaires loggées en verbose
EXTRA_METRICS = [
    "physical_occupancy_rate",
    "reconstitution_value",
    "debt_ratio",
    "walb_average",
    "walt_average",
]


# ─── API ──────────────────────────────────────────────────────────────────────

def fetch_key_figures(fund_slug: str) -> list[dict]:
    """Récupère tous les key_figures non-nuls pour un fonds Iroko."""
    r = requests.get(
        f"{API_BASE}/key_figures",
        params={
            "select":      "name,value,unit,update_date",
            "fund":        f"eq.{fund_slug}",
            "value":       "not.is.null",
            "order":       "update_date.desc",
        },
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def latest_by_metric(rows: list[dict]) -> dict[str, dict]:
    """Pour chaque metric name, garde l'entrée avec la date la plus récente."""
    by_metric: dict[str, dict] = {}
    for row in rows:
        name = row.get("name")
        if not name or row.get("value") is None:
            continue
        existing_date = (by_metric.get(name) or {}).get("update_date") or ""
        new_date = row.get("update_date") or ""
        if name not in by_metric or new_date > existing_date:
            by_metric[name] = row
    return by_metric


# ─── Lookup ISIN ─────────────────────────────────────────────────────────────

def find_isin(client, name_patterns: list[str]) -> str | None:
    """Cherche l'ISIN d'une SCPI dans investissement_funds par nom."""
    for pattern in name_patterns:
        try:
            res = (
                client.table("investissement_funds")
                .select("isin,name")
                .ilike("name", f"%{pattern}%")
                .limit(1)
                .execute()
            )
            if res.data:
                return res.data[0]["isin"]
        except Exception:
            pass
    return None


# ─── Upsert ───────────────────────────────────────────────────────────────────

def _quarter() -> str:
    now = datetime.now(timezone.utc)
    q = (now.month - 1) // 3 + 1
    return f"{now.year}-Q{q}"


def upsert_scpi_metrics(client, isin: str, metrics: dict) -> bool:
    row = {
        "isin":       isin,
        "period":     _quarter(),
        "updated_at": now_iso(),
    }
    for col in ("dvm", "tof", "capitalization", "price_per_share"):
        if col in metrics:
            val = metrics[col]
            if col in ("capitalization", "price_per_share"):
                row[col] = int(val)  # bigint en DB
            elif col == "tof":
                # numeric(6,4) → max 99.9999
                row[col] = min(float(val), 99.99)
            else:
                row[col] = val

    try:
        client.table("investissement_scpi_metrics").upsert(row, on_conflict="isin").execute()
        return True
    except Exception as e:
        print(f"  ✗ scpi_metrics {isin} : {e}")
        return False


def upsert_fund_enrichment(client, isin: str, updates: dict) -> bool:
    if not updates:
        return True
    # aum_eur est bigint en DB → forcer int
    safe = dict(updates)
    if "aum_eur" in safe and safe["aum_eur"] is not None:
        safe["aum_eur"] = int(safe["aum_eur"])
    try:
        client.table("investissement_funds").update({
            **safe,
            "updated_at": now_iso(),
        }).eq("isin", isin).execute()
        return True
    except Exception as e:
        print(f"  ✗ funds {isin} : {e}")
        return False


# ─── Runner ───────────────────────────────────────────────────────────────────

def run(apply: bool, verbose: bool):
    print("=" * 60)
    print("  Iroko SCPI Enricher — API publique")
    print("=" * 60)
    print(f"  Fonds  : {', '.join(FUND_SLUGS.keys())}")
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client() if apply else None

    ok = fail = 0

    for slug, name_patterns in FUND_SLUGS.items():
        print(f"  ── {slug.upper()} ({name_patterns[0]}) ──")

        # 1. Fetch
        try:
            rows = fetch_key_figures(slug)
        except Exception as e:
            print(f"  ✗ API error : {e}")
            fail += 1
            continue

        by_metric = latest_by_metric(rows)
        print(f"  {len(by_metric)} métriques ({len(rows)} entrées brutes)")

        # 2. Extraire métriques DB
        scpi_metrics: dict[str, float] = {}
        fund_updates:  dict[str, float] = {}

        for api_name, db_col in SCPI_METRICS_MAP.items():
            if api_name in by_metric:
                val = by_metric[api_name]["value"]
                date = by_metric[api_name].get("update_date", "?")
                scpi_metrics[db_col] = float(val)
                if verbose:
                    print(f"    {api_name:40} = {val:<15} ({date})")

        for api_name, db_col in FUND_UPDATES_MAP.items():
            if api_name in by_metric:
                fund_updates[db_col] = float(by_metric[api_name]["value"])

        if verbose:
            for m in EXTRA_METRICS:
                if m in by_metric:
                    row = by_metric[m]
                    print(f"    {m:40} = {row['value']:<15} ({row.get('update_date', '?')})")

        if not scpi_metrics:
            print("  ⚠  Aucune métrique extraite")
            continue

        # Résumé
        dvm  = scpi_metrics.get("dvm", "?")
        tof  = scpi_metrics.get("tof", "?")
        capi = scpi_metrics.get("capitalization")
        capi_str = f"{capi:,.0f} €" if capi else "?"
        print(f"  dvm={dvm}%  tof={tof}%  capi={capi_str}")

        if not apply:
            ok += 1
            continue

        # 3. Lookup ISIN
        isin = find_isin(client, name_patterns)
        if not isin:
            print(f"  ⚠  ISIN introuvable ({name_patterns[0]})")
            fail += 1
            continue

        print(f"  ISIN : {isin}")

        # 4. Upsert
        ok_m = upsert_scpi_metrics(client, isin, scpi_metrics)
        ok_f = upsert_fund_enrichment(client, isin, fund_updates)
        if ok_m and ok_f:
            ok += 1
            print("  ✓ OK")
        else:
            fail += 1

        print()

    print(f"\n  Total : {ok} OK, {fail} échec")

    if apply:
        status = "success" if fail == 0 else "partial"
        log_run("scpi-iroko-enricher", status, ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Iroko SCPI Enricher (API publique)")
    parser.add_argument("--apply",   action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--verbose", action="store_true", help="Afficher chaque métrique")
    args = parser.parse_args()
    run(apply=args.apply, verbose=args.verbose)
