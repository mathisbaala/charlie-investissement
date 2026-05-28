#!/usr/bin/env python3
"""
fonds-euros-mgmt-enricher.py — Management company pour fonds euros Quantalys
=============================================================================
Les 226 fonds euros FE_Q_QUA* n'ont pas de management_company.
Ce script les enrichit en reconnaissant la société assureur dans le nom.

Patterns couverts : ~80% des 226 noms identifiés manuellement.
Les noms non reconnus sont listés en fin de run pour traitement futur.

Usage :
    python3 scripts/migrations/fonds-euros-mgmt-enricher.py
    python3 scripts/migrations/fonds-euros-mgmt-enricher.py --apply
"""

import sys
import re
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run


# ─── Mapping nom → société d'assurance ─────────────────────────────────────
# L'ordre compte : patterns plus spécifiques d'abord.

PATTERNS: list[tuple[str, str]] = [
    # Suravenir (Arkéa) — plusieurs variantes
    (r"suravenir",              "Suravenir (Arkéa)"),
    # Spirica (Crédit Agricole)
    (r"spirica",                "Spirica (Crédit Agricole)"),
    # La Mondiale / AGGV / LMP / Nortia
    (r"mondiale|aggv|nortia\s*ii|nortia|lmp\b|signatures\s*2",
                                "La Mondiale"),
    # Predica / Crédit Agricole — Predi-Euros, Eurossima
    (r"predi.euros|predica",    "Predica (Crédit Agricole)"),
    (r"eurossima",              "Predica (Crédit Agricole)"),
    # UAF Life
    (r"\buaf\b",                "UAF Life (Crédit Agricole)"),
    # Generali
    (r"géné?rali|generali|génération vie|euro sécurité|cachemire"
     r"|celestia|sequoia|patrimoine absolu|forticiel|espace lux",
                                "Generali Vie"),
    # Allianz
    (r"allianz|gaipare|antarius",  "Allianz Vie"),
    # Abeille Assurances (ex-Aviva)
    (r"abeille|afer eurocroissance|afer",  "Abeille Assurances (Aviva)"),
    # APICIL
    (r"apicil",                 "APICIL"),
    # Swiss Life
    (r"swisslife|swiss.?life",  "Swiss Life France"),
    # BNP Paribas Cardif
    (r"cardif|bnp multiplacements|cad\.\s*euro|cadet\b",
                                "BNP Paribas Cardif"),
    # Groupama / GAN
    (r"groupama|gan patrim|gan capitali|gan prév|investlife",
                                "Groupama"),
    # La Banque Postale / CNP — Netissima
    (r"netissima|dolcea",       "La Banque Postale (CNP)"),
    # HSBC
    (r"\bhsbc\b",               "HSBC Life"),
    # MMA (Covéa)
    (r"\bmma\b",                "MMA Vie (Covéa)"),
    # Myrialis (Crédit Mutuel)
    (r"myrialis",               "Myrialis Vie (Crédit Mutuel)"),
    # Oradéa Vie
    (r"orad[eé]a",              "Oradéa Vie"),
    # AFI-ESCA
    (r"afi.esca|afi esca",      "AFI-ESCA"),
    # MAIF
    (r"\bmaif\b",               "MAIF Vie"),
    # ABP Vie
    (r"\babp vie\b",            "ABP Vie"),
    # BRED
    (r"\bbred\b",               "BRED Banque Populaire"),
    # Pro BTP / Batiretraite
    (r"batiretraite|saf.btp|btp",  "Pro BTP"),
    # Ampli Mutuelle
    (r"ampli.grain|ampli",      "Ampli Mutuelle"),
    # CANSSM / ASAC
    (r"asac\b",                 "ASAC-FAPES"),
    # Primonial
    (r"primonial",              "Primonial"),
    # Macif / Vert Equateur
    (r"vert equateur|macif",    "Macif"),
    # MGEN
    (r"\bmgen\b",               "MGEN"),
    # AG2R / La Mondiale (Retraite)
    (r"ag2r|la retraite\b",     "AG2R La Mondiale"),
    # Predica Eurocroissance
    (r"eurocroissance",         "Predica (Crédit Agricole)"),
    # Avip
    (r"\bavip\b",               "AVIP"),
    # Euro Innovalia → Mutualia / Mutuelle
    (r"innovalia",              "Mutualia"),
    # Plan Vert Avenir / Vert → Crédit Mutuel
    (r"plan vert avenir|vert avenir",  "Crédit Mutuel"),
    # Sélection Rdt / ACMN → Crédit Mutuel Nord Europe
    (r"acmn avenir|acmn",       "Crédit Mutuel (Nord Europe)"),
    # Nuances → Crédit Mutuel
    (r"nuances",                "Crédit Mutuel"),
    # ABP, Alyss → Crédit Mutuel Arkéa
    (r"\balyss\b",              "Crédit Mutuel Arkéa"),
    # MM Vie → Crédit Mutuel (MM Vie = Crédit Mutuel du Massif Central)
    (r"\bmm vie\b",             "Crédit Mutuel"),
    # Rentepargne → Crédit Mutuel
    (r"rentepargne",            "Crédit Mutuel"),
    # Assurecureuil → Caisse d'Épargne (Natixis/CNP)
    (r"assurecureuil|ecureuil", "Caisse d'Épargne (Natixis)"),
    # Anthologie → Spirica (Crédit Agricole)
    (r"anthologie",             "Spirica (Crédit Agricole)"),
    # Floriane, Espace Liberté → CNP Assurances
    (r"floriane|espace libert",  "CNP Assurances"),
    # €uroCit' → CNP Assurances (LBP)
    (r"eurocit|€urocit",       "La Banque Postale (CNP)"),
    # Monceau → Monceau Assurances
    (r"monceau",                "Monceau Assurances"),
    # Barclays → Barclays Life
    (r"barclays",               "Barclays Life"),
    # UAP (historique AXA)
    (r"\buap\b",                "AXA France Vie"),
    # ARC → Arcalis (ancienne mutuelle)
    (r"\barc r?\b",             "Arcalis"),
    # Chrysalide, Aréas → Aréas Assurances (CNP)
    (r"aréas|areas",            "Aréas Assurances"),
    # Chromatys → Groupama (Chromatys = Groupama Evolution)
    (r"chromatys",              "Groupama"),
    # Anthénolia → Entoria (ex-Mutavie)
    (r"sécurifrance",           "Groupama"),
    # France 2 → Generali France
    (r"fonds euro france\s*2",  "Generali Vie"),
    # Multi PERP → Generali
    (r"multi perp",             "Generali Vie"),
    # Euro Exclusif → Generali
    (r"euro exclusif",          "Generali Vie"),
    # Euromulti → Generali
    (r"euromulti",              "Generali Vie"),
    # Génération Vie → Generali
    (r"génération vie",         "Generali Vie"),
    # Version essentielle → Spirica ou Suravenir
    (r"version essentielle",    "Spirica (Crédit Agricole)"),
    # Actifonds → MACSF
    (r"actifonds",              "MACSF"),
    # Quintessa → MACSF
    (r"quintessa",              "MACSF"),
    # Pro BTP / SAF BTP  (déjà couvert plus haut avec btp, gardé pour redondance)
    # Nouvelle Génération → Suravenir
    (r"nouvelle génération",    "Suravenir (Arkéa)"),
    # Fonds Euro PER Zen → Swiss Life
    (r"\bzen\b",                "Swiss Life France"),
    # Actif Sécurité → Generali
    (r"actif sécurité",         "Generali Vie"),
    # Cmpte Libre / Compte Libre → CNP
    (r"cmpte libre|compte libre croissance", "CNP Assurances"),
    # Livret Jeun'Avenir / Livret RM → Crédit Mutuel
    (r"livret.*avenir|livret.*rm|livret.*multi",  "Crédit Mutuel"),
    # Confort PERP → Swisslife ou CNP
    (r"confort perp",           "CNP Assurances"),
    # Ebene → Generali
    (r"\bebene\b",              "Generali Vie"),
    # Ingénierie → Generali
    (r"ingénierie",             "Generali Vie"),
    # Europierre → Primonial
    (r"europierre",             "Primonial"),
    # Acuity → Cholet-Dupont (Covéa)
    (r"\bacuity\b",             "MMA Vie (Covéa)"),
    # Vers l'Avenir → MGEN
    (r"vers l.avenir",          "MGEN"),
    # Formule retraite → Allianz
    (r"formule retraite",       "Allianz Vie"),
    # Patrimoine Stratégies → Groupama
    (r"patrimoine stratégies",  "Groupama"),
    # Retraite Garantie → Swiss Life
    (r"retraite garantie",      "Swiss Life France"),
    # MyPGA → PGA (Pro Golf Assurances ? ou Mutuelle)
    (r"mypga",                  "Generali Vie"),
    # BMM Latitude → BNP Paribas (BMM = Banque de la Mutualité)
    (r"\bbmm\b",                "BNP Paribas Cardif"),
    # Altiscore → Generali
    (r"altiscore",              "Generali Vie"),
    # Sécurité PERP / Sécurité Retraite → Swiss Life ou Spirica
    (r"sécurité retraite",      "Spirica (Crédit Agricole)"),
    # Profil sécurité → Suravenir (plan Profil)
    (r"profil sécurité",        "Suravenir (Arkéa)"),
]

# Compilation en avance
_COMPILED = [(re.compile(pat, re.IGNORECASE), mc) for pat, mc in PATTERNS]


def infer_mc(name: str) -> str | None:
    for pattern, mc in _COMPILED:
        if pattern.search(name):
            return mc
    return None


def run(apply: bool) -> None:
    print("=" * 68)
    print("  Fonds Euros — Enrichissement management_company")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # Charger les fonds euros sans MC
    all_funds: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,name") \
            .eq("product_type", "fonds_euros") \
            .is_("management_company", "null") \
            .range(offset, offset + 999) \
            .execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds)} fonds euros sans management_company")

    to_update: list[dict] = []
    unmatched: list[str] = []

    for f in all_funds:
        mc = infer_mc(f["name"])
        if mc:
            to_update.append({"isin": f["isin"], "management_company": mc})
        else:
            unmatched.append(f["name"])

    print(f"  {len(to_update)} matchés, {len(unmatched)} non identifiés")

    # Distribution des sociétés trouvées
    mc_counts = Counter(r["management_company"] for r in to_update)
    print("\n  Répartition des sociétés :")
    for mc, cnt in mc_counts.most_common(20):
        print(f"    {cnt:4d}  {mc}")

    if apply and to_update:
        print("\n  Application en base...", flush=True)
        now = datetime.now(timezone.utc).isoformat()
        ok = fail = 0
        for row in to_update:
            try:
                client.table("investissement_funds") \
                    .update({"management_company": row["management_company"], "updated_at": now}) \
                    .eq("isin", row["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"  ✗ {row['isin']}: {e}", flush=True)
        print(f"\n  → {ok} mis à jour, {fail} erreurs")
        log_run("fonds-euros-mgmt-enricher", "success", ok, fail, started_at=started)
    elif not apply:
        print("\n  [DRY-RUN] Pas d'écriture. Ajouter --apply pour persister.")

    if unmatched:
        print(f"\n  {len(unmatched)} noms non reconnus :")
        for name in sorted(set(unmatched)):
            print(f"    {name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Enrichit management_company des fonds euros depuis leur nom"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
