#!/usr/bin/env python3
"""
fps-name-enricher.py — management_company + category + asset_class pour FPS
============================================================================
Les fonds FPS (CSSF_O*) ont des noms souvent informatifs.
Ce script extrait management_company, category et asset_class depuis le nom.

Avec MC(25) + inception(20) + track(15) + currency(5) + category(10) + asset_class(5) = 80 pts.

Usage :
    python3 scripts/migrations/fps-name-enricher.py
    python3 scripts/migrations/fps-name-enricher.py --apply
"""

import sys
import re
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

# ─── Patterns management_company ─────────────────────────────────────────────
# (regex, management_company)
MC_PATTERNS: list[tuple[str, str]] = [
    (r"\bamundi\b",                "Amundi Asset Management"),
    (r"\baurazeo\b",               "Aurazeo"),
    (r"\beurazeo\b",               "Eurazeo"),
    (r"\bardian\b",                "Ardian"),
    (r"\bpartners.?group\b",       "Partners Group"),
    (r"\bmirabaud\b",              "Mirabaud"),
    (r"\bpemberton\b",             "Pemberton Capital"),
    (r"\bares\b",                  "Ares Management"),
    (r"\bblackstone\b",            "Blackstone"),
    (r"\bapollo\b",                "Apollo Global Management"),
    (r"\bkkr\b",                   "KKR"),
    (r"\bcvc\b",                   "CVC Capital Partners"),
    (r"\baxa.?im\b|axa invest",    "AXA Investment Managers"),
    (r"\bnatixis\b",               "Natixis Investment Managers"),
    (r"\bbnp\b",                   "BNP Paribas AM"),
    (r"\bgenerali invest",         "Generali Investments"),
    (r"\bdeka\b",                  "Deka Investments"),
    (r"\bfondaco\b",               "Fondaco SGR"),
    (r"\btikehau\b",               "Tikehau Capital"),
    (r"\bsiparex\b",               "Siparex"),
    (r"\bpatrizia\b",              "Patrizia AG"),
    (r"\bpictet\b",                "Pictet Asset Management"),
    (r"\bschroders?\b",            "Schroders"),
    (r"\bfidelity\b",              "Fidelity Investments"),
    (r"\balliance.?bernstein\b",   "AllianceBernstein"),
    (r"\bblackrock\b",             "BlackRock"),
    (r"\bvanguard\b",              "Vanguard"),
    (r"\bstate.?street\b",         "State Street Global Advisors"),
    (r"\binvesco\b",               "Invesco"),
    (r"\bpgim\b",                  "PGIM (Prudential)"),
    (r"\btcg\b",                   "TCG (The Carlyle Group)"),
    (r"\bcarlyle\b",               "The Carlyle Group"),
    (r"\bnomura\b",                "Nomura Asset Management"),
    (r"\bnordea\b",                "Nordea Asset Management"),
    (r"\bunibail\b",               "Unibail-Rodamco-Westfield"),
    (r"\bcbam\b",                  "CBAM (Credit-Based Asset Management)"),
    (r"\bwai\b",                   "WAI Capital"),
    (r"\bwhitelake\b",             "Whitelake"),
    (r"\bprobus\b",                "Probus Capital"),
    (r"\bmanavest\b",              "Manavest"),
    (r"\beyquem\b",                "Eyquem"),
    (r"\bspecialized invest",      "Specialized Investments"),
    (r"\bieif\b|southeast.?europe","European Fund for Southeast Europe"),
    (r"\bsieger?fried\b",          "Siegfried Holding"),
    (r"\bbd.family\b",             "BD Capital"),
    (r"\bglobal.?alpha\b",         "Global Alpha Capital"),
    (r"\btishman.?speyer\b",       "Tishman Speyer"),
    (r"\baltius\b",                "Altius Associates"),
    (r"\bsica fund\b",             "SICA Advisors"),
    (r"\bipc.wmaxx\b",             "IPC"),
    (r"\bclbrm\b",                 "CLBRM"),
    (r"\bmu abrdn\b",              "abrdn"),
    (r"\babrdn\b",                 "abrdn"),
    (r"\barcho\b",                 "Archo Asset Management"),
    (r"\bauler\b",                 "Euler ILS"),
    (r"\bcapital dynamics\b",      "Capital Dynamics"),
    (r"\bfg wohn\b",               "FG Wohninvest"),
    (r"\bmanager opport",          "Manager Opportunities"),
]

# ─── Patterns category ────────────────────────────────────────────────────────
CAT_PATTERNS: list[tuple[str, str, str]] = [
    # (regex, category, asset_class)
    (r"real estate|immobilier|reit|wohn|property",        "Immobilier",          "immobilier"),
    (r"private equity|capital iv|venture|growth equity",  "Private Equity",      "private equity"),
    (r"debt.fund|loan.fund|credit.fund|senior.debt|lending", "Dette Privée",     "obligations"),
    (r"infrastructure|infra.fund",                         "Infrastructure",      "infrastructure"),
    (r"supply chain|trade.finance",                        "Finance Commerciale", "obligations"),
    (r"insurance.?linked|ils\b|cat.bond",                  "ILS / Cat Bond",      "autres"),
    (r"hedge|absolute.return|long.short|market.neutral",   "Hedge Fund",          "multi-actifs"),
    (r"fund.of.fund|multi.manager|umbrella",               "Fonds de Fonds",      "multi-actifs"),
    (r"distress|special.sit|opportunist",                  "Situations Spéciales","autres"),
    (r"mezzanine",                                         "Mezzanine",           "obligations"),
    (r"secon?dar|secondar",                                "Secondaire PE",       "private equity"),
    (r"impact|esg|responsible|climate|green",              "Impact / ESG",        "multi-actifs"),
    (r"micro.financ|microfinanc",                          "Microfinance",        "obligations"),
    (r"\bfcpi\b|innovation.fund|technolog",                "Innovation / FCPI",   "actions"),
    (r"action|equity|strat\w* action",                     "Actions",             "actions"),
    (r"oblig|bond\b|fixed.income",                         "Obligations",         "obligations"),
    (r"cash|monetaire|money market",                       "Monétaire",           "monetaire"),
]

_MC_COMPILED  = [(re.compile(p, re.I), mc) for p, mc in MC_PATTERNS]
_CAT_COMPILED = [(re.compile(p, re.I), cat, ac) for p, cat, ac in CAT_PATTERNS]


def infer_mc(name: str) -> str | None:
    for pat, mc in _MC_COMPILED:
        if pat.search(name):
            return mc
    return None


def infer_cat_ac(name: str) -> tuple[str | None, str | None]:
    for pat, cat, ac in _CAT_COMPILED:
        if pat.search(name):
            return cat, ac
    return None, None


def run(apply: bool) -> None:
    print("=" * 68)
    print("  FPS Name Enricher — MC + Category + Asset Class")
    print("=" * 68)
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    all_fps: list[dict] = []
    offset = 0
    while True:
        batch = client.table("investissement_funds") \
            .select("isin,name,management_company,category,asset_class") \
            .eq("product_type", "fps") \
            .range(offset, offset + 999) \
            .execute().data or []
        all_fps.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"  {len(all_fps)} FPS chargés")

    to_update: list[dict] = []
    mc_dist: Counter = Counter()

    for f in all_fps:
        changes: dict = {}
        name = f["name"] or ""

        if not f.get("management_company"):
            mc = infer_mc(name)
            if mc:
                changes["management_company"] = mc
                mc_dist[mc] += 1

        if not f.get("category") or not f.get("asset_class"):
            cat, ac = infer_cat_ac(name)
            if cat and not f.get("category"):
                changes["category"] = cat
            if ac and not f.get("asset_class"):
                changes["asset_class"] = ac

        if changes:
            to_update.append({"isin": f["isin"], "name": name[:50], **changes})

    print(f"  {len(to_update)} FPS à enrichir")
    print(f"  MC identifiées: {sum(1 for r in to_update if 'management_company' in r)}")
    print(f"  Category:       {sum(1 for r in to_update if 'category' in r)}")
    print(f"  Asset class:    {sum(1 for r in to_update if 'asset_class' in r)}")

    print("\n  Répartition MC :")
    for mc, cnt in mc_dist.most_common(15):
        print(f"    {cnt:4d}  {mc}")

    if not apply:
        print("\n  [DRY-RUN] Ajouter --apply pour persister.")
        return

    print("\n  Application en base...", flush=True)
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for row in to_update:
        isin = row["isin"]
        changes = {k: v for k, v in row.items() if k not in ("isin", "name")}
        try:
            client.table("investissement_funds") \
                .update({**changes, "updated_at": now}) \
                .eq("isin", isin) \
                .execute()
            ok += 1
        except Exception as e:
            fail += 1
            if fail <= 3:
                print(f"  ✗ {isin}: {e}", flush=True)

    print(f"\n  → {ok} FPS enrichis, {fail} erreurs")
    log_run("fps-name-enricher", "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Enrichit management_company/category/asset_class des FPS depuis leur nom"
    )
    parser.add_argument("--apply", action="store_true", help="Écrire en base")
    args = parser.parse_args()
    run(apply=args.apply)
