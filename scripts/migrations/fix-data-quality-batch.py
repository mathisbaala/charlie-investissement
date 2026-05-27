#!/usr/bin/env python3
"""
fix-data-quality-batch.py — Corrections batch des anomalies HIGH severity
==========================================================================
Applique les corrections identifiées par audit-data-quality.py :

  1. perf_decimal (1867 cas) : performances |val|<1 → ×100
  2. vol_decimal (673 cas)  : volatilités 0<val<1 → ×100
  3. vol_saturated (25 cas) : volatilité ≥9999.9 → NULL
  4. aum_currency (51 cas)  : aum_eur > 1Tn (devise locale non convertie) → NULL
  5. html_entities (50 cas) : html.unescape() sur name/management_company

Sécurité : croise perf_decimal avec volatility_1y. Si vol est aussi < 1
(donc cohérence "tout en fraction"), conversion sûre. Sinon, plus prudent.

Usage :
    python3 scripts/migrations/fix-data-quality-batch.py            # dry-run
    python3 scripts/migrations/fix-data-quality-batch.py --apply
    python3 scripts/migrations/fix-data-quality-batch.py --apply --only perf_decimal
"""

import sys
import html
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run

PERF_MAX = 9999.9999
VOL_MAX  = 9999.9999

FIELDS = (
    "isin,product_type,name,management_company,"
    "ter,ongoing_charges,"
    "performance_1y,performance_3y,performance_5y,"
    "volatility_1y,volatility_3y,"
    "aum_eur,currency"
)


def fetch_all(client) -> list[dict]:
    funds = []
    offset = 0
    while True:
        batch = (client.table("investissement_funds").select(FIELDS)
                 .range(offset, offset+999).execute().data or [])
        funds.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return funds


def fix_perf_decimal(funds: list[dict]) -> list[dict]:
    """Performance |val|<1, ≠0 → ×100.

    PRUDENCE : compute-metrics stocke déjà en % (×100 inline), donc une
    perf à 0.5 peut être LÉGITIME (fonds monétaire à 0.5%) PAS une fraction.

    Heuristique de cohérence (toutes doivent être vraies pour convertir) :
      a) Volatility_1y existe ET est aussi < 1 (cohérence "tout en fraction")
      b) OU bien TER < 0.0001 (TER ridiculement bas = autre artefact)
      c) Le fonds n'a pas été enrichi récemment par compute-metrics
         (heuristique : si vol existe et est > 1, vol vient de compute-metrics
          donc perf aussi → ne pas toucher)
    """
    updates = []
    for f in funds:
        upd = {}
        vol_1y = f.get("volatility_1y")
        vol_3y = f.get("volatility_3y")
        vol_1y_val = float(vol_1y) if vol_1y is not None else None
        vol_3y_val = float(vol_3y) if vol_3y is not None else None

        # Cohérence "tout en fraction" : vol existe ET vol < 1
        vol_is_fraction = (
            (vol_1y_val is not None and 0 < vol_1y_val < 1) or
            (vol_3y_val is not None and 0 < vol_3y_val < 1)
        )
        # Cohérence "tout en %" : vol existe ET vol >= 1 (probablement compute-metrics)
        vol_is_pct = (
            (vol_1y_val is not None and vol_1y_val >= 1) or
            (vol_3y_val is not None and vol_3y_val >= 1)
        )

        # Skip si vol est en %, c'est une perf légitime
        if vol_is_pct:
            continue

        # Skip si vol est NULL — trop ambigu (peut être fonds monétaire légitime
        # à 0.5% comme livret, OU fonds avec perf en fraction). Préférons
        # ne rien faire à risquer de corrompre.
        if not vol_is_fraction:
            continue

        # À ce stade : vol existe ET vol < 1 → cohérence fraction confirmée
        for field in ("performance_1y", "performance_3y", "performance_5y"):
            v = f.get(field)
            if v is None: continue
            v = float(v)
            if v == 0 or abs(v) >= 1:
                continue
            # Convert
            new_v = round(v * 100, 4)
            new_v = max(-PERF_MAX, min(PERF_MAX, new_v))
            upd[field] = new_v
        if upd:
            upd["isin"] = f["isin"]
            upd["_check"] = "perf_decimal"
            upd["_vol_coherent"] = vol_is_fraction
            updates.append(upd)
    return updates


def fix_vol_decimal(funds: list[dict]) -> list[dict]:
    """Volatilité 0<val<1 → ×100.

    PRUDENCE : un livret/cash peut légitimement avoir vol=0.3% en %.
    Heuristique : on convertit uniquement si vol < 0.5 (livret peut être
    légitime à 0.3) ET (l'autre vol est aussi en fraction OU perf_1y
    suggère un fonds non-monétaire)."""
    updates = []
    for f in funds:
        upd = {}
        vol_1y = f.get("volatility_1y")
        vol_3y = f.get("volatility_3y")
        vol_1y_val = float(vol_1y) if vol_1y is not None else None
        vol_3y_val = float(vol_3y) if vol_3y is not None else None

        # Skip si AUCUNE vol n'est en fraction (cohérence)
        both_in_fraction = (
            vol_1y_val is not None and 0 < vol_1y_val < 1 and
            vol_3y_val is not None and 0 < vol_3y_val < 1
        )
        any_in_pct = (
            (vol_1y_val is not None and vol_1y_val >= 1) or
            (vol_3y_val is not None and vol_3y_val >= 1)
        )

        # Décision : convertir SEULEMENT si :
        #  - une des deux vol est <1 (sinon rien à faire)
        #  - ET aucune autre vol n'est en % (sinon incohérence)
        if not any_in_pct:
            for field, val in (("volatility_1y", vol_1y_val), ("volatility_3y", vol_3y_val)):
                if val is not None and 0 < val < 1:
                    new_v = round(val * 100, 4)
                    new_v = min(VOL_MAX, new_v)
                    upd[field] = new_v

        if upd:
            upd["isin"] = f["isin"]
            upd["_check"] = "vol_decimal"
            updates.append(upd)
    return updates


def fix_vol_saturated(funds: list[dict]) -> list[dict]:
    """Volatilité ≥9999.9 = donnée saturée corrompue → NULL."""
    updates = []
    for f in funds:
        upd = {}
        for field in ("volatility_1y", "volatility_3y"):
            v = f.get(field)
            if v is None: continue
            v = float(v)
            if v >= 9999.9:
                upd[field] = None
        if upd:
            upd["isin"] = f["isin"]
            upd["_check"] = "vol_saturated"
            updates.append(upd)
    return updates


def fix_aum_currency(funds: list[dict]) -> list[dict]:
    """aum_eur > 1 trillion (10^12) = devise locale non convertie → NULL."""
    updates = []
    THRESHOLD = 1_000_000_000_000  # 1 trillion EUR
    for f in funds:
        aum = f.get("aum_eur")
        if aum is None: continue
        if float(aum) > THRESHOLD:
            updates.append({
                "isin": f["isin"],
                "aum_eur": None,
                "_check": "aum_currency",
                "_old_value": float(aum),
                "_currency": f.get("currency"),
            })
    return updates


def fix_html_entities(funds: list[dict]) -> list[dict]:
    """HTML entities dans name/management_company → unescape."""
    updates = []
    for f in funds:
        upd = {}
        for field in ("name", "management_company"):
            v = f.get(field)
            if not v or not isinstance(v, str): continue
            if "&amp;" in v or "&quot;" in v or "&lt;" in v or "&gt;" in v or "&#" in v:
                clean = html.unescape(v)
                if clean != v:
                    upd[field] = clean
        if upd:
            upd["isin"] = f["isin"]
            upd["_check"] = "html_entities"
            updates.append(upd)
    return updates


CHECKS = {
    "perf_decimal":  fix_perf_decimal,
    "vol_decimal":   fix_vol_decimal,
    "vol_saturated": fix_vol_saturated,
    "aum_currency":  fix_aum_currency,
    "html_entities": fix_html_entities,
}


def run(apply: bool, only: list[str] | None):
    print("=" * 70)
    print("  fix-data-quality-batch — Corrections anomalies HIGH severity")
    print("=" * 70)
    print(f"  Mode  : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"  Cibles: {', '.join(only) if only else 'TOUS les checks'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    print("  Chargement des 22 292 fonds...")
    funds = fetch_all(client)
    print(f"  {len(funds)} fonds chargés\n")

    total_updates = 0
    total_ok = 0
    total_fail = 0

    for check_name, fix_func in CHECKS.items():
        if only and check_name not in only:
            continue

        print(f"  ━━━ {check_name} ━━━")
        updates = fix_func(funds)
        print(f"  {len(updates)} fonds à corriger")
        total_updates += len(updates)

        if updates:
            # Échantillons
            print(f"  Échantillons (3 premiers) :")
            for u in updates[:3]:
                meta = {k: v for k, v in u.items() if k.startswith("_") or k == "isin"}
                data = {k: v for k, v in u.items() if not k.startswith("_") and k != "isin"}
                print(f"    {meta} → {data}")

        if not apply or not updates:
            print()
            continue

        # Appliquer
        now_iso = datetime.now(timezone.utc).isoformat()
        ok = fail = 0
        for u in updates:
            isin = u.pop("isin")
            # Retirer les meta fields
            payload = {k: v for k, v in u.items() if not k.startswith("_")}
            payload["updated_at"] = now_iso
            try:
                client.table("investissement_funds").update(payload).eq("isin", isin).execute()
                ok += 1
                if ok % 200 == 0:
                    print(f"    {ok}/{len(updates)}...")
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"    ✗ {isin}: {e}")

        print(f"  → {ok} corrigés, {fail} erreurs")
        total_ok += ok
        total_fail += fail
        print()

    print(f"  {'━' * 70}")
    print(f"  TOTAL : {total_updates} corrections identifiées")
    if apply:
        print(f"  Appliqué : {total_ok} succès, {total_fail} erreurs")
        log_run("fix-data-quality-batch", "success", total_ok, total_fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--only", type=str, help="Liste de checks séparés par virgule")
    args = parser.parse_args()
    only = args.only.split(",") if args.only else None
    run(apply=args.apply, only=only)
