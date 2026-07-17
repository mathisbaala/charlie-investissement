#!/usr/bin/env python3
"""
apply-natures-from-harvest.py — Applique la récolte des natures juridiques GECO
================================================================================
Lit scripts/data/geco-natures-harvest.json (produit par
scripts/scrapers/geco-natures-harvest.py) et applique dans investissement_funds
trois choses, avec garde-fous :

  1. RECLASSIFICATION product_type — uniquement quand :
       • la nature GECO mappe vers un type SPÉCIFIQUE déjà connu du produit
         (OPCI→opci, FCPR→fcpr, FPCI→fpci, FIP→fip, FCPI→fcpi, SCPI→scpi) ;
       • ET le type actuel en base est GÉNÉRIQUE (opcvm ou fps).
     Jamais de reclassification depuis etf/action/structuré/etc.

  2. LABELS eltif / euveca — fusionnés dans le tableau `labels` des fonds
     existants (jamais de retrait).

  3. CRÉATION des produits CGP absents de la base — natures OPCI, FCPR, SCPI,
     SCI, GFV, GFI et tout produit labellisé ELTIF, statut VIVANT uniquement,
     hors fonds dédiés. Ligne minimale complétée ensuite par les enrichers.
     Désactivable avec --no-create.

Dry-run par défaut, écrire = --apply.

Usage :
  python3 scripts/migrations/apply-natures-from-harvest.py
  python3 scripts/migrations/apply-natures-from-harvest.py --apply
"""

import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run  # noqa: E402

DEFAULT_JSON = Path(__file__).parent.parent / "data" / "geco-natures-harvest.json"
BATCH = 100

# nature GECO → product_type spécifique (types déjà présents en base)
NATURE_TO_TYPE = {
    "OPCI": "opci", "FCPR": "fcpr", "FPCI": "fpci",
    "FIP": "fip",   "FCPI": "fcpi", "SCPI": "scpi",
}
# types génériques autorisés comme POINT DE DÉPART d'une reclassification
GENERIC_TYPES = {"opcvm", "fps"}

# natures créées si absentes de la base (produits CGP retail).
# Volontairement EXCLUS : OPPCI (réservé professionnels), OFS (dette privée
# pro, sauf ELTIF), FPCI/FIP/FCPI (campagnes fermées, déjà couverts), FCT/SCR.
CREATE_NATURES = {"OPCI", "FCPR", "SCPI", "SCI", "GFV", "GFI", "GF", "GFA"}

# nature → asset_class à la création
NATURE_ASSET_CLASS = {
    "OPCI": "immobilier", "SCPI": "immobilier", "SCI": "immobilier",
    "GFV": "alternatif",  "GFI": "alternatif",  "GF": "alternatif",
    "GFA": "alternatif",  "FCPR": "alternatif",
}

SKIP_NAME_PATTERNS = ("dédié", "dedie", "***", "fcpe ")


def fetch_existing(client) -> dict[str, dict]:
    """ISIN → {product_type, labels}, pagination ORDONNÉE."""
    out, off = {}, 0
    while True:
        rows = (
            client.table("investissement_funds")
            .select("isin, product_type, labels")
            .order("isin")
            .range(off, off + 999)
            .execute().data or []
        )
        for r in rows:
            out[r["isin"]] = r
        if len(rows) < 1000:
            break
        off += 1000
    return out


def main():
    ap = argparse.ArgumentParser(description="Applique les natures GECO en base")
    ap.add_argument("--json", default=str(DEFAULT_JSON))
    ap.add_argument("--apply", action="store_true", help="écrire en base (défaut : dry-run)")
    ap.add_argument("--no-create", action="store_true", help="ne pas insérer les produits absents")
    args = ap.parse_args()

    started = datetime.now(timezone.utc)
    data = json.loads(Path(args.json).read_text())
    products = {p["isin"]: p for p in data.get("products", []) if p.get("isin")}

    print("=" * 64)
    print("  Apply natures juridiques GECO + labels ELTIF")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"  Récolte : {len(products)} ISIN")

    client = get_client()
    existing = fetch_existing(client)
    print(f"  Base : {len(existing)} fonds existants")

    # ── 1. reclassifications ──
    reclass: dict[str, list[str]] = {}          # target_type → [isins]
    for isin, p in products.items():
        cur = existing.get(isin)
        target = NATURE_TO_TYPE.get(p.get("nature"))
        if cur and target and cur.get("product_type") in GENERIC_TYPES \
                and cur["product_type"] != target:
            reclass.setdefault(target, []).append(isin)

    # ── 2. labels eltif/euveca ──
    label_add: dict[str, list[str]] = {}        # isin → labels à ajouter
    for isin, p in products.items():
        cur = existing.get(isin)
        if not cur:
            continue
        want = [l for flag, l in (("eltif", "eltif"), ("euveca", "euveca")) if p.get(flag)]
        have = set(cur.get("labels") or [])
        missing = [l for l in want if l not in have]
        if missing:
            label_add[isin] = sorted(have | set(missing))

    # ── 3. créations ──
    to_create = []
    for isin, p in products.items():
        if isin in existing:
            continue
        if p.get("status") != "VIV":
            continue
        name_low = (p.get("name") or "").lower()
        if any(s in name_low for s in SKIP_NAME_PATTERNS):
            continue
        if p.get("nature") in CREATE_NATURES or p.get("eltif"):
            to_create.append(p)

    print(f"\n  → reclassifications : " +
          (", ".join(f"{t}:{len(v)}" for t, v in sorted(reclass.items())) or "aucune"))
    print(f"  → labels eltif/euveca à poser : {len(label_add)} fonds")
    print(f"  → produits CGP absents à créer : {len(to_create)}"
          f"{' (création désactivée)' if args.no_create else ''}")

    updated = created = 0
    if args.apply:
        for target, isins in reclass.items():
            for i in range(0, len(isins), BATCH):
                chunk = isins[i:i + BATCH]
                client.table("investissement_funds").update({"product_type": target}).in_("isin", chunk).execute()
            updated += len(isins)
            print(f"  ✓ {len(isins)} fonds reclassés {target}")

        for isin, labels in label_add.items():
            client.table("investissement_funds").update({"labels": labels}).eq("isin", isin).execute()
        updated += len(label_add)
        if label_add:
            print(f"  ✓ {len(label_add)} fonds labellisés eltif/euveca")

        if to_create and not args.no_create:
            rows = []
            for p in to_create:
                nature = p.get("nature")
                ptype = NATURE_TO_TYPE.get(nature, "fps")
                labels = [l for flag, l in (("eltif", "eltif"), ("euveca", "euveca")) if p.get(flag)]
                rows.append({
                    "isin":               p["isin"],
                    "name":               p["name"],
                    "product_type":       ptype,
                    "asset_class":        NATURE_ASSET_CLASS.get(nature, "alternatif"),
                    "currency":           "EUR",
                    "category":           p.get("nature_label") or p.get("amf_category"),
                    "management_company": p.get("management_company"),
                    "inception_date":     p.get("inception_date"),
                    "labels":             labels or None,
                    "distributor_france": True,
                    "data_source":        "amf-geco-natures",
                })
            ok, ko = upsert_funds_bulk(rows)
            created = ok
            print(f"  ✓ {ok} produits créés ({ko} échecs)")

        log_run("apply-natures-from-harvest", "success", updated + created, 0, started_at=started)
    else:
        print("\n  Dry-run — exemples de produits à créer :")
        for p in to_create[:12]:
            tag = "ELTIF " if p.get("eltif") else ""
            print(f"    {p['isin']}  {p.get('nature') or '?':5}  {tag}{(p.get('name') or '')[:52]}")

    print("=" * 64)


if __name__ == "__main__":
    main()
