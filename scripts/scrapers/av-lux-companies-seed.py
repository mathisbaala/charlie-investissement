#!/usr/bin/env python3
"""
av-lux-companies-seed.py — Seed des compagnies d'assurance-vie luxembourgeoises
================================================================================
L'assurance-vie luxembourgeoise est un must-have CGP français : neutralité fiscale,
triangle de sécurité, FID/FIC pour clients HNW, accès gestion sous mandat.

Seed des compagnies principales (régulées par le CAA - Commissariat aux Assurances).
Source : sites publics, registre CAA, listes courtiers (Vitis, Olifan, Privalux).

Marque ensuite les fonds LU UCITS comme `av_lux_eligible = True` (heuristique :
tout UCITS LU avec AUM > 5M€ et inception < today-1 an est typiquement éligible
au catalogue UC des compagnies AV Lux).

Usage :
    python3 scripts/scrapers/av-lux-companies-seed.py [--apply]
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Compagnies d'assurance-vie luxembourgeoises (Top 20 utilisées par CGP FR) ─

AV_LUX_COMPANIES = [
    # (short_code, name, group, website, notes)
    ("LOMBARD_INTL",     "Lombard International Assurance",       "Lombard Intl Group",       "https://www.lombardinternational.com",         "Leader HNW, FID/FIC, ticket élevé"),
    ("ONELIFE",          "OneLife",                                "APICIL",                    "https://www.onelife.eu.com",                    "Filiale APICIL (FR), FID/FIC"),
    ("SOGELIFE",         "Sogelife (Société Générale Insurance)",  "Société Générale Insurance","https://www.sogelife.com",                      "Filiale Société Générale, AV Lux"),
    ("WEALINS",          "Wealins (ex-Foyer International)",       "Foyer Group",               "https://www.wealins.com",                       "Spécialiste HNW, FID"),
    ("GENERALI_LUX",     "Generali Luxembourg",                    "Generali",                  "https://www.generali.lu",                       "Filiale Generali, multi-produits"),
    ("BALOISE_LUX",      "Baloise Vie Luxembourg",                 "Baloise Group",             "https://www.baloise.lu",                        "Filiale Baloise (CH)"),
    ("VITIS_LIFE",       "Vitis Life (groupe BIL)",                "Banque Internationale Lux", "https://www.vitislife.com",                     "Filiale BIL"),
    ("CALI_EUROPE",      "Cardif Lux Vie (CALI Europe)",           "BNP Paribas Cardif",        "https://www.cardifluxvie.com",                  "Filiale BNP Paribas Cardif"),
    ("BCEE_VIE",         "Lalux Vie (Le Foyer)",                   "Le Foyer",                  "https://www.lalux.lu",                          "Compagnie historique, retail+HNW"),
    ("AXA_LUX",          "AXA Wealth Europe",                      "AXA",                       "https://wealtheurope.axa.com",                  "Filiale AXA, AV Lux"),
    ("ALLIANZ_LIFE_LUX", "Allianz Life Luxembourg",                "Allianz",                   "https://www.allianz.lu",                        "Filiale Allianz, multi-produits"),
    ("NATIO_VIE",        "Natio Vie Luxembourg",                   "BPCE Vie",                  "",                                              "Filiale BPCE"),
    ("UTMOST_WEALTH",    "Utmost Wealth Solutions",                "Utmost Group",              "https://www.utmostwealthsolutions.com",         "ex-Generali Worldwide"),
    ("CNP_LUX",          "CNP Luxembourg",                         "CNP Assurances",            "https://www.cnp.lu",                            "Filiale CNP"),
    ("SEB_LIFE",         "SEB Life International",                 "SEB",                       "https://www.seb.lu",                            "Spécialiste cross-border HNW"),
    ("SWISSLIFE_LUX",    "Swiss Life Luxembourg",                  "Swiss Life",                "https://www.swisslife.lu",                      "Filiale Swiss Life"),
    ("ZURICH_EUROVITA",  "Zurich Eurolife",                        "Zurich Insurance",          "https://www.zurich.lu",                         "Filiale Zurich"),
    ("AVIVA_LUX",        "Aviva Vie Luxembourg",                   "Aviva (Aéma)",              "https://www.aviva.lu",                          "ex-AVIVA"),
    ("PRIVATEINSU",      "Private Insurer (groupe Vault)",         "Vault",                     "https://www.private-insurer.com",               "Spécialiste FID"),
    ("HSBC_LIFE",        "HSBC Life Assurance Luxembourg",         "HSBC",                      "https://www.hsbc.lu",                           "Filiale HSBC"),
]


def seed_companies(apply: bool):
    client = get_client()
    rows = [
        {
            "short_code":   short_code,
            "name":         name,
            "group_company": group,
            "website":      website,
            "notes":        notes,
        }
        for short_code, name, group, website, notes in AV_LUX_COMPANIES
    ]

    print(f"  {len(rows)} compagnies AV Lux à seeder")
    for r in rows[:5]:
        print(f"    - {r['short_code']:18} | {r['name']}")
    print(f"    ... ({len(rows)-5} de plus)")

    if not apply:
        print("\n  DRY-RUN — pas d'écriture")
        return 0, 0

    ok = fail = 0
    for r in rows:
        try:
            client.table("investissement_av_lux_companies") \
                .upsert(r, on_conflict="short_code") \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            print(f"    ✗ {r['short_code']} : {e}")
    return ok, fail


def flag_eligible_funds(apply: bool):
    """
    Heuristique éligibilité AV Lux :
      - ISIN LU* OU IE* (UCITS Irlande aussi commercialisés en Lux)
      - product_type in (etf, opcvm, sicav)
      - currency in (EUR, USD, GBP, CHF) — devises supportées par les contrats AV Lux
      - aum_eur >= 5_000_000 OU NULL (on garde les nouveaux fonds)
    Critères conservateurs : on flag potentiellement éligible, pas garanti.
    """
    client = get_client()

    # Paginer les fonds candidats
    candidates = []
    for prefix in ("LU", "IE"):
        offset = 0
        while True:
            r = client.table("investissement_funds") \
                .select("isin, product_type, currency, aum_eur") \
                .like("isin", f"{prefix}%") \
                .in_("product_type", ["etf", "opcvm", "sicav"]) \
                .range(offset, offset + 999) \
                .execute()
            if not r.data:
                break
            candidates += r.data
            if len(r.data) < 1000:
                break
            offset += 1000

    print(f"\n  Candidats fonds LU/IE UCITS : {len(candidates)}")

    eligible = [
        f for f in candidates
        if f.get("currency") in (None, "EUR", "USD", "GBP", "CHF")
        and (f.get("aum_eur") is None or f.get("aum_eur") >= 5_000_000)
    ]
    print(f"  Eligibles AV Lux (heuristique) : {len(eligible)}")

    if not apply:
        print("  DRY-RUN — pas d'écriture")
        return len(eligible), 0

    # Update par batch de 100
    ok = fail = 0
    batch = 100
    for i in range(0, len(eligible), batch):
        chunk = eligible[i: i + batch]
        for f in chunk:
            try:
                client.table("investissement_funds") \
                    .update({"av_lux_eligible": True}) \
                    .eq("isin", f["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"    ✗ {f['isin']} : {e}")
        if (i + batch) % 500 == 0 or i + batch >= len(eligible):
            print(f"    [{min(i+batch, len(eligible))}/{len(eligible)}] {ok} OK, {fail} fail")
    return ok, fail


def run(apply: bool):
    print("=" * 68)
    print("  AV Lux Companies Seed + Eligibility Flag")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)

    print("  [1/2] Seed compagnies AV Lux...")
    comp_ok, comp_fail = seed_companies(apply)

    print("\n  [2/2] Flag fonds LU/IE éligibles...")
    fund_ok, fund_fail = flag_eligible_funds(apply)

    print()
    print(f"  ✓ Compagnies : {comp_ok} OK, {comp_fail} fail")
    print(f"  ✓ Fonds flagués : {fund_ok} OK, {fund_fail} fail")

    if apply:
        log_run(
            scraper="av-lux-companies-seed",
            status="success" if (comp_fail + fund_fail) == 0 else "partial",
            records_processed=comp_ok + fund_ok,
            records_failed=comp_fail + fund_fail,
            started_at=started,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed AV Lux companies + flag eligible funds")
    parser.add_argument("--apply", action="store_true", help="Écrire en base (sinon DRY-RUN)")
    args = parser.parse_args()
    run(apply=args.apply)
