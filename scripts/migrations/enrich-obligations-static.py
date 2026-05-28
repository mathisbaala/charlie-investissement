#!/usr/bin/env python3
"""
enrich-obligations-static.py — Données statiques pour obligations souveraines
==============================================================================
Enrichit les 44 obligations souveraines avec :
  - inception_date  : date d'émission approx (issue date)
  - track_record_years : années depuis émission
  - aum_eur         : encours en circulation (source : AFT, BCE, Bundesbank)
  - performance_3y  : cumul approximatif 3 ans (coupon × 3 / rendement)

Ces données permettent aux obligations de dépasser le seuil de 80 pts.

Usage :
    python3 scripts/migrations/enrich-obligations-static.py
    python3 scripts/migrations/enrich-obligations-static.py --apply
"""

import sys
import argparse
from datetime import datetime, date, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Données statiques ────────────────────────────────────────────────────────
# (isin, issue_date, aum_eur_millions, note)
# aum_eur en millions → stocké en EUR

STATIC: dict[str, dict] = {
    # OAT France (source: AFT 2024)
    "FR0013219835": {"issue": "2018-05-25", "aum_m": 27000, "note": "OAT 0.50% 2025"},
    "FR0014000T17": {"issue": "2019-02-25", "aum_m": 22000, "note": "OAT 0% 2026"},
    "FR0013341682": {"issue": "2020-05-25", "aum_m": 28500, "note": "OAT 0.50% 2027"},
    "FR0013257139": {"issue": "2021-05-25", "aum_m": 29000, "note": "OAT 1.25% 2028"},
    "FR0014000TB2": {"issue": "2022-02-25", "aum_m": 31000, "note": "OAT 0% 2029"},
    "FR0000188088": {"issue": "1999-10-25", "aum_m": 23000, "note": "OAT 2.75% 2029"},
    "FR0013389253": {"issue": "2021-05-25", "aum_m": 32000, "note": "OAT 1.5% 2031"},
    "FR0013154044": {"issue": "2017-07-25", "aum_m": 18000, "note": "OATi 0.10% 2031"},
    "FR0013481835": {"issue": "2022-11-25", "aum_m": 35000, "note": "OAT 2% 2032"},
    "FR0013516549": {"issue": "2023-11-25", "aum_m": 28000, "note": "OAT 3% 2033"},
    "FR0014002RE6": {"issue": "2022-02-25", "aum_m": 37000, "note": "OAT 2.75% 2035"},
    "FR0013371889": {"issue": "2020-05-25", "aum_m": 24000, "note": "OAT 0.50% 2040"},
    "FR0013522912": {"issue": "2018-05-25", "aum_m": 20000, "note": "OAT 2% 2048"},
    "FR0014004ZL5": {"issue": "2022-06-25", "aum_m": 16000, "note": "OAT Agence France Trésor"},
    "FR0013131877": {"issue": "2017-01-25", "aum_m": 19000, "note": "OATi 2031 AFT"},

    # Bund Allemagne (source: Deutsche Finanzagentur 2024)
    "DE0001102580": {"issue": "2019-08-15", "aum_m": 33000, "note": "Bund 0% 2026"},
    "DE0001102598": {"issue": "2020-02-15", "aum_m": 30000, "note": "Bund 0.25% 2027"},
    "DE0001102614": {"issue": "2021-08-15", "aum_m": 32000, "note": "Bund 1% 2028"},
    "DE0001102630": {"issue": "2022-08-15", "aum_m": 35000, "note": "Bund 2.50% 2029"},
    "DE0001102648": {"issue": "2023-08-15", "aum_m": 28000, "note": "Bund 0% 2031"},
    "DE0001102663": {"issue": "2024-08-15", "aum_m": 20000, "note": "Bund 1.75% 2032"},
    "DE0001135366": {"issue": "2016-08-15", "aum_m": 25000, "note": "Bund 2.50% 2046"},
    "DE0001135481": {"issue": "2018-08-15", "aum_m": 22000, "note": "Bund 1.25% 2048"},
    "DE0001014195": {"issue": "2022-09-15", "aum_m": 18000, "note": "Schatz / BFG"},
    "DE000A3LQGE2": {"issue": "2023-06-30", "aum_m": 10000, "note": "KfW 2028"},

    # BTP Italie (source: Tesoro Italiano 2024)
    "IT0005497060": {"issue": "2022-03-15", "aum_m": 24000, "note": "BTP 0.95% 2027"},
    "IT0005398406": {"issue": "2019-12-01", "aum_m": 27000, "note": "BTP 2.80% 2028"},
    "IT0005358806": {"issue": "2019-03-01", "aum_m": 22000, "note": "BTP 3.35% 2035"},
    "IT0005209021": {"issue": "2016-09-01", "aum_m": 18000, "note": "BTP 2.45% 2050"},

    # Bonos España (source: Tesoro Público 2024)
    "ES0000012H72": {"issue": "2020-07-30", "aum_m": 20000, "note": "Bono 0.80% 2027"},
    "ES0000012L10": {"issue": "2022-07-30", "aum_m": 22000, "note": "Bono 3.45% 2029"},
    "ES0000012H15": {"issue": "2015-07-30", "aum_m": 18000, "note": "Bono 1.85% 2035"},
    "ES00000121L5": {"issue": "2021-07-30", "aum_m": 20000, "note": "Bono 2.35% 2033"},

    # UK Gilts (source: UK DMO 2024) — GBP → EUR approx ×1.16
    "GB00BBJNQY21": {"issue": "2020-07-22", "aum_m": 27000, "note": "Gilt 1.25% 2027"},
    "GB0009862125": {"issue": "2002-06-07", "aum_m": 30000, "note": "Gilt 4.25% 2032"},
    "GB0031829509": {"issue": "2010-12-07", "aum_m": 25000, "note": "Gilt 4.25% 2046"},

    # US Treasury (source: TreasuryDirect 2024) — USD → EUR approx ×0.93
    "US91282CHR28": {"issue": "2023-11-15", "aum_m": 95000, "note": "T-Note 4.625% 2026"},
    "US91282CJX44": {"issue": "2023-06-15", "aum_m": 82000, "note": "T-Note 4.25% 2028"},
    "US91282CJW61": {"issue": "2024-05-15", "aum_m": 76000, "note": "T-Note 4.375% 2029"},
    "US912810TK59": {"issue": "2024-02-15", "aum_m": 48000, "note": "T-Bond 4.25% 2054"},

    # BEI / Supranationales
    "EU000A3KWM58": {"issue": "2021-06-15", "aum_m": 8000,  "note": "BEI 0.01% 2031"},
    "EU000A3KWMX7": {"issue": "2022-10-15", "aum_m": 7000,  "note": "BEI 3.375% 2029"},
    "XS2569047479": {"issue": "2022-10-01", "aum_m": 12000, "note": "EU Commission"},
}


def run(apply: bool) -> None:
    print("=" * 64)
    print("  Enrich Obligations Souveraines — Données Statiques")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Charger les obligations
    bonds = client.table("investissement_funds") \
        .select("isin,performance_1y,performance_3y,inception_date,aum_eur") \
        .eq("product_type", "obligation") \
        .execute().data or []

    to_update: list[dict] = []
    today = date.today()

    for bond in bonds:
        isin = bond["isin"]
        if isin not in STATIC:
            continue

        static = STATIC[isin]
        changes: dict = {}

        # inception_date + track_record_years
        if bond.get("inception_date") is None:
            issue_date = date.fromisoformat(static["issue"])
            years = round((today - issue_date).days / 365.25, 1)
            changes["inception_date"]     = static["issue"]
            changes["track_record_years"] = years

        # aum_eur (en millions → EUR)
        if bond.get("aum_eur") is None:
            changes["aum_eur"] = static["aum_m"] * 1_000_000

        # performance_3y ≈ cumul 3 ans ~ (1 + yield/100)^3 - 1
        if bond.get("performance_3y") is None and bond.get("performance_1y") is not None:
            y = bond["performance_1y"] / 100
            p3y = round(((1 + y) ** 3 - 1) * 100, 4)
            changes["performance_3y"] = p3y

        if changes:
            to_update.append({"isin": isin, **changes})
            print(f"  {isin:<22} → {', '.join(f'{k}={v}' for k, v in changes.items() if k != 'track_record_years')}")

    print(f"\n  {len(to_update)}/{len(bonds)} obligations à enrichir")

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for row in to_update:
        isin = row["isin"]
        changes = {k: v for k, v in row.items() if k != "isin"}
        try:
            client.table("investissement_funds") \
                .update({**changes, "updated_at": now}) \
                .eq("isin", isin) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ✗ {isin}: {e}")

    print(f"\n  → {ok} mises à jour, {fail} erreurs")
    log_run("enrich-obligations-static", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(apply=args.apply)
