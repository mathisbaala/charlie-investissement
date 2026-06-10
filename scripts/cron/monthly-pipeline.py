#!/usr/bin/env python3
"""
monthly-pipeline.py — Balayage mensuel complet (fill-only)
===========================================================
Une fois par mois, on traite tout l'univers OPCVM/ETF, pas seulement
le top par encours du run hebdo :

  ft-full-sweep.py
    Phase 1 — ft-enricher (complet) : enrichit depuis Financial Times
      les fonds encore incomplets (NAV + frais + catégorie + holdings/
      secteurs/régions), en FILL-ONLY (jamais d'écrasement).
    Phase 2 — calcul des métriques sur tous les ISIN pricés par FT,
      sans jamais écraser une valeur existante par None.

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


def main() -> int:
    print("=" * 60)
    print(f"  Pipeline mensuel (balayage FT complet) — {date.today().isoformat()}")
    print("=" * 60, flush=True)

    # ft-full-sweep est un driver one-shot sans argument (apply implicite).
    cmd = [sys.executable, str(SCRIPTS_DIR / "ft-full-sweep.py")]
    rc = subprocess.run(cmd, cwd=str(SCRIPTS_DIR.parent)).returncode

    if rc != 0:
        print(f"\n  ⚠️  ft-full-sweep.py a retourné {rc}")
    else:
        print("\n  ✓ Pipeline mensuel terminé")
    return rc


if __name__ == "__main__":
    sys.exit(main())
