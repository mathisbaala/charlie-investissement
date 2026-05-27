#!/usr/bin/env python3
"""
fonds-euros-seed.py — Fonds en euros des assureurs français
=============================================================
Insère les fonds en euros (capital garanti) dans investissement_funds.
Ces produits sont le socle des contrats d'assurance vie en France.

Taux servis 2024 (annoncés début 2025) — source : Good Value for Money,
comparateurs d'AV (Linxea, Placement-Direct, etc.)

Ces produits n'ont pas d'ISIN officiel : on utilise des identifiants
synthétiques préfixés FE_ (Fonds Euros).

Caractéristiques communes :
  - Garantie du capital (net de frais de gestion)
  - SRRI = 1 (risque minimum)
  - SRI = 1
  - Frais de gestion annuels 0.60% à 1.0% (frais propres à chaque assureur)
  - SFDR Article 6 (pas d'engagement ESG sauf mention)
  - Performance = taux net de frais de gestion

Usage :
    python3 scripts/scrapers/fonds-euros-seed.py           # dry-run
    python3 scripts/scrapers/fonds-euros-seed.py --apply   # appliquer
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Données fonds en euros ────────────────────────────────────────────────────
# (isin_synth, nom, assureur, taux_2024_net_pct, frais_gestion_pct, article_sfdr, note)
# taux_2024_net = taux servi net de frais de gestion
# frais_gestion = frais annuels (0.6% → 0.006)

FONDS_EUROS = [
    # ── Grands groupes ─────────────────────────────────────────────────────────
    ("FE_GENERALI",    "Generali Fonds Euros (Euro Croissance)",    "Generali Vie",            3.85, 0.60, 6),
    ("FE_SWISSLIFE",   "SwissLife Fonds Euros",                     "SwissLife Assurance",      3.90, 0.75, 6),
    ("FE_SWISSLIFE_P", "SwissLife Fonds Euros Premium",             "SwissLife Assurance",      4.00, 0.60, 6),
    ("FE_SURAVENIR",   "Suravenir Opportunités 2",                  "Suravenir (Arkéa)",        3.50, 0.75, 6),
    ("FE_SURAVENIR_R", "Suravenir Rendement 2",                     "Suravenir (Arkéa)",        3.20, 0.70, 6),
    ("FE_SPIRICA",     "Spirica Fonds Euros",                       "Spirica (Crédit Agricole)",3.20, 0.85, 6),
    ("FE_ALLIANZ",     "Allianz Fonds Euros (Actif Garanti)",       "Allianz Vie",              3.10, 0.75, 6),
    ("FE_CARDIF",      "BNP Paribas Cardif Fonds Euros",            "Cardif (BNP Paribas)",     3.10, 0.80, 6),
    ("FE_GMF",         "GMF Vie Fonds Euros",                       "GMF Vie (MACSF)",          3.20, 0.65, 6),
    ("FE_SOGECAP",     "Sogecap Fonds Euros (Séquoia)",             "Sogecap (Société Générale)",2.90, 0.75, 6),
    ("FE_AXA",         "AXA Euro Evolution 2",                      "AXA France Vie",           2.50, 0.80, 6),
    ("FE_MAAF",        "MAAF Fonds Euros",                          "MAAF Vie",                 3.00, 0.70, 6),
    ("FE_AVIVA",       "Abeille Vie Fonds Euros",                   "Abeille Assurances (Aviva)",2.80, 0.75, 6),
    ("FE_PREDICA",     "Predica Fonds Euros (CA Vie)",              "Predica (Crédit Agricole)",3.10, 0.75, 6),
    ("FE_CNP",         "CNP Fonds Euros",                           "CNP Assurances",           2.80, 0.70, 6),
    ("FE_PACIFIC",     "Pacific Vie Fonds Euros",                   "Pacific Vie",              3.00, 0.75, 6),
    ("FE_LINXEA",      "Linxea Spirit 2 Fonds Euros",               "Spirica / Linxea",         3.20, 0.60, 6),
    # ── Mutuelles et IP ────────────────────────────────────────────────────────
    ("FE_MACSF",       "MACSF Fonds Euros",                         "MACSF (RCP)",              3.20, 0.60, 6),
    ("FE_AG2R",        "AG2R La Mondiale Fonds Euros",              "AG2R La Mondiale",         2.75, 0.80, 6),
    ("FE_MNEF",        "Harmonie Mutuelle Fonds Euros",             "Harmonie Mutuelle",        2.80, 0.70, 6),
    ("FE_MIF",         "MIF Fonds Euros",                           "MIF (Mutuelle IDF)",       3.40, 0.55, 6),
    ("FE_MACIF",       "Macif Fonds Euros (Agipi)",                 "Macif / Agipi",            2.90, 0.70, 6),
    ("FE_MGEN",        "MGEN Fonds Euros",                          "MGEN",                     2.75, 0.65, 6),
    ("FE_MMA",         "MMA Fonds Euros",                           "MMA Vie",                  2.70, 0.75, 6),
    ("FE_TUTELARE",    "Tutélaire Fonds Euros",                     "Tutélaire",                3.00, 0.65, 6),
    ("FE_APICIL",      "Apicil Fonds Euros",                        "Apicil",                   3.10, 0.70, 6),
    ("FE_FRANCE_MUT",  "France Mutualiste Fonds Euros",             "France Mutualiste",        3.30, 0.55, 6),
    # ── Plateformes web / courtiers ────────────────────────────────────────────
    ("FE_PLACEMENT_D", "Placement-direct Fonds Euros (Suravenir)",  "Suravenir / Placement-Direct",3.50, 0.60, 6),
    ("FE_BOURSO",      "Boursorama Vie Fonds Euros",                "Generali / Boursorama",    3.20, 0.75, 6),
    ("FE_FORTUNEO",    "Fortuneo Vie Fonds Euros",                  "Suravenir / Fortuneo",     3.20, 0.70, 6),
    ("FE_ASSURANCEVIE","AssuranceVie.com Fonds Euros (Suravenir)",  "Suravenir",                3.20, 0.70, 6),
    ("FE_YOMONI",      "Yomoni Vie Fonds Euros",                    "Suravenir / Yomoni",       2.80, 0.85, 6),
    ("FE_NALO",        "Nalo Fonds Euros",                          "Generali / Nalo",          3.00, 0.85, 6),
    ("FE_GOODVEST",    "Goodvest Fonds Euros",                      "SwissLife / Goodvest",     2.50, 1.00, 8),  # Art.8 ESG
    ("FE_RAMIFY",      "Ramify Fonds Euros",                        "Generali / Ramify",        3.10, 0.85, 6),
    # ── Réseaux bancaires ──────────────────────────────────────────────────────
    ("FE_PREDICA_GC",  "Prédica Fonds Euros Garanti Croissance",    "Predica (Crédit Agricole)",3.00, 0.80, 6),
    ("FE_LCL_VIE",     "LCL Vie Fonds Euros",                       "Predica / LCL",            2.70, 0.85, 6),
    ("FE_CARAC",       "CARAC Fonds Euros",                         "CARAC",                    3.50, 0.55, 6),
    ("FE_PALATINE",    "Palatine Vie Fonds Euros",                  "Banque Palatine",          2.80, 0.80, 6),
    ("FE_UAF_LIFE",    "UAF Life Patrimoine Fonds Euros",           "UAF Life (CA)",            2.90, 0.80, 6),
    # ── Assureurs spécialisés / niches ─────────────────────────────────────────
    ("FE_PRIMONIAL",   "Sécurité Pierre Euro (Primonial)",          "Primonial / Generali",     3.20, 0.80, 8),  # Immo + Art.8
    ("FE_CAPITAL_VIE", "Capital Vie Fonds Euros",                   "Capital Vie",              2.90, 0.75, 6),
    ("FE_VAUBAN",      "Vauban Fonds Euros",                        "Vauban Humanis",           3.00, 0.70, 6),
    ("FE_SMAVIE",      "SMAVIE BTP Fonds Euros",                    "SMAVIE BTP",               3.10, 0.60, 6),
    ("FE_MARCH_VIE",   "March Vie Fonds Euros",                     "March Vie",                3.20, 0.65, 6),
    ("FE_ACTIVA",      "Activa Fonds Euros",                        "Activa Mutuelle",          2.90, 0.70, 6),
    ("FE_NOVALIS",     "Novalis Taitbout Fonds Euros",              "Novalis Taitbout",         3.00, 0.65, 6),
    ("FE_GARANCE",     "Garance Fonds Euros",                       "Garance",                  3.80, 0.50, 6),  # Mutuelle transport
    ("FE_MNT",         "MNT Fonds Euros",                           "MNT (Fonctions Publiques)",3.10, 0.60, 6),
    ("FE_GAN",         "GAN Vie Fonds Euros (Nuance Privilège)",    "GAN Assurances",           2.80, 0.80, 6),
]


def build_fonds_euros_record(row: tuple, now_str: str) -> dict:
    isin, name, assureur, taux, frais, sfdr = row
    return {
        "isin":               isin,
        "name":               name,
        "product_type":       "fonds_euros",
        "asset_class":        "monetaire",  # capital garanti, proche monétaire
        "currency":           "EUR",
        "management_company": assureur,
        "srri":               1,
        "sri":                1,
        "sfdr_article":       sfdr,
        "ongoing_charges":    round(frais / 100, 6),
        "ter":                round(frais / 100, 6),
        "performance_1y":     round(taux, 2),
        "distributor_france": True,
        "pea_eligible":       False,
        "data_source":        "seed-gvfm-2024",
        "updated_at":         now_str,
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(apply: bool):
    print("=" * 60)
    print("  Fonds Euros Seed — Assureurs français")
    print("=" * 60)
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  {len(FONDS_EUROS)} fonds en euros à insérer/mettre à jour")
    print()

    started = datetime.now(timezone.utc)
    now_str = datetime.now(timezone.utc).isoformat()

    records = [build_fonds_euros_record(row, now_str) for row in FONDS_EUROS]

    if not apply:
        print(f"  {'ISIN':20} | {'Nom':42} | Taux | Frais")
        print("  " + "-" * 85)
        for r in records[:25]:
            print(f"  {r['isin']:20} | {r['name'][:42]:42} | {r['performance_1y']:.2f}% | {r['ongoing_charges']*100:.2f}%")
        if len(records) > 25:
            print(f"  ... et {len(records)-25} de plus")
        print(f"\n  → {len(records)} fonds en euros prêts (--apply pour insérer)")
        return

    client = get_client()

    # Vérifier quels ISINs existent
    all_isins = [r["isin"] for r in records]
    existing_isins: set[str] = set()
    resp = client.table("investissement_funds").select("isin").in_("isin", all_isins).execute()
    for row in (resp.data or []):
        existing_isins.add(row["isin"])

    new_records = [r for r in records if r["isin"] not in existing_isins]
    upd_records = [r for r in records if r["isin"] in existing_isins]

    print(f"  Nouveaux : {len(new_records)} | Mises à jour : {len(upd_records)}")
    print()

    ok = fail = 0

    # Insérer les nouveaux
    if new_records:
        try:
            client.table("investissement_funds").insert(new_records).execute()
            ok += len(new_records)
            print(f"  ✓ {len(new_records)} fonds en euros insérés")
        except Exception as e:
            # Fallback un par un
            for rec in new_records:
                try:
                    client.table("investissement_funds").insert(rec).execute()
                    ok += 1
                except Exception as e2:
                    fail += 1
                    print(f"  ✗ {rec['isin']}: {e2}")

    # Mettre à jour les existants
    update_fields = ["performance_1y", "ongoing_charges", "ter", "management_company",
                     "sfdr_article", "srri", "sri", "updated_at", "data_source"]
    if upd_records:
        for rec in upd_records:
            fields = {k: rec[k] for k in update_fields if k in rec}
            try:
                client.table("investissement_funds").update(fields).eq("isin", rec["isin"]).execute()
                ok += 1
            except Exception as e:
                fail += 1
                print(f"  ✗ {rec['isin']}: {e}")
        print(f"  ✓ {len(upd_records)} fonds en euros mis à jour")

    print()
    print(f"  ✓ {ok} fonds traités, {fail} erreurs")
    log_run("fonds-euros-seed", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed fonds en euros assureurs français")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = parser.parse_args()
    run(apply=args.apply)
