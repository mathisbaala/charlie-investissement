#!/usr/bin/env python3
"""
scpi-seed-extended.py — Seed étendu des SCPIs françaises dans investissement_funds
===================================================================================
Insère des SCPIs connues dans investissement_funds avec leurs métadonnées clés.

Deux catégories :
  - CONFIRMED : ISINs réels vérifiés (depuis aspim-scpi.py SCPI_SEED)
  - NEW       : ISINs synthétiques SCPI_<NOM> pour les SCPIs sans ISIN vérifié

DVM → performance_1y (taux de distribution annuel, en %)
Capitalisation → aum_eur
SRRI SCPI typique : 3 (risque modéré, liquidité limitée)

Source des données : bulletins ASPIM Q4 2024, france-scpi.fr, amf-france.org
Dernière mise à jour : mai 2026

Usage :
    python3 scripts/scrapers/scpi-seed-extended.py           # dry-run
    python3 scripts/scrapers/scpi-seed-extended.py --apply   # appliquer
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run

# ─── Format des entrées ───────────────────────────────────────────────────────
# (isin, name, management_company, dvm_pct, capitalization_eur, srri, sfdr_article,
#  ongoing_charges_pct, inception_year)

# ── CONFIRMED : ISINs réels, déjà vérifiés ────────────────────────────────────
SCPI_CONFIRMED = [
    ("FR0000188013", "Edissimmo",               "Amundi Immobilier",           3.07, 3_900_000_000, 3, 8, 1.0,  1984),
    ("FR0000187666", "Immorente",               "SOFIDY",                      4.37, 3_500_000_000, 3, 8, 0.9,  1988),
    ("FR0000187781", "Épargne Foncière",        "La Française REIM",           3.50, 3_100_000_000, 3, 8, 1.0,  1968),
    ("FR0011361988", "Primovie",                "Primonial REIM",              4.50, 2_800_000_000, 3, 8, 0.9,  2012),
    ("FR0013251598", "Corum Origin",            "CORUM AM",                    6.06, 2_700_000_000, 3, 8, 1.2,  2012),
    ("FR0010956722", "Primopierre",             "Primonial REIM",              3.40, 2_500_000_000, 3, 8, 0.9,  2011),
    ("FR0010689448", "PFO2",                    "PERIAL AM",                   3.44, 1_700_000_000, 3, 8, 1.0,  2009),
    ("FR0013284286", "Corum XL",                "CORUM AM",                    5.72, 1_400_000_000, 3, 8, 1.2,  2017),
    ("FR0011513530", "Épargne Pierre",          "VOISIN",                      5.29, 1_400_000_000, 3, 8, 1.0,  2013),
    ("FR0010614267", "PFO",                     "PERIAL AM",                   4.03, 1_300_000_000, 3, 8, 1.0,  2008),
    ("FR0000188666", "Efimmo 1",                "SOFIDY",                      4.42, 1_100_000_000, 3, 8, 0.9,  1990),
    ("FR0000188557", "Rivoli Avenir Patrimoine","AEW Ciloger",                 4.31, 1_000_000_000, 3, 8, 1.0,  2003),
    ("FR0000187757", "Selectinvest 1",          "SwissLife AM France",         3.82,   920_000_000, 3, 8, 1.0,  1985),
    ("FR0000187583", "Élysées Pierre",          "HSBC REIM",                   3.51,   900_000_000, 3, 8, 1.0,  1986),
    ("FR0013018780", "Pierval Santé",           "Euryale AM",                  5.32,   900_000_000, 3, 8, 1.0,  2015),
    ("FR0013462570", "Activimmo",               "ALDERAN",                     6.02,   750_000_000, 3, 8, 1.0,  2019),
    ("FR0013309909", "PF Grand Paris",          "BNP Paribas REIM",            4.52,   680_000_000, 3, 8, 1.0,  2018),
    ("FR0013085417", "Eurovalys",               "Advenis REIM",                4.93,   640_000_000, 3, 8, 1.0,  2015),
    ("FR0013257116", "Novapierre Allemagne 2",  "Paref Gestion",               5.24,   540_000_000, 3, 8, 1.0,  2017),
    ("FR0012555740", "Patrimmo Commerce",       "Primonial REIM",              4.58,   530_000_000, 3, 8, 0.9,  2014),
    ("FR0011339745", "Swisslife Dynapierre",    "SwissLife AM France",         4.10,   450_000_000, 3, 8, 1.0,  2012),
    ("FR0014001YP7", "Corum Eurion",            "CORUM AM",                    5.57,   450_000_000, 3, 8, 1.2,  2020),
    ("FR0000189456", "Pierre Plus",             "Inter Gestion",               2.50,   420_000_000, 3, 6, 0.9,  1995),
    ("FR0013100272", "Accimmo Pierre",          "BNP Paribas REIM",            1.57,   400_000_000, 3, 8, 0.8,  2016),
    ("FR0013349244", "PF Hospitalité Europe",   "BNP Paribas REIM",            3.53,   380_000_000, 3, 8, 1.0,  2018),
    ("FR0013285895", "Interpierre Europe",      "Paref Gestion",               5.32,   380_000_000, 3, 8, 1.0,  2017),
    ("FR0013346182", "Atream Hotels",           "ATREAM",                      3.78,   310_000_000, 3, 8, 1.0,  2018),
    ("FR0012563645", "Aestiam Pierre Rendement","AESTIAM",                     3.92,   310_000_000, 3, 8, 1.0,  2014),
    ("FR0000189910", "Novapierre 1",            "Paref Gestion",               4.82,   280_000_000, 3, 8, 1.0,  2000),
    ("FR0000189431", "Cristal Rente",           "Inter Gestion",               5.00,   260_000_000, 3, 6, 0.9,  1998),
    ("FR0013399496", "LF Avenir Santé",         "La Française REIM",           4.71,   250_000_000, 3, 8, 1.0,  2019),
    ("FR0013407216", "Kyaneos Pierre",          "Kyaneos AM",                  3.88,   220_000_000, 3, 8, 1.2,  2019),
    ("FR0013344948", "Novapierre Résidences 2", "Paref Gestion",               3.52,   200_000_000, 3, 8, 1.0,  2018),
    ("FR0013399041", "Vendôme Régions",         "Norma Capital",               6.22,   150_000_000, 3, 8, 1.0,  2019),
    ("FR0013416829", "Fair Invest",             "Norma Capital",               4.41,    60_000_000, 3, 8, 1.0,  2019),
]

# ── NEW : ISINs synthétiques (SCPI sans ISIN vérifié) ─────────────────────────
# Identifiants préfixés SCPI_ pour les distinguer des vrais ISINs
# Ces SCPIs sont réelles et actives, mais leur ISIN n'est pas encore vérifié
SCPI_NEW = [
    # Nouvelles SCPIs à forte collecte 2020-2024
    ("SCPI_REMAKE_LIVE",       "Remake Live",             "Remake AM",               7.64,   820_000_000, 3, 9, 1.0,  2021),
    ("SCPI_IROKO_ZEN",         "Iroko Zen",               "Iroko",                   7.12,   620_000_000, 3, 9, 1.0,  2020),
    ("SCPI_NOVAXIA_NEO",       "Novaxia NEO",             "Novaxia Investissement",  6.51,   180_000_000, 3, 9, 1.0,  2020),
    ("SCPI_LOG_IN",            "Log In",                  "Theoreim",                5.44,   320_000_000, 3, 8, 1.0,  2019),
    ("SCPI_SOFIDY_EUR_INV",    "Sofidy Europe Invest",    "SOFIDY",                  5.10,   290_000_000, 3, 8, 0.9,  2021),
    ("SCPI_TRANSITIONS_EUR",   "Transitions Europe",      "Arkéa REIM",              5.09,   105_000_000, 3, 9, 1.0,  2022),
    ("SCPI_COEUR_REGIONS",     "Cœur de Régions",         "Sogenial Immobilier",     6.04,   170_000_000, 3, 8, 1.0,  2020),
    ("SCPI_COEUR_EUROPE",      "Cœur d'Europe",           "Sogenial Immobilier",     5.27,   130_000_000, 3, 8, 1.0,  2021),
    ("SCPI_ALTIXIA_C12",       "Altixia Cadence XII",     "Altixia REIM",            6.00,   195_000_000, 3, 8, 1.1,  2022),
    ("SCPI_ALTIXIA_COM",       "Altixia Commerces",       "Altixia REIM",            5.90,    90_000_000, 3, 8, 1.0,  2018),
    ("SCPI_LF_GP_PATRIMOINE",  "LF Grand Paris Patrimoine","La Française REIM",      4.60,   230_000_000, 3, 8, 1.0,  2020),
    ("SCPI_OSMO_ENERGIE",      "Osmo Énergie",            "Voisin",                  5.54,    85_000_000, 3, 9, 1.0,  2020),
    ("SCPI_EP_EUROPE",         "Épargne Pierre Europe",   "VOISIN",                  5.43,   235_000_000, 3, 8, 1.0,  2020),
    ("SCPI_CORUM_USA",         "Corum USA",               "CORUM AM",                5.18,   520_000_000, 3, 8, 1.2,  2022),
    ("SCPI_CORUM_BUTLER",      "Corum Butler RE",         "Corum Butler",            6.50,   210_000_000, 3, 8, 1.2,  2023),
    ("SCPI_IMMORENTE_2",       "Immorente 2",             "SOFIDY",                  4.84,   280_000_000, 3, 8, 0.9,  2021),
    ("SCPI_SOFIDY_PE",         "Sofidy Pierre Europe",    "SOFIDY",                  5.38,   165_000_000, 3, 8, 0.9,  2020),
    ("SCPI_GMA_ESSENTIALIS",   "GMA Essentialis",         "Groupama Gan REIM",       4.66,   120_000_000, 3, 8, 1.0,  2020),
    ("SCPI_MNK_EUROPE",        "MNK Europe+",             "MNK Partners",            5.48,    75_000_000, 3, 8, 1.0,  2020),
    ("SCPI_WEMO_ONE",          "Wemo One",                "Wemo Finance",            6.10,    95_000_000, 3, 8, 1.0,  2021),
    ("SCPI_PYTHAGORE",         "Pythagore",               "Voisin",                  5.73,    60_000_000, 3, 8, 1.0,  2021),
    ("SCPI_AESTIAM_CAPI",      "Aestiam Capitalisation",  "AESTIAM",                 5.01,    45_000_000, 3, 8, 1.0,  2022),
    ("SCPI_VENDOME_REG",       "Vendôme Régions",         "Norma Capital",           6.22,   150_000_000, 3, 8, 1.0,  2019),
    ("SCPI_PAREF_INTERP",      "Paref Interpierre",       "PAREF Gestion",           4.85,   115_000_000, 3, 8, 1.0,  2019),
    ("SCPI_PIERRE_EXP_SANTE",  "Pierre Expansion Santé",  "Pierre Expansion",        5.70,    65_000_000, 3, 8, 1.0,  2020),
    ("SCPI_ACTIVIMMO_2",       "Activimmo 2",             "ALDERAN",                 5.60,    80_000_000, 3, 8, 1.0,  2022),
]

ALL_SCPI = SCPI_CONFIRMED + SCPI_NEW


def build_fund_record(row: tuple, now_str: str) -> dict:
    isin, name, mgmt, dvm, capi, srri, sfdr, frais, year = row
    rec: dict = {
        "isin":               isin,
        "name":               name,
        "product_type":       "scpi",
        "asset_class":        "immobilier",
        "currency":           "EUR",
        "management_company": mgmt,
        "srri":               srri,
        "sri":                srri,
        "sfdr_article":       sfdr,
        "ongoing_charges":    round(frais / 100, 6),
        "ter":                round(frais / 100, 6),
        "performance_1y":     round(dvm, 2),
        "aum_eur":            capi,
        "distributor_france": True,
        "pea_eligible":       False,
        "data_source":        "seed-aspim-2024q4",
        "updated_at":         now_str,
    }
    if year:
        rec["inception_date"] = f"{year}-01-01"
    return rec


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool):
    print("=" * 60)
    print("  SCPI Seed Étendu — Top SCPIs françaises")
    print("=" * 60)
    print(f"  Mode       : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Confirmées : {len(SCPI_CONFIRMED)} (ISINs réels vérifiés)")
    print(f"  Nouvelles  : {len(SCPI_NEW)} (ISINs synthétiques SCPI_*)")
    print(f"  Total      : {len(ALL_SCPI)} SCPIs")
    print()

    started = datetime.now(timezone.utc)
    now_str = datetime.now(timezone.utc).isoformat()

    records = [build_fund_record(row, now_str) for row in ALL_SCPI]

    if not apply:
        print("  Aperçu (20 premiers) :")
        print(f"  {'ISIN':25} | {'Nom':32} | DVM   | AUM")
        print("  " + "-" * 90)
        for r in records[:20]:
            aum_str = f"{r['aum_eur']/1e6:.0f}M€" if r.get("aum_eur") else "N/A"
            tag = " [SYNTHÉTIQUE]" if r["isin"].startswith("SCPI_") else ""
            print(f"  {r['isin']:25} | {r['name'][:32]:32} | {r['performance_1y']:.2f}% | {aum_str}{tag}")
        print(f"\n  → {len(records)} SCPIs prêtes (--apply pour insérer)")
        return

    # Appliquer
    client = get_client()

    # Vérifier quelles ISINs existent déjà
    all_isins = [r["isin"] for r in records]
    existing_isins: set[str] = set()
    for i in range(0, len(all_isins), 500):
        batch_isins = all_isins[i:i + 500]
        resp = client.table("investissement_funds").select("isin").in_("isin", batch_isins).execute()
        for row in (resp.data or []):
            existing_isins.add(row["isin"])

    new_records = [r for r in records if r["isin"] not in existing_isins]
    upd_records = [r for r in records if r["isin"] in existing_isins]

    print(f"  Nouveaux : {len(new_records)} | Mises à jour : {len(upd_records)}")
    print()

    ok = fail = 0

    # Insérer les nouveaux
    if new_records:
        n_ok, n_fail = upsert_funds_bulk(new_records, batch_size=50)
        ok += n_ok
        fail += n_fail
        print(f"  ✓ {n_ok} SCPIs nouvelles insérées")

    # Mettre à jour les existantes
    update_fields = ["performance_1y", "aum_eur", "srri", "sri", "sfdr_article",
                     "ongoing_charges", "ter", "management_company", "updated_at",
                     "data_source", "asset_class", "currency", "pea_eligible",
                     "distributor_france", "inception_date"]
    if upd_records:
        n_ok2 = n_fail2 = 0
        for rec in upd_records:
            fields = {k: rec[k] for k in update_fields if k in rec and rec[k] is not None}
            try:
                client.table("investissement_funds").update(fields).eq("isin", rec["isin"]).execute()
                n_ok2 += 1
            except Exception as e:
                n_fail2 += 1
                print(f"  ✗ {rec['isin']}: {e}")
        ok += n_ok2
        fail += n_fail2
        print(f"  ✓ {n_ok2} SCPIs existantes mises à jour")

    print()
    print(f"  ✓ {ok} SCPIs traitées, {fail} erreurs")

    log_run("scpi-seed-extended", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed étendu SCPIs françaises")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = parser.parse_args()
    run(apply=args.apply)
