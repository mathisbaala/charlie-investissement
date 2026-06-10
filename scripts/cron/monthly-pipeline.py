#!/usr/bin/env python3
"""
monthly-pipeline.py — Balayage mensuel complet (fill-only)
===========================================================
Une fois par mois, on traite tout l'univers OPCVM/ETF, pas seulement
le top par encours du run hebdo :

  1. ft-enricher (gap-fill complet, AVEC holdings) : enrichit depuis
     Financial Times tous les fonds encore incomplets (NAV + frais +
     catégorie + holdings/secteurs/régions), en FILL-ONLY. Pas de
     --refresh ni de --limit → toutes les cibles incomplètes.
  2. compute-metrics : recalcul perf/vol/Sharpe/SRRI sur tous les fonds
     ayant un historique de prix (découverte via table de couverture,
     reconnexion périodique → robuste sur des dizaines de milliers de
     requêtes).

⚠️  N'INCLUT JAMAIS les scrapers de seeding de l'univers
    (amf-geco-full, justetf-scraper, scpi-full-scraper, …) qui font
    de l'upsert destructif et doivent rester supervisés manuellement.

Planifié par .github/workflows/monthly-enrich.yml (1er lundi du mois).
Lançable à la main :  python3 scripts/cron/monthly-pipeline.py
"""

import sys
import subprocess
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent

# (chemin relatif à SCRIPTS_DIR, arguments). --apply est ajouté automatiquement.
MONTHLY_STEPS = [
    ("scrapers/ft-enricher.py", ["--workers", "6", "--delay", "0.15"]),
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
    print(f"  Pipeline mensuel (gap-fill FT complet) — {date.today().isoformat()}")
    print("=" * 60)

    failures = []
    for name, args in MONTHLY_STEPS:
        rc = run_script(name, args)
        if rc != 0:
            print(f"  ⚠️  {name} a retourné {rc}")
            failures.append(name)

    print("\n  ✓ Pipeline mensuel terminé"
          + (f" ({len(failures)} étape(s) en échec : {', '.join(failures)})" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
