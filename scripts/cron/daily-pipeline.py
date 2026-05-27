#!/usr/bin/env python3
"""
daily-pipeline.py — Orchestrateur du pipeline quotidien
========================================================
Lance dans l'ordre :
  1. Fetch VL OPCVM (Yahoo Finance pour les fonds couverts)
  2. Fetch prix ETF
  3. Recalcul métriques (Sharpe, vol, performances) — hebdo seulement le lundi

Usage (depuis run.sh) :
    python3 scripts/cron/daily-pipeline.py

Cron recommandé : tous les jours à 03:30 UTC
    30 3 * * * /opt/charlie-investissement/run.sh python3 scripts/cron/daily-pipeline.py
"""

import sys
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent

def run_script(name: str, args: list[str] = None) -> int:
    cmd = [sys.executable, str(SCRIPTS_DIR / name), "--apply"] + (args or [])
    print(f"\n  {'─'*50}")
    print(f"  Lancement : {name}")
    print(f"  {'─'*50}")
    result = subprocess.run(cmd, cwd=str(SCRIPTS_DIR.parent))
    return result.returncode

def main():
    today = date.today()
    is_monday = today.weekday() == 0

    print("=" * 60)
    print(f"  Pipeline quotidien — {today.isoformat()}")
    print(f"  Lundi (calcul métriques) : {'OUI' if is_monday else 'NON'}")
    print("=" * 60)

    # 1. VL OPCVM
    rc = run_script("fetch-opcvm-nav.py")
    if rc != 0:
        print(f"  ⚠️  fetch-opcvm-nav.py a retourné {rc}")

    # 2. Prix ETF
    rc = run_script("fetch-etf-prices.py")
    if rc != 0:
        print(f"  ⚠️  fetch-etf-prices.py a retourné {rc}")

    # 3. Métriques — uniquement le lundi
    if is_monday:
        rc = run_script("enrichers/compute-metrics.py")
        if rc != 0:
            print(f"  ⚠️  compute-metrics.py a retourné {rc}")

    print("\n  ✓ Pipeline terminé")

if __name__ == "__main__":
    main()
