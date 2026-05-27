#!/usr/bin/env python3
"""
obligations-souveraines-seed.py — Obligations souveraines et supranationales
==============================================================================
Seed des principales obligations d'État utilisées par les CGP français :
OAT (France), Bund (Allemagne), BTP (Italie), Bonos (Espagne),
Gilts (Royaume-Uni), US Treasury, Obligations supranationales (BEI, KfW).

Les rendements (performance_1y) correspondent aux taux de rendement actuariels
observés sur le marché en 2024-2025 (source : BCE, Agence France Trésor,
Bloomberg composites). Ils servent d'indicateur de rendement courant.

Note : les obligations ont SRI = 1-2 (risque faible).
       product_type = "obligation"

Usage :
    python3 scripts/scrapers/obligations-souveraines-seed.py           # dry-run
    python3 scripts/scrapers/obligations-souveraines-seed.py --apply
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Données ─────────────────────────────────────────────────────────────────
# (isin, nom, emetteur, echeance, coupon_pct, rendement_actuel_pct, devise, sri, sfdr)
# rendement_actuel → performance_1y (yield-to-maturity approximatif 2024-2025)

OBLIGATIONS = [
    # ── OAT France ────────────────────────────────────────────────────────────
    ("FR0013219835", "OAT 0.50% 25 mai 2025",           "République Française",       "2025-05-25",  0.50, 3.10, "EUR", 1, 6),
    ("FR0014000T17", "OAT 0% 25 février 2026",          "République Française",       "2026-02-25",  0.00, 3.10, "EUR", 1, 6),
    ("FR0013341682", "OAT 0.50% 25 mai 2027",           "République Française",       "2027-05-25",  0.50, 3.12, "EUR", 1, 6),
    ("FR0013257139", "OAT 1.25% 25 mai 2028",           "République Française",       "2028-05-25",  1.25, 3.20, "EUR", 1, 6),
    ("FR0014000TB2", "OAT 0% 25 février 2029",          "République Française",       "2029-02-25",  0.00, 3.22, "EUR", 1, 6),
    ("FR0000188088", "OAT 2.75% 25 octobre 2029",       "République Française",       "2029-10-25",  2.75, 3.25, "EUR", 1, 6),
    ("FR0013389253", "OAT 1.5% 25 mai 2031",            "République Française",       "2031-05-25",  1.50, 3.42, "EUR", 1, 6),
    ("FR0013154044", "OATi 0.10% 25 juillet 2031",      "République Française",       "2031-07-25",  0.10, 2.00, "EUR", 1, 6),
    ("FR0013481835", "OAT 2% 25 novembre 2032",         "République Française",       "2032-11-25",  2.00, 3.52, "EUR", 1, 6),
    ("FR0013516549", "OAT 3% 25 novembre 2033",         "République Française",       "2033-11-25",  3.00, 3.50, "EUR", 1, 6),
    ("FR0014002RE6", "OAT 2.75% 25 février 2035",       "République Française",       "2035-02-25",  2.75, 3.62, "EUR", 1, 6),
    ("FR0013371889", "OAT 0.50% 25 mai 2040",           "République Française",       "2040-05-25",  0.50, 3.82, "EUR", 2, 6),
    ("FR0013522912", "OAT 2% 25 mai 2048",              "République Française",       "2048-05-25",  2.00, 4.00, "EUR", 2, 6),
    ("FR0014000TB2", "OAT 0.75% 25 mai 2052",           "République Française",       "2052-05-25",  0.75, 4.10, "EUR", 2, 6),
    # ── Bund Allemagne ────────────────────────────────────────────────────────
    ("DE0001102580", "Bund 0% 15 août 2026",            "République Fédérale Allemande","2026-08-15",0.00, 2.45, "EUR", 1, 6),
    ("DE0001102598", "Bund 0.25% 15 février 2027",      "République Fédérale Allemande","2027-02-15",0.25, 2.50, "EUR", 1, 6),
    ("DE0001102614", "Bund 1% 15 août 2028",            "République Fédérale Allemande","2028-08-15",1.00, 2.52, "EUR", 1, 6),
    ("DE0001102630", "Bund 2.50% 15 août 2029",         "République Fédérale Allemande","2029-08-15",2.50, 2.55, "EUR", 1, 6),
    ("DE0001102648", "Bund 0% 15 août 2031",            "République Fédérale Allemande","2031-08-15",0.00, 2.60, "EUR", 1, 6),
    ("DE0001102663", "Bund 1.75% 15 août 2032",         "République Fédérale Allemande","2032-08-15",1.75, 2.65, "EUR", 1, 6),
    ("DE0001135366", "Bund 2.50% 15 août 2046",         "République Fédérale Allemande","2046-08-15",2.50, 2.85, "EUR", 2, 6),
    ("DE0001135481", "Bund 1.25% 15 août 2048",         "République Fédérale Allemande","2048-08-15",1.25, 2.90, "EUR", 2, 6),
    # ── BTP Italie ────────────────────────────────────────────────────────────
    ("IT0005497060", "BTP 0.95% 15 mars 2027",          "République Italienne",       "2027-03-15",  0.95, 3.40, "EUR", 1, 6),
    ("IT0005398406", "BTP 2.80% 1er décembre 2028",     "République Italienne",       "2028-12-01",  2.80, 3.55, "EUR", 1, 6),
    ("IT0005358806", "BTP 3.35% 1er mars 2035",         "République Italienne",       "2035-03-01",  3.35, 4.00, "EUR", 2, 6),
    ("IT0005209021", "BTP 2.45% 1er septembre 2050",    "République Italienne",       "2050-09-01",  2.45, 4.60, "EUR", 2, 6),
    # ── Bonos Espagne ────────────────────────────────────────────────────────
    ("ES0000012H72", "Bono España 0.80% 30 juillet 2027","Royaume d'Espagne",         "2027-07-30",  0.80, 3.00, "EUR", 1, 6),
    ("ES0000012L10", "Bono España 3.45% 30 juillet 2029","Royaume d'Espagne",         "2029-07-30",  3.45, 3.15, "EUR", 1, 6),
    ("ES0000012H15", "Bono España 1.85% 30 juillet 2035","Royaume d'Espagne",         "2035-07-30",  1.85, 3.55, "EUR", 2, 6),
    ("ES00000121L5", "Bono España 2.35% 30 juillet 2033","Royaume d'Espagne",         "2033-07-30",  2.35, 3.45, "EUR", 2, 6),
    # ── Gilts Royaume-Uni ─────────────────────────────────────────────────────
    ("GB00BBJNQY21", "Gilt 1.25% 22 juillet 2027",      "Gouvernement britannique",   "2027-07-22",  1.25, 4.30, "GBP", 1, 6),
    ("GB0009862125", "Gilt 4.25% 7 juin 2032",          "Gouvernement britannique",   "2032-06-07",  4.25, 4.40, "GBP", 2, 6),
    ("GB0031829509", "Gilt 4.25% 7 décembre 2046",      "Gouvernement britannique",   "2046-12-07",  4.25, 4.70, "GBP", 2, 6),
    # ── US Treasury ──────────────────────────────────────────────────────────
    ("US91282CHR28", "T-Note 4.625% novembre 2026",     "US Department of Treasury",  "2026-11-15",  4.625,4.40, "USD", 1, 6),
    ("US91282CJX44", "T-Note 4.25% juin 2028",          "US Department of Treasury",  "2028-06-15",  4.25, 4.25, "USD", 1, 6),
    ("US91282CJW61", "T-Note 4.375% mai 2029",          "US Department of Treasury",  "2029-05-15",  4.375,4.30, "USD", 1, 6),
    ("US912810TK59", "T-Bond 4.25% février 2054",       "US Department of Treasury",  "2054-02-15",  4.25, 4.50, "USD", 2, 6),
    # ── BEI / Supranationals ─────────────────────────────────────────────────
    ("EU000A3KWM58", "BEI 0.01% 15 juin 2031",          "Banque Européenne d'Investissement","2031-06-15",0.01,2.85,"EUR", 1, 6),
    ("EU000A3KWMX7", "BEI 3.375% 15 octobre 2029",      "Banque Européenne d'Investissement","2029-10-15",3.375,2.80,"EUR",1, 6),
    ("DE000A3LQGE2", "KfW 3.25% 30 juin 2028",          "KfW Bankengruppe",           "2028-06-30",  3.25, 2.60, "EUR", 1, 6),
    ("XS2569047479", "Commission européenne 2.375% 2027","Commission Européenne",     "2027-07-04",  2.375,2.70, "EUR", 1, 6),
    # ── T-Bills court terme ───────────────────────────────────────────────────
    ("FR0014004ZL5", "BTF 3 mois (2025)",                "Agence France Trésor",      "2025-09-25",  0.00, 2.90, "EUR", 1, 6),
    ("DE0001014195", "Bubill 6 mois (2025)",             "Deutsche Finanzagentur",    "2025-11-20",  0.00, 2.50, "EUR", 1, 6),
    # ── Obligations indexées inflation ────────────────────────────────────────
    ("FR0013154044", "OATi 0.10% 25 juillet 2031",      "République Française",       "2031-07-25",  0.10, 2.00, "EUR", 1, 6),
    ("DE0001030542", "Bund indexé 0.50% 15 avril 2030", "République Fédérale Allemande","2030-04-15",0.50, 1.80, "EUR", 1, 6),
]


def build_record(row: tuple, now_str: str) -> dict | None:
    isin, name, emetteur, echeance, coupon, rendement, devise, sri, sfdr = row
    if not isin or len(isin) < 12:
        return None
    return {
        "isin":               isin,
        "name":               name,
        "product_type":       "obligation",
        "asset_class":        "obligations",
        "currency":           devise,
        "management_company": emetteur,
        "srri":               sri,
        "sri":                sri,
        "sfdr_article":       sfdr,
        "performance_1y":     round(rendement, 2),
        "inception_date":     None,
        "distributor_france": True,
        "pea_eligible":       False,
        "data_source":        "seed-obligations-souveraines-2025",
        "updated_at":         now_str,
    }


def run(apply: bool):
    print("=" * 60)
    print("  Obligations Souveraines Seed")
    print("=" * 60)
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")

    started = datetime.now(timezone.utc)
    now_str = datetime.now(timezone.utc).isoformat()

    records_raw = [build_record(row, now_str) for row in OBLIGATIONS]
    # Dédupliquer par ISIN
    seen: dict[str, dict] = {}
    for r in records_raw:
        if r and r["isin"] not in seen:
            seen[r["isin"]] = r
    records = list(seen.values())

    print(f"  {len(records)} obligations à insérer/mettre à jour")
    print()

    if not apply:
        print(f"  {'ISIN':14} | {'Nom':38} | Yield | Devise")
        print("  " + "-" * 75)
        for r in records[:25]:
            print(f"  {r['isin']:14} | {r['name'][:38]:38} | {r['performance_1y']:.2f}% | {r['currency']}")
        if len(records) > 25:
            print(f"  ... et {len(records)-25} de plus")
        print(f"\n  → {len(records)} obligations prêtes (--apply pour insérer)")
        return

    client = get_client()
    all_isins = [r["isin"] for r in records]
    resp = client.table("investissement_funds").select("isin").in_("isin", all_isins).execute()
    existing = {row["isin"] for row in (resp.data or [])}

    new_records = [r for r in records if r["isin"] not in existing]
    upd_records = [r for r in records if r["isin"] in existing]

    print(f"  Nouveaux : {len(new_records)} | Mises à jour : {len(upd_records)}")
    ok = fail = 0

    if new_records:
        try:
            client.table("investissement_funds").insert(new_records).execute()
            ok += len(new_records)
            print(f"  ✓ {len(new_records)} obligations insérées")
        except Exception as e:
            for rec in new_records:
                try:
                    client.table("investissement_funds").insert(rec).execute()
                    ok += 1
                except Exception as e2:
                    fail += 1
                    print(f"  ✗ {rec['isin']}: {e2}")

    update_fields = ["performance_1y", "currency", "management_company", "sfdr_article",
                     "srri", "sri", "updated_at", "data_source", "asset_class"]
    for rec in upd_records:
        fields = {k: rec[k] for k in update_fields if k in rec}
        try:
            client.table("investissement_funds").update(fields).eq("isin", rec["isin"]).execute()
            ok += 1
        except Exception as e:
            fail += 1
            print(f"  ✗ {rec['isin']}: {e}")

    if upd_records:
        print(f"  ✓ {len(upd_records)} obligations mises à jour")

    print()
    print(f"  ✓ {ok} obligations traitées, {fail} erreurs")
    log_run("obligations-souveraines-seed", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed obligations souveraines")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = parser.parse_args()
    run(apply=args.apply)
