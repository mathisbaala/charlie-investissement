#!/usr/bin/env python3
"""
recalc-completeness-v2.py — Recalcul data_completeness avec formule par product_type
=====================================================================================
Évolution de recalc-completeness.py : la formule uniforme actuelle pénalise
structurellement certains types (actions plafonnées à 56, SCPI sans DVM scorée, etc.).

Ce script propose une formule différenciée par product_type, calibrée sur les champs
réellement disponibles pour chaque catégorie (cf. docs/data-standards.md).

Modes :
    (défaut, sans flag)    Formule legacy (identique à recalc-completeness.py)
    --per-type             Formule différenciée par product_type
    --apply                Écrit les nouveaux scores en base
    --dry-run              Force le mode aperçu (par défaut si pas --apply)
    --type opcvm,action    Restreint à certains product_type
    --verbose              Affiche la décomposition score par champ pour 10 fonds

Usage :
    python3 scripts/migrations/recalc-completeness-v2.py --per-type
    python3 scripts/migrations/recalc-completeness-v2.py --per-type --apply
    python3 scripts/migrations/recalc-completeness-v2.py --per-type --type scpi,crypto
"""

import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter, defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client, log_run


# ─── Champs lus en DB ─────────────────────────────────────────────────────────

COMPLETENESS_FIELDS = (
    "isin,product_type,currency,asset_class,"
    "ter,ongoing_charges,sri,srri,"
    "performance_1y,performance_3y,performance_5y,"
    "sfdr_article,aum_eur,kid_parsed_at,kid_url,"
    "volatility_1y,max_drawdown_1y,sharpe_1y,"
    "inception_date,track_record_years,morningstar_rating,"
    "management_company,category,region_exposure,risk_level,"
    "data_completeness"
)
BATCH_SIZE = 500


# ─── Formule legacy (inchangée) ───────────────────────────────────────────────

def compute_completeness_legacy(fund: dict) -> int:
    """Formule actuelle (identique à scripts/db.py:compute_completeness)."""
    score = 0
    if fund.get("ongoing_charges") is not None or fund.get("ter") is not None:
        score += 14
    if fund.get("sri") is not None or fund.get("srri") is not None:
        score += 14
    if fund.get("performance_1y") is not None:
        score += 14
    if fund.get("performance_3y") is not None:
        score += 14
    if fund.get("sfdr_article") is not None:
        score += 14
    if fund.get("aum_eur") is not None:
        score += 14
    if fund.get("kid_parsed_at") is not None:
        score += 16
    return min(score, 100)


# ─── Formules par product_type ────────────────────────────────────────────────
#
# Chaque formule renvoie (score, decomposition: dict[label, points])
# Les pondérations sont calibrées sur 100 points exactement.
# Voir docs/data-standards.md pour la justification.

def _has(fund: dict, *keys: str) -> bool:
    return any(fund.get(k) is not None and fund.get(k) != "" for k in keys)


def compute_etf(fund: dict) -> tuple[int, dict]:
    """
    ETF (UCITS) — schéma complet attendu : KID, SRI/SRRI, TER, AUM, perf, vol, sharpe.
    Max = 100, atteint pour un ETF Morningstar/JustETF bien enrichi.
    """
    d = {}
    d["frais"]      = 14 if _has(fund, "ongoing_charges", "ter") else 0
    d["risque"]     = 14 if _has(fund, "sri", "srri") else 0
    d["perf_1y"]    = 12 if _has(fund, "performance_1y") else 0
    d["perf_3y"]    = 10 if _has(fund, "performance_3y") else 0
    d["sfdr"]       = 8  if _has(fund, "sfdr_article") else 0
    d["aum"]        = 12 if _has(fund, "aum_eur") else 0
    d["kid"]        = 14 if _has(fund, "kid_parsed_at", "kid_url") else 0
    d["volatility"] = 8  if _has(fund, "volatility_1y") else 0
    d["track_rec"]  = 4  if _has(fund, "inception_date", "track_record_years") else 0
    d["mngmt"]      = 4  if _has(fund, "management_company") else 0
    return min(sum(d.values()), 100), d


def compute_opcvm(fund: dict) -> tuple[int, dict]:
    """
    OPCVM (UCITS retail FR) — formule équivalente ETF, calibrée sur les sources
    AMF GECO + Boursorama + KID PDF.
    """
    d = {}
    d["frais"]      = 14 if _has(fund, "ongoing_charges", "ter") else 0
    d["risque"]     = 14 if _has(fund, "sri", "srri") else 0
    d["perf_1y"]    = 12 if _has(fund, "performance_1y") else 0
    d["perf_3y"]    = 10 if _has(fund, "performance_3y") else 0
    d["sfdr"]       = 8  if _has(fund, "sfdr_article") else 0
    d["aum"]        = 10 if _has(fund, "aum_eur") else 0
    d["kid"]        = 14 if _has(fund, "kid_parsed_at", "kid_url") else 0
    d["volatility"] = 8  if _has(fund, "volatility_1y") else 0
    d["track_rec"]  = 6  if _has(fund, "inception_date", "track_record_years") else 0
    d["mngmt"]      = 4  if _has(fund, "management_company") else 0
    return min(sum(d.values()), 100), d


def compute_action(fund: dict) -> tuple[int, dict]:
    """
    Action individuelle — pas de TER, SRRI, KID, SFDR au sens UCITS.
    Champs réellement pertinents :
      - currency  (devise de cotation)        20
      - aum_eur   (market cap)                25
      - performance_1y                        20
      - performance_3y                        15
      - performance_5y                        10
      - asset_class                            5
      - pea_eligible (toujours rempli)         5
    Total = 100
    """
    d = {}
    d["currency"]    = 20 if _has(fund, "currency") else 0
    d["market_cap"]  = 25 if _has(fund, "aum_eur") else 0
    d["perf_1y"]     = 20 if _has(fund, "performance_1y") else 0
    d["perf_3y"]     = 15 if _has(fund, "performance_3y") else 0
    d["perf_5y"]     = 10 if _has(fund, "performance_5y") else 0
    d["asset_class"] = 5  if _has(fund, "asset_class") else 0
    d["pea_flag"]    = 5  # toujours rempli (bool not null en DB)
    return min(sum(d.values()), 100), d


def compute_scpi(fund: dict) -> tuple[int, dict]:
    """
    SCPI — performance_1y agit comme DVM (Distribution sur Valeur de Marché),
    aum_eur comme capitalisation. Pas de SFDR UCITS, mais souvent disponible.
    """
    d = {}
    d["dvm"]         = 20 if _has(fund, "performance_1y") else 0       # TDVM
    d["perf_3y"]     = 10 if _has(fund, "performance_3y") else 0
    d["cap"]         = 15 if _has(fund, "aum_eur") else 0              # capitalisation
    d["frais"]       = 10 if _has(fund, "ongoing_charges", "ter") else 0
    d["risque"]      = 10 if _has(fund, "sri", "srri") else 0
    d["mngmt"]       = 10 if _has(fund, "management_company") else 0
    d["inception"]   = 10 if _has(fund, "inception_date") else 0
    d["category"]    = 5  if _has(fund, "category") else 0
    d["region"]      = 5  if _has(fund, "region_exposure") else 0
    d["sfdr"]        = 5  if _has(fund, "sfdr_article") else 0
    return min(sum(d.values()), 100), d


def compute_crypto(fund: dict) -> tuple[int, dict]:
    """
    Crypto — pas de TER classique. Performance & volatilité sont les clés.
    """
    d = {}
    d["market_cap"] = 25 if _has(fund, "aum_eur") else 0
    d["perf_1y"]    = 20 if _has(fund, "performance_1y") else 0
    d["perf_3y"]    = 15 if _has(fund, "performance_3y") else 0
    d["volatility"] = 15 if _has(fund, "volatility_1y") else 0
    d["risque"]     = 10 if _has(fund, "sri", "srri") else 0
    d["category"]   = 10 if _has(fund, "category") else 0
    d["currency"]   = 5  if _has(fund, "currency") else 0
    return min(sum(d.values()), 100), d


def compute_fonds_euros(fund: dict) -> tuple[int, dict]:
    """
    Fonds euros (UC) — produit régulé : taux annuel garanti + AUM + frais.
    Pas de SFDR au sens UCITS (sauf SCR ESG récent).
    """
    d = {}
    d["taux_an"]    = 35 if _has(fund, "performance_1y") else 0  # rendement annuel net
    d["frais"]      = 20 if _has(fund, "ongoing_charges", "ter") else 0
    d["mngmt"]      = 15 if _has(fund, "management_company") else 0
    d["risque"]     = 10 if _has(fund, "sri", "srri") else 0
    d["aum"]        = 10 if _has(fund, "aum_eur") else 0
    d["track_3y"]   = 10 if _has(fund, "performance_3y") else 0  # historique 3 ans
    d["track_5y"]   = 10 if _has(fund, "performance_5y") else 0  # historique 5 ans
    return min(sum(d.values()), 100), d


def compute_livret(fund: dict) -> tuple[int, dict]:
    """
    Livret réglementé — taux + nom + management_company = tout.
    """
    d = {}
    d["taux"]       = 50 if _has(fund, "performance_1y") else 0  # taux légal
    d["mngmt"]      = 20 if _has(fund, "management_company") else 0
    d["aum"]        = 15 if _has(fund, "aum_eur") else 0         # encours total
    d["risque"]     = 10 if _has(fund, "sri", "srri") else 0
    d["currency"]   = 5  if _has(fund, "currency") else 0
    return min(sum(d.values()), 100), d


def compute_obligation(fund: dict) -> tuple[int, dict]:
    """
    Obligation souveraine / corporate — rendement, durée, rating, AUM.
    """
    d = {}
    d["perf_1y"]    = 15 if _has(fund, "performance_1y") else 0
    d["perf_3y"]    = 10 if _has(fund, "performance_3y") else 0
    d["risque"]     = 15 if _has(fund, "sri", "srri") else 0
    d["rating"]     = 15 if _has(fund, "morningstar_rating") else 0
    d["aum"]        = 10 if _has(fund, "aum_eur") else 0
    d["volatility"] = 10 if _has(fund, "volatility_1y") else 0
    d["track_rec"]  = 10 if _has(fund, "inception_date", "track_record_years") else 0
    d["mngmt"]      = 10 if _has(fund, "management_company") else 0
    d["currency"]   = 5  if _has(fund, "currency") else 0
    return min(sum(d.values()), 100), d


def compute_pe_retail(fund: dict) -> tuple[int, dict]:
    """
    FCPI / FIP / FCPR — fonds de capital-investissement retail (avec KID public possible).
    SRRI/SRI possible mais perf rare. AUM dispo via AMF.
    """
    d = {}
    d["aum"]         = 15 if _has(fund, "aum_eur") else 0
    d["mngmt"]       = 15 if _has(fund, "management_company") else 0
    d["category"]    = 10 if _has(fund, "category") else 0
    d["inception"]   = 10 if _has(fund, "inception_date") else 0
    d["track_years"] = 10 if _has(fund, "track_record_years") else 0
    d["risque"]      = 15 if _has(fund, "sri", "srri") else 0
    d["perf_1y"]     = 10 if _has(fund, "performance_1y") else 0
    d["perf_3y"]     = 5  if _has(fund, "performance_3y") else 0
    d["frais"]       = 5  if _has(fund, "ongoing_charges", "ter") else 0
    d["sfdr"]        = 5  if _has(fund, "sfdr_article") else 0
    return min(sum(d.values()), 100), d


def compute_pe_institutional(fund: dict) -> tuple[int, dict]:
    """
    FPCI / FPS / FCPE / FCT — fonds institutionnels ou réservés.
    Pas de KID public, pas de performance grand public. Score plafonné par construction.
    Le minimum métier est : identifiant + société de gestion + date de création.
    On garde un score interprétable mais on ne vise pas 100.
    """
    d = {}
    d["mngmt"]       = 25 if _has(fund, "management_company") else 0
    d["inception"]   = 20 if _has(fund, "inception_date") else 0
    d["track_years"] = 15 if _has(fund, "track_record_years") else 0
    d["aum"]         = 15 if _has(fund, "aum_eur") else 0
    d["category"]    = 10 if _has(fund, "category") else 0
    d["sfdr"]        = 5  if _has(fund, "sfdr_article") else 0
    d["currency"]    = 5  if _has(fund, "currency") else 0
    d["asset_class"] = 5  if _has(fund, "asset_class") else 0
    return min(sum(d.values()), 100), d


def compute_opci(fund: dict) -> tuple[int, dict]:
    """
    OPCI — immobilier coté. Schéma proche SCPI mais perf et SRRI obligatoires.
    """
    d = {}
    d["perf_1y"]   = 20 if _has(fund, "performance_1y") else 0
    d["perf_3y"]   = 15 if _has(fund, "performance_3y") else 0
    d["risque"]    = 15 if _has(fund, "sri", "srri") else 0
    d["aum"]       = 15 if _has(fund, "aum_eur") else 0
    d["frais"]     = 10 if _has(fund, "ongoing_charges", "ter") else 0
    d["mngmt"]     = 10 if _has(fund, "management_company") else 0
    d["inception"] = 10 if _has(fund, "inception_date") else 0
    d["sfdr"]      = 5  if _has(fund, "sfdr_article") else 0
    return min(sum(d.values()), 100), d


# ─── Dispatcher ───────────────────────────────────────────────────────────────

DISPATCH = {
    "etf":         compute_etf,
    "opcvm":       compute_opcvm,
    "action":      compute_action,
    "scpi":        compute_scpi,
    "crypto":      compute_crypto,
    "fonds_euros": compute_fonds_euros,
    "livret":      compute_livret,
    "obligation":  compute_obligation,
    "fcpi":        compute_pe_retail,
    "fip":         compute_pe_retail,
    "fcpr":        compute_pe_retail,
    "fpci":        compute_pe_institutional,
    "fps":         compute_pe_institutional,
    "fct":         compute_pe_institutional,
    "fcpe":        compute_pe_institutional,
    "opci":        compute_opci,
}


def compute_completeness_v2(fund: dict, product_type: str | None = None) -> tuple[int, dict]:
    """
    Renvoie (score 0-100, decomposition par champ).
    Fallback : si product_type inconnu ou None → formule legacy.
    """
    pt = product_type or fund.get("product_type")
    fn = DISPATCH.get(pt)
    if fn is None:
        return compute_completeness_legacy(fund), {"legacy_fallback": compute_completeness_legacy(fund)}
    return fn(fund)


# ─── Pipeline d'exécution ─────────────────────────────────────────────────────

def fetch_all(client, types_filter: list[str] | None) -> list[dict]:
    funds: list[dict] = []
    offset = 0
    page = 1000
    while True:
        q = client.table("investissement_funds").select(COMPLETENESS_FIELDS)
        if types_filter:
            q = q.in_("product_type", types_filter)
        batch = q.range(offset, offset + page - 1).execute().data or []
        funds.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return funds


def show_distribution(label: str, scores: list[int]) -> None:
    if not scores:
        print(f"  {label}: aucun fonds")
        return
    n = len(scores)
    above_80 = sum(1 for s in scores if s >= 80)
    eq_100 = sum(1 for s in scores if s == 100)
    avg = sum(scores) / n
    print(f"  {label:25} n={n:6d}  avg={avg:5.1f}  ≥80: {above_80:5d} ({above_80*100/n:4.1f}%)  =100: {eq_100:5d}")


def show_decomposition(funds: list[dict], n: int = 10) -> None:
    print("\n  Décomposition détaillée (10 premiers fonds) :")
    for f in funds[:n]:
        pt = f.get("product_type")
        score, decomp = compute_completeness_v2(f, pt)
        old = f.get("data_completeness") or 0
        delta = score - old
        items = ", ".join(f"{k}={v}" for k, v in decomp.items() if v > 0) or "(vide)"
        print(f"    {f['isin']:15} [{pt:10}] old={old:3d} → new={score:3d} (Δ{delta:+3d})  {items}")


def run(apply: bool, per_type: bool, types_filter: list[str] | None, verbose: bool) -> None:
    print("=" * 72)
    print("  Recalc Completeness V2 — Formule différenciée par product_type")
    print("=" * 72)
    print(f"  Mode      : {'APPLY (écriture)' if apply else 'DRY-RUN (aperçu)'}")
    print(f"  Formule   : {'PER-TYPE' if per_type else 'LEGACY (compatible)'}")
    print(f"  Filtre    : {','.join(types_filter) if types_filter else 'tous types'}")
    print()

    started = datetime.now(timezone.utc)
    client  = get_client()

    print("  Chargement...")
    funds = fetch_all(client, types_filter)
    print(f"  → {len(funds)} fonds chargés\n")

    # Distribution AVANT (= ce qui est en DB actuellement)
    print("  Distribution actuelle en DB (data_completeness existant) :")
    by_type_old = defaultdict(list)
    for f in funds:
        by_type_old[f.get("product_type")].append(f.get("data_completeness") or 0)
    for pt, scores in sorted(by_type_old.items(), key=lambda x: -len(x[1])):
        show_distribution(pt, scores)
    show_distribution("== TOTAL ==", [f.get("data_completeness") or 0 for f in funds])

    # Distribution APRÈS (avec la formule choisie)
    print(f"\n  Distribution simulée avec formule {'PER-TYPE' if per_type else 'LEGACY'} :")
    by_type_new = defaultdict(list)
    updates: list[dict] = []
    for f in funds:
        pt = f.get("product_type")
        if per_type:
            new_score, _ = compute_completeness_v2(f, pt)
        else:
            new_score = compute_completeness_legacy(f)
        by_type_new[pt].append(new_score)
        old_score = f.get("data_completeness") or 0
        if new_score != old_score:
            updates.append({"isin": f["isin"], "data_completeness": new_score})

    for pt, scores in sorted(by_type_new.items(), key=lambda x: -len(x[1])):
        show_distribution(pt, scores)
    show_distribution("== TOTAL ==", [s for arr in by_type_new.values() for s in arr])

    # Delta tabulaire
    print(f"\n  Delta ≥80 par type (combien de fonds passent à ≥80) :")
    print(f"    {'type':15} {'old≥80':>8} {'new≥80':>8} {'delta':>8}")
    for pt in sorted(by_type_new):
        old80 = sum(1 for s in by_type_old[pt] if s >= 80)
        new80 = sum(1 for s in by_type_new[pt] if s >= 80)
        delta = new80 - old80
        print(f"    {pt:15} {old80:>8} {new80:>8} {delta:>+8}")

    print(f"\n  {len(updates)} fonds avec score à mettre à jour")

    if verbose:
        show_decomposition(funds, 10)

    if not apply:
        print("\n  [DRY-RUN] Pas d'écriture en base. Ajouter --apply pour persister.")
        return

    print("\n  Application en base...")
    now = datetime.now(timezone.utc).isoformat()
    ok = fail = 0
    for i in range(0, len(updates), BATCH_SIZE):
        batch = updates[i : i + BATCH_SIZE]
        for row in batch:
            try:
                client.table("investissement_funds") \
                    .update({"data_completeness": row["data_completeness"], "updated_at": now}) \
                    .eq("isin", row["isin"]) \
                    .execute()
                ok += 1
            except Exception as e:
                fail += 1
                if fail <= 3:
                    print(f"  ✗ {row['isin']} : {e}")
        pct = min(i + len(batch), len(updates)) / len(updates) * 100
        if i % (BATCH_SIZE * 5) == 0 or i + len(batch) >= len(updates):
            print(f"    [{i + len(batch):6d}/{len(updates)}] {pct:.0f}%  ✓{ok}  ✗{fail}")

    print(f"\n  → {ok} mis à jour, {fail} erreurs")
    log_run("recalc-completeness-v2" + ("-per-type" if per_type else "-legacy"),
            "success", ok, fail, started_at=started)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Recalcul data_completeness avec formule différenciée par product_type",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--apply", action="store_true",
                        help="Écrire les nouveaux scores en base (sinon dry-run)")
    parser.add_argument("--per-type", action="store_true",
                        help="Utilise la formule différenciée par product_type")
    parser.add_argument("--type", type=str, default="",
                        help="Restreint à certains product_type (comma-separated)")
    parser.add_argument("--verbose", action="store_true",
                        help="Affiche la décomposition score par champ pour 10 fonds")
    args = parser.parse_args()
    types_filter = [t.strip() for t in args.type.split(",") if t.strip()] or None
    run(apply=args.apply, per_type=args.per_type,
        types_filter=types_filter, verbose=args.verbose)
