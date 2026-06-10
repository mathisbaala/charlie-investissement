#!/usr/bin/env python3
"""
monthly-pipeline.py — Enrichissement mensuel (fill-only)
=========================================================
Comble les champs manquants une fois par mois, sans jamais écraser
les données existantes. Tous les scripts ci-dessous utilisent un mode
fill-only / *-fill (safe_fill_funds, mise à jour des NULL uniquement).

⚠️  N'INCLUT JAMAIS les scrapers de seeding de l'univers
    (amf-geco-full, justetf-scraper, scpi-full-scraper, …) qui font
    de l'upsert destructif et doivent rester supervisés manuellement.

Ordre : KID/DICI → TER → AUM → perf → champs ETF. Chaque étape est
indépendante ; un échec n'interrompt pas les suivantes.

Planifié par .github/workflows/monthly-enrich.yml (1er lundi du mois).
Lançable à la main :  python3 scripts/cron/monthly-pipeline.py
"""

import sys
import subprocess
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent

# Enrichisseurs fill-only, dans l'ordre. (chemin relatif à SCRIPTS_DIR, args)
MONTHLY_STEPS = [
    ("enrichers/epr-kid-enrich.py", []),          # URLs KID/DICI manquantes
    ("scrapers/morningstar-ter-fill.py", []),     # TER manquants (Morningstar)
    ("scrapers/yahoo-finance-ter-fill.py", []),   # TER manquants (Yahoo, ETF)
    ("scrapers/justetf-aum-fill.py", []),         # AUM manquants (ETF)
    ("scrapers/boursorama-aum-fill.py", []),      # AUM manquants (FR)
    ("scrapers/justetf-perf-fill.py", []),        # perfs manquantes (ETF)
    ("scrapers/boursorama-srri-fill.py", []),     # SRRI manquants (FR)
    ("scrapers/justetf-fields-enricher.py", []),  # region / inception / société
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
    print(f"  Pipeline mensuel (enrichissement fill-only) — {date.today().isoformat()}")
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
