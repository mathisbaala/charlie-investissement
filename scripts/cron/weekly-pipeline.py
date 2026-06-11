#!/usr/bin/env python3
"""
weekly-pipeline.py — Rafraîchissement hebdomadaire (sans risque)
=================================================================
Cadence pensée pour des CGP : données fraîches chaque lundi matin,
sans suivi quotidien type salle de marché.

Lance dans l'ordre :
  1. ft-enricher --refresh (tier 1) : re-fetch la VL courante (Financial
     Times, source la plus fraîche) des TOP_BY_AUM plus gros fonds par
     encours, CHAQUE semaine → investissement_fund_prices.
  2. ft-enricher --refresh (rotation longue traîne) : re-fetch un bucket
     de la queue de l'univers (rang > TOP_BY_AUM), différent chaque
     semaine (offset = numéro de semaine ISO modulo ROTATE_WEEKS). En
     ROTATE_WEEKS semaines, toute la longue traîne FT-éligible est
     couverte → plus aucun fonds figé indéfiniment.
  3. compute-metrics : recalcul perf/vol/Sharpe/SRRI sur les fonds
     ayant un historique de prix → investissement_funds.

Tout est fill-only / additif côté fonds (VL ajoutées, métriques dérivées
recalculées). Aucun upsert destructif de l'univers. Les scrapers de SEEDING
(amf-geco-full, justetf-scraper base, scpi-full-scraper) ne tournent JAMAIS
ici — à ne pas confondre avec justetf-nav (filet de cours ETF, purement
additif via upsert isin,price_date, comme ft-enricher).

Rotation : le top par encours (fonds réellement utilisés par les CGP)
reste frais chaque semaine ; le reste de l'univers (~19,6 k fonds) est
balayé par buckets sur ROTATE_WEEKS semaines, ce qui garde le run hebdo
court (~9 k fonds/semaine) tout en bornant l'âge max d'une VL à ~1 mois.

Planifié par .github/workflows/weekly-refresh.yml (lundi 04:00 UTC).
Lançable à la main :  python3 scripts/cron/weekly-pipeline.py
"""

import sys
import subprocess
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent

# Tier 1 : top par encours, rafraîchi CHAQUE semaine (fonds les plus consultés).
TOP_BY_AUM = 4000
# Rotation longue traîne : un bucket de TAIL_BUCKET fonds par semaine, sur
# ROTATE_WEEKS semaines. Offsets 4000/9000/14000/19000 → couvre rang 4000→24000,
# soit tout l'univers FT-éligible (~23,6 k OPCVM/ETF) en 4 semaines.
TAIL_BUCKET = 5000
ROTATE_WEEKS = 4


def weekly_steps():
    """Construit les étapes du run, avec l'offset de rotation du jour."""
    iso_week = date.today().isocalendar()[1]
    week_index = iso_week % ROTATE_WEEKS
    tail_offset = TOP_BY_AUM + week_index * TAIL_BUCKET
    print(f"  Rotation : semaine ISO {iso_week} "
          f"→ bucket {week_index + 1}/{ROTATE_WEEKS} (offset {tail_offset})")

    common = ["--workers", "6", "--delay", "0.15"]
    # (chemin relatif à SCRIPTS_DIR, arguments). --apply ajouté automatiquement.
    return [
        # Tier 1 : top encours, chaque semaine.
        ("scrapers/ft-enricher.py",
         ["--refresh", "--no-holdings", "--limit", str(TOP_BY_AUM)] + common),
        # Rotation : un bucket de la longue traîne, différent chaque semaine.
        ("scrapers/ft-enricher.py",
         ["--refresh", "--no-holdings",
          "--offset", str(tail_offset), "--limit", str(TAIL_BUCKET)] + common),
        # Filet ETF : JustETF (API cours publique) rafraîchit les ETF que FT ne
        # couvre pas — gros ETF type Amundi MSCI World / BNP S&P 500, sinon figés
        # sur des VL Yahoo périmées. Cible uniquement les ETF non frais (cf.
        # STALE_DAYS) → pas de doublon avec FT. AVANT compute-metrics.
        ("scrapers/justetf-nav.py", []),
        ("enrichers/compute-metrics.py", []),
        # Encours rafraîchis ci-dessus → recalcule le représentant share-class
        # (is_primary_share_class) qui porte la dédup de /api/funds.
        ("enrichers/refresh-primary-share-class.py", []),
        # is_primary_share_class / data_completeness ayant pu changer, on repropage
        # le référencement assureur sur la primaire (sinon screener AV périmé).
        ("enrichers/refresh-insurer-mv.py", []),
    ]


def run_script(name: str, args: list[str]) -> int:
    cmd = [sys.executable, str(SCRIPTS_DIR / name), "--apply"] + args
    print(f"\n  {'─' * 50}")
    print(f"  Lancement : {name} {' '.join(args)}")
    print(f"  {'─' * 50}", flush=True)
    result = subprocess.run(cmd, cwd=str(SCRIPTS_DIR.parent))
    return result.returncode


def main() -> int:
    print("=" * 60)
    print(f"  Pipeline hebdomadaire — {date.today().isoformat()}")
    print("=" * 60)

    failures = []
    for name, args in weekly_steps():
        rc = run_script(name, args)
        if rc != 0:
            print(f"  ⚠️  {name} a retourné {rc}")
            failures.append(name)

    print("\n  ✓ Pipeline hebdomadaire terminé"
          + (f" ({len(failures)} étape(s) en échec : {', '.join(failures)})" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
