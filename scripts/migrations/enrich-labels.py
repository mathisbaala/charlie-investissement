#!/usr/bin/env python3
"""
enrich-labels.py — Enrichissement et normalisation de la colonne `labels`
=========================================================================
Deux passes dans le même script :

  Passe 1 — Normalisation des labels existants
    · "ESG" (majuscule) → fusionné dans "esg" (minuscule, convention populate-screener)
      Les 664 fonds qui ont "ESG" mais pas "esg" reçoivent "esg" à la place.

  Passe 2 — Enrichissement sémantique depuis SFDR + nom du fonds
    Cibles : fonds avec labels=[] OU sfdr_article IN (8, 9)
    Règles appliquées (sans dupliquer) :
      · sfdr_article = 9                              → "ESG"  (signal fort, label CGP-visible)
      · nom contient ISR (insensible casse)           → "ISR"
      · nom contient greenfin                         → "Greenfin"
      · nom contient finansol                         → "Finansol"
      · nom contient climate|climat|carbone|carbon
                      |low.carbon                     → "Climat"
      · nom contient \\bwater\\b|\\beau\\b            → "Water"
      · nom contient healthcare|santé|health          → "Healthcare"
      · nom contient technolog                        → "Technology"
      · nom contient \\bimpact\\b                     → "Impact"

  Note : les labels thématiques sont en PascalCase (ISR, Greenfin, Climat, Water …)
  tandis que les labels screener automatiques sont en kebab-case (esg, article-8 …).
  Cette convention est intentionnelle et permet de distinguer les deux familles.

Usage :
    python3 scripts/migrations/enrich-labels.py           # dry-run
    python3 scripts/migrations/enrich-labels.py --apply   # écrire en base
"""

import sys
import re
import json
import argparse
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

BATCH_SIZE = 400

# ─── Règles d'enrichissement sémantique ───────────────────────────────────────

THEMATIC_RULES: list[tuple[re.Pattern, str]] = [
    # Label réglementaire FR
    (re.compile(r'\bISR\b', re.IGNORECASE), "ISR"),
    (re.compile(r'\bgreenfin\b', re.IGNORECASE), "Greenfin"),
    (re.compile(r'\bfinansol\b', re.IGNORECASE), "Finansol"),
    # Climatique
    (re.compile(r'climate|climat|carbone|carbon|low[\s\-]?carbon', re.IGNORECASE), "Climat"),
    # Eau
    (re.compile(r'\bwater\b|\beau\b', re.IGNORECASE), "Water"),
    # Santé
    (re.compile(r'healthcare|sant[eé]|health(?!y)', re.IGNORECASE), "Healthcare"),
    # Technologie
    (re.compile(r'technolog', re.IGNORECASE), "Technology"),
    # Impact
    (re.compile(r'\bimpact\b', re.IGNORECASE), "Impact"),
]


def enrich_labels_for_fund(current_labels: list, sfdr_article, name: str) -> list:
    """
    Retourne la nouvelle liste de labels (triée) après application des règles.
    Ne modifie pas si aucun label nouveau à ajouter.
    """
    tags = set(current_labels)
    name = name or ""

    # SFDR article 9 → signal ESG fort (label CGP-visible "ESG" en PascalCase)
    # Distinct du label "esg" kebab-case produit par populate-screener qui cible article-8/9
    if sfdr_article == 9 and "ESG" not in tags:
        tags.add("ESG")

    # Règles nom
    for pattern, label in THEMATIC_RULES:
        if label not in tags and pattern.search(name):
            tags.add(label)

    return sorted(tags)


# ─── Passe 1 : Normalisation "ESG" → "esg" ────────────────────────────────────

def run_normalisation(client, apply: bool) -> int:
    """
    Fonds qui ont "ESG" (PascalCase) SANS "esg" (kebab) → remplacer "ESG" par "esg".
    Retourne le nombre de fonds concernés.
    """
    print("\n  [Passe 1] Normalisation : \"ESG\" → \"esg\"")

    rows = []
    offset = 0
    while True:
        batch = (
            client.table("investissement_funds")
            .select("isin,labels")
            .contains("labels", json.dumps(["ESG"]))
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    to_fix = []
    for r in rows:
        lbls = r.get("labels") or []
        if "ESG" in lbls and "esg" not in lbls:
            new_lbls = sorted((set(lbls) - {"ESG"}) | {"esg"})
            to_fix.append({"isin": r["isin"], "labels": new_lbls})

    print(f"    {len(to_fix)} fonds avec \"ESG\" sans \"esg\" → normalisation")

    if not apply or not to_fix:
        return len(to_fix)

    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for i in range(0, len(to_fix), BATCH_SIZE):
        sub = to_fix[i:i + BATCH_SIZE]
        # On groupe par valeur de labels (souvent identiques) pour batches efficaces
        groups: dict[str, list[str]] = {}
        for r in sub:
            key = json.dumps(r["labels"])
            groups.setdefault(key, []).append(r["isin"])
        for key, isins in groups.items():
            try:
                client.table("investissement_funds") \
                    .update({"labels": json.loads(key), "updated_at": now_ts}) \
                    .in_("isin", isins) \
                    .execute()
                ok += len(isins)
            except Exception as e:
                fail += len(isins)
                print(f"    Erreur batch normalisation : {e}")

    print(f"    → {ok} normalisés, {fail} erreurs")
    return ok


# ─── Passe 2 : Enrichissement sémantique ──────────────────────────────────────

def run_enrichissement(client, apply: bool) -> tuple[int, Counter]:
    """
    Charge les fonds cibles, applique les règles sémantiques, met à jour.
    Retourne (nb_enrichis, distribution_labels_ajoutés).
    """
    print("\n  [Passe 2] Enrichissement sémantique depuis SFDR + nom")

    # Cible : labels vides OU sfdr 8/9
    all_funds: list[dict] = []
    offset = 0
    fields = "isin,name,sfdr_article,labels"

    while True:
        # Récupérer labels=[] en premier
        batch_empty = (
            client.table("investissement_funds")
            .select(fields)
            .eq("labels", "[]")
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        # Récupérer sfdr 8/9 en second (peut avoir labels non vides)
        batch_sfdr = (
            client.table("investissement_funds")
            .select(fields)
            .in_("sfdr_article", [8, 9])
            .range(offset, offset + 999)
            .execute()
            .data or []
        )
        # Fusionner sans doublons
        seen = {r["isin"] for r in all_funds}
        for r in batch_empty + batch_sfdr:
            if r["isin"] not in seen:
                all_funds.append(r)
                seen.add(r["isin"])

        # Continuer si l'un des deux batches est plein (pagination nécessaire)
        if len(batch_empty) < 1000 and len(batch_sfdr) < 1000:
            break
        offset += 1000

    print(f"    {len(all_funds)} fonds en cible (labels=[] OU sfdr 8/9)")

    to_update: list[dict] = []
    label_added_dist: Counter = Counter()

    for f in all_funds:
        current = list(f.get("labels") or [])
        new_labels = enrich_labels_for_fund(current, f.get("sfdr_article"), f.get("name") or "")

        added = set(new_labels) - set(current)
        if added:
            to_update.append({"isin": f["isin"], "labels": new_labels})
            for lbl in added:
                label_added_dist[lbl] += 1

    print(f"    {len(to_update)} fonds avec au moins un label à ajouter")
    if label_added_dist:
        print("    Labels ajoutés :")
        for lbl, n in label_added_dist.most_common():
            print(f"      {n:5d}  {lbl}")

    if not apply or not to_update:
        return len(to_update), label_added_dist

    # Grouper par ensemble de labels pour batches efficaces
    groups: dict[str, list[str]] = {}
    for r in to_update:
        key = json.dumps(r["labels"])
        groups.setdefault(key, []).append(r["isin"])

    now_ts = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for key, isins in groups.items():
        labels_list = json.loads(key)
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
                print(f"    Erreur batch enrichissement : {e}")

    print(f"    → {ok} fonds enrichis, {fail} erreurs")
    return ok, label_added_dist


# ─── Main ──────────────────────────────────────────────────────────────────────

def run(apply: bool) -> None:
    print("=" * 68)
    print("  Enrich Labels — normalisation + enrichissement sémantique")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN (ajouter --apply pour persister)'}")

    started = datetime.now(timezone.utc)
    client = get_client()

    n_normalized = run_normalisation(client, apply)
    n_enriched, dist = run_enrichissement(client, apply)

    total = n_normalized + n_enriched
    print("\n" + "=" * 68)
    print(f"  Résumé : {n_normalized} labels normalisés, {n_enriched} fonds enrichis")
    print("=" * 68)

    if apply:
        status = "success" if total > 0 else "noop"
        log_run("enrich-labels", status, total, 0, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Normalise les labels existants et enrichit depuis SFDR + nom"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base (défaut : dry-run)")
    args = parser.parse_args()
    run(apply=args.apply)
