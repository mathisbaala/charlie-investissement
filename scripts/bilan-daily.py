#!/usr/bin/env python3
"""
bilan-daily.py — Rapport quotidien de l'état des données
==========================================================
Génère un rapport propre exploitable pour le user au format markdown.
À lancer chaque matin pour suivre la progression.

Usage :
    python3 scripts/bilan-daily.py
    python3 scripts/bilan-daily.py > docs/bilans/bilan-YYYY-MM-DD.md
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from db import get_client

c = get_client()
now = datetime.now(timezone.utc)


def cnt(**kw):
    q = c.table("investissement_funds").select("isin", count="exact")
    for k, v in kw.items():
        if v is None:
            q = q.is_(k, "null")
        elif v == "!null":
            q = q.not_.is_(k, "null")
        else:
            q = q.eq(k, v)
    return q.execute().count


# ── Header ─────────────────────────────────────────────────────────────────────
print(f"# 📊 Bilan Charlie Investissement — {now.strftime('%Y-%m-%d %H:%M UTC')}")
print()
total = cnt()
hi80 = cnt(**{"data_completeness": ("gte", 80)} if False else {})  # bypass
hi80 = c.table("investissement_funds").select("isin", count="exact").gte("data_completeness", 80).execute().count
mid = c.table("investissement_funds").select("isin", count="exact").gte("data_completeness", 50).execute().count
print(f"## 🎯 Vue d'ensemble")
print()
print(f"- **Total fonds** : {total:,}".replace(",", " "))
print(f"- **≥80 completeness** : {hi80:,} ({100*hi80/total:.0f}%)".replace(",", " "))
print(f"- **≥50 completeness** : {mid:,} ({100*mid/total:.0f}%)".replace(",", " "))
print()

# ── Par product_type ──────────────────────────────────────────────────────────
print("## 📂 Par product_type")
print()
print("| Type | Total | ≥80 | % | perf_1y | vol_1y | TER |")
print("|---|---:|---:|---:|---:|---:|---:|")
types_data = []
for t in ["etf", "opcvm", "scpi", "action", "crypto", "fonds_euros", "fcpi", "fcpr",
         "fct", "fip", "fps", "fpci", "obligation", "livret", "opci", "sicav"]:
    n = cnt(product_type=t)
    if n == 0:
        continue
    hi = c.table("investissement_funds").select("isin", count="exact").eq("product_type", t).gte("data_completeness", 80).execute().count
    p1y = cnt(product_type=t, performance_1y="!null")
    v1y = cnt(product_type=t, volatility_1y="!null")
    ter = cnt(product_type=t, ter="!null")
    print(f"| {t} | {n:,} | {hi:,} | {100*hi/n:.0f}% | {100*p1y/n:.0f}% | {100*v1y/n:.0f}% | {100*ter/n:.0f}% |".replace(",", " "))
    types_data.append((t, n, hi))
print()

# ── Couverture champs ────────────────────────────────────────────────────────
print("## 🗂️ Couverture par champ")
print()
fields = [
    ("name", "Nom"),
    ("aum_eur", "AUM"),
    ("performance_1y", "Perf 1Y"),
    ("performance_3y", "Perf 3Y"),
    ("performance_5y", "Perf 5Y"),
    ("ter", "TER"),
    ("volatility_1y", "Vol 1Y"),
    ("volatility_3y", "Vol 3Y"),
    ("sharpe_1y", "Sharpe 1Y"),
    ("max_drawdown_1y", "Max DD 1Y"),
    ("sri", "SRI"),
    ("srri", "SRRI"),
    ("sfdr_article", "SFDR"),
    ("kid_url", "KID URL"),
    ("kid_parsed_at", "KID parsé"),
    ("management_company", "Société gestion"),
    ("management_company_normalized", "Société normalisée"),
    ("inception_date", "Date création"),
]
print("| Champ | Couverture | % |")
print("|---|---:|---:|")
for f, label in fields:
    n = cnt(**{f: "!null"})
    print(f"| {label} | {n:,} | {100*n/total:.0f}% |".replace(",", " "))
print()

# ── AV Lux ──────────────────────────────────────────────────────────────────
print("## 🇱🇺 Assurance-Vie Luxembourg")
print()
av_lux = cnt(av_lux_eligible=True)
companies = c.table("investissement_av_lux_companies").select("short_code", count="exact").execute().count
print(f"- **Compagnies AV Lux seedées** : {companies}")
print(f"- **Fonds flagués éligibles** : {av_lux:,}".replace(",", " "))
print()

# ── Share classes ──────────────────────────────────────────────────────────
print("## 🔗 Share classes")
print()
shares = cnt(share_class_group_id="!null")
print(f"- **Fonds groupés en classes de parts** : {shares:,}".replace(",", " "))
print()

# ── Field_sources ──────────────────────────────────────────────────────────
print("## 📊 Traçabilité (field_sources)")
print()
# Compter fonds avec field_sources non vide via direct query
r = c.table("investissement_funds").select("field_sources").not_.is_("field_sources", "null").limit(5000).execute()
non_empty = sum(1 for x in r.data if x.get("field_sources") and len(x["field_sources"]) > 0)
print(f"- **Fonds avec traçabilité peuplée** : {non_empty:,}+ (échantillon 5000)".replace(",", " "))
print()

# ── Pipeline runs ──────────────────────────────────────────────────────────
print("## 🔄 Pipeline (dernières 24h)")
print()
yesterday = (now - __import__('datetime').timedelta(days=1)).isoformat()
runs = c.table("investissement_pipeline_runs") \
    .select("scraper, status, records_processed, records_failed, started_at") \
    .gte("started_at", yesterday) \
    .order("started_at", desc=True) \
    .limit(25) \
    .execute().data
if runs:
    print("| Scraper | Statut | Records OK | Échecs |")
    print("|---|---|---:|---:|")
    for r in runs[:20]:
        marker = "✅" if r["status"] == "success" else ("⚠️" if r["status"] == "partial" else "❌")
        print(f"| {r['scraper']} | {marker} {r['status']} | {r['records_processed']:,} | {r['records_failed']:,} |".replace(",", " "))
else:
    print("_Aucun run dans les dernières 24h._")
print()

# ── Footer ─────────────────────────────────────────────────────────────────
print()
print(f"---")
print(f"_Bilan généré automatiquement par `scripts/bilan-daily.py` le {now.strftime('%Y-%m-%d %H:%M:%S UTC')}_")
