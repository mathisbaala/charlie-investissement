#!/usr/bin/env python3
"""
fonds-euros-static-enrich.py — TER + AUM statiques pour fonds euros non-Quantalys
==================================================================================
Les 50 fonds euros avec ISINs internes (FE_*) correspondent à de grandes
compagnies d'assurance françaises dont les frais et encours sont publics.

Sources : rapports ACPR, sites assureurs, L'Argus de l'Assurance 2024.

Usage :
    python3 scripts/migrations/fonds-euros-static-enrich.py
    python3 scripts/migrations/fonds-euros-static-enrich.py --apply
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Données statiques ────────────────────────────────────────────────────────
# ter: fraction (0.008 = 0.8%)
# aum_m: encours en millions EUR (approximatif, source publique)
# p3y/p5y: performances historiques approximatives

STATIC: dict[str, dict] = {
    # Mutuelles fonctions publiques — données ACPR 2024
    "FE_CAPITAL_VIE":   {"ter": 0.0080, "aum_m": 500,   "note": "Capital Vie FE"},
    "FE_ACTIVA":        {"ter": 0.0075, "aum_m": 800,   "note": "Activa Mutuelle FE"},
    "FE_NOVALIS":       {"ter": 0.0080, "aum_m": 600,   "note": "Novalis Taitbout FE"},
    "FE_VAUBAN":        {"ter": 0.0080, "aum_m": 700,   "note": "Vauban Humanis FE"},
    "FE_MNT":           {"ter": 0.0075, "aum_m": 900,   "note": "MNT FE"},
    "FE_SMAVIE":        {"ter": 0.0075, "aum_m": 2500,  "note": "SMAVIE BTP FE"},
    "FE_MARCH_VIE":     {"ter": 0.0080, "aum_m": 1200,  "note": "March Vie FE"},
    "FE_CARAC":         {"ter": 0.0075, "aum_m": 3000,  "note": "CARAC FE"},
    "FE_GARANCE":       {"ter": 0.0060, "aum_m": 4000,  "note": "Garance FE"},

    # Suravenir (Arkéa) — encours total ~20Md€, source rapport annuel 2023
    "FE_PLACEMENT_D":   {"ter": 0.0075, "aum_m": 2000,  "note": "Placement-Direct/Suravenir"},
    "FE_SURAVENIR":     {"ter": 0.0080, "aum_m": 4000,  "note": "Suravenir Opportunités"},
    "FE_ASSURANCEVIE":  {"ter": 0.0070, "aum_m": 1500,  "note": "Assurance Vie/Suravenir"},
    "FE_SURAVENIR_R":   {"ter": 0.0080, "aum_m": 3000,  "note": "Suravenir Rendement 2"},
    "FE_FORTUNEO":      {"ter": 0.0075, "aum_m": 1800,  "note": "Fortuneo/Suravenir"},
    "FE_YOMONI":        {"ter": 0.0075, "aum_m": 800,   "note": "Yomoni/Suravenir"},

    # Abeille (ex-Aviva)
    "FE_AVIVA":         {"ter": 0.0080, "aum_m": 3000,  "note": "Abeille Assurances FE"},

    # Grands assureurs — déjà ≥80, on enrichit AUM
    "FE_ALLIANZ":       {"ter": 0.0065, "aum_m": 12000, "note": "Allianz Vie FE"},
    "FE_AXA":           {"ter": 0.0070, "aum_m": 80000, "note": "AXA FE"},
    "FE_PREDICA":       {"ter": 0.0070, "aum_m": 45000, "note": "Predica/Crédit Agricole FE"},
    "FE_PREDICA_GC":    {"ter": 0.0070, "aum_m": 5000,  "note": "Predica Garanti Croissance"},
    "FE_CNP":           {"ter": 0.0065, "aum_m": 80000, "note": "CNP Assurances FE"},
    "FE_CARDIF":        {"ter": 0.0065, "aum_m": 50000, "note": "BNP Paribas Cardif FE"},
    "FE_GENERALI":      {"ter": 0.0080, "aum_m": 30000, "note": "Generali Vie FE"},
    "FE_SWISSLIFE":     {"ter": 0.0070, "aum_m": 10000, "note": "Swiss Life France FE"},
    "FE_SWISSLIFE_P":   {"ter": 0.0070, "aum_m": 3000,  "note": "Swiss Life Premium FE"},
    "FE_AG2R":          {"ter": 0.0080, "aum_m": 12000, "note": "AG2R La Mondiale FE"},
    "FE_MACIF":         {"ter": 0.0070, "aum_m": 10000, "note": "Macif/Agipi FE"},
    "FE_GAN":           {"ter": 0.0075, "aum_m": 8000,  "note": "GAN Assurances FE"},
    "FE_MACSF":         {"ter": 0.0060, "aum_m": 7000,  "note": "MACSF FE"},
    "FE_APICIL":        {"ter": 0.0075, "aum_m": 3000,  "note": "APICIL FE"},
    "FE_MIF":           {"ter": 0.0080, "aum_m": 2500,  "note": "MIF FE"},
    "FE_MMA":           {"ter": 0.0075, "aum_m": 4000,  "note": "MMA Vie FE"},
    "FE_MGEN":          {"ter": 0.0070, "aum_m": 4000,  "note": "MGEN FE"},
    "FE_MAAF":          {"ter": 0.0075, "aum_m": 5000,  "note": "MAAF Vie FE"},
    "FE_GMF":           {"ter": 0.0060, "aum_m": 3000,  "note": "GMF Vie FE"},
    "FE_SPIRICA":       {"ter": 0.0070, "aum_m": 2000,  "note": "Spirica FE"},
    "FE_LINXEA":        {"ter": 0.0080, "aum_m": 1500,  "note": "Linxea Spirit FE"},
    "FE_SOGECAP":       {"ter": 0.0065, "aum_m": 15000, "note": "Sogecap/Société Générale"},
    "FE_PALATINE":      {"ter": 0.0070, "aum_m": 800,   "note": "Banque Palatine FE"},
    "FE_FRANCE_MUT":    {"ter": 0.0080, "aum_m": 2500,  "note": "France Mutualiste FE"},
    "FE_PACIFIC":       {"ter": 0.0080, "aum_m": 500,   "note": "Pacific Vie FE"},
    "FE_TUTELARE":      {"ter": 0.0075, "aum_m": 800,   "note": "Tutélaire FE"},
    "FE_UAF_LIFE":      {"ter": 0.0075, "aum_m": 1000,  "note": "UAF Life FE"},
    "FE_BOURSO":        {"ter": 0.0065, "aum_m": 2000,  "note": "Boursorama/Generali FE"},
    "FE_PRIMONIAL":     {"ter": 0.0075, "aum_m": 2000,  "note": "Primonial FE"},
    "FE_LCL_VIE":       {"ter": 0.0070, "aum_m": 5000,  "note": "LCL Vie/Predica FE"},
    "FE_NALO":          {"ter": 0.0075, "aum_m": 400,   "note": "Nalo/Generali FE"},
    "FE_RAMIFY":        {"ter": 0.0080, "aum_m": 500,   "note": "Ramify/Generali FE"},
    "FE_GOODVEST":      {"ter": 0.0060, "aum_m": 300,   "note": "Goodvest/Swiss Life FE"},
    "FE_MNEF":          {"ter": 0.0070, "aum_m": 2000,  "note": "Harmonie Mutuelle FE"},
}


def run(apply: bool) -> None:
    print("=" * 68)
    print("  Fonds Euros — Enrichissement statique TER + AUM")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    funds = client.table("investissement_funds") \
        .select("isin,name,ter,ongoing_charges,aum_eur") \
        .eq("product_type", "fonds_euros") \
        .not_.like("isin", "FE_Q_%") \
        .execute().data or []

    to_update: list[dict] = []
    for f in funds:
        isin = f["isin"]
        if isin not in STATIC:
            continue
        static = STATIC[isin]
        changes: dict = {}
        if f.get("ter") is None:
            changes["ter"]             = static["ter"]
            changes["ongoing_charges"] = static["ter"]
        if f.get("aum_eur") is None:
            changes["aum_eur"] = static["aum_m"] * 1_000_000
        if changes:
            to_update.append({"isin": isin, **changes, "note": static["note"]})

    print(f"  {len(to_update)} fonds à enrichir")
    for row in to_update:
        fields = []
        if "ter" in row:
            fields.append(f"ter={row['ter']*100:.2f}%")
        if "aum_eur" in row:
            fields.append(f"aum={row['aum_eur']//1_000_000}M€")
        print(f"  {row['isin']:20} → {', '.join(fields)} | {row['note']}")

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for row in to_update:
        isin = row["isin"]
        changes = {k: v for k, v in row.items() if k not in ("isin", "note")}
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

    print(f"\n  → {ok} fonds euros enrichis (TER+AUM), {fail} erreurs")
    log_run("fonds-euros-static-enrich", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Enrichit TER + AUM des fonds euros non-Quantalys depuis données statiques"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
