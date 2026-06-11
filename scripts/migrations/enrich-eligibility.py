#!/usr/bin/env python3
"""
enrich-eligibility.py — Peuplement des colonnes éligibilités enveloppes
=========================================================================
Colonnes cibles (ajoutées par migration 20260529000003) :
  av_fr_eligible   — Assurance-Vie France
  pea_pme_eligible — PEA-PME
  cto_eligible     — Compte-Titres Ordinaire

La migration SQL effectue déjà un peuplement initial par règles simples.
Ce script :
  1. Applique des règles métier supplémentaires (ex : fonds PEA-PME via nom)
  2. Permet de rejouer l'enrichissement après un ajout de fonds
  3. Recalcule data_completeness si --recalc

Usage :
    python3 scripts/migrations/enrich-eligibility.py
    python3 scripts/migrations/enrich-eligibility.py --apply
    python3 scripts/migrations/enrich-eligibility.py --apply --recalc
"""

import sys
import argparse
import re
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH_SIZE = 500

# ─── Règles éligibilité ───────────────────────────────────────────────────────

CTO_ELIGIBLE_TYPES = frozenset({
    "opcvm", "etf", "fcp", "sicav", "action", "obligation",
    "fps", "fpci", "fcpr", "opci", "scpi", "crypto",
})
CTO_NOT_ELIGIBLE_TYPES = frozenset({"fonds_euros", "livret"})

AV_FR_ELIGIBLE_TYPES  = frozenset({"opcvm", "etf", "fcp", "sicav", "fonds_euros"})
AV_FR_ELIGIBLE_ISINS  = ("FR", "LU", "IE")   # domiciles UCITS courants

# PEA-PME = agrément réglementaire (≥75 % de titres de PME-ETI européennes
# éligibles), déclaré fonds par fonds — PAS dérivable de « small cap ».
# On ne retient donc QUE les noms explicitement PME / PEA-PME / PME-ETI, sinon
# on génère des faux positifs massifs (cf. migration 20260611130000).
PEA_PME_KEYWORDS = re.compile(
    r"pea[\s\-]?pme|pme[\s\-]?eti|"
    r"petites?\s*(?:et\s*moyennes?\s*)?entreprises?|\bpme\b",
    re.IGNORECASE,
)


def compute_eligibility(fund: dict) -> dict:
    """Retourne les éligibilités calculées pour un fonds (None = inconnue)."""
    pt   = (fund.get("product_type") or "").lower()
    isin = fund.get("isin") or ""
    name = fund.get("name") or ""
    cat  = fund.get("category_normalized") or ""
    pea  = fund.get("pea_eligible")

    result: dict[str, bool | None] = {
        "cto_eligible": None,
        "av_fr_eligible": None,
        "av_lux_eligible": None,
        "per_eligible": None,
        "pea_pme_eligible": None,
    }

    # CTO
    if pt in CTO_ELIGIBLE_TYPES:
        result["cto_eligible"] = True
    elif pt in CTO_NOT_ELIGIBLE_TYPES:
        result["cto_eligible"] = False

    # AV-France
    if pt in AV_FR_ELIGIBLE_TYPES:
        if pt == "fonds_euros":
            result["av_fr_eligible"] = True
        elif any(isin.startswith(p) for p in AV_FR_ELIGIBLE_ISINS):
            result["av_fr_eligible"] = True
        else:
            result["av_fr_eligible"] = False
    elif pt in ("action", "obligation", "crypto", "livret"):
        result["av_fr_eligible"] = False

    # PER & AV-Luxembourg : aucune de ces enveloppes ne détient de titres vifs
    # en direct (uniquement des supports/fonds). On marque donc négatif les
    # types « securité en direct » (cf. migration 20260611190000).
    if pt in ("action", "obligation", "crypto", "livret"):
        result["per_eligible"] = False
        result["av_lux_eligible"] = False

    # PEA-PME
    if pt in CTO_NOT_ELIGIBLE_TYPES or pt in ("action", "obligation", "crypto", "livret", "fps", "fpci", "fcpr"):
        result["pea_pme_eligible"] = False
    elif pt in AV_FR_ELIGIBLE_TYPES:
        if pea is True and PEA_PME_KEYWORDS.search(name + " " + cat):
            result["pea_pme_eligible"] = True
        elif pt != "fonds_euros":
            result["pea_pme_eligible"] = False

    return result


def run(apply: bool, recalc: bool) -> None:
    print("=" * 64)
    print("  Enrichissement éligibilités enveloppes")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    fields = (
        "isin,product_type,name,category_normalized,"
        "pea_eligible,av_fr_eligible,av_lux_eligible,per_eligible,pea_pme_eligible,cto_eligible"
    )

    offset  = 0
    total   = 0
    changed = Counter()

    while True:
        batch = (
            client.table("investissement_funds")
            .select(fields)
            .range(offset, offset + BATCH_SIZE - 1)
            .execute()
            .data
        )
        if not batch:
            break

        updates = []
        for fund in batch:
            computed = compute_eligibility(fund)
            patch: dict = {"isin": fund["isin"]}
            diff = False
            for col, val in computed.items():
                if val is not None and fund.get(col) is None:
                    patch[col] = val
                    diff = True
                    changed[col] += 1
            if diff:
                updates.append(patch)

        total += len(batch)

        if apply and updates:
            for upd in updates:
                isin = upd.pop("isin")
                client.table("investissement_funds").update(upd).eq("isin", isin).execute()

        offset += BATCH_SIZE

    print(f"  Fonds analysés : {total}")
    print(f"  Mises à jour :")
    for col, n in sorted(changed.items()):
        print(f"    {col:30s} : {n}")
    print()

    if recalc and apply:
        print("  Recalcul data_completeness…")
        import subprocess, sys
        subprocess.run(
            [sys.executable, "scripts/migrations/recalc-completeness-v2.py", "--per-type", "--apply"],
            check=False,
        )

    log_run(
        scraper="enrich-eligibility",
        status="success" if apply else "partial",
        records_processed=total,
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply",  action="store_true")
    parser.add_argument("--recalc", action="store_true", help="Recalcule data_completeness après enrichissement")
    args = parser.parse_args()
    run(apply=args.apply, recalc=args.recalc)
