#!/usr/bin/env python3
"""
audit-data-quality.py — Audit des incohérences d'unités et de format
======================================================================
Inspecte la table investissement_funds pour détecter :

1. Performances en format décimal (|val|<1 mais ≠0)         → devraient être en %
2. Volatilités en format décimal (0 < val < 1)              → devraient être en %
3. Volatilités saturées (val == 9999.9999)                  → cap numeric(8,4)
4. Volatilités > 100%                                       → suspectes
5. TER en format pourcentage (val > 1)                      → devrait être en fraction
6. TER vs ongoing_charges incohérents (|Δ| > 0.0001)        → choix de source
7. AUM en devise locale (val > 1000 Mrd€)                   → conversion EUR manquante
8. SRI / SRRI hors plage [1, 7]
9. Max drawdown positif (devrait être négatif ou 0)
10. Performances aberrantes (|val| > 500%)
11. kid_parsed_at sans kid_url ET sans srri/ter             → marquage abusif
12. inception_date dans le futur ou track_record < 0
13. Cohérence asset_class vs product_type
14. Champs string non normalisés (HTML entities, casse)

Mode : lecture seule. Produit un rapport JSON + console.
Aucune migration appliquée. Les corrections recommandées sont décrites
dans le rapport mais doivent être implémentées dans des scripts dédiés.

Usage :
    python3 scripts/migrations/audit-data-quality.py
    python3 scripts/migrations/audit-data-quality.py --json /tmp/audit.json
    python3 scripts/migrations/audit-data-quality.py --type opcvm,etf
"""

import sys
import json
import argparse
from datetime import datetime, date, timezone
from pathlib import Path
from collections import Counter, defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

FIELDS = (
    "isin,name,product_type,asset_class,currency,"
    "ter,ongoing_charges,sri,srri,"
    "performance_1y,performance_3y,performance_5y,average_performance,"
    "volatility_1y,volatility_3y,max_drawdown_1y,max_drawdown_3y,"
    "sharpe_1y,sharpe_3y,aum_eur,"
    "inception_date,track_record_years,kid_url,kid_parsed_at,management_company"
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def fetch_all(client, types_filter: list[str] | None) -> list[dict]:
    funds: list[dict] = []
    offset = 0
    page = 1000
    while True:
        q = client.table("investissement_funds").select(FIELDS)
        if types_filter:
            q = q.in_("product_type", types_filter)
        batch = q.range(offset, offset + page - 1).execute().data or []
        funds.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return funds


def _f(v):
    return float(v) if v is not None else None


# ─── Checks ───────────────────────────────────────────────────────────────────

def check_perf_decimal(funds: list[dict]) -> dict:
    """Performance probablement en fraction (|val|<1, ≠0) → devrait être en %."""
    hits = []
    for f in funds:
        for field in ("performance_1y", "performance_3y", "performance_5y"):
            v = _f(f.get(field))
            if v is not None and v != 0 and abs(v) < 1:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "field": field, "value": v})
    by_type = Counter(h["product_type"] for h in hits)
    by_field = Counter(h["field"] for h in hits)
    return {
        "check": "perf_decimal",
        "severity": "high",
        "description": "Performances stockées en fraction (0.05 = 5%) alors que la convention est %.",
        "count": len(hits),
        "by_type": dict(by_type),
        "by_field": dict(by_field),
        "samples": hits[:10],
        "fix_recommendation": (
            "Étendre fix-decimal-metrics.py pour couvrir tous les types "
            "(actuellement filtre sur vol_1y). Multiplier les valeurs par 100. "
            "Cap à 9999.9999 (numeric(8,4))."
        ),
    }


def check_vol_decimal(funds: list[dict]) -> dict:
    """Volatilité 0 < val < 1 = probablement en fraction."""
    hits = []
    for f in funds:
        for field in ("volatility_1y", "volatility_3y"):
            v = _f(f.get(field))
            if v is not None and 0 < v < 1:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "field": field, "value": v})
    return {
        "check": "vol_decimal",
        "severity": "high",
        "description": "Volatilité en fraction (0.15 = 15%) au lieu de %.",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Multiplier par 100 si vol < 1 (le seuil est sûr car même un livret est >= 0).",
    }


def check_vol_saturated(funds: list[dict]) -> dict:
    """Volatilité = 9999.9999 = saturation numeric(8,4)."""
    hits = []
    for f in funds:
        for field in ("volatility_1y", "volatility_3y"):
            v = _f(f.get(field))
            if v is not None and v >= 9999.9:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "field": field, "value": v})
    return {
        "check": "vol_saturated",
        "severity": "medium",
        "description": "Volatilité saturée au cap numeric(8,4) = 9999.9999 (donnée corrompue).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Remettre NULL et recalculer depuis fund_prices via compute-metrics.",
    }


def check_vol_high(funds: list[dict]) -> dict:
    """Volatilité > 100 (anormale sauf actifs très volatils)."""
    hits = []
    for f in funds:
        for field in ("volatility_1y", "volatility_3y"):
            v = _f(f.get(field))
            if v is not None and 100 < v < 9999:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "field": field, "value": v})
    return {
        "check": "vol_high",
        "severity": "low",
        "description": "Volatilité > 100% — plausible pour cryptos/penny stocks mais à vérifier.",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Inspecter manuellement, capper à 200% si confirmé erreur.",
    }


def check_ter_format(funds: list[dict]) -> dict:
    """TER doit être en fraction (0.006 = 0.6%). Si > 1 → en %."""
    hits = []
    for f in funds:
        for field in ("ter", "ongoing_charges"):
            v = _f(f.get(field))
            if v is not None and v > 1:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "field": field, "value": v})
    return {
        "check": "ter_format",
        "severity": "high",
        "description": "TER/ongoing_charges en pourcentage (8.5 au lieu de 0.085).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Diviser par 100 si val > 1 (TER réaliste : 0.001 à 0.05).",
    }


def check_ter_mismatch(funds: list[dict]) -> dict:
    """ter vs ongoing_charges divergents."""
    hits = []
    for f in funds:
        t  = _f(f.get("ter"))
        oc = _f(f.get("ongoing_charges"))
        if t is not None and oc is not None and abs(t - oc) > 0.0001:
            hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                         "ter": t, "ongoing_charges": oc, "delta": round(t - oc, 6)})
    return {
        "check": "ter_mismatch",
        "severity": "low",
        "description": "ter ≠ ongoing_charges. Devraient être identiques (PRIIPs : ongoing = total ter).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Source primaire = KID PDF (ongoing_charges). Aligner ter sur ongoing_charges.",
    }


def check_aum_currency(funds: list[dict]) -> dict:
    """AUM en devise locale (val > 1000 Mrd€)."""
    hits = []
    for f in funds:
        v = f.get("aum_eur")
        if v is not None and int(v) > 1_000_000_000_000:
            hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                         "aum_eur": int(v), "currency": f.get("currency")})
    return {
        "check": "aum_currency",
        "severity": "high",
        "description": "AUM > 1000 Mrd€ : probablement stocké en devise locale (IDR, CLP, KRW…).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "by_currency": dict(Counter(h["currency"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": (
            "Re-fetch AUM en EUR ou convertir via taux de change ; "
            "pour les actions, normaliser via market_cap × FX. "
            "À défaut, mettre NULL (cf. /tmp/data-cleaner.py existant)."
        ),
    }


def check_sri_srri_range(funds: list[dict]) -> dict:
    """SRI / SRRI hors [1, 7]."""
    hits = []
    for f in funds:
        for field in ("sri", "srri"):
            v = f.get(field)
            if v is not None and (int(v) < 1 or int(v) > 7):
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "field": field, "value": int(v)})
    return {
        "check": "sri_srri_range",
        "severity": "high",
        "description": "SRI/SRRI hors plage réglementaire [1, 7].",
        "count": len(hits),
        "samples": hits[:10],
        "fix_recommendation": "Clamper à [1, 7] ou mettre NULL si inconsistant.",
    }


def check_drawdown_sign(funds: list[dict]) -> dict:
    """Max drawdown doit être négatif ou 0."""
    hits = []
    for f in funds:
        for field in ("max_drawdown_1y", "max_drawdown_3y"):
            v = _f(f.get(field))
            if v is not None and v > 0:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "field": field, "value": v})
    return {
        "check": "drawdown_sign",
        "severity": "medium",
        "description": "max_drawdown positif (devrait être ≤ 0).",
        "count": len(hits),
        "samples": hits[:10],
        "fix_recommendation": "Multiplier par -1 ou recomputer depuis fund_prices.",
    }


def check_perf_outliers(funds: list[dict]) -> dict:
    """Performances aberrantes (|val|>500%)."""
    hits = []
    for f in funds:
        for field in ("performance_1y", "performance_3y", "performance_5y"):
            v = _f(f.get(field))
            if v is not None and abs(v) > 500:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "field": field, "value": v})
    return {
        "check": "perf_outliers",
        "severity": "medium",
        "description": "|Performance| > 500% — possible mais à vérifier (penny stock, crypto récente).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Auditer manuellement ; capper à 999% pour les actions FR/EU sains.",
    }


def check_kid_parsed_phantom(funds: list[dict]) -> dict:
    """kid_parsed_at sans kid_url ni srri ni ter (marquage abusif)."""
    hits = []
    for f in funds:
        kpa = f.get("kid_parsed_at")
        ku  = f.get("kid_url")
        srri = f.get("srri")
        ter  = f.get("ter")
        oc   = f.get("ongoing_charges")
        if kpa and not ku and srri is None and ter is None and oc is None:
            hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                         "kid_parsed_at": kpa})
    return {
        "check": "kid_parsed_phantom",
        "severity": "low",
        "description": "kid_parsed_at marqué mais aucune donnée KID extraite (URL ni SRRI ni TER).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Démarquer kid_parsed_at pour ces fonds.",
    }


def check_inception_future(funds: list[dict]) -> dict:
    """inception_date dans le futur, ou track_record < 0."""
    today = date.today()
    hits = []
    for f in funds:
        inc = f.get("inception_date")
        if inc:
            try:
                d = date.fromisoformat(inc[:10])
                if d > today:
                    hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                                 "inception_date": inc, "issue": "future"})
            except ValueError:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "inception_date": inc, "issue": "malformed"})
        tr = _f(f.get("track_record_years"))
        if tr is not None and tr < 0:
            hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                         "track_record_years": tr, "issue": "negative"})
    return {
        "check": "inception_future",
        "severity": "low",
        "description": "inception_date dans le futur ou track_record négatif.",
        "count": len(hits),
        "samples": hits[:10],
        "fix_recommendation": "Mettre NULL si futur, recomputer track_record via recalc-track-record.py.",
    }


def check_asset_class_mismatch(funds: list[dict]) -> dict:
    """Cohérence basique asset_class vs product_type."""
    expected = {
        "crypto":      {"crypto"},
        "livret":      {"monetaire"},
        "fonds_euros": {"monetaire", "obligations", "diversifie"},
        "scpi":        {"immobilier"},
        "opci":        {"immobilier"},
        "obligation":  {"obligations"},
    }
    hits = []
    for f in funds:
        pt = f.get("product_type")
        ac = f.get("asset_class")
        if pt in expected and ac and ac not in expected[pt]:
            hits.append({"isin": f["isin"], "product_type": pt, "asset_class": ac})
    return {
        "check": "asset_class_mismatch",
        "severity": "low",
        "description": "asset_class incohérent avec product_type (ex : crypto avec asset_class=actions).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Normaliser asset_class via une table de mapping product_type→asset_class.",
    }


def check_html_entities(funds: list[dict]) -> dict:
    """HTML entities résiduels dans name / management_company."""
    needles = ("&amp;", "&lt;", "&gt;", "&quot;", "&#39;", "&nbsp;")
    hits = []
    for f in funds:
        for field in ("name", "management_company"):
            v = f.get(field)
            if v and isinstance(v, str) and any(n in v for n in needles):
                hits.append({"isin": f["isin"], "field": field, "value": v[:60]})
    return {
        "check": "html_entities",
        "severity": "low",
        "description": "HTML entities (&amp; etc.) résiduels dans des champs string.",
        "count": len(hits),
        "samples": hits[:10],
        "fix_recommendation": "Appliquer html.unescape() en masse sur name et management_company.",
    }


def check_perf_consistency_avg(funds: list[dict]) -> dict:
    """average_performance ≠ moyenne(p1y, p3y, p5y) — devrait être recalculé."""
    hits = []
    for f in funds:
        vals = [_f(f.get(k)) for k in ("performance_1y", "performance_3y", "performance_5y")]
        vals = [v for v in vals if v is not None]
        avg_db = _f(f.get("average_performance"))
        if vals and avg_db is not None:
            expected = sum(vals) / len(vals)
            if abs(expected - avg_db) > 0.5:
                hits.append({"isin": f["isin"], "product_type": f.get("product_type"),
                             "avg_db": avg_db, "avg_computed": round(expected, 4)})
    return {
        "check": "perf_avg_drift",
        "severity": "low",
        "description": "average_performance dérive de la moyenne des p1y/p3y/p5y (>0.5pt).",
        "count": len(hits),
        "by_type": dict(Counter(h["product_type"] for h in hits)),
        "samples": hits[:10],
        "fix_recommendation": "Relancer scripts/migrations/recalc-average-perf.py --apply.",
    }


ALL_CHECKS = [
    check_perf_decimal,
    check_vol_decimal,
    check_vol_saturated,
    check_vol_high,
    check_ter_format,
    check_ter_mismatch,
    check_aum_currency,
    check_sri_srri_range,
    check_drawdown_sign,
    check_perf_outliers,
    check_kid_parsed_phantom,
    check_inception_future,
    check_asset_class_mismatch,
    check_html_entities,
    check_perf_consistency_avg,
]


# ─── Pipeline ─────────────────────────────────────────────────────────────────

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


def run(json_path: str | None, types_filter: list[str] | None) -> None:
    print("=" * 72)
    print("  Audit Data Quality — investissement_funds")
    print("=" * 72)
    print(f"  Filtre : {','.join(types_filter) if types_filter else 'tous types'}")
    print()

    client = get_client()
    print("  Chargement...")
    funds = fetch_all(client, types_filter)
    print(f"  → {len(funds)} fonds chargés\n")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_funds":      len(funds),
        "filter_types": types_filter or "all",
        "checks":       [],
    }

    for check_fn in ALL_CHECKS:
        result = check_fn(funds)
        report["checks"].append(result)

    # Tri par sévérité puis nb d'incidents
    report["checks"].sort(key=lambda c: (SEVERITY_RANK.get(c["severity"], 99), -c["count"]))

    # Console
    print(f"  {'SEV':<6} {'CHECK':<25} {'COUNT':>8}  DESCRIPTION")
    print(f"  {'-'*6} {'-'*25} {'-'*8}  {'-'*60}")
    for c in report["checks"]:
        print(f"  {c['severity']:<6} {c['check']:<25} {c['count']:>8}  {c['description'][:60]}")

    # Détail des checks non-vides
    print("\n  ─── Détails ───\n")
    for c in report["checks"]:
        if c["count"] == 0:
            continue
        print(f"  [{c['severity'].upper():6}] {c['check']} — {c['count']} cas")
        print(f"    {c['description']}")
        if "by_type" in c and c["by_type"]:
            tops = sorted(c["by_type"].items(), key=lambda x: -x[1])[:6]
            print(f"    Par type : {', '.join(f'{t}={n}' for t, n in tops)}")
        if "by_field" in c and c["by_field"]:
            print(f"    Par champ : {dict(c['by_field'])}")
        if "by_currency" in c and c["by_currency"]:
            tops = sorted(c["by_currency"].items(), key=lambda x: -x[1])[:6]
            print(f"    Par devise : {', '.join(f'{t}={n}' for t, n in tops)}")
        if c.get("samples"):
            print(f"    Échantillons (max 3) :")
            for s in c["samples"][:3]:
                print(f"      - {s}")
        print(f"    → {c['fix_recommendation']}")
        print()

    # Résumé final
    total_issues = sum(c["count"] for c in report["checks"])
    high_issues = sum(c["count"] for c in report["checks"] if c["severity"] == "high")
    print(f"\n  ═══════════════════════════════════════════════════")
    print(f"  TOTAL : {total_issues:6d} anomalies détectées")
    print(f"   HIGH : {high_issues:6d} (correction prioritaire)")
    print(f"  ═══════════════════════════════════════════════════")

    if json_path:
        Path(json_path).write_text(json.dumps(report, indent=2, default=str))
        print(f"\n  Rapport JSON écrit : {json_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Audit data quality — investissement_funds")
    parser.add_argument("--json", type=str, default="",
                        help="Chemin d'export JSON du rapport")
    parser.add_argument("--type", type=str, default="",
                        help="Restreindre à certains product_type (comma-separated)")
    args = parser.parse_args()
    types_filter = [t.strip() for t in args.type.split(",") if t.strip()] or None
    run(json_path=args.json or None, types_filter=types_filter)
