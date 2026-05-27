#!/usr/bin/env python3
"""
cluster-share-classes.py — Identifier les classes de parts du même fonds
==========================================================================
Beaucoup de fonds (ETF/OPCVM) ont plusieurs ISINs représentant des CLASSES DE
PARTS différentes (Acc/Dist, EUR/USD/CHF, hedged/non-hedged, A/B/I institutionnels).

Exemple : "BNP Paribas Easy S&P 500" a 3 ISINs :
  - IE000Q6C8036, IE0000VX9GN7, IE0004J37T45

On veut les regrouper sous un `share_class_group_id` (UUID partagé) pour permettre :
  - Affichage groupé côté UI
  - Calcul d'AUM total / suivi du fonds-mère
  - Dédoublonnage des recommandations

Critère de clustering :
  - Même `name` normalisé (lowercase, sans suffixes Acc/Dist/EUR/etc.)
  - Même `product_type`
  - Même `management_company_normalized`

Usage :
    python3 scripts/migrations/cluster-share-classes.py [--apply]
"""

import sys
import re
import argparse
import unicodedata
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run


# ─── Normalisation du nom pour clustering ─────────────────────────────────────

# Suffixes typiques de classes de parts à enlever pour identifier le nom-mère
SHARE_CLASS_SUFFIXES = [
    # Distribution policy
    r"\b(acc(umulating)?|accumulation|cap|capitalisation|capitalising)\b",
    r"\b(dist(ribution|ributing)?|inc(ome)?|d)\b(?!\w)",
    # Hedging
    r"\bhedged\b", r"\b(eur|usd|gbp|chf|jpy|hkd)\s+hedged\b",
    # Currency
    r"\b(eur|usd|gbp|chf|jpy|hkd|cad|aud|sek|nok)\b(?!\w)",
    # Share class letters & roman numerals
    r"\b(class\s+)?([abcdefijprstux]|institutional|retail|premium|priv|p|i|r|q)\b(?!\w)",
    # Roman numerals
    r"\b(part\s+)?(i{1,3}|iv|v|vi{0,3}|x)\b(?!\w)",
    # Trailing "ucits etf" (déjà dans le nom-mère)
    # Trailing tickers
    r"\([^)]+\)$",
]

def normalize_name_for_clustering(name: str) -> str:
    """Réduit le nom à sa forme la plus dénudée pour clustering."""
    if not name:
        return ""
    # Accents → ASCII
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = n.lower().strip()
    # Enlever suffixes de classes
    for pattern in SHARE_CLASS_SUFFIXES:
        n = re.sub(pattern, " ", n)
    # Espaces multiples
    n = re.sub(r"\s+", " ", n).strip()
    # Garder caractères alphanumériques
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def run(apply: bool):
    print("=" * 68)
    print("  Cluster Share Classes — share_class_group_id")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    # Charger ETF + OPCVM + SICAV
    out = []
    offset = 0
    while True:
        r = client.table("investissement_funds") \
            .select("isin, name, product_type, management_company_normalized, share_class_group_id, currency") \
            .in_("product_type", ["etf", "opcvm", "sicav"]) \
            .not_.is_("name", "null") \
            .range(offset, offset + 999) \
            .execute()
        if not r.data:
            break
        out += r.data
        if len(r.data) < 1000:
            break
        offset += 1000

    print(f"  {len(out)} fonds ETF/OPCVM/SICAV chargés")

    # Exclure les noms placeholders/génériques OU millésimés
    EXCLUDE_PATTERNS = [
        r"fonds\s*dedie", r"\*+", r"^fonds$", r"^opcvm$",
        r"autocall", r"^compartiment$",
        r"triple\s+horizon",  # millésimés
        r"naxicap\s+opportunities",  # millésimés
        r"france\s+valley", r"selection\s+france",  # FCPI millésimés
    ]
    # Exclure tout nom qui contient une année (2018-2099) ou un mois français
    YEAR_OR_MONTH = re.compile(
        r"(20[1-9]\d|janv|fevr|fevrier|mars|avril|mai|juin|juil|juillet|aout|sept|oct|nov|decembre|dec\b)",
        re.IGNORECASE,
    )
    # Exclure si le nom original se termine par un chiffre romain (millésime FCPI/FCPR)
    ROMAN_END = re.compile(r"\b(II|III|IV|VI|VII|VIII|IX|XI|XII|XIII)\s*$", re.IGNORECASE)

    def is_excluded(name_norm: str, raw_name: str = "") -> bool:
        if any(re.search(p, name_norm) for p in EXCLUDE_PATTERNS):
            return True
        if YEAR_OR_MONTH.search(raw_name or name_norm):
            return True
        if raw_name and ROMAN_END.search(raw_name.strip()):
            return True
        return False

    # Grouper par (normalized_name, product_type, management_company_norm)
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for f in out:
        raw = f.get("name", "") or ""
        name_norm = normalize_name_for_clustering(raw)
        if not name_norm or len(name_norm) < 8 or is_excluded(name_norm, raw):
            continue
        key = (
            name_norm,
            f.get("product_type"),
            f.get("management_company_normalized") or "_unknown_",
        )
        groups[key].append(f)

    # Garder uniquement les groupes ≥2 (vraies classes de parts)
    multi = {k: v for k, v in groups.items() if len(v) >= 2}

    print(f"  {len(multi)} groupes de classes de parts trouvés")
    print(f"  Fonds dans groupes : {sum(len(v) for v in multi.values())}")

    # Distribution
    from collections import Counter
    sizes = Counter(len(v) for v in multi.values())
    print(f"\n  Distribution taille de groupe :")
    for sz, n in sorted(sizes.items()):
        print(f"    {sz} parts : {n} groupes")

    # Échantillon
    print(f"\n  Top 5 plus gros groupes :")
    for key, funds in sorted(multi.items(), key=lambda x: -len(x[1]))[:5]:
        norm_name, ptype, mgmt = key
        print(f"\n    [{ptype}] '{norm_name[:50]}' ({mgmt}) — {len(funds)} parts :")
        for f in funds[:4]:
            print(f"      {f['isin']:14} | currency={f.get('currency')} | {f['name'][:55]}")

    if not apply:
        print("\n  DRY-RUN — pas d'écriture.")
        return

    # Génération des UUIDs et application
    print(f"\n  Application en base...")
    updates = []
    for key, funds in multi.items():
        # Si un fonds du groupe a déjà un share_class_group_id, réutiliser
        existing_id = next((f["share_class_group_id"] for f in funds if f.get("share_class_group_id")), None)
        group_id = existing_id or str(uuid.uuid4())[:18]  # 18 chars pour économiser
        for f in funds:
            if f.get("share_class_group_id") != group_id:
                updates.append({"isin": f["isin"], "share_class_group_id": group_id})

    print(f"  {len(updates)} fonds à updater")

    ok = fail = 0
    for i, u in enumerate(updates, 1):
        try:
            client.table("investissement_funds") \
                .update({"share_class_group_id": u["share_class_group_id"]}) \
                .eq("isin", u["isin"]) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"    ✗ {u['isin']} : {e}")
        if i % 500 == 0:
            print(f"    [{i:>5}/{len(updates)}] {100*i/len(updates):.0f}% ok={ok} fail={fail}")

    print(f"\n  ✓ {ok} mis à jour, {fail} échecs")
    print(f"  → {len(multi)} groupes de classes de parts créés")

    log_run(
        scraper="cluster-share-classes",
        status="success" if fail == 0 else "partial",
        records_processed=ok,
        records_failed=fail,
        started_at=started,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cluster ETF/OPCVM/SICAV en groupes de classes de parts")
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
