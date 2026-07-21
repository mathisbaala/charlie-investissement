#!/usr/bin/env python3
"""
esg-exclusions-enricher.py — Exclusions sectorielles ESG depuis les fichiers EET
=================================================================================
Alimente investissement_funds.esg_exclusions (jsonb {clé: bool}) depuis les
European ESG Templates (EET, FinDatEx) publiés par les sociétés de gestion :
champs d'exclusions PAB/CTB (tabac, armes controversées, charbon/fossiles) et
politiques d'exclusion volontaires (jeux, alcool, nucléaire…).

Pourquoi un parseur de FICHIERS plutôt qu'un crawler : l'EET n'a pas de point de
diffusion central public — chaque SGP publie son fichier (page « informations
durabilité » SFDR, doc center, ou plateformes type fundinfo). On récupère les
fichiers (CSV/XLSX) à la main ou par script dédié, puis ce script les ingère de
façon uniforme. Les en-têtes EET varient selon la version du template
(V1.0/V1.1.x : `20010_Financial_Instrument_Identifying_Data`, etc.) → détection
par MOTIFS sur les noms de colonnes plutôt que par liste figée.

Clés canoniques écrites (cf. COMMENT SQL de la colonne) :
    tobacco, controversial_weapons, weapons, thermal_coal, fossil, nuclear,
    gambling, alcohol, adult_entertainment, ungc_violations

Sémantique : clé présente = politique documentée (true = le fonds exclut le
secteur, false = il ne l'exclut pas) ; clé absente = inconnu. Le moteur
d'allocation replie sur le proxy « labels » quand la clé est absente.

Fill-only : n'écrit que les fonds DÉJÀ en base (update_funds_bulk, jamais
d'insert) et, par défaut, seulement ceux SANS esg_exclusions (--overwrite pour
rafraîchir, ex. nouvelle période EET).

Usage :
    python3 scripts/scrapers/esg-exclusions-enricher.py --eet amundi-eet.csv            # dry-run
    python3 scripts/scrapers/esg-exclusions-enricher.py --dir data/eet/ --apply
    python3 scripts/scrapers/esg-exclusions-enricher.py --eet f.xlsx --source amundi \\
        --as-of 2026-06-30 --apply --overwrite
"""

import re
import csv
import sys
import json
import argparse
from datetime import datetime, timezone, date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, update_funds_bulk, log_run

# ─── Détection des colonnes EET ───────────────────────────────────────────────

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

# Une colonne est candidate « exclusion » si son en-tête évoque une politique
# d'exclusion/de filtrage (les champs EET PAB/CTB et les politiques volontaires
# contiennent l'un de ces marqueurs), pour ne pas confondre avec les colonnes
# d'EXPOSITION (% d'implication) ou de simple description.
POLICY_MARKER = re.compile(r"exclu|policy|polic|screen|\bpab\b|\bctb\b|_pab_|_ctb_", re.IGNORECASE)

# Motif d'en-tête → clé canonique. L'ordre compte (controversial weapons avant
# weapons génériques).
SECTOR_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"controversial[\s_]*weapon", re.I), "controversial_weapons"),
    (re.compile(r"weapon|armament|defen[cs]e", re.I), "weapons"),
    (re.compile(r"tobacco", re.I),                    "tobacco"),
    (re.compile(r"thermal[\s_]*coal|coal", re.I),     "thermal_coal"),
    (re.compile(r"fossil", re.I),                     "fossil"),
    (re.compile(r"nuclear", re.I),                    "nuclear"),
    (re.compile(r"gambling", re.I),                   "gambling"),
    (re.compile(r"alcohol", re.I),                    "alcohol"),
    (re.compile(r"adult|pornograph", re.I),           "adult_entertainment"),
    (re.compile(r"global[\s_]*compact|ungc|norms?[\s_]*based", re.I), "ungc_violations"),
]

TRUE_VALUES  = {"y", "yes", "true", "1", "oui"}
FALSE_VALUES = {"n", "no", "false", "0", "non"}


def parse_bool(raw) -> bool | None:
    """Y/N/True/False/1/0/Oui/Non → bool ; tout le reste (vide, %, texte) → None."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if s in TRUE_VALUES:
        return True
    if s in FALSE_VALUES:
        return False
    return None


def map_headers(headers: list[str]) -> tuple[int | None, dict[int, str]]:
    """
    Repère la colonne ISIN et les colonnes d'exclusion.
    Retourne (index_isin, {index_colonne: clé canonique}).
    """
    isin_idx: int | None = None
    sector_cols: dict[int, str] = {}
    for i, h in enumerate(headers):
        name = (h or "").strip()
        if not name:
            continue
        if isin_idx is None and re.search(r"\bisin\b|identifying[\s_]*data|instrument[\s_]*identif", name, re.I):
            isin_idx = i
            continue
        if not POLICY_MARKER.search(name):
            continue
        for pat, key in SECTOR_PATTERNS:
            if pat.search(name):
                sector_cols[i] = key
                break
    return isin_idx, sector_cols


# ─── Lecture des fichiers (CSV / XLSX) ────────────────────────────────────────

def read_rows(path: Path) -> list[list]:
    """Fichier EET → liste de lignes (la première contenant les en-têtes)."""
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise SystemExit("openpyxl requis pour les .xlsx — pip install openpyxl")
        wb = load_workbook(path, read_only=True, data_only=True)
        ws = wb.active
        return [list(r) for r in ws.iter_rows(values_only=True)]

    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    sample = raw[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
    except csv.Error:
        # EET : le point-virgule est le séparateur le plus répandu.
        class dialect:  # type: ignore[no-redef]
            delimiter = ";"
            quotechar = '"'
            lineterminator = "\n"
            quoting = csv.QUOTE_MINIMAL
            doublequote = True
            skipinitialspace = False
    return [row for row in csv.reader(raw.splitlines(), dialect=dialect)]


def find_isin_by_values(rows: list[list]) -> int | None:
    """Repli : colonne dont les valeurs RESSEMBLENT à des ISIN (en-tête atypique)."""
    if len(rows) < 2:
        return None
    width = max(len(r) for r in rows[1:21])
    for i in range(width):
        vals = [str(r[i]).strip().upper() for r in rows[1:21] if i < len(r) and r[i]]
        if vals and sum(1 for v in vals if ISIN_RE.match(v)) >= max(2, len(vals) // 2):
            return i
    return None


def parse_eet_file(path: Path) -> tuple[dict[str, dict[str, bool]], dict[str, str]]:
    """
    Parse un fichier EET → ({isin: {clé: bool}}, {clé: en-tête source}).
    Plusieurs colonnes pour une même clé : OR (une politique documentée suffit) ;
    seules les valeurs booléennes explicites sont retenues (les seuils en % et
    les champs descriptifs sont ignorés).
    """
    rows = read_rows(path)
    if not rows:
        return {}, {}
    headers = [str(h) if h is not None else "" for h in rows[0]]
    isin_idx, sector_cols = map_headers(headers)
    if isin_idx is None:
        isin_idx = find_isin_by_values(rows)
    if isin_idx is None or not sector_cols:
        return {}, {}

    mapping_info = {key: headers[i] for i, key in sector_cols.items()}
    out: dict[str, dict[str, bool]] = {}
    for row in rows[1:]:
        if isin_idx >= len(row):
            continue
        isin = str(row[isin_idx] or "").strip().upper()
        if not ISIN_RE.match(isin):
            continue
        excl = out.setdefault(isin, {})
        for i, key in sector_cols.items():
            val = parse_bool(row[i]) if i < len(row) else None
            if val is None:
                continue
            # OR entre colonnes d'une même clé (PAB + politique volontaire, etc.)
            excl[key] = excl.get(key, False) or val
        if not excl:
            out.pop(isin, None)
    return out, mapping_info


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(files: list[Path], apply: bool, overwrite: bool, limit: int | None,
        source: str | None, as_of: str | None):
    print("=" * 64)
    print("  ESG Exclusions Enricher — ingestion EET (FinDatEx)")
    print("=" * 64)
    print(f"  Mode      : {'APPLY' if apply else 'DRY-RUN'}{' + OVERWRITE' if overwrite else ''}")
    print(f"  Fichiers  : {len(files)}")
    print()

    started = datetime.now(timezone.utc)
    as_of_date = as_of or date.today().isoformat()

    merged: dict[str, dict[str, bool]] = {}
    sources: dict[str, str] = {}
    for path in files:
        data, mapping = parse_eet_file(path)
        label = f"eet:{source or path.stem}:{as_of_date}"
        print(f"  {path.name} : {len(data)} ISIN")
        if not data:
            print("    ⚠️  aucune colonne ISIN/exclusion reconnue — en-têtes inattendus ?")
            continue
        for key, header in sorted(mapping.items()):
            print(f"    {key:<22} ← {header}")
        for isin, excl in data.items():
            merged.setdefault(isin, {}).update(excl)
            sources[isin] = label

    if not merged:
        print("\n  ⚠️  Aucune exclusion extraite")
        return
    if limit:
        merged = dict(list(merged.items())[:limit])

    # Statistiques par clé
    counts: dict[str, int] = {}
    for excl in merged.values():
        for k, v in excl.items():
            if v:
                counts[k] = counts.get(k, 0) + 1
    print(f"\n  {len(merged)} ISIN au total — exclusions positives par clé :")
    for k, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {k:<22} {n}")

    # Filtrage : ISINs déjà en base, et (sauf --overwrite) sans donnée existante.
    client = get_client()
    isins = list(merged.keys())
    existing: set[str] = set()
    already: set[str] = set()
    has_column = True
    for i in range(0, len(isins), 500):
        chunk = isins[i : i + 500]
        cols = "isin, esg_exclusions" if has_column else "isin"
        try:
            r = client.table("investissement_funds").select(cols).in_("isin", chunk).execute()
        except Exception as e:
            # Migration 20260721140000 pas encore appliquée : on peut dry-runner,
            # mais pas écrire.
            if has_column and "esg_exclusions" in str(e):
                has_column = False
                print("  ⚠️  Colonne esg_exclusions absente en base — appliquer la migration 20260721140000 avant --apply.")
                r = client.table("investissement_funds").select("isin").in_("isin", chunk).execute()
            else:
                raise
        for row in (r.data or []):
            existing.add(row["isin"])
            if row.get("esg_exclusions") is not None:
                already.add(row["isin"])

    batch = [
        {
            "isin": isin,
            "esg_exclusions": merged[isin],
            "esg_exclusions_source": sources[isin],
            "esg_exclusions_updated_at": as_of_date,
        }
        for isin in merged
        if isin in existing and (overwrite or isin not in already)
    ]
    print(f"\n  En base : {len(existing)}/{len(merged)} — "
          f"déjà renseignés : {len(already)}"
          f"{' (écrasés)' if overwrite else ' (conservés, --overwrite pour rafraîchir)'}")
    print(f"  À écrire : {len(batch)}")

    if not apply:
        print("\n  Aperçu (10 premiers) :")
        for row in batch[:10]:
            print(f"  {row['isin']} → {json.dumps(row['esg_exclusions'], sort_keys=True)}")
        print("\n  DRY-RUN — relancer avec --apply pour écrire.")
        return

    if not has_column:
        print("\n  ✗ ABANDON : la colonne esg_exclusions n'existe pas encore en base.")
        return

    ok, fail = update_funds_bulk(batch, batch_size=200)
    print(f"  → Update {len(batch)} fonds : {ok} OK, {fail} échec")
    log_run("esg-exclusions-enricher", "success" if fail == 0 else "partial",
            ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Exclusions ESG depuis fichiers EET")
    parser.add_argument("--eet", action="append", default=[], help="Fichier EET (CSV/XLSX), répétable")
    parser.add_argument("--dir", type=str, help="Dossier de fichiers EET (*.csv, *.xlsx)")
    parser.add_argument("--apply", action="store_true", help="Écrire dans Supabase")
    parser.add_argument("--overwrite", action="store_true", help="Écraser les esg_exclusions existants")
    parser.add_argument("--limit", type=int, help="Limiter à N fonds")
    parser.add_argument("--source", type=str, help="Étiquette SGP pour esg_exclusions_source (défaut : nom de fichier)")
    parser.add_argument("--as-of", type=str, help="Date de référence YYYY-MM-DD (défaut : aujourd'hui)")
    args = parser.parse_args()

    paths = [Path(p) for p in args.eet]
    if args.dir:
        paths += sorted(Path(args.dir).glob("*.csv")) + sorted(Path(args.dir).glob("*.xlsx"))
    paths = [p for p in paths if p.exists()]
    if not paths:
        raise SystemExit("Aucun fichier EET — passer --eet <fichier> ou --dir <dossier>")
    run(paths, apply=args.apply, overwrite=args.overwrite, limit=args.limit,
        source=args.source, as_of=args.as_of)
