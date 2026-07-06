#!/usr/bin/env python3
"""
prune-unenriched-seeds.py — Cycle de vie des fonds « semés » (data_source *-seed)
=================================================================================
Les scrapers d'éligibilité PDF (cf. _av_pdf_common seed_missing) ajoutent au
catalogue des UC citées par les contrats mais absentes. Beaucoup sont des fonds
ANCIENS / FERMÉS / dormants qu'on ne peut PAS enrichir (aucune VL disponible) :
sans NAV → sans perf → invisibles → poids mort.

Politique (décision produit 06/07) : **ne garder que l'enrichissable.**
Ce script, à lancer dans le pipeline APRÈS les scrapers de seed :
  1. ENRICHIT en ciblé les seeds sans prix (les enrichers de rotation ne les
     atteignent jamais : ils trient par encours, or un seed a aum_eur = NULL) :
       - ISIN FR      → geco-nav.py  (AMF GECO)
       - ISIN LU/IE/GB → ft-enricher.py (Financial Times)
  2. compute-metrics sur ceux qui ont gagné une VL (perf/vol/sharpe).
  3. PURGE les seeds toujours SANS aucune VL au-delà d'un délai de grâce
     (--grace-days, défaut 21 j) : suppression du fonds + de ses liens
     d'éligibilité. Le délai de grâce laisse au moins un passage d'enrichissement.

Idempotent, fill-only côté enrichissement. La purge ne touche QUE des fonds
`data_source like '%-seed'` SANS prix (jamais un fonds réel).

Usage :
    python3 scripts/enrichers/prune-unenriched-seeds.py            # dry-run
    python3 scripts/enrichers/prune-unenriched-seeds.py --apply
    python3 scripts/enrichers/prune-unenriched-seeds.py --apply --grace-days 30 --no-enrich
"""
import sys
import argparse
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_client

SCRAPERS = Path(__file__).parent.parent / "scrapers"
PY = sys.executable


def _seeds_without_prices(client) -> list[dict]:
    """Fonds semés (data_source *-seed) sans aucune VL. Paginé."""
    out, off = [], 0
    while True:
        rows = (client.table("investissement_funds")
                .select("isin,updated_at")
                .like("data_source", "%-seed")
                .range(off, off + 999).execute().data)
        if not rows:
            break
        for r in rows:
            n = (client.table("investissement_fund_prices")
                 .select("isin", count="exact").eq("isin", r["isin"]).limit(1).execute().count)
            if not n:
                out.append(r)
        if len(rows) < 1000:
            break
        off += 1000
    return out


def _run(script: str, isin: str) -> None:
    try:
        subprocess.run([PY, str(SCRAPERS / script), "--isin", isin, "--apply"],
                       capture_output=True, timeout=120)
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser(description="Enrichit puis purge les seeds non-enrichissables")
    ap.add_argument("--apply", action="store_true", help="Écrire (enrich + purge)")
    ap.add_argument("--grace-days", type=int, default=21, help="Âge min avant purge (défaut 21 j)")
    ap.add_argument("--no-enrich", action="store_true", help="Sauter l'étape d'enrichissement ciblé")
    args = ap.parse_args()

    client = get_client()
    seeds = _seeds_without_prices(client)
    print(f"Seeds sans VL : {len(seeds)}")

    # 1-2. Enrichissement ciblé (les seuls à pouvoir survivre).
    if args.apply and not args.no_enrich and seeds:
        fr = [s["isin"] for s in seeds if s["isin"][:2] == "FR"]
        ft = [s["isin"] for s in seeds if s["isin"][:2] in ("LU", "IE", "GB")]
        print(f"  Enrichissement : {len(fr)} FR via GECO, {len(ft)} LU/IE/GB via FT…")
        for i in fr:
            _run("geco-nav.py", i)
        for i in ft:
            _run("ft-enricher.py", i)
        newly = [s["isin"] for s in seeds
                 if client.table("investissement_fund_prices")
                 .select("isin", count="exact").eq("isin", s["isin"]).limit(1).execute().count]
        print(f"  → {len(newly)} seeds ont désormais une VL")
        for i in newly:
            try:
                subprocess.run([PY, str(Path(__file__).parent / "compute-metrics.py"),
                                "--isin", i, "--apply"], capture_output=True, timeout=120)
            except Exception:
                pass
        seeds = _seeds_without_prices(client)  # recalcul du reliquat sans VL

    # 3. Purge des seeds toujours sans VL au-delà du délai de grâce.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=args.grace_days)).isoformat()
    dead = [s["isin"] for s in seeds if (s.get("updated_at") or "") < cutoff]
    print(f"Seeds morts à purger (sans VL, > {args.grace_days} j) : {len(dead)}")
    if not args.apply:
        print("DRY-RUN — rien supprimé. Relancer avec --apply.")
        return
    n_elig = n_fund = 0
    for k in range(0, len(dead), 100):
        chunk = dead[k:k + 100]
        client.table("investissement_av_lux_eligibility").delete().in_("isin", chunk).execute()
        client.table("investissement_funds").delete().in_("isin", chunk).execute()
        n_fund += len(chunk)
    print(f"Purge : {n_fund} fonds semés morts supprimés (+ liens d'éligibilité).")
    if dead:
        print("⚠ Pense à rafraîchir la matview : select inv_refresh_fund_insurers_mv();")


if __name__ == "__main__":
    main()
