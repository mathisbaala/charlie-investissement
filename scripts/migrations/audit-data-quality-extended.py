#!/usr/bin/env python3
"""
audit-data-quality-extended.py — Audit avancé v2 de investissement_funds
==========================================================================
Étend `audit-data-quality.py` avec 6 checks supplémentaires :

  E1. perf_suspect            — |perf| > 200% sur 1y (probable bug ; cap 999% sain)
  E2. perf_decimal_fine       — valeurs dans (-1, 1) hors zéro qui ressemblent à
                                des fractions oubliées (vérification croisée)
  E3. sri_vs_vol_drift        — SRI stocké vs SRI ESMA implicite (vol_3y) ;
                                liste les outliers > 2 niveaux d'écart
  E4. ter_aberrants           — TER < 0 OU TER > 10% (sauf product_type='scpi'
                                où plausible jusqu'à 12%)
  E5. stale_data              — fonds avec updated_at > 6 mois SANS kid_parsed_at
                                plus récent que la dernière maj (donnée morte)
  E6. source_coverage_matrix  — couverture data_source × product_type
                                (combien de fonds par croisement)
  E7. potential_duplicates    — fonds avec même `name` mais ISIN différents
                                (probablement des parts différentes du même fonds)

Tous les checks utilisent les conventions définies dans docs/data-standards.md :
  - perfs/volatilités en pourcentage (12.5 = 12.5%)
  - ter en fraction (0.012 = 1.2%)
  - SRI/SRRI ∈ [1, 7]

Mode lecture seule. Aucune correction n'est appliquée. Le rapport est imprimé
sur la console avec des sections lisibles + optionnellement écrit en JSON.

Usage :
    python3 scripts/migrations/audit-data-quality-extended.py
    python3 scripts/migrations/audit-data-quality-extended.py --json /tmp/audit-ext.json
    python3 scripts/migrations/audit-data-quality-extended.py --type opcvm,etf
    python3 scripts/migrations/audit-data-quality-extended.py --no-base  # uniquement les checks étendus
"""

import sys
import json
import argparse
from datetime import datetime, date, timezone, timedelta
from pathlib import Path
from collections import Counter, defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

# On réutilise le moteur de l'audit existant
import importlib.util

_BASE_AUDIT_PATH = Path(__file__).parent / "audit-data-quality.py"
_spec = importlib.util.spec_from_file_location("audit_base", _BASE_AUDIT_PATH)
audit_base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit_base)


# ─── Champs récupérés (incluant les colonnes utilisées par les checks étendus)

EXTENDED_FIELDS = (
    "isin,name,product_type,asset_class,currency,data_source,"
    "ter,ongoing_charges,sri,srri,"
    "performance_1y,performance_3y,performance_5y,average_performance,"
    "volatility_1y,volatility_3y,max_drawdown_1y,max_drawdown_3y,"
    "sharpe_1y,sharpe_3y,aum_eur,"
    "inception_date,track_record_years,kid_url,kid_parsed_at,"
    "management_company,updated_at,created_at"
)


def fetch_all_extended(client, types_filter: list[str] | None) -> list[dict]:
    funds: list[dict] = []
    offset = 0
    page = 1000
    while True:
        q = client.table("investissement_funds").select(EXTENDED_FIELDS)
        if types_filter:
            q = q.in_("product_type", types_filter)
        batch = q.range(offset, offset + page - 1).execute().data or []
        funds.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return funds


def _f(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _parse_iso(v):
    if not v:
        return None
    try:
        # Supabase renvoie en ISO 8601 avec timezone, on tronque les microsecondes
        s = str(v).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(str(v)[:19])
        except Exception:
            return None


# ─── Mapping ESMA SRI/SRRI <-> volatilité annualisée (en %) ───────────────────
# Source : ESMA/CESR guidelines on KID risk classes. Ce mapping est utilisé par
# `derive-srri-from-volatility.py` pour les fonds sans SRRI stocké. On le
# réimplémente ici à des fins de cohérence (vérification SRI vs vol_3y).

def vol_to_sri_bucket(vol_pct: float) -> int:
    """Volatilité annualisée en % → bucket SRI/SRRI ESMA (1-7)."""
    if vol_pct < 0.5:
        return 1
    if vol_pct < 2.0:
        return 2
    if vol_pct < 5.0:
        return 3
    if vol_pct < 10.0:
        return 4
    if vol_pct < 15.0:
        return 5
    if vol_pct < 25.0:
        return 6
    return 7


# ─── E1. perf_suspect : |perf| > 200% sur 1y ──────────────────────────────────

def check_perf_suspect(funds: list[dict]) -> dict:
    """
    Performances suspectes : |perf_1y| > 200%. Plausible pour cryptos / penny stocks
    mais à vérifier sur opcvm/etf (un OPCVM à +300% sur 1 an est presque sûrement un bug).
    """
    hits = []
    for f in funds:
        for field in ("performance_1y", "performance_3y", "performance_5y"):
            v = _f(f.get(field))
            if v is None:
                continue
            # On garde un seuil 1y strict (200%), 3y/5y plus tolérant (500%) car cumul total
            threshold = 200.0 if field == "performance_1y" else 500.0
            if abs(v) > threshold and abs(v) < 9999.9:  # exclure les valeurs saturées
                hits.append({
                    "isin": f["isin"],
                    "product_type": f.get("product_type"),
                    "field": field,
                    "value": v,
                    "threshold": threshold,
                })
    return {
        "check": "perf_suspect",
        "severity": "medium",
        "description": "Performances |val|>200% sur 1y (ou >500% sur 3y/5y) — probable bug d'unité.",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "by_field": dict(Counter(h["field"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": (
            "Pour les types non-crypto/non-action : auditer manuellement, "
            "vérifier la source ; possible double conversion ×100. "
            "Capper à ±999% si confirmé erreur."
        ),
    }


# ─── E2. perf_decimal_fine : valeurs (-1,1) hors zéro ──────────────────────────

def check_perf_decimal_fine(funds: list[dict]) -> dict:
    """
    Performances dans (-1, 1), ≠0 : probable fraction non convertie (0.05 = 5%
    stocké au lieu de 5.0). Vérifie aussi la cohérence avec volatilité pour
    confirmer le diagnostic.
    """
    hits = []
    for f in funds:
        vol_1y = _f(f.get("volatility_1y"))
        vol_3y = _f(f.get("volatility_3y"))
        # Confiance "fraction" forte si vol est aussi < 1
        vol_in_fraction = (
            (vol_1y is not None and 0 < vol_1y < 1) or
            (vol_3y is not None and 0 < vol_3y < 1)
        )
        vol_in_pct = (
            (vol_1y is not None and vol_1y >= 1) or
            (vol_3y is not None and vol_3y >= 1)
        )

        for field in ("performance_1y", "performance_3y", "performance_5y"):
            v = _f(f.get(field))
            if v is None or v == 0:
                continue
            if abs(v) < 1:
                # Score de confiance : élevé si vol cohérente (en fraction)
                if vol_in_fraction:
                    confidence = "high"
                elif vol_in_pct:
                    # vol en %, mais perf < 1 → possiblement légitime (monétaire à 0.5%)
                    confidence = "low"
                else:
                    confidence = "medium"
                hits.append({
                    "isin": f["isin"],
                    "product_type": f.get("product_type"),
                    "field": field,
                    "value": v,
                    "confidence": confidence,
                })
    by_conf = Counter(h["confidence"] for h in hits)
    return {
        "check": "perf_decimal_fine",
        "severity": "high",
        "description": "Performance (-1,1) hors zéro — probable fraction non convertie en %.",
        "count": len(hits),
        "count_high_confidence": by_conf.get("high", 0),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "by_confidence": dict(by_conf),
        "samples": hits[:10],
        "fix_recommendation": (
            "Cas 'high confidence' : multiplier par 100 (cohérence vol < 1). "
            "Cas 'low confidence' : vol >= 1 → perf<1 légitime (monétaire) — ne pas toucher. "
            "Voir fix-data-quality-batch.py:fix_perf_decimal pour la logique sûre."
        ),
    }


# ─── E3. sri_vs_vol_drift : SRI stocké vs ESMA implicite ──────────────────────

def check_sri_vs_vol_drift(funds: list[dict]) -> dict:
    """
    Pour chaque fonds avec SRI/SRRI et volatility_3y renseignés, comparer le SRI
    stocké au SRI implicite (calculé via les seuils ESMA sur vol_3y).
    Une dérive de ±1 niveau est acceptable (méthodologies SRI/SRRI diffèrent).
    > 2 niveaux d'écart = outlier (probable corruption ou mauvaise unité).
    """
    hits = []
    drift_distribution = Counter()  # |drift| → count
    for f in funds:
        # Préférer SRI (PRIIPs) mais accepter SRRI (UCITS legacy)
        stored = f.get("sri") if f.get("sri") is not None else f.get("srri")
        if stored is None:
            continue
        try:
            stored = int(stored)
            if not (1 <= stored <= 7):
                continue
        except (TypeError, ValueError):
            continue

        vol_3y = _f(f.get("volatility_3y"))
        vol_1y = _f(f.get("volatility_1y"))
        # Préférer vol_3y (méthodologie SRI), fallback vol_1y
        vol = vol_3y if vol_3y is not None else vol_1y
        # Skip si vol semble en fraction (sera audité ailleurs)
        if vol is None or vol <= 0 or vol < 1:
            continue
        # Skip vol saturée
        if vol >= 9999.0:
            continue

        implicit = vol_to_sri_bucket(vol)
        drift = abs(stored - implicit)
        drift_distribution[drift] += 1
        if drift > 2:
            hits.append({
                "isin": f["isin"],
                "product_type": f.get("product_type"),
                "stored_sri": stored,
                "stored_field": "sri" if f.get("sri") is not None else "srri",
                "implicit_sri": implicit,
                "vol_used": vol,
                "vol_field": "volatility_3y" if vol_3y is not None else "volatility_1y",
                "drift": stored - implicit,
            })
    return {
        "check": "sri_vs_vol_drift",
        "severity": "medium",
        "description": "SRI/SRRI stocké vs SRI ESMA implicite (vol_3y) — écart > 2 niveaux.",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "drift_distribution": {str(k): v for k, v in sorted(drift_distribution.items())},
        "samples": hits[:10],
        "fix_recommendation": (
            "Inspecter les outliers : soit le SRI stocké est obsolète (re-fetch KID), "
            "soit la volatilité est dans une mauvaise unité (cf. audit perf/vol décimal). "
            "Si le SRI vient d'une source primaire récente (kid_parsed_at), garder le SRI ; "
            "sinon, recalculer via derive-srri-from-volatility.py."
        ),
    }


# ─── E4. ter_aberrants : TER < 0 ou > 10% (12% pour SCPI) ─────────────────────

def check_ter_aberrants(funds: list[dict]) -> dict:
    """
    TER hors bornes plausibles :
      - TER < 0 : impossible (frais négatifs)
      - TER > 0.10 (10%) : aberrant pour la plupart des produits
      - SCPI : tolérance jusqu'à 0.12 (frais de gestion + entrée annualisés possibles)
    Convention : TER stocké en FRACTION (0.01 = 1%).
    """
    hits = []
    for f in funds:
        pt = f.get("product_type")
        # Seuil supérieur dépendant du type
        upper = 0.12 if pt == "scpi" else 0.10
        for field in ("ter", "ongoing_charges"):
            v = _f(f.get(field))
            if v is None:
                continue
            issue = None
            if v < 0:
                issue = "negative"
            elif v > upper:
                issue = "above_threshold"
            if issue:
                hits.append({
                    "isin": f["isin"],
                    "product_type": pt,
                    "field": field,
                    "value": v,
                    "threshold": upper,
                    "issue": issue,
                })
    return {
        "check": "ter_aberrants",
        "severity": "high",
        "description": "TER/ongoing_charges hors plage plausible (<0 ou >10% ; SCPI >12%).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "by_issue": dict(Counter(h["issue"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": (
            "TER négatif → NULL. TER > seuil → vérifier l'unité (peut-être encore en %), "
            "sinon plafonner (0.10 OPCVM/ETF, 0.12 SCPI) ou NULL. "
            "Audit conjoint avec check_ter_format (audit de base)."
        ),
    }


# ─── E5. stale_data : updated_at > 6 mois sans kid_parsed_at plus récent ──────

def check_stale_data(funds: list[dict]) -> dict:
    """
    Fonds dont la dernière maj globale (updated_at) date de plus de 6 mois ET
    dont le kid_parsed_at (s'il existe) n'est pas plus récent. Indicateur de
    données potentiellement obsolètes.
    """
    now = datetime.now(timezone.utc)
    six_months_ago = now - timedelta(days=183)

    hits = []
    age_buckets = Counter()  # bucket "6-9 mois", "9-12 mois", ">12 mois"

    for f in funds:
        upd = _parse_iso(f.get("updated_at"))
        if upd is None:
            continue
        if upd >= six_months_ago:
            continue
        kid = _parse_iso(f.get("kid_parsed_at"))
        # Si KID plus récent que la dernière maj générale, on considère que c'est frais
        if kid is not None and kid >= six_months_ago:
            continue

        age_days = (now - upd).days
        if age_days < 274:  # ~9 mois
            bucket = "6-9_months"
        elif age_days < 365:
            bucket = "9-12_months"
        else:
            bucket = "12+_months"
        age_buckets[bucket] += 1

        hits.append({
            "isin": f["isin"],
            "product_type": f.get("product_type"),
            "updated_at": str(f.get("updated_at"))[:10] if f.get("updated_at") else None,
            "kid_parsed_at": str(f.get("kid_parsed_at"))[:10] if f.get("kid_parsed_at") else None,
            "data_source": f.get("data_source"),
            "age_days": age_days,
        })
    return {
        "check": "stale_data",
        "severity": "low",
        "description": "Fonds non mis à jour depuis > 6 mois (sans KID frais plus récent).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "by_age_bucket": dict(age_buckets),
        "by_source": dict(Counter(h["data_source"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": (
            "Planifier un re-scrape des sources couvrant ces types. "
            "Pour les opcvm : relancer amf-geco-full + boursorama. "
            "Pour les etf : justetf-scraper. "
            "Marquer les fonds non re-rencontrés en 2 cycles comme 'inactive'."
        ),
    }


# ─── E6. source_coverage_matrix : data_source × product_type ──────────────────

def check_source_coverage_matrix(funds: list[dict]) -> dict:
    """
    Matrice de couverture : combien de fonds par (data_source, product_type).
    Permet de visualiser quelles sources alimentent quels types.
    """
    matrix: dict[tuple[str, str], int] = defaultdict(int)
    by_source = Counter()
    by_type = Counter()
    no_source = 0

    for f in funds:
        src = f.get("data_source") or "<NULL>"
        pt = f.get("product_type") or "<NULL>"
        matrix[(src, pt)] += 1
        by_source[src] += 1
        by_type[pt] += 1
        if src == "<NULL>":
            no_source += 1

    # Préparer une vue lisible (top 20 croisements)
    sorted_matrix = sorted(matrix.items(), key=lambda x: -x[1])

    return {
        "check": "source_coverage_matrix",
        "severity": "info",
        "description": "Couverture data_source × product_type (informatif).",
        "count": no_source,  # nombre de fonds sans data_source
        "n_funds_without_source": no_source,
        "n_distinct_sources": len(by_source),
        "n_distinct_types": len(by_type),
        "top_sources": dict(by_source.most_common(15)),
        "top_types": dict(by_type.most_common(15)),
        "matrix_top": [
            {"source": k[0], "product_type": k[1], "n": v}
            for k, v in sorted_matrix[:30]
        ],
        "samples": [],
        "fix_recommendation": (
            "Les fonds sans data_source devraient être rares : signe que l'upsert "
            "initial n'a pas tracé la provenance. À enrichir lors des prochains scrapes."
        ),
    }


# ─── E7. potential_duplicates : même name, ISINs différents ───────────────────

def check_potential_duplicates(funds: list[dict]) -> dict:
    """
    Fonds avec le même `name` mais ISIN différent. Cas légitimes :
      - parts différentes d'un même fonds (P, R, I, USD, EUR-hedged, etc.)
      - fonds miroirs (Lux vs France)
    Cas problématiques :
      - réelles doublons à fusionner
      - noms non normalisés (casse, espaces, accents) qui matchent par hasard

    On regroupe par nom normalisé (lower, trim, strip espaces multiples) et on
    flag les groupes de taille ≥ 2.
    """
    import re

    def _norm(name: str) -> str:
        return re.sub(r"\s+", " ", (name or "").strip().lower())

    by_name: dict[str, list[dict]] = defaultdict(list)
    for f in funds:
        if not f.get("name"):
            continue
        n = _norm(f["name"])
        if not n:
            continue
        by_name[n].append({
            "isin": f["isin"],
            "product_type": f.get("product_type"),
            "currency": f.get("currency"),
            "data_source": f.get("data_source"),
            "management_company": f.get("management_company"),
        })

    groups = [(name, group) for name, group in by_name.items() if len(group) >= 2]
    # Distribution de la taille des groupes
    size_dist = Counter(len(g) for _, g in groups)
    # Top 10 plus gros groupes
    biggest = sorted(groups, key=lambda x: -len(x[1]))[:10]
    samples = []
    for name, group in biggest[:10]:
        samples.append({
            "name": name[:80],
            "n": len(group),
            "isins": [g["isin"] for g in group[:6]],
            "currencies": list({g.get("currency") for g in group if g.get("currency")}),
            "types": list({g.get("product_type") for g in group if g.get("product_type")}),
        })

    n_funds_in_groups = sum(len(g) for _, g in groups)
    return {
        "check": "potential_duplicates",
        "severity": "low",
        "description": "Fonds partageant un même `name` (normalisé) — probablement des parts différentes.",
        "count": n_funds_in_groups,
        "n_groups": len(groups),
        "size_distribution": {str(k): v for k, v in sorted(size_dist.items())},
        "samples": samples,
        "fix_recommendation": (
            "Inspecter les groupes >= 5 : si vraies parts (P/R/I/USD/EUR), ajouter un "
            "champ `parent_fund_id` ou enrichir `name` avec le suffixe de part. "
            "Si vrais doublons : merger via le plus complet (data_completeness max)."
        ),
    }


EXTENDED_CHECKS = [
    check_perf_suspect,
    check_perf_decimal_fine,
    check_sri_vs_vol_drift,
    check_ter_aberrants,
    check_stale_data,
    check_source_coverage_matrix,
    check_potential_duplicates,
]


# ─── Rapport ──────────────────────────────────────────────────────────────────

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2, "info": 3}


def _print_section_header(title: str) -> None:
    print()
    print("  " + "═" * 70)
    print(f"  {title}")
    print("  " + "═" * 70)


def _print_check_detail(c: dict) -> None:
    sev = c.get("severity", "info").upper()
    print(f"  [{sev:6}] {c['check']} — {c['count']} cas")
    print(f"    {c['description']}")

    if "by_type" in c and c["by_type"]:
        tops = sorted(c["by_type"].items(), key=lambda x: -x[1])[:8]
        print(f"    Par type : {', '.join(f'{t}={n}' for t, n in tops)}")
    if "by_field" in c and c["by_field"]:
        print(f"    Par champ : {dict(c['by_field'])}")
    if "by_issue" in c and c["by_issue"]:
        print(f"    Par issue : {dict(c['by_issue'])}")
    if "by_confidence" in c and c["by_confidence"]:
        print(f"    Par confiance : {dict(c['by_confidence'])}")
    if "by_age_bucket" in c and c["by_age_bucket"]:
        print(f"    Par âge : {dict(c['by_age_bucket'])}")
    if "drift_distribution" in c:
        print(f"    Distribution dérive : {c['drift_distribution']}")
    if "by_source" in c and c["by_source"]:
        tops = sorted(c["by_source"].items(), key=lambda x: -x[1])[:5]
        print(f"    Par source : {', '.join(f'{t}={n}' for t, n in tops)}")
    if "size_distribution" in c:
        print(f"    Tailles de groupes : {c['size_distribution']}")
    if c.get("samples"):
        print(f"    Échantillons (max 3) :")
        for s in c["samples"][:3]:
            print(f"      - {s}")
    if c.get("fix_recommendation"):
        print(f"    → {c['fix_recommendation']}")
    print()


def _print_coverage_matrix(c: dict) -> None:
    """Affichage spécifique pour la matrice de couverture."""
    print(f"  Fonds sans data_source : {c['n_funds_without_source']}")
    print(f"  Sources distinctes     : {c['n_distinct_sources']}")
    print(f"  Types distincts        : {c['n_distinct_types']}")
    print()
    print(f"  Top sources :")
    for src, n in list(c["top_sources"].items())[:10]:
        print(f"    {src:30s} {n:>6}")
    print()
    print(f"  Top types :")
    for pt, n in list(c["top_types"].items())[:10]:
        print(f"    {pt:30s} {n:>6}")
    print()
    print(f"  Matrix (top 20 croisements) :")
    print(f"    {'source':<25} {'product_type':<20} {'n':>8}")
    print(f"    {'-'*25} {'-'*20} {'-'*8}")
    for cell in c["matrix_top"][:20]:
        print(f"    {str(cell['source'])[:25]:<25} {str(cell['product_type'])[:20]:<20} {cell['n']:>8}")
    print()


def run(json_path: str | None, types_filter: list[str] | None, run_base: bool) -> None:
    print("=" * 72)
    print("  Audit Data Quality EXTENDED — investissement_funds")
    print("=" * 72)
    print(f"  Filtre type : {','.join(types_filter) if types_filter else 'tous'}")
    print(f"  Audit base  : {'OUI' if run_base else 'NON (--no-base)'}")
    print()

    client = get_client()
    print("  Chargement...")
    funds = fetch_all_extended(client, types_filter)
    print(f"  → {len(funds)} fonds chargés\n")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_funds": len(funds),
        "filter_types": types_filter or "all",
        "base_checks": [],
        "extended_checks": [],
    }

    # ─── 1. Re-runner les checks de base (rétrocompatibilité) ─────────────────
    if run_base:
        _print_section_header("CHECKS DE BASE (audit-data-quality.py)")
        base_results = []
        for check_fn in audit_base.ALL_CHECKS:
            result = check_fn(funds)
            base_results.append(result)
            report["base_checks"].append(result)
        base_results.sort(key=lambda c: (SEVERITY_RANK.get(c["severity"], 99), -c["count"]))

        print(f"  {'SEV':<7} {'CHECK':<26} {'COUNT':>8}")
        print(f"  {'-'*7} {'-'*26} {'-'*8}")
        for c in base_results:
            print(f"  {c['severity']:<7} {c['check']:<26} {c['count']:>8}")

    # ─── 2. Checks étendus ────────────────────────────────────────────────────
    _print_section_header("CHECKS ÉTENDUS (nouveaux)")
    extended_results = []
    for check_fn in EXTENDED_CHECKS:
        result = check_fn(funds)
        extended_results.append(result)
        report["extended_checks"].append(result)

    # Tri par sévérité puis count
    extended_results.sort(key=lambda c: (SEVERITY_RANK.get(c["severity"], 99), -c["count"]))

    # Sommaire
    print(f"  {'SEV':<7} {'CHECK':<28} {'COUNT':>8}  DESCRIPTION")
    print(f"  {'-'*7} {'-'*28} {'-'*8}  {'-'*55}")
    for c in extended_results:
        print(f"  {c['severity']:<7} {c['check']:<28} {c['count']:>8}  {c['description'][:55]}")

    # ─── 3. Détails ────────────────────────────────────────────────────────────
    _print_section_header("DÉTAILS — CHECKS ÉTENDUS")
    for c in extended_results:
        if c["check"] == "source_coverage_matrix":
            print(f"  [{c['severity'].upper():6}] {c['check']} (informatif)")
            print(f"    {c['description']}")
            _print_coverage_matrix(c)
            print(f"    → {c['fix_recommendation']}")
            print()
        elif c["count"] == 0:
            print(f"  [{c['severity'].upper():6}] {c['check']} — OK (0 cas)\n")
        else:
            _print_check_detail(c)

    # ─── 4. Résumé global ─────────────────────────────────────────────────────
    _print_section_header("RÉSUMÉ GLOBAL")
    total_ext = sum(c["count"] for c in extended_results if c["severity"] != "info")
    high_ext = sum(c["count"] for c in extended_results if c["severity"] == "high")
    med_ext = sum(c["count"] for c in extended_results if c["severity"] == "medium")
    low_ext = sum(c["count"] for c in extended_results if c["severity"] == "low")
    print(f"  Anomalies étendues : {total_ext}")
    print(f"    HIGH   : {high_ext}")
    print(f"    MEDIUM : {med_ext}")
    print(f"    LOW    : {low_ext}")
    if run_base:
        total_base = sum(c["count"] for c in report["base_checks"])
        high_base = sum(c["count"] for c in report["base_checks"] if c["severity"] == "high")
        print(f"  Anomalies base (rappel) : {total_base} dont HIGH={high_base}")

    if json_path:
        Path(json_path).write_text(json.dumps(report, indent=2, default=str))
        print(f"\n  Rapport JSON écrit : {json_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Audit data quality EXTENDED — investissement_funds"
    )
    parser.add_argument("--json", type=str, default="",
                        help="Chemin d'export JSON du rapport")
    parser.add_argument("--type", type=str, default="",
                        help="Restreindre à certains product_type (comma-separated)")
    parser.add_argument("--no-base", action="store_true",
                        help="Ne pas re-runner les checks de base")
    args = parser.parse_args()
    types_filter = [t.strip() for t in args.type.split(",") if t.strip()] or None
    run(
        json_path=args.json or None,
        types_filter=types_filter,
        run_base=not args.no_base,
    )
