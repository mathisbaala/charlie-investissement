#!/usr/bin/env python3
"""
ft-full-sweep.py — Balayage complet FT puis calcul des métriques.
Driver one-shot : enrichit tous les OPCVM/ETF manquants depuis FT
(NAV + frais + catégorie + holdings/secteurs/régions), puis calcule
perf/vol/sharpe/srri sur tous les ISIN nouvellement pricés par FT.

Usage : python3 scripts/ft-full-sweep.py
"""
import importlib.util
import sys
from datetime import date, timedelta, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, str(ROOT / rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ft = _load("ft", "scrapers/ft-enricher.py")
    cm = _load("cm", "enrichers/compute-metrics.py")
    from db import get_client, update_funds_bulk, log_run

    print("######## PHASE 1 : enrichissement FT (complet) ########", flush=True)
    ft.run(apply=True, limit=None, isin_arg=None,
           workers=6, delay=0.15, with_holdings=True)

    print("\n######## PHASE 2 : calcul des métriques (ISIN FT) ########", flush=True)
    client = get_client()
    DATE_5Y = (date.today() - timedelta(days=365 * 5)).isoformat()
    D1 = (date.today() - timedelta(days=365)).isoformat()
    D3 = (date.today() - timedelta(days=365 * 3)).isoformat()

    # Liste des ISIN ayant des VL FT — pagination keyset (gt isin) plutôt que
    # par offset numérique : la table fait ~3,4 M lignes et un deep-offset y
    # scanne-puis-jette tout le préfixe (lenteur quadratique + statement timeout).
    # Cf. db.isins_with_recent_prices pour le même pattern.
    ft_isins, after = set(), ""
    while True:
        rows = (client.table("investissement_fund_prices").select("isin")
                .eq("source", "financial-times")
                .gt("isin", after).order("isin").limit(1000)
                .execute().data or [])
        if not rows:
            break
        for r in rows:
            ft_isins.add(r["isin"])
        if len(rows) < 1000:
            break
        after = rows[-1]["isin"]
    ft_isins = sorted(ft_isins)
    print(f"  {len(ft_isins)} ISIN FT à calculer", flush=True)

    def fetch_all(isin):
        rows, o = [], 0
        while True:
            r = (client.table("investissement_fund_prices").select("price_date,nav")
                 .eq("isin", isin).gte("price_date", DATE_5Y)
                 .order("price_date", desc=False).range(o, o + 999).execute().data or [])
            rows += r
            if len(r) < 1000:
                break
            o += 1000
        pairs = [(x["price_date"], float(x["nav"])) for x in rows if x.get("nav") is not None]
        def win(c): return [(d, p) for d, p in pairs if d >= c]
        def span(pp): return 0 if len(pp) < 2 else (date.fromisoformat(pp[-1][0]) - date.fromisoformat(pp[0][0])).days
        w5, w3, w1 = win(DATE_5Y), win(D3), win(D1)
        return {"all": [p for _, p in pairs], "5y": [p for _, p in w5],
                "3y": [p for _, p in w3], "1y": [p for _, p in w1],
                "span": {"5y": span(w5), "3y": span(w3), "1y": span(w1)}}

    rf = cm.get_ecb_rate()
    started = datetime.now(timezone.utc)
    updates, skipped = [], 0
    for i, isin in enumerate(ft_isins, 1):
        p = fetch_all(isin)
        if len(p["1y"]) < cm.MIN_POINTS_1Y:
            skipped += 1
            continue
        m = cm.compute_fund_metrics(p["1y"], p["3y"], p["5y"], p["all"], rf, p["span"])
        # Enrichissement opportuniste : ne JAMAIS écraser une valeur existante
        # avec None. compute_fund_metrics renvoie None pour les fenêtres trop
        # courtes ; sur un fonds ciblé pour ses frais (mais qui a déjà une perf),
        # écrire ce None effacerait la perf. On ne garde que les valeurs réelles.
        m = {k: v for k, v in (m or {}).items() if v is not None}
        if m:
            updates.append({"isin": isin, **m})
        if i % 200 == 0:
            print(f"  {i}/{len(ft_isins)} calc:{len(updates)} skip:{skipped}", flush=True)

    ok, fail = update_funds_bulk(updates, batch_size=200)
    p3 = sum(1 for r in updates if r.get("performance_3y") is not None)
    p5 = sum(1 for r in updates if r.get("performance_5y") is not None)
    print(f"\n  métriques écrites : {ok} OK / {fail} échec "
          f"(perf_3y:{p3} perf_5y:{p5})", flush=True)
    log_run(scraper="ft-full-sweep-metrics", status="success",
            records_processed=ok, records_failed=fail, started_at=started)
    print("\n######## TERMINÉ ########", flush=True)


if __name__ == "__main__":
    main()
