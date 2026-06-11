#!/usr/bin/env python3
"""
pea-eligibility-fix.py — Marque les produits PEA éligibles
===========================================================
Règles :
  1. Actions dont l'ISIN commence par un pays UE ou EEE → PEA = True
  2. ETF dont l'asset_class = "actions" ET domicile UE/EEE → PEA = True
     (filtre négatif sur les noms indicateurs de non-éligibilité)
  3. OPCVM FR* avec asset_class = "actions" non encore marqués → PEA = True

Pays UE/EEE éligibles PEA :
  UE 27 : FR DE IT ES NL BE AT PT FI IE LU SE DK PL CZ RO HU SK BG HR SI EE LV LT CY MT GR
  EEE   : NO IS LI (accord fiscal, inclus dans le PEA)

Non éligibles : GB CH US JP CA AU CN HK SG etc.

Usage :
    python3 scripts/scrapers/pea-eligibility-fix.py           # dry-run
    python3 scripts/scrapers/pea-eligibility-fix.py --apply
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

PEA_COUNTRY_PREFIXES = {
    # UE 27
    "FR","DE","IT","ES","NL","BE","AT","PT","FI","IE","LU","SE","DK",
    "PL","CZ","RO","HU","SK","BG","HR","SI","EE","LV","LT","CY","MT","GR",
    # EEE non-UE — inclus dans le PEA
    "NO","IS","LI",
}

# Mots-clés dans le nom/catégorie indiquant que l'ETF n'investit PAS dans les actions UE
ETF_NON_PEA_KEYWORDS = [
    "bond","obligation","credit","taux","fixed","treasury","gilt","bund",
    "us dollar","usd","emerging","chine","china","japan","japon","uk ",
    "united states","nasdaq","s&p 500","dow jones","hang seng","nikkei",
    "commodity","gold","silver","oil","bitcoin","crypto","reit",
    "short","inverse","leverage","leveraged","bear","2x","3x",
    "high yield","convertible","aggregate","corporate",
]

ETF_EU_PEA_KEYWORDS = [
    "europe","euro stoxx","eurostoxx","stoxx europe","cac 40","cac40",
    "dax","ftse mib","ibex","aex","bel 20","psi","omx","msci europe",
    "msci emu","euro zone","eurozone","euronext","france","german",
    "italian","spanish","dutch","belgian","nordic","scandinav",
]


def run(apply: bool):
    print("=" * 60)
    print("  PEA Eligibility Fix")
    print("=" * 60)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    updated = 0
    skipped = 0

    # ── 1. Actions EU/EEE ──────────────────────────────────────────────────────
    print("  Actions EU/EEE...")
    offset = 0
    batch_update = []
    while True:
        rows = (
            client.table("investissement_funds")
            .select("isin, pea_eligible")
            .eq("product_type", "action")
            .range(offset, offset + 999)
            .execute().data or []
        )
        for r in rows:
            isin = r["isin"]
            if isin[:2] in PEA_COUNTRY_PREFIXES and not r.get("pea_eligible"):
                batch_update.append(isin)
        if len(rows) < 1000:
            break
        offset += 1000

    print(f"  → {len(batch_update)} actions à marquer PEA")
    if apply and batch_update:
        for i in range(0, len(batch_update), 100):
            chunk = batch_update[i:i+100]
            client.table("investissement_funds").update({"pea_eligible": True}).in_("isin", chunk).execute()
        updated += len(batch_update)
        print(f"  ✓ {len(batch_update)} actions mises à jour")

    # ── 2. ETF EU avec asset_class = actions ──────────────────────────────────
    print("\n  ETF actions EU...")
    etf_update = []
    offset = 0
    while True:
        rows = (
            client.table("investissement_funds")
            .select("isin, name, pea_eligible, asset_class")
            .eq("product_type", "etf")
            .eq("asset_class", "actions")
            .range(offset, offset + 999)
            .execute().data or []
        )
        for r in rows:
            isin = r["isin"]
            if r.get("pea_eligible"):
                continue
            name_lower = (r.get("name") or "").lower()
            prefix = isin[:2]
            # Domicile UE/EEE (nécessaire mais NON suffisant : IE/LU sont des hubs
            # UCITS, le domicile ne dit rien des sous-jacents).
            if prefix not in PEA_COUNTRY_PREFIXES:
                continue
            # ETF synthétique labellisé PEA (réplication swap d'indices hors-UE,
            # ex. Amundi PEA S&P 500) ou « european » → toujours éligible.
            if "pea" in name_lower:
                etf_update.append(isin)
                continue
            # Sinon : exiger un signal POSITIF d'univers UE et aucun signal hors-UE.
            # Le domicile seul ne suffit pas (sinon MSCI Korea/Brazil/World… domiciliés
            # IE/LU passent à tort — cf. migration 20260611140000).
            if any(kw in name_lower for kw in ETF_NON_PEA_KEYWORDS):
                continue
            if not any(kw in name_lower for kw in ETF_EU_PEA_KEYWORDS):
                continue
            etf_update.append(isin)
        if len(rows) < 1000:
            break
        offset += 1000

    print(f"  → {len(etf_update)} ETF à marquer PEA")
    if apply and etf_update:
        for i in range(0, len(etf_update), 100):
            chunk = etf_update[i:i+100]
            client.table("investissement_funds").update({"pea_eligible": True}).in_("isin", chunk).execute()
        updated += len(etf_update)
        print(f"  ✓ {len(etf_update)} ETF mis à jour")

    # ── 3. OPCVM FR actions avec signal Europe explicite ─────────────────────
    # On est conservateur : seuls les OPCVM dont le nom indique clairement
    # un univers EU/France sont marqués PEA. Les fonds monde (World/Global/
    # US/Nasdaq etc.) restent non marqués même avec FR ISIN.
    OPCVM_PEA_KEYWORDS = [
        "europe","europ","euro stoxx","eurostoxx","stoxx","msci europe",
        "msci emu","eurozone","euro zone","france","paris","cac 40","cac40",
        "dax","ibex","ftse mib","bel 20","aex","omx",
        "actions françaises","actions europeennes","actions européennes",
        "actions zone euro","valeurs françaises","valeurs europeenn",
        "grandes capitalisations france","grandes cap france","pmv","small cap fr",
        "mid cap france","mid cap euro","small cap euro",
    ]
    OPCVM_NON_PEA_KEYWORDS = [
        "world","global","international","us ","nasdaq","s&p","dow jones",
        "china","japon","japan","asie","asia","emergent","emerging",
        "amérique","amerique","america","british","uk ","united kingdom",
        "australi","canada","suisse","switzerland",
    ]

    print("\n  OPCVM FR actions — signal Europe explicite...")
    opcvm_update = []
    offset = 0
    while True:
        rows = (
            client.table("investissement_funds")
            .select("isin, name, pea_eligible")
            .eq("product_type", "opcvm")
            .eq("asset_class", "actions")
            .range(offset, offset + 999)
            .execute().data or []
        )
        for r in rows:
            if r.get("pea_eligible"):
                continue
            if not r["isin"].startswith("FR"):
                continue
            name_lower = (r.get("name") or "").lower()
            if any(kw in name_lower for kw in OPCVM_NON_PEA_KEYWORDS):
                continue
            if any(kw in name_lower for kw in OPCVM_PEA_KEYWORDS):
                opcvm_update.append(r["isin"])
        if len(rows) < 1000:
            break
        offset += 1000

    print(f"  → {len(opcvm_update)} OPCVM actions Europe à marquer PEA")
    if apply and opcvm_update:
        for i in range(0, len(opcvm_update), 100):
            chunk = opcvm_update[i:i+100]
            client.table("investissement_funds").update({"pea_eligible": True}).in_("isin", chunk).execute()
        updated += len(opcvm_update)
        print(f"  ✓ {len(opcvm_update)} OPCVM mis à jour")

    print()
    print(f"  Total : {updated} produits marqués PEA éligibles")
    if apply:
        log_run("pea-eligibility-fix", "success", updated, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Marque les produits PEA éligibles")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    args = parser.parse_args()
    run(apply=args.apply)
