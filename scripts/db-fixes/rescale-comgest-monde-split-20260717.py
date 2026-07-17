#!/usr/bin/env python3
"""
rescale-comgest-monde-split-20260717.py — Recolle le split 100:1 de Comgest Monde
=================================================================================
SYMPTÔME : sur le backtest (comparaison de fonds livrée le 17/07/2026), la courbe
de Comgest Monde (C ou Z) s'effondre à ~1 % mi 2023 puis reste plate : le moteur
inv_portfolio_analyze lit la série BRUTE et interprète le saut de VL comme une
perte de 99 %.

CAUSE : split de part 100:1 du 22/05/2023 (VL 2 838,80 → 28,36, même source FT,
ratio 0,00999 ≈ 1/100 au mouvement de marché du lundi près). La série concatène
les deux échelles sans recalage. Fonds touchés (balayage des cassures ×2+ sur
toutes les parts « Comgest Monde ») :
    FR0000284689  Comgest Monde
    FR0013290939  Comgest Monde Z

CORRECTION : toutes les VL antérieures au 22/05/2023 sont divisées par 100
(facteur EXACT du split, pas le ratio de couture : le rendement réel du lundi de
bascule est ainsi préservé). Forme intra segment inchangée, aucune ligne créée.

Usage :
    python3 scripts/db-fixes/rescale-comgest-monde-split-20260717.py           # dry-run
    python3 scripts/db-fixes/rescale-comgest-monde-split-20260717.py --apply
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client  # noqa: E402

SPLIT_DATE = "2023-05-22"   # 1re VL post-split (exclue du recalage)
FACTOR = 0.01               # split 100:1
ISINS = ["FR0000284689", "FR0013290939"]


def main() -> None:
    apply = "--apply" in sys.argv
    sb = get_client()
    print(f"Recalage split Comgest Monde — mode {'APPLY' if apply else 'DRY-RUN'}")

    for isin in ISINS:
        rows = []
        off = 0
        while True:
            chunk = sb.table("investissement_fund_prices") \
                .select("price_date,nav").eq("isin", isin) \
                .lt("price_date", SPLIT_DATE) \
                .order("price_date").range(off, off + 999).execute().data
            rows.extend(chunk)
            if len(chunk) < 1000:
                break
            off += 1000
        # Garde-fou : ne recaler que des VL encore à l'ancienne échelle (> 500 €),
        # pour rester idempotent si le script est relancé.
        todo = [r for r in rows if r["nav"] is not None and float(r["nav"]) > 500]
        print(f"  {isin} : {len(rows)} VL avant le split, {len(todo)} à recaler")
        if not apply:
            continue
        for r in todo:
            sb.table("investissement_fund_prices") \
                .update({"nav": round(float(r["nav"]) * FACTOR, 6)}) \
                .eq("isin", isin).eq("price_date", r["price_date"]).execute()
        print(f"  {isin} : {len(todo)} VL recalées (×{FACTOR})")

    if not apply:
        print("Dry-run terminé. Relancer avec --apply pour écrire.")


if __name__ == "__main__":
    main()
