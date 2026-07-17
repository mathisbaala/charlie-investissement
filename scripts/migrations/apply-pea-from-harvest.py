#!/usr/bin/env python3
"""
apply-pea-from-harvest.py — Intègre en base la récolte de l'univers PEA
========================================================================
Lit scripts/data/pea-harvest-boursorama.json (produit par
scripts/scrapers/pea-universe-boursorama.py, source gratuite : recherche
publique Boursorama filtrée PEA / PEA-PME) et applique dans
investissement_funds :

  • ISIN DÉJÀ en base   → UPDATE des seuls drapeaux pea_eligible /
    pea_pme_eligible (fill-only : ne touche ni nom, ni type, ni métriques ;
    ne repasse JAMAIS un drapeau True → False) ;
  • ISIN ABSENTS        → INSERT d'une ligne minimale (nom, type, devise,
    société de gestion, drapeaux PEA, data_source="boursorama-pea") — les
    enrichers habituels (boursorama, quantalys, compute-metrics…) complètent
    ensuite. Désactivable avec --no-create.

Dry-run par défaut, écrire = --apply.

Usage :
  python3 scripts/migrations/apply-pea-from-harvest.py
  python3 scripts/migrations/apply-pea-from-harvest.py --apply
  python3 scripts/migrations/apply-pea-from-harvest.py --apply --no-create
"""

import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, upsert_funds_bulk, log_run  # noqa: E402

DEFAULT_JSON = Path(__file__).parent.parent / "data" / "pea-harvest-boursorama.json"
BATCH = 100

# Domiciles UE/EEE éligibles PEA (mêmes règles que pea-eligibility-fix.py).
# Boursorama garde des éligibilités périmées d'avant Brexit (fonds GB) : on
# les écarte plutôt que de propager une donnée fausse.
PEA_COUNTRY_PREFIXES = {
    "FR","DE","IT","ES","NL","BE","AT","PT","FI","IE","LU","SE","DK",
    "PL","CZ","RO","HU","SK","BG","HR","SI","EE","LV","LT","CY","MT","GR",
    "NO","IS","LI",
}


def fetch_existing(client) -> dict[str, dict]:
    """ISIN → {pea_eligible, pea_pme_eligible} pour toute la base."""
    out, off = {}, 0
    while True:
        rows = (
            client.table("investissement_funds")
            .select("isin, pea_eligible, pea_pme_eligible")
            .order("isin")           # pagination SANS tri = pages instables → lignes ratées
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
    ap = argparse.ArgumentParser(description="Applique la récolte PEA en base")
    ap.add_argument("--json", default=str(DEFAULT_JSON), help="chemin du JSON de récolte")
    ap.add_argument("--apply", action="store_true", help="écrire en base (défaut : dry-run)")
    ap.add_argument("--no-create", action="store_true", help="ne pas insérer les ISIN absents")
    args = ap.parse_args()

    started = datetime.now(timezone.utc)
    data = json.loads(Path(args.json).read_text())
    all_funds = [f for f in data.get("funds", []) if f.get("isin")]
    funds = [f for f in all_funds if f["isin"][:2] in PEA_COUNTRY_PREFIXES]
    excluded = len(all_funds) - len(funds)
    if excluded:
        print(f"  ⚠ {excluded} ISIN hors UE/EEE écartés (éligibilité Boursorama périmée, ex. GB post-Brexit)")
    print("=" * 64)
    print("  Apply univers PEA (récolte Boursorama)")
    print("=" * 64)
    print(f"  Mode : {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"  Récolte : {len(funds)} ISIN "
          f"(récoltée le {data.get('meta', {}).get('harvested_at', '?')[:10]})")

    client = get_client()
    existing = fetch_existing(client)
    print(f"  Base : {len(existing)} fonds existants")

    # ── Tri : à flaguer / à créer ──
    flag_pea, flag_pme, to_create = [], [], []
    for f in funds:
        isin = f["isin"]
        cur = existing.get(isin)
        if cur is None:
            to_create.append(f)
            continue
        if f.get("pea_eligible") and not cur.get("pea_eligible"):
            flag_pea.append(isin)
        if f.get("pea_pme_eligible") and not cur.get("pea_pme_eligible"):
            flag_pme.append(isin)

    print(f"\n  → drapeaux à poser : {len(flag_pea)} PEA, {len(flag_pme)} PEA-PME")
    print(f"  → fonds absents de la base : {len(to_create)}"
          f"{' (création désactivée)' if args.no_create else ''}")

    updated = created = 0

    if args.apply:
        for isins, col in ((flag_pea, "pea_eligible"), (flag_pme, "pea_pme_eligible")):
            for i in range(0, len(isins), BATCH):
                chunk = isins[i:i + BATCH]
                client.table("investissement_funds").update({col: True}).in_("isin", chunk).execute()
            updated += len(isins)
        if updated:
            print(f"  ✓ {updated} drapeaux mis à jour")

        if to_create and not args.no_create:
            # dédoublonner par ISIN (plusieurs symboles Boursorama peuvent
            # pointer la même part) — sinon l'upsert par lot échoue (21000)
            seen: set[str] = set()
            to_create = [f for f in to_create
                         if not (f["isin"] in seen or seen.add(f["isin"]))]
            rows = [
                {
                    "isin":               f["isin"],
                    "name":               f["name"],
                    "product_type":       f.get("product_type") or "opcvm",
                    "currency":           f.get("currency") or "EUR",
                    "management_company": f.get("management_company"),
                    "pea_eligible":       bool(f.get("pea_eligible")),
                    "pea_pme_eligible":   bool(f.get("pea_pme_eligible")),
                    "distributor_france": True,
                    "data_source":        "boursorama-pea",
                }
                for f in to_create
            ]
            ok, ko = upsert_funds_bulk(rows)
            created = ok
            print(f"  ✓ {ok} fonds créés ({ko} échecs)")

        log_run("apply-pea-from-harvest", "success", updated + created, 0, started_at=started)
    else:
        print("\n  Dry-run — exemples de fonds à créer :")
        for f in to_create[:10]:
            print(f"    {f['isin']}  {f.get('product_type', '?'):5}  {f['name'][:60]}")

    print("=" * 64)


if __name__ == "__main__":
    main()
