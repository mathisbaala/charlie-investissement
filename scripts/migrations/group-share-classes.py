#!/usr/bin/env python3
"""
group-share-classes.py — Peupler share_class_group_id pour toutes les variantes d'un même fonds
================================================================================================
Un même fonds (ex: Carmignac Patrimoine) existe en 10+ variantes dans la base :
part A, B, C, I, R, W, FH hedgée, distribution (D), accumulation (Acc), etc.
Sans regroupement, le screener affiche 10 lignes identiques pour le même fonds.

Algorithme :
  1. Normaliser le nom → retirer suffixes de parts (lettre, devise, acc/dis, hedged…)
  2. group_key = nom_normalisé + "|" + gestionnaire
  3. Groupes de taille ≥ 2 → share_class_group_id = min(isins du groupe)
  4. Fonds singletons → share_class_group_id inchangé

Types couverts : opcvm, etf, sicav, action (ADR/duplicats), crypto (ETP multi-devises)
Types exclus  : fps, fpci, fcpr, fonds_euros, scpi, opci, livret, obligation
  (ces types n'ont pas de classes de parts multiples au sens strict)

Usage :
    python3 scripts/migrations/group-share-classes.py          # dry-run
    python3 scripts/migrations/group-share-classes.py --apply  # écriture en base
    python3 scripts/migrations/group-share-classes.py --apply --overwrite  # réassigner même si déjà groupé
"""

import sys
import re
import argparse
import unicodedata
from collections import defaultdict, Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run


# ─── Constantes ───────────────────────────────────────────────────────────────

# Types de fonds pour lesquels on cherche des classes de parts
ELIGIBLE_TYPES = {"opcvm", "etf", "sicav", "action", "crypto"}

# Longueur minimale du nom normalisé pour éviter les faux positifs
MIN_NAME_LEN = 6

# Taille max d'un batch d'UPDATE Supabase
BATCH_SIZE = 400


# ─── Patterns de normalisation ────────────────────────────────────────────────
#
# L'ordre est important : on applique chaque regex successivement.
# On supprime les suffixes de DROITE vers la GAUCHE (mode boucle).
# Chaque regex matche quelque chose à supprimer en fin ou milieu de chaîne.

# Phase 1 — Suffixes composés (hedged currencies, combos acc/dis)
_PHASE1 = [
    # "EUR Acc", "USD Dis", "CHF H Acc", "EURH Acc", "AUD Hdis" etc.
    r"\b(eur|usd|gbp|chf|jpy|hkd|cad|aud|sek|nok|dkk|pln|czk|sgd|try|zar|inr)\s*(h|hedged)?\s*(acc(umulating|umulation)?|cap(italisation|italizing)?|dis(t|tribution|tributing)?|inc(ome)?|d|c)\s*$",
    # "EUR Hedged", "USD Hedged"
    r"\b(eur|usd|gbp|chf|jpy|hkd|cad|aud|sek|nok)\s+hedged\s*$",
    # "(EUR Acc)", "(USD H)", etc.
    r"\((eur|usd|gbp|chf|jpy|hkd|cad|aud|sek|nok)(\s+h|\s+hedged)?\s*(acc|dis|dist|cap|inc|d|c)?\)\s*$",
]

# Phase 2 — Politique distribution/capitalisation seule
_PHASE2 = [
    r"\s+(accumulating|accumulation|capitalisation|capitalizing|capitalising)\s*$",
    r"\s+(distributing|distribution)\s*$",
    r"\b(acc|cap|dis|dist|inc|h\s*acc|h\s*dis|hacc|hdis)\s*$",
]

# Phase 3 — Classe "Part X", "Classe A", "Tranche I", "Class USD" etc.
_PHASE3 = [
    r"\s+(part(s)?|classe|class|tranche|share\s+class)\s+[a-z0-9][a-z0-9\s\-]*$",
    r"\s+(part(s)?|classe|class|tranche)\s*$",
]

# Phase 4 — Devise seule en fin de nom
_PHASE4 = [
    r"\s+(eur|usd|gbp|chf|jpy|hkd|cad|aud|sek|nok|dkk|pln|czk|sgd)\s*$",
]

# Phase 5 — Lettre(s) de classe seule(s) en fin de nom
# Pattern strict : 1-3 lettres majuscules (dans le nom normalisé lowercase = 1-3 lettres)
# On n'enlève QUE si c'est isolé (précédé d'un espace ou tiret)
_PHASE5 = [
    # "institutional", "retail", "premium", "wholesale"
    r"\s+(institutional|retail|premium|wholesale|privé|prive)\s*$",
    # Classe lettre isolée : A, B, C, D, E, F, G, I, J, N, P, Q, R, S, T, U, W, X, Y, Z
    # On exclut M (souvent partie du nom), H seul (parfois abréviation hedged mais aussi dans noms)
    r"\s+([abcdefgijknpqrstuwxyz]{1,2})\s*$",
]

# Phase 6 — Suffixes ETF / UCITS
_PHASE6 = [
    r"\s+ucits\s+etf\b.*$",
    r"\s+etf\b\s*$",
    r"\s+ucits\s*$",
    r"\s+\(acc\)\s*$",
    r"\s+\(dist\)\s*$",
    r"\s+\(d\)\s*$",
    r"\s+\(c\)\s*$",
]

# Phase 7 — Suffixes spéciaux français
_PHASE7 = [
    r"\s+(fh|fh\s*eur|fh\s*usd)\s*$",   # FH = hedgé en EUR
    r"\s+h\s*$",                          # trailing H seul = hedged
    r"\s+(eur|usd|gbp)\s+h\s*$",
    r"\s+\*+\s*$",                        # étoiles trailing (noms privés)
    r"\s*\([^)]*\)\s*$",                  # parenthèse finale quelconque
]

# Compile toutes les phases dans l'ordre
_ALL_PATTERNS: list[re.Pattern] = []
for phase in [_PHASE1, _PHASE2, _PHASE3, _PHASE4, _PHASE5, _PHASE6, _PHASE7]:
    for p in phase:
        _ALL_PATTERNS.append(re.compile(p, re.IGNORECASE))

# Patterns d'exclusion : certains noms ne doivent pas être regroupés
_EXCLUDE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"fonds\s*dedie",
        r"\*{2,}",                           # noms génériques étoiles
        r"^(fonds|opcvm|sicav|compartiment)$",
        r"autocall",
        r"triple\s+horizon",
        r"france\s+valley",
        # Noms trop génériques pour être regroupés de façon fiable
        r"^actif\s+general",
        r"^rendement\s*\d*$",
        r"^opportunites?\s*\d*$",
    ]
]

# Exclure les noms millésimés (contenant une année 2000-2099 ou un mois)
_YEAR_RE   = re.compile(r"\b(20[0-9]{2})\b")
_MONTH_RE  = re.compile(
    r"\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre"
    r"|janv|fevr|sept|oct|nov|dec)\b",
    re.IGNORECASE,
)
# Exclure si termine par chiffre romain fort (millésime FCPI/FCPR)
_ROMAN_END = re.compile(r"\b(II|III|IV|VI|VII|VIII|IX|XI|XII|XIII)\s*$", re.IGNORECASE)


# ─── Fonctions de normalisation ───────────────────────────────────────────────

def _strip_accents(text: str) -> str:
    """Supprime les accents sans toucher aux autres caractères."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def normalize_name(raw: str) -> str:
    """
    Normalise un nom de fonds pour regroupement :
    1. Strip accents, lowercase
    2. Applique les patterns de suppression de suffixes (boucle jusqu'à stabilité)
    3. Normalise les espaces, supprime caractères non alphanum
    """
    if not raw:
        return ""

    # Accents → ASCII, lowercase
    n = _strip_accents(raw).lower().strip()

    # Appliquer les patterns en boucle jusqu'à stabilité (max 10 passes)
    for _ in range(10):
        prev = n
        for pat in _ALL_PATTERNS:
            n = pat.sub("", n).strip()
        if n == prev:
            break

    # Normaliser espaces et ponctuation résiduelle
    n = re.sub(r"[-_/\\|]+", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    # Supprimer caractères non-alphanumériques-espace
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()

    return n


def slugify(text: str) -> str:
    """Slugifie pour former une clé : minuscules, tirets à la place des espaces."""
    return re.sub(r"\s+", "-", text.strip().lower())


def make_group_key(name_norm: str, mgmt: str) -> str:
    """Construit la clé de groupe : nom_normalisé|gestionnaire."""
    return slugify(name_norm) + "|" + slugify(mgmt or "_inconnu_")


def is_excluded(raw_name: str, name_norm: str) -> bool:
    """Retourne True si ce fonds doit être exclu du regroupement."""
    if any(p.search(name_norm) for p in _EXCLUDE_PATTERNS):
        return True
    if _YEAR_RE.search(raw_name):
        return True
    if _MONTH_RE.search(raw_name):
        return True
    if _ROMAN_END.search(raw_name.strip()):
        return True
    return False


# ─── Chargement ───────────────────────────────────────────────────────────────

def load_all_funds(client) -> list[dict]:
    """Charge tous les fonds des types éligibles, type par type pour éviter les timeouts."""
    funds: list[dict] = []

    for ptype in sorted(ELIGIBLE_TYPES):
        count_before = len(funds)
        offset = 0
        while True:
            batch = (
                client.table("investissement_funds")
                .select("isin, name, management_company_normalized, management_company, share_class_group_id, product_type")
                .eq("product_type", ptype)
                .not_.is_("name", "null")
                .range(offset, offset + 999)
                .execute()
                .data or []
            )
            funds.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        loaded = len(funds) - count_before
        print(f"    {ptype:<12} : {loaded:>6,} fonds", flush=True)

    # Dédupliquer par ISIN (la pagination SDK peut produire des doublons en bordure de page)
    seen_isins: set[str] = set()
    deduped: list[dict] = []
    for f in funds:
        isin = f.get("isin")
        if isin and isin not in seen_isins:
            seen_isins.add(isin)
            deduped.append(f)
    if len(deduped) < len(funds):
        print(f"    (dédoublonnage : {len(funds) - len(deduped)} doublons supprimés)", flush=True)
    return deduped


# ─── Logique principale ───────────────────────────────────────────────────────

def build_groups(funds: list[dict]) -> dict[str, list[dict]]:
    """
    Groupe les fonds par (nom_normalisé, gestionnaire).
    Retourne dict group_key → liste de fonds (seulement groupes ≥ 2).
    """
    buckets: dict[str, list[dict]] = defaultdict(list)

    for f in funds:
        raw  = f.get("name") or ""
        norm = normalize_name(raw)

        # Rejeter les noms trop courts ou exclus
        if not norm or len(norm) < MIN_NAME_LEN:
            continue
        if is_excluded(raw, norm):
            continue

        mgmt = (
            f.get("management_company_normalized")
            or f.get("management_company")
        )
        # Sans gestionnaire connu, le regroupement par nom seul est trop risqué
        # (ex : fonds UC Suravenir, noms génériques multi-assureurs)
        if not mgmt:
            continue

        key = make_group_key(norm, mgmt)
        f["_norm"] = norm   # garder pour debug
        f["_key"]  = key
        buckets[key].append(f)

    # Ne garder que les vrais groupes (≥ 2 membres)
    return {k: v for k, v in buckets.items() if len(v) >= 2}


def assign_group_ids(groups: dict[str, list[dict]]) -> list[dict]:
    """
    Pour chaque groupe, calcule le share_class_group_id = min(isins).
    Retourne la liste des mises à jour à effectuer : [{isin, share_class_group_id}].
    """
    updates: list[dict] = []

    for key, members in groups.items():
        isins = [f["isin"] for f in members]
        # min ISIN alphanumérique = part "principale" (souvent la plus ancienne / part A)
        group_id = min(isins)

        for f in members:
            if f.get("share_class_group_id") != group_id:
                updates.append({
                    "isin":               f["isin"],
                    "share_class_group_id": group_id,
                })

    return updates


# ─── Application en base ──────────────────────────────────────────────────────

def apply_updates(client, updates: list[dict]) -> tuple[int, int]:
    """
    Applique les UPDATE en batches de BATCH_SIZE.
    Retourne (ok, fail).
    """
    # Regrouper par group_id pour réduire le nombre de requêtes
    by_group: dict[str, list[str]] = defaultdict(list)
    for u in updates:
        by_group[u["share_class_group_id"]].append(u["isin"])

    ok = fail = 0
    now_ts = datetime.now(timezone.utc).isoformat()
    processed_groups = 0

    for group_id, isins in by_group.items():
        for i in range(0, len(isins), BATCH_SIZE):
            sub = isins[i : i + BATCH_SIZE]
            try:
                client.table("investissement_funds") \
                    .update({"share_class_group_id": group_id, "updated_at": now_ts}) \
                    .in_("isin", sub) \
                    .execute()
                ok += len(sub)
            except Exception as e:
                fail += len(sub)
                print(f"  ERREUR [{group_id}]: {e}", flush=True)

        processed_groups += 1
        if processed_groups % 500 == 0:
            pct = 100 * processed_groups / len(by_group)
            print(f"  [{processed_groups:>5}/{len(by_group)}] {pct:.0f}%  ok={ok} fail={fail}", flush=True)

    return ok, fail


# ─── Rapport ──────────────────────────────────────────────────────────────────

def print_report(groups: dict[str, list[dict]], updates: list[dict]) -> None:
    """Affiche le rapport de regroupement."""
    sizes = Counter(len(v) for v in groups.values())
    total_grouped = sum(len(v) for v in groups.values())

    print(f"\n  Groupes distincts trouvés    : {len(groups):>7,}")
    print(f"  Fonds dans des groupes       : {total_grouped:>7,}")
    if groups:
        avg = total_grouped / len(groups)
        print(f"  Taille moyenne des groupes   : {avg:>10.2f}")
    print(f"  Mises à jour nécessaires     : {len(updates):>7,}")

    print(f"\n  Distribution taille de groupe :")
    for sz, nb in sorted(sizes.items()):
        bar = "#" * min(nb, 60)
        print(f"    {sz:>3} parts : {nb:>5,} groupes  {bar}")

    # Top 10 groupes
    top = sorted(groups.items(), key=lambda kv: -len(kv[1]))[:10]
    print(f"\n  Top 10 groupes (taille + exemple) :")
    for rank, (key, members) in enumerate(top, 1):
        group_id = min(f["isin"] for f in members)
        # Nom le plus court comme exemple du nom commun
        example = min(members, key=lambda f: len(f.get("name") or ""))
        norm_example = members[0].get("_norm", "")
        print(f"\n  #{rank:>2}  group_id={group_id}  ({len(members)} parts)")
        print(f"       Nom normalisé : {norm_example[:60]}")
        print(f"       Gestionnaire  : {example.get('management_company_normalized') or example.get('management_company') or '?'}")
        print(f"       Exemples membres :")
        for m in sorted(members, key=lambda f: f["isin"])[:5]:
            print(f"         {m['isin']:14}  {(m.get('name') or '')[:60]}")
        if len(members) > 5:
            print(f"         ... +{len(members) - 5} autres")

    # Quelques exemples de mapping nom brut → nom normalisé
    print(f"\n  Exemples de normalisation de noms :")
    seen: set[str] = set()
    count = 0
    for _, members in top[:4]:
        for m in sorted(members, key=lambda f: f["isin"])[:3]:
            raw  = m.get("name") or ""
            norm = m.get("_norm", normalize_name(raw))
            if raw not in seen:
                print(f"    {raw[:55]:<55}  →  {norm[:40]}")
                seen.add(raw)
                count += 1
            if count >= 20:
                break
        if count >= 20:
            break


# ─── Entrée principale ────────────────────────────────────────────────────────

def run(apply: bool, overwrite: bool) -> None:
    print("=" * 72)
    print("  Group Share Classes — peupler share_class_group_id")
    print("=" * 72)
    print(f"  Mode      : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Overwrite : {'OUI (réassigne même si déjà groupé)' if overwrite else 'NON (ignore les groupes existants)'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    # 1. Charger
    print("  Chargement des fonds éligibles...", flush=True)
    funds = load_all_funds(client)
    print(f"  {len(funds):,} fonds chargés (types : {', '.join(sorted(ELIGIBLE_TYPES))})")

    # Si pas overwrite, on traite uniquement les fonds non groupés
    if not overwrite:
        funds_to_process = [f for f in funds if not f.get("share_class_group_id")]
        already_grouped  = len(funds) - len(funds_to_process)
        print(f"  {already_grouped:,} fonds déjà groupés (ignorés)")
        print(f"  {len(funds_to_process):,} fonds à traiter")
    else:
        funds_to_process = funds
        print(f"  Mode overwrite : tous les fonds retraités")

    if not funds_to_process:
        print("\n  Rien à faire.")
        return

    # 2. Construire les groupes
    print(f"\n  Construction des groupes...", flush=True)
    groups = build_groups(funds_to_process)

    # 3. Calculer les mises à jour
    updates = assign_group_ids(groups)

    # 4. Rapport
    print_report(groups, updates)

    if not apply:
        print(f"\n  [DRY-RUN] Ajouter --apply pour persister en base.")
        return

    if not updates:
        print(f"\n  Aucune mise à jour nécessaire.")
        return

    # 5. Application
    print(f"\n  Application en base ({len(updates):,} fonds)...", flush=True)
    ok, fail = apply_updates(client, updates)

    print(f"\n  ✓ {ok:,} fonds mis à jour")
    if fail:
        print(f"  ✗ {fail:,} erreurs")

    status = "success" if fail == 0 else "partial"
    log_run(
        scraper="group-share-classes",
        status=status,
        records_processed=ok,
        records_failed=fail,
        started_at=started,
    )

    print(f"\n  Résumé final :")
    print(f"    Groupes créés/mis à jour : {len(groups):,}")
    print(f"    Fonds groupés            : {sum(len(v) for v in groups.values()):,}")
    print(f"    Updates persistés        : {ok:,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Peuple share_class_group_id en regroupant les variantes d'un même fonds "
            "(parts A/B/C/I/R, acc/dis, EUR/USD/hedged…)."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Écrire les mises à jour en base (sans ce flag : dry-run uniquement)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Réassigner même les fonds déjà groupés (recalcul complet)",
    )
    args = parser.parse_args()
    run(apply=args.apply, overwrite=args.overwrite)
