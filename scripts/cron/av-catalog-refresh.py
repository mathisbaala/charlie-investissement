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
    # ── AV France — bancassureurs majeurs (Tier 3, annexes PDF, juin 2026) ─────
    #    Tous éligibilité-only via _av_pdf_common (curl_cffi + pdftotext, filtre
    #    sur ISIN en base). ~65 contrats / ~11,9k liens bruts au câblage.
    ("scrapers/av-fr-cnp-catalog.py", []),          # CNP Assurances (Lucya CNP, Nuances, EasyVie)
    ("scrapers/av-fr-predica-catalog.py", []),      # Predica / Crédit Agricole (WP REST → PDF)
    ("scrapers/av-fr-abeille-catalog.py", []),      # Abeille Vie (ex-Aviva, Afer/Lucya Abeille)
    ("scrapers/av-fr-groupama-gan-catalog.py", []), # Groupama Gan Vie (webfg, 4 marques)
    ("scrapers/av-fr-macsf-catalog.py", []),        # MACSF (RES Multisupport)
    ("scrapers/av-fr-maaf-catalog.py", []),         # MAAF Vie / Covéa (Winalto ; MMA+GMF non scriptables)
    ("scrapers/av-fr-acm-catalog.py", []),          # ACM Vie / Crédit Mutuel-CIC
    # ── AV Luxembourg ─────────────────────────────────────────────────────────
    ("scrapers/av-lux-apicil-onelife-catalog.py", []),
    ("scrapers/av-lux-axa-wealtheurope-catalog.py", []),  # PDF → poppler-utils requis
    ("scrapers/av-lux-baloise-catalog.py", []),           # PDF → poppler-utils requis
    ("scrapers/av-lux-generali-catalog.py", []),
    ("scrapers/av-lux-opcvm360-catalog.py", ["--all"]),      # contrats KNOWN_CONTRACTS (IDs figés)
    ("scrapers/av-lux-opcvm360-catalog.py", ["--dynamic"]),  # contrats /licontracts (noms assureur autoritaires : Generali Vie, AG2R, Spirica…)
    ("scrapers/av-lux-swisslife-catalog.py", []),
    ("scrapers/av-lux-utmost-catalog.py", []),            # PDF → poppler-utils requis
    ("scrapers/av-lux-vitislife-catalog.py", []),         # PDF → poppler-utils requis
    ("scrapers/av-lux-wealins-catalog.py", []),           # migré scrapling→curl_cffi+parsel (21/06)
    # ── Délistage : purge les liens confirmés périmés (UC retirées d'un contrat) ──
    ("enrichers/prune-stale-av-eligibility.py", []),
    # ── Recompose l'offre par contrat (matview lue par /assureurs & screener) ──
    ("enrichers/refresh-insurer-mv.py", []),
]

# Catalogues NON joués par le job planifié — à réparer avant de réintégrer.
# (Les 4 ex-scrapling ont été migrés vers curl_cffi+parsel le 21/06 → plus de crash
#  à l'import en CI ; mais 3 restent inopérants pour une autre raison :)
#   • besoin d'un NAVIGATEUR (Playwright) — pas de simple migration possible :
#       - scrapers/av-lux-linxea-catalog.py        (JWT Morningstar généré côté navigateur)
#       - scrapers/av-lux-cardif-lux-vie-catalog.py (APIs /docInfo only via session SPA — 404 en direct)
#   • URLs source mortes (à re-câbler, indépendant de scrapling) :
#       - scrapers/linxea-av-catalog.py            (comparateur Linxea 404 → rend 0)
#   • sources bloquantes (rendaient 0, dont 1 hang 2 h) :
#       - scrapers/av-lux-lmep-easypack.py   (quantalys.com — pendait sans timeout)
#       - scrapers/av-lux-ag2r-catalog.py    (opcvm360 403 → fallback Playwright absent)
#
# Tier 3 — périmètre Covéa NON couvert (pas de source publique scriptable) :
#   • MMA Vie  : liste UC seulement via quantalys (SPA cookie-wall) ou DataDome.
#   • GMF Vie  : idem (tout gmf.fr en 403/503 DataDome).
#   La gamme MAAF (Winalto) est câblée ; MMA/GMF partagent l'essentiel des mêmes
#   supports Covéa Finance. Cf. docs/tier3-missing-insurers-spec.md.


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
