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
    ("scrapers/av-fr-generali-catalog.py", []),     # Generali Vie FR (Himalia + e-Xaélidia, annexes PDF ~2,3k liens)
    ("scrapers/av-fr-mutualistes-catalog.py", []),  # OK (vérifié 22/06 : 8 PDF live, ~280 ISIN en base)
    ("scrapers/av-fr-garance-catalog.py", []),      # Garance (mutuelle, 5 contrats — vérifié 15/07)
    ("scrapers/av-fr-monceau-catalog.py", []),      # Monceau Assurances (2 contrats — vérifié 15/07)
    ("scrapers/av-fr-asac-fapes-catalog.py", []),   # Asac Fapes (3 contrats — vérifié 15/07)
    ("scrapers/av-fr-bpce-catalog.py", []),         # BPCE Vie / Natixis Assurances (portail HTML priips, 7 réseaux, 38 contrats — vérifié 15/07)
    ("scrapers/av-fr-prepar-vie-catalog.py", []),   # Prépar Vie (portail AJAX priips.prepar-vie.com, 11 réseaux, 36 contrats — vérifié 15/07)
    ("scrapers/av-fr-afi-esca-catalog.py", []),     # Afi Esca FR (Sélection Premium, liste mensuelle — vérifié 15/07 ; ≠ AFI ESCA Luxembourg ci-dessous)
    # av-fr-oradea-catalog.py RETIRÉ 13/07 : portail source décommissionné (cf. quarantaine ci-dessous).
    ("scrapers/av-fr-spirica-catalog.py", []),      # OK (vérifié 22/06 : sylvea.fr rétabli, 146 contrats, ~62k lignes)
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
    ("scrapers/av-fr-maaf-catalog.py", []),         # MAAF Vie / Covéa (Winalto)
    ("scrapers/av-fr-mma-catalog.py", []),          # MMA Vie / Covéa (Multisupports — cap.mma.fr PDF)
    ("scrapers/av-fr-gmf-catalog.py", []),          # GMF Vie / Covéa (Multéo — miroir cleerly.fr PDF)
    ("scrapers/av-fr-acm-catalog.py", []),          # ACM Vie / Crédit Mutuel-CIC
    ("scrapers/av-fr-maif-catalog.py", []),         # MAIF Vie (ARS — API JSON gateway maif.fr ; reachability CI à confirmer, cf. gotcha Abeille/MAAF)
    # ── AV Luxembourg ─────────────────────────────────────────────────────────
    ("scrapers/av-lux-afi-esca-catalog.py", []),          # AFI ESCA Lux — PDF loi PACTE, URL découverte (ajouté 16/07)
    ("scrapers/av-lux-allianz-catalog.py", []),           # Allianz Life Lux — portail PRIIPS, POST par produit (ajouté 16/07)
    ("scrapers/av-lux-apicil-onelife-catalog.py", []),
    ("scrapers/av-lux-axa-wealtheurope-catalog.py", []),  # PDF → poppler-utils requis
    ("scrapers/av-lux-baloise-catalog.py", []),           # PDF → poppler-utils requis
    ("scrapers/av-lux-cnp-catalog.py", []),               # CNP Lux — quantalys Easypack, listes par contrat (ajouté 16/07)
    ("scrapers/av-lux-generali-catalog.py", []),
    ("scrapers/av-lux-lmep-easypack.py", []),               # AG2R LMEP (quantalys Easypack, réparé 21/06 : porte JS + payload DataTables)
    ("scrapers/av-lux-opcvm360-catalog.py", ["--all"]),      # contrats KNOWN_CONTRACTS (IDs figés)
    ("scrapers/av-lux-opcvm360-catalog.py", ["--dynamic"]),  # contrats /licontracts (noms assureur autoritaires : Generali Vie, AG2R, Spirica…)
    ("scrapers/av-lux-sogelife-catalog.py", []),          # Sogelife — ZIP PRIIPS, répertoire central lu via Range (ajouté 16/07)
    ("scrapers/av-lux-swisslife-catalog.py", []),
    ("scrapers/av-lux-utmost-catalog.py", []),            # migré PDF → API REST utmostgroup.com le 16/07 (ex-Lombard, renommé Utmost Luxembourg S.A.)
    ("scrapers/av-lux-vitislife-catalog.py", []),         # PDF → poppler-utils requis
    ("scrapers/av-lux-wealins-catalog.py", []),           # migré scrapling→curl_cffi+parsel (21/06)
    # ── Délistage : purge les liens confirmés périmés (UC retirées d'un contrat) ──
    ("enrichers/prune-stale-av-eligibility.py", []),
    # ── Recompose l'offre par contrat (matview lue par /assureurs & screener) ──
    ("enrichers/refresh-insurer-mv.py", []),
]

# Catalogues NON joués par le job planifié — à réparer avant de réintégrer.
#   • besoin d'un NAVIGATEUR (Playwright) — joués par av-catalog-refresh-browser.py :
#       - scrapers/av-lux-linxea-catalog.py        (JWT Morningstar généré côté navigateur ;
#                                                   API ECINT vivante, IDs d'univers à rafraîchir)
#       - scrapers/av-lux-cardif-lux-vie-catalog.py (APIs /docInfo only via session SPA — 404 en direct)
#   • sources bloquantes restantes :
#       - scrapers/av-lux-ag2r-catalog.py    (opcvm360 403 → fallback Playwright absent ;
#                                            la gamme AG2R LMEP Lux est désormais couverte
#                                            par av-lux-lmep-easypack ci-dessus)
#       - Matmut Vie (Complice Vie)          (aucun PDF/API exploitable trouvé le 15/07 : les
#                                            annexes/CG publiques (MATMUT_PAVNI.pdf, notice-
#                                            complice-vie.pdf, tableau-frais-complice-vie.pdf)
#                                            ne contiennent aucun ISIN — liste de supports
#                                            réservée à l'espace client/portail. À couvrir via
#                                            Playwright si l'espace public change de structure.)
#       - Neuflize Vie (Hoche Patrimoine…)   (banque privée : /contrats/ redirige vers la page
#                                            d'accueil générique neuflizeobc.fr, aucune annexe
#                                            financière publique trouvée le 15/07. Distribution
#                                            probablement conseiller-only ; à recontacter côté
#                                            partenariat ou vérifier un accès CGP dédié.)
#     (Sogelife : quarantaine du 15/07 LEVÉE le 16/07 — les ZIP PRIIPS publics
#      doc.sogelife.com/priips/<code>.zip listent les UC par contrat →
#      av-lux-sogelife-catalog câblé dans la liste ci-dessus.)
#   • sources DÉCOMMISSIONNÉES (hôte source disparu, à re-sourcer avant réintégration) :
#       - scrapers/av-fr-oradea-catalog.py   (RETIRÉ 13/07 : le portail statique
#                                            priips.oradea-vie.com — HTML à attributs cdisine="ISIN" —
#                                            est mort (NXDOMAIN, tout le domaine oradea-vie.com).
#                                            Le groupe a migré vers oradeavie.fr (Imperva/Incapsula,
#                                            landing marketing sans catalogue machine-lisible).
#                                            Les 916 liens Oradéa déjà en base sont conservés
#                                            (upsert-only + garde anti-scraper-cassé du prune).
#                                            Réintégrer si un nouvel endpoint DIC listant les ISIN
#                                            est retrouvé sur oradeavie.fr.)
# (scrapers/linxea-av-catalog.py SUPPRIMÉ le 21/06 : comparateur Linxea 404, superseded
#  par av-lux-linxea-catalog.py.)
#
# Tier 3 — groupe Covéa désormais COMPLET (MAAF/Winalto + MMA/Multisupports +
#   GMF/Multéo, tous annexe PDF). MMA via cap.mma.fr (sous-domaine doc non
#   protégé) ; GMF via miroir tiers cleerly.fr (gmf.fr reste DataDome).
#   Cf. docs/tier3-missing-insurers-spec.md.


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
