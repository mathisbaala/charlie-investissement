#!/usr/bin/env python3
"""
migrate-data-source.py — Backfill `field_sources JSONB` depuis `data_source` legacy
=====================================================================================
Migration de la traçabilité de provenance :
  AVANT : 1 colonne `data_source TEXT` par fonds (ex: "quantalys")
          → ne dit pas QUI a fourni QUEL champ.

  APRÈS : colonne additionnelle `field_sources JSONB` par fonds :
          { "ter": "quantalys", "performance_1y": "quantalys", "sri": "quantalys", ... }
          → traçabilité par champ. Les enrichers futurs peuvent mettre à jour
          champ par champ sans écraser la provenance des autres champs.

Ce script :
  1. Vérifie que la colonne `field_sources` existe (sinon, erreur explicite et
     instruction pour appliquer migrate-data-source-jsonb.sql).
  2. Pour chaque fonds, construit un dict `field_sources` à partir de
     `data_source` (legacy) en associant cette source à TOUS les champs
     non-NULL canoniques (ter, performance_1y, sri, etc.). C'est le comportement
     par défaut : "tout vient de la même source", et c'est cohérent avec l'état
     actuel de la base où data_source est l'unique pivot.
  3. NE TOUCHE PAS aux fonds dont `field_sources` est déjà non vide
     (idempotent, ne régresse pas une migration partielle).
  4. NE TOUCHE PAS `data_source` (rétrocompatibilité totale).

Mode DRY-RUN par défaut (n'écrit rien). Utiliser --apply pour persister.

Usage :
    # Vérification + dry-run + sample
    python3 scripts/migrations/migrate-data-source.py

    # Application réelle
    python3 scripts/migrations/migrate-data-source.py --apply

    # Limiter à un type de produit pour tester
    python3 scripts/migrations/migrate-data-source.py --apply --type opcvm

    # Forcer le re-backfill (écrase field_sources existant)
    python3 scripts/migrations/migrate-data-source.py --apply --force
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Champs canoniques considérés "sourceables" ───────────────────────────────
# Lorsque ces champs sont non-NULL et qu'on n'a pas d'info de provenance plus
# fine, on attribue la source legacy (data_source) à ces champs.
#
# Liste tirée de docs/data-standards.md §1 + §3 (champs utilisés par
# compute_completeness). Les champs administratifs (created_at, updated_at,
# isin, name, product_type, currency) ne sont pas sourcés ici car ils sont
# soit identitaires (isin), soit gérés par la DB (timestamps), soit
# pratiquement toujours définis à l'insert.

SOURCEABLE_FIELDS = [
    # Frais
    "ter",
    "ongoing_charges",
    # Risque
    "sri",
    "srri",
    # Performances
    "performance_1y",
    "performance_3y",
    "performance_5y",
    "average_performance",
    # Volatilité / risque calculé
    "volatility_1y",
    "volatility_3y",
    "max_drawdown_1y",
    "max_drawdown_3y",
    "sharpe_1y",
    "sharpe_3y",
    # ESG / réglementaire
    "sfdr_article",
    # Encours
    "aum_eur",
    # Métadonnées descriptives
    "asset_class",
    "category",
    "region_exposure",
    "management_company",
    "inception_date",
    "track_record_years",
    "morningstar_rating",
    # KID
    "kid_url",
    "kid_parsed_at",
    "kid_hash",
    # Distribution / classification réglementaire France
    "distributor_france",
    "pea_eligible",
    "hedged",
    "risk_level",
]


FETCH_FIELDS = "isin,product_type,data_source,field_sources," + ",".join(SOURCEABLE_FIELDS)
BATCH_SIZE = 200


def column_exists(client) -> bool:
    """Vérifie que la colonne `field_sources` existe en sélectionnant 1 ligne."""
    try:
        client.table("investissement_funds").select("field_sources").limit(1).execute()
        return True
    except Exception as e:
        msg = str(e)
        if "field_sources" in msg or "42703" in msg or "PGRST" in msg:
            return False
        raise


def fetch_all(client, types_filter: list[str] | None) -> list[dict]:
    funds: list[dict] = []
    offset = 0
    page = 1000
    while True:
        q = client.table("investissement_funds").select(FETCH_FIELDS)
        if types_filter:
            q = q.in_("product_type", types_filter)
        batch = q.range(offset, offset + page - 1).execute().data or []
        funds.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return funds


def build_field_sources(fund: dict) -> dict:
    """
    Construit le dict {field: source} pour un fonds.

    Règle par défaut : la source legacy (data_source) est attribuée à TOUS les
    champs canoniques actuellement non-NULL. Si data_source est NULL/absent, on
    utilise '<unknown>' (signal que ce fonds n'a pas de traçabilité initiale —
    sera corrigé par les futurs scrapes).
    """
    src = fund.get("data_source") or "<unknown>"
    out: dict[str, str] = {}
    for col in SOURCEABLE_FIELDS:
        val = fund.get(col)
        # On ne source que les colonnes qui ont effectivement une valeur
        if val is None:
            continue
        # Les strings vides ne comptent pas comme valeur
        if isinstance(val, str) and val.strip() == "":
            continue
        out[col] = src
    return out


def run(apply: bool, types_filter: list[str] | None, force: bool) -> None:
    print("=" * 72)
    print("  migrate-data-source — Backfill `field_sources` JSONB")
    print("=" * 72)
    print(f"  Mode   : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Filtre : {','.join(types_filter) if types_filter else 'tous types'}")
    print(f"  Force  : {force} (si True, écrase field_sources existant)")
    print()

    started = datetime.now(timezone.utc)
    client = get_client()

    # ─── 1. Pré-flight : colonne existe ? ──────────────────────────────────────
    print("  [1/3] Vérification de la colonne field_sources...")
    if not column_exists(client):
        print("  ✗ Colonne `field_sources` introuvable.")
        print("    → Appliquer d'abord : scripts/migrations/migrate-data-source-jsonb.sql")
        print("    → Via Supabase dashboard > SQL Editor (la migration est idempotente)")
        sys.exit(1)
    print("  ✓ Colonne field_sources OK")

    # ─── 2. Chargement ────────────────────────────────────────────────────────
    print("  [2/3] Chargement des fonds...")
    funds = fetch_all(client, types_filter)
    print(f"  ✓ {len(funds)} fonds chargés")

    # ─── 3. Préparation des updates ────────────────────────────────────────────
    print("  [3/3] Calcul des updates...")
    updates: list[dict] = []
    skipped_already_done = 0
    skipped_no_sourceable = 0
    source_distribution: Counter = Counter()
    field_coverage: Counter = Counter()

    for f in funds:
        existing = f.get("field_sources") or {}
        # Skip si déjà fait (idempotent), sauf si --force
        if existing and not force:
            skipped_already_done += 1
            continue

        new_sources = build_field_sources(f)
        if not new_sources:
            skipped_no_sourceable += 1
            continue

        # Stats
        for src in new_sources.values():
            source_distribution[src] += 1
        for field_name in new_sources:
            field_coverage[field_name] += 1

        updates.append({"isin": f["isin"], "field_sources": new_sources})

    print(f"  ✓ {len(updates)} fonds à mettre à jour")
    print(f"    Skip (déjà migrés) : {skipped_already_done}")
    print(f"    Skip (aucun champ sourceable) : {skipped_no_sourceable}")
    print()

    # ─── 4. Rapport préalable ─────────────────────────────────────────────────
    print("  ─── Distribution sources qui seront propagées ───")
    for src, n in source_distribution.most_common(15):
        print(f"    {src:35s} {n:>8} (n champs attribués)")
    print()

    print("  ─── Top champs qui auront une source attribuée ───")
    for fld, n in field_coverage.most_common(15):
        print(f"    {fld:30s} {n:>8} fonds")
    print()

    if updates:
        print("  ─── Échantillon (3 premiers) ───")
        for u in updates[:3]:
            print(f"    isin={u['isin']}")
            sample_keys = list(u["field_sources"].items())[:6]
            print(f"      field_sources = {{ {', '.join(f'{k}: {v!r}' for k, v in sample_keys)}{'  ...' if len(u['field_sources']) > 6 else ''} }}")
        print()

    # ─── 5. Appliquer (si --apply) ─────────────────────────────────────────────
    if not apply:
        print("  ───────────────────────────────────────────────────")
        print(f"  DRY-RUN : aucune écriture. Relancer avec --apply.")
        print("  ───────────────────────────────────────────────────")
        return

    if not updates:
        print("  Rien à faire.")
        return

    print(f"  Application en cours sur {len(updates)} fonds...")
    ok = fail = 0
    errors: list[dict] = []

    for i in range(0, len(updates), BATCH_SIZE):
        batch = updates[i: i + BATCH_SIZE]
        for upd in batch:
            isin = upd["isin"]
            payload = {
                "field_sources": upd["field_sources"],
                # Ne pas écraser updated_at : le backfill n'est pas un changement
                # de donnée métier, c'est de la traçabilité retroactive.
                # On évite donc de fausser stale_data ou les recency checks.
            }
            try:
                client.table("investissement_funds") \
                    .update(payload) \
                    .eq("isin", isin) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if len(errors) < 10:
                    errors.append({"isin": isin, "error": str(e)[:200]})
                if fail <= 3:
                    print(f"    ✗ {isin}: {e}")

        pct = min(i + len(batch), len(updates)) / len(updates) * 100
        print(f"    [{i + len(batch):6d}/{len(updates)}] {pct:5.1f}%  ✓{ok}  ✗{fail}")

    print()
    print(f"  Résultat : {ok} succès, {fail} échecs")

    status = "success" if fail == 0 else ("partial" if ok > 0 else "failed")
    log_run(
        scraper="migrate-data-source",
        status=status,
        records_processed=ok,
        records_failed=fail,
        errors=errors,
        started_at=started,
    )


# ─── Documentation des conventions futures (lisible via --help-enrichers) ───

ENRICHER_GUIDE = """\
================================================================================
GUIDE — Comment les enrichers doivent mettre à jour `field_sources`
================================================================================

Une fois ce backfill exécuté, les nouveaux enrichers (et les scrapers existants
au fur et à mesure de leur refactor) doivent suivre cette convention :

1. NE PAS écraser `data_source` quand on enrichit partiellement
   --------------------------------------------------------------
   ❌ AVANT (perd la provenance des autres champs) :
       client.table("investissement_funds").update({
           "ter": 0.0085,
           "data_source": "kid_pdf",     # ← écrase quantalys/etc.
       }).eq("isin", isin).execute()

   ✅ APRÈS (préserve la traçabilité par champ) :
       # Lire l'existant
       row = client.table("investissement_funds") \\
                   .select("field_sources") \\
                   .eq("isin", isin).single().execute().data
       fs = row.get("field_sources") or {}

       # Mettre à jour SEULEMENT les champs qu'on vient de fetcher
       fs["ter"] = "kid_pdf"
       fs["ongoing_charges"] = "kid_pdf"
       fs["sri"] = "kid_pdf"

       client.table("investissement_funds").update({
           "ter": 0.0085,
           "ongoing_charges": 0.0085,
           "sri": 4,
           "field_sources": fs,
           # data_source reste inchangé (sauf premier ingest)
       }).eq("isin", isin).execute()

2. À l'insert (premier seed), définir les deux ensemble
   ----------------------------------------------------
   row = {
       "isin": "FR0010...",
       "name": "Mon Fonds",
       "product_type": "opcvm",
       "ter": 0.0085,
       "performance_1y": 7.5,
       "data_source": "amf-geco",        # legacy, sera utilisé par du code ancien
       "field_sources": {
           "ter": "amf-geco",
           "performance_1y": "amf-geco",
       },
   }
   client.table("investissement_funds").upsert(row, on_conflict="isin").execute()

3. Helper recommandé (à ajouter dans scripts/db.py au fur et à mesure)
   ------------------------------------------------------------------
   def upsert_fund_with_sources(data: dict, sources: dict[str, str]) -> bool:
       \"\"\"Comme upsert_fund mais merge `sources` dans field_sources existant.\"\"\"
       client = get_client()
       isin = data["isin"]
       existing = client.table("investissement_funds") \\
                       .select("field_sources") \\
                       .eq("isin", isin).limit(1).execute().data
       fs = (existing[0].get("field_sources") if existing else {}) or {}
       fs.update(sources)
       data["field_sources"] = fs
       return upsert_fund(data)

4. Forme structurée (optionnelle, V2)
   ----------------------------------
   Pour tracer aussi l'instant de l'enrichissement :
       fs["ter"] = {"source": "kid_pdf", "at": "2026-05-19T08:12:00Z"}
   Le schéma SQL accepte les deux formes (string OU objet).

================================================================================
"""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill field_sources JSONB depuis data_source legacy"
    )
    parser.add_argument("--apply", action="store_true",
                        help="Appliquer les updates (sinon DRY-RUN)")
    parser.add_argument("--type", type=str, default="",
                        help="Restreindre à certains product_type (comma-separated)")
    parser.add_argument("--force", action="store_true",
                        help="Écraser field_sources existant (sinon idempotent)")
    parser.add_argument("--help-enrichers", action="store_true",
                        help="Afficher le guide pour les enrichers et quitter")
    args = parser.parse_args()

    if args.help_enrichers:
        print(ENRICHER_GUIDE)
        sys.exit(0)

    types_filter = [t.strip() for t in args.type.split(",") if t.strip()] or None
    run(apply=args.apply, types_filter=types_filter, force=args.force)
