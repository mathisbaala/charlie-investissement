#!/usr/bin/env python3
"""
av-catalog-refresh.py — Rafraîchissement des catalogues UC d'assurance-vie
==========================================================================
Rejoue les scrapers de catalogue AV (av-fr-*, av-lux-*) qui peuplent
investissement_av_lux_eligibility (liens UC↔contrat). Ces catalogues avaient
été seedés à la main une seule fois (mai-juin 2026) et n'étaient sur AUCUNE
cadence : les assureurs ajoutent/retirent des UC de leurs contrats au fil du
temps, donc le référencement se périme silencieusement.

Tous ces scrapers sont ÉLIGIBILITÉ-ONLY / fill-only : ils n'écrivent que dans
investissement_av_lux_eligibility (et n'upsertent les fonds que pour des ISIN
déjà connus). Ils n'écrasent jamais perfs/frais nettoyés → relancer est
idempotent et non destructif. Chaque étape est NON-FATALE et bornée par un
TIMEOUT (STEP_TIMEOUT) : un site assureur lent/bloquant ne peut plus figer tout
le job (cf. incident 21/06 : av-lux-lmep-easypack → quantalys.com pendait 2 h).

En fin de course : refresh de la matview de référencement (offre par contrat).

Lançable à la main :  python3 scripts/cron/av-catalog-refresh.py
Cadence réelle : workflow GitHub Actions `av-refresh.yml` (trimestriel).
"""

import sys
import subprocess
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent

# Garde-fou anti-hang : aucun scraper de catalogue ne dépasse ~3 min en pratique
# (le plus lent, Suravenir/SwissLife, ~2,5 min). 15 min laisse une marge large
# (1er backfill, PDF lourds) tout en tuant un hang réseau bien avant le timeout CI.
STEP_TIMEOUT = 900  # secondes

# (chemin relatif depuis scripts/, args additionnels). run_script ajoute --apply.
# Liste = uniquement les scrapers PROUVÉS écrivant de la donnée (cf. tri DB 21/06).
AV_CATALOG_STEPS = [
    # ── AV France ─────────────────────────────────────────────────────────────
    ("scrapers/av-fr-allianz-catalog.py", []),
    ("scrapers/av-fr-axa-catalog.py", []),
    ("scrapers/av-fr-cardif-catalog.py", []),
    ("scrapers/av-fr-mutualistes-catalog.py", []),  # rend 0 actuellement — à re-câbler
    ("scrapers/av-fr-oradea-catalog.py", []),
    ("scrapers/av-fr-spirica-catalog.py", []),      # rend 0 (sylvea.fr 404) — à re-câbler
    ("scrapers/av-fr-suravenir-catalog.py", []),
    ("scrapers/av-fr-swisslife-catalog.py", []),
    # ── AV Luxembourg ─────────────────────────────────────────────────────────
    ("scrapers/av-lux-apicil-onelife-catalog.py", []),
    ("scrapers/av-lux-axa-wealtheurope-catalog.py", []),  # PDF → poppler-utils requis
    ("scrapers/av-lux-baloise-catalog.py", []),           # PDF → poppler-utils requis
    ("scrapers/av-lux-generali-catalog.py", []),
    ("scrapers/av-lux-opcvm360-catalog.py", ["--all"]),   # --all = tous les contrats
    ("scrapers/av-lux-swisslife-catalog.py", []),
    ("scrapers/av-lux-utmost-catalog.py", []),            # PDF → poppler-utils requis
    ("scrapers/av-lux-vitislife-catalog.py", []),         # PDF → poppler-utils requis
    # ── Recompose l'offre par contrat (matview lue par /assureurs & screener) ──
    ("enrichers/refresh-insurer-mv.py", []),
]

# Catalogues NON joués par le job planifié — à réparer/migrer avant de réintégrer :
#   • scrapling (navigateur furtif gardé HORS CI, cf. requirements.txt l.12 ;
#     `parsel` l'a remplacé pour SCPI) — leur donnée est déjà seedée :
#       - scrapers/av-lux-cardif-lux-vie-catalog.py
#       - scrapers/av-lux-linxea-catalog.py
#       - scrapers/av-lux-wealins-catalog.py
#       - scrapers/linxea-av-catalog.py
#   • sources bloquantes / besoin navigateur (rendaient 0, dont 1 hang 2 h) :
#       - scrapers/av-lux-lmep-easypack.py   (quantalys.com — pendait sans timeout)
#       - scrapers/av-lux-ag2r-catalog.py    (opcvm360 403 → fallback Playwright absent)


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
        return 124  # convention timeout


def main() -> int:
    print("=" * 60)
    print(f"  Refresh catalogues UC d'assurance-vie — {date.today().isoformat()}")
    print("=" * 60)

    failures = []
    for name, args in AV_CATALOG_STEPS:
        rc = run_script(name, args)
        if rc != 0:
            print(f"  ⚠️  {name} a retourné {rc}")
            failures.append(name)

    print("\n  ✓ Refresh catalogues AV terminé"
          + (f" ({len(failures)} étape(s) en échec : {', '.join(failures)})" if failures else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
