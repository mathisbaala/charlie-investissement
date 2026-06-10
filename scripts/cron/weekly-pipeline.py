#!/usr/bin/env python3
"""
weekly-pipeline.py — Rafraîchissement hebdomadaire (sans risque)
=================================================================
Cadence pensée pour des CGP : données fraîches chaque lundi matin,
sans suivi quotidien type salle de marché.

Lance dans l'ordre :
  1. Fetch VL OPCVM (Yahoo Finance)        → investissement_fund_prices
  2. Fetch prix ETF (Yahoo Finance)        → investissement_fund_prices
  3. Recalcul métriques (perf/vol/Sharpe)  → investissement_funds

Aucun de ces scripts ne fait d'upsert destructif sur l'univers de fonds :
ils ajoutent des points de prix et recalculent des métriques dérivées.
Les scrapers de seeding (GECO, justETF base) ne tournent JAMAIS ici.

Planifié par .github/workflows/weekly-refresh.yml (lundi 04:00 UTC).
Lançable à la main :  python3 scripts/cron/weekly-pipeline.py
"""

import sys
import subprocess
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent

# Scripts hebdo, dans l'ordre. (chemin relatif à SCRIPTS_DIR, args supplémentaires)
WEEKLY_STEPS = [
    ("fetch-opcvm-nav.py", []),
    ("fetch-etf-prices.py", []),
    ("enrichers/compute-metrics.py", []),
]


def run_script(name: str, args: list[str]) -> int:
    cmd = [sys.executable, str(SCRIPTS_DIR / name), "--apply"] + args
    print(f"\n  {'─' * 50}")
    print(f"  Lancement : {name}")
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
    # On signale l'échec à GitHub Actions si au moins une étape a échoué.
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
