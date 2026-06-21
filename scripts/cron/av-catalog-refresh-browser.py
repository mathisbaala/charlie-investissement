#!/usr/bin/env python3
"""
av-catalog-refresh-browser.py — Catalogues UC d'AV qui EXIGENT un navigateur
============================================================================
Pendant navigateur de `av-catalog-refresh.py`. Deux catalogues d'assurance-vie
ne sont pas atteignables en HTTP simple (vérifié 21/06) et requièrent Playwright :

  • av-lux-linxea-catalog   : le JWT de l'API Morningstar ECINT est généré côté
                              navigateur (token dans le hash de l'URL XRay).
                              → ~1 729 UC / 4 748 liens.
  • av-lux-cardif-lux-vie    : les APIs /docInfo/api/* ne répondent que dans le
                              contexte de session de la SPA (404 en requête directe).
                              → ~682 UC / 4 618 liens.

Éligibilité-only / fill-only / idempotent comme l'autre orchestrateur. Séparé
car il a besoin de chromium (lourd) — exécuté par `av-refresh-browser.yml`, en
parallèle conceptuel du refresh HTTP mais sur son propre workflow.

Lançable à la main (chromium requis) :
    python3 -m playwright install chromium
    python3 scripts/cron/av-catalog-refresh-browser.py
"""

import sys
import subprocess
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent

# Plus généreux que le job HTTP : Playwright démarre un navigateur + boucle sur les
# produits/univers (linxea ~90 s, cardif ~120 s). 20 min couvre large sans figer.
STEP_TIMEOUT = 1200  # secondes

AV_BROWSER_STEPS = [
    ("scrapers/av-lux-linxea-catalog.py", []),
    ("scrapers/av-lux-cardif-lux-vie-catalog.py", []),
    # Recompose l'offre par contrat (matview lue par /assureurs & screener).
    ("enrichers/refresh-insurer-mv.py", []),
]


def run_script(name: str, args: list[str]) -> int:
    cmd = [sys.executable, str(SCRIPTS_DIR / name), "--apply"] + args
    print(f"\n  {'─' * 50}")
    print(f"  Lancement : {name} {' '.join(args)}")
    print(f"  {'─' * 50}", flush=True)
    try:
        result = subprocess.run(cmd, cwd=str(SCRIPTS_DIR.parent), timeout=STEP_TIMEOUT)
        return result.returncode
    except subprocess.TimeoutExpired:
        print(f"  ⏱️  {name} a dépassé {STEP_TIMEOUT}s — tué (anti-hang).", flush=True)
        return 124


def main() -> int:
    print("=" * 60)
    print(f"  Refresh catalogues UC d'AV (navigateur) — {date.today().isoformat()}")
    print("=" * 60)

    failures = []
    for name, args in AV_BROWSER_STEPS:
        rc = run_script(name, args)
        if rc != 0:
            print(f"  ⚠️  {name} a retourné {rc}")
            failures.append(name)

    print("\n  ✓ Refresh catalogues AV (navigateur) terminé"
          + (f" ({len(failures)} étape(s) en échec : {', '.join(failures)})" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
