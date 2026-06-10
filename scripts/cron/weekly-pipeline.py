#!/usr/bin/env python3
"""
weekly-pipeline.py — Rafraîchissement hebdomadaire (sans risque)
=================================================================
Cadence pensée pour des CGP : données fraîches chaque lundi matin,
sans suivi quotidien type salle de marché.

Lance dans l'ordre :
  1. ft-enricher --refresh : re-fetch la VL courante (Financial Times,
     source la plus fraîche) des plus gros fonds par encours, qu'ils
     soient déjà complets ou non → investissement_fund_prices.
  2. compute-metrics : recalcul perf/vol/Sharpe/SRRI sur les fonds
     ayant un historique de prix → investissement_funds.

Tout est fill-only / additif côté fonds (VL ajoutées, métriques dérivées
recalculées). Aucun upsert destructif de l'univers. Les scrapers de
seeding (GECO, justETF base, SCPI) ne tournent JAMAIS ici.

On borne à TOP_BY_AUM fonds pour garder le run court et focalisé sur
les fonds réellement utilisés par les CGP ; le reste de l'univers est
balayé par le pipeline mensuel.

Planifié par .github/workflows/weekly-refresh.yml (lundi 04:00 UTC).
Lançable à la main :  python3 scripts/cron/weekly-pipeline.py
"""

import sys
import subprocess
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent

TOP_BY_AUM = "4000"  # nombre de fonds (par encours décroissant) rafraîchis/semaine

# (chemin relatif à SCRIPTS_DIR, arguments). --apply est ajouté automatiquement.
WEEKLY_STEPS = [
    ("scrapers/ft-enricher.py",
     ["--refresh", "--no-holdings", "--limit", TOP_BY_AUM,
      "--workers", "6", "--delay", "0.15"]),
    ("enrichers/compute-metrics.py", []),
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
    for name, args in WEEKLY_STEPS:
        rc = run_script(name, args)
        if rc != 0:
            print(f"  ⚠️  {name} a retourné {rc}")
            failures.append(name)

    print("\n  ✓ Pipeline hebdomadaire terminé"
          + (f" ({len(failures)} étape(s) en échec : {', '.join(failures)})" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
