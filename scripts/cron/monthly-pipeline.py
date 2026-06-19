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
  2. ft-enricher --refresh-breakdowns : rafraîchit les VENTILATIONS
     (holdings/secteurs/régions) PÉRIMÉES (> BREAKDOWN_MAX_AGE_DAYS).
     Remplace par ISIN uniquement si FT renvoie des données (jamais
     d'écrasement par du vide). La péremption pilote la rotation : un
     bucket par mois → tout l'univers ventilé (~2,6 k fonds) couvert en
     ~3 mois, comme la rotation des cours pour les VL.
  3. compute-metrics : recalcul perf/vol/Sharpe/SRRI sur tous les fonds
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

# Rotation des ventilations : un bucket par mois, trié par encours. Avec un
# seuil de péremption de 90j (≈ 3 mois), un bucket ≥ univers/3 garantit que
# tout fonds ventilé est rafraîchi au moins une fois par trimestre. Univers
# actuel ~2,6 k → 1000/mois couvre largement (3×1000 ≥ 2633) avec marge.
BREAKDOWN_BUCKET = 1000
BREAKDOWN_MAX_AGE_DAYS = 90

# (chemin relatif à SCRIPTS_DIR, arguments). --apply est ajouté automatiquement.
MONTHLY_STEPS = [
    ("scrapers/ft-enricher.py", ["--workers", "6", "--delay", "0.15"]),
    # Rafraîchissement des ventilations périmées (rotation trimestrielle).
    ("scrapers/ft-enricher.py",
     ["--refresh-breakdowns",
      "--max-age-days", str(BREAKDOWN_MAX_AGE_DAYS),
      "--limit", str(BREAKDOWN_BUCKET),
      "--workers", "6", "--delay", "0.15"]),
    ("enrichers/compute-metrics.py", []),
    # Perfs des OPCVM ÉTRANGERS sans série de prix (LU/IE que FT ne couvre pas et
    # que GECO/JustETF ne touchent pas) : Morningstar EMEA est leur SEULE source.
    # --refresh cible précisément ces fonds (non-FR, hors table de couverture) et
    # écrase leurs perfs → aucun conflit avec les perfs calculées depuis une VL
    # par compute-metrics ci-dessus. APRÈS compute-metrics, AVANT le recalcul du
    # représentant share-class (les nouvelles perfs montent data_completeness).
    ("scrapers/ms-emea-perf-enricher.py", ["--refresh"]),
    # Gap-fill complet ci-dessus (encours + nouveaux groupes) → recalcule le
    # représentant share-class (is_primary_share_class) qui porte la dédup de /api/funds.
    ("enrichers/refresh-primary-share-class.py", []),
    # Tracking difference des ETF : rafraîchit d'abord les séries d'indices de
    # référence (Yahoo pour S&P 500/DAX ; MSCI net TR pour World/EM/USA/Europe/
    # Japan), puis recalcule la TD 1Y/3Y/5Y vs indice TR. Après
    # compute-metrics (a besoin de VL/perfs à jour). Fill/recompute, non destructif.
    ("enrichers/td-enricher.py", ["--refresh-indices"]),
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
