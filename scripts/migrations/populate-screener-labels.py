#!/usr/bin/env python3
"""
populate-screener-labels.py — Tags automatiques pour le screener CGP
=====================================================================
Remplit la colonne `labels` (JSONB array) avec des tags stables qui
permettent des filtres rapides dans le screener sans jointures.

Tags produits :
  pea          — éligible PEA (pea_eligible=true)
  per          — éligible PER
  av-lux       — éligible AV Luxembourg
  article-6 / article-8 / article-9  — SFDR
  low-cost     — TER ≤ 0.50%
  mid-cost     — TER 0.50–1.20%
  high-cost    — TER > 1.20%
  sri-1..sri-7 — profil de risque SRI
  sri-low      — SRI ≤ 2
  sri-medium   — SRI 3-4
  sri-high     — SRI ≥ 5
  esg          — fonds ESG/SRI déclaré (SFDR article 8 ou 9)
  kid-ready    — KID disponible (kid_url ou kid_parsed_at)
  screener-ready  — data_completeness ≥ 70
  top-performer   — performance_3y > 15%
  large-cap    — AUM ≥ 1 Mrd€

Usage :
    python3 scripts/migrations/populate-screener-labels.py
    python3 scripts/migrations/populate-screener-labels.py --apply
    python3 scripts/migrations/populate-screener-labels.py --apply --force  (recalcule même si déjà set)
"""

import sys
import json
import argparse
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH_SIZE = 100  # fonds par requête (réduit pour éviter les timeouts Supabase)

# Labels gérés manuellement (hors scope screener) — préservés lors du recalcul
PRESERVED_LABELS = frozenset([
    "established", "large-fund", "risk-adjusted-top", "low-drawdown",
    "ISR", "Greenfin", "Finansol", "Climat", "Water", "Healthcare",
    "Technology", "Impact",
    # Labels officiels normalisés (registres BdF / lelabelisr.fr via
    # labels-registries.py) — en minuscules, consommés par le moteur
    # (EXCLUSION_GUARANTEE_LABELS teste "isr"/"greenfin"/"finansol").
    "isr", "greenfin", "finansol",
    # Politique d'exclusion déclarée (annexe SFDR, sfdr-annex-enricher) —
    # consommée par le moteur d'allocation (exclusions éthiques du client).
    "excl-fossiles", "excl-tabac", "excl-armes", "excl-jeux", "excl-alcool",
])


def compute_labels(f: dict) -> list[str]:
    tags: list[str] = []

    # Enveloppes fiscales
    if f.get("pea_eligible") is True:
        tags.append("pea")
    if f.get("per_eligible") is True:
        tags.append("per")
    if f.get("av_lux_eligible") is True:
        tags.append("av-lux")

    # SFDR
    sfdr = f.get("sfdr_article")
    if sfdr in (6, 8, 9):
        tags.append(f"article-{sfdr}")
    if sfdr in (8, 9):
        tags.append("esg")

    # TER / frais
    ter = f.get("ter") or f.get("ongoing_charges")
    if ter is not None:
        if ter <= 0.005:
            tags.append("low-cost")
        elif ter <= 0.012:
            tags.append("mid-cost")
        else:
            tags.append("high-cost")

    # SRI
    sri = f.get("sri") or f.get("srri")
    if sri is not None:
        try:
            v = int(sri)
            if 1 <= v <= 7:
                tags.append(f"sri-{v}")
                if v <= 2:
                    tags.append("sri-low")
                elif v <= 4:
                    tags.append("sri-medium")
                else:
                    tags.append("sri-high")
        except (TypeError, ValueError):
            pass

    # KID disponible
    if f.get("kid_url") or f.get("kid_parsed_at"):
        tags.append("kid-ready")

    # Screener-ready
    dc = f.get("data_completeness") or 0
    if dc >= 70:
        tags.append("screener-ready")
    elif dc >= 50:
        tags.append("screener-partial")

    # Performance
    p3y = f.get("performance_3y")
    if p3y is not None and p3y > 15:
        tags.append("top-performer")

    # Taille
    aum = f.get("aum_eur")
    if aum is not None:
        if aum >= 1_000_000_000:
            tags.append("large-cap")
        elif aum >= 100_000_000:
            tags.append("mid-cap")

    return sorted(set(tags))


def run(apply: bool, force: bool) -> None:
    print("=" * 68)
    print("  Populate Screener Labels — tags automatiques")
    print("=" * 68)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Force : {'oui (recalcule tout)' if force else 'non (seulement labels vides)'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    all_funds: list[dict] = []
    offset = 0
    fields = ("isin,pea_eligible,per_eligible,av_lux_eligible,sfdr_article,"
              "ter,ongoing_charges,sri,srri,kid_url,kid_parsed_at,"
              "data_completeness,performance_3y,aum_eur,labels")

    while True:
        q = client.table("investissement_funds").select(fields)
        if not force:
            q = q.eq("labels", "[]")  # seulement les fonds avec labels vide
        batch = q.range(offset, offset + 999).execute().data or []
        all_funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_funds)} fonds à traiter")

    to_update: list[dict] = []
    tag_dist: Counter = Counter()

    for f in all_funds:
        new_labels = compute_labels(f)
        existing = f.get("labels") or []
        # Préserver les labels hors-scope screener (enrichissements manuels / SQL)
        preserved = [lbl for lbl in existing if lbl in PRESERVED_LABELS]
        merged = sorted(set(new_labels) | set(preserved))
        if merged != sorted(existing):
            to_update.append({"isin": f["isin"], "labels": merged})
            for t in merged:
                tag_dist[t] += 1

    print(f"  {len(to_update)} fonds avec labels à mettre à jour\n")
    print("  Distribution des tags :")
    for tag, n in tag_dist.most_common(20):
        print(f"    {n:6d}  {tag}")

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    print("\n  Application en base...", flush=True)
    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0

    for label_key, isins in _group_by_labels(to_update).items():
        labels_list = json.loads(label_key)
        for i in range(0, len(isins), BATCH_SIZE):
            sub = isins[i:i + BATCH_SIZE]
            try:
                client.table("investissement_funds") \
                    .update({"labels": labels_list, "updated_at": now_ts}) \
                    .in_("isin", sub) \
                    .execute()
                ok += len(sub)
            except Exception as e:
                fail += len(sub)
                print(f"  ✗ [{labels_list[:2]}...]: {e}", flush=True)
                continue

    print(f"\n  → {ok} fonds taguées, {fail} erreurs")
    log_run("populate-screener-labels", "success" if fail == 0 else "partial", ok, fail, started_at=started)


def _group_by_labels(rows: list[dict]) -> dict[str, list[str]]:
    """Groupe les ISINs par ensemble de labels identique."""
    import json
    groups: dict[str, list[str]] = {}
    for r in rows:
        key = json.dumps(r["labels"])
        groups.setdefault(key, []).append(r["isin"])
    return groups


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Calcule et stocke les labels screener dans la colonne JSONB labels"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    parser.add_argument("--force", action="store_true", help="Recalculer même si labels déjà remplis")
    args = parser.parse_args()
    run(apply=args.apply, force=args.force)
