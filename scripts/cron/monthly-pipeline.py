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
# Comblement des compositions manquantes : la couverture look-through est faible
# (~3 % des fonds primaires ont des holdings). On en comble un bucket par mois,
# EN PRIORITÉ sur les fonds les plus référencés en AV (ceux qui alimentent la
# comparaison / le look-through). ~10 k fonds référencés sans holdings → couverts
# en quelques mois.
BREAKDOWN_FILL_BUCKET = 1500
# 2ᵉ source de composition (ETF) : JustETF. FT ne ventile qu'une fraction des
# ETF ; JustETF (HTML server-side, requests+BS4 — pas de scrapling) couvre ~1,7 k
# ETF sans compo. Rate-limit interne 4 s/ETF → un bucket de 400 ≈ 27 min, et
# l'univers ETF (~1,7 k) est drainé en ~4 mois (priorité AUM décroissant). Le
# scraper exclut nativement les ETF déjà ventilés → fill-only, rotation auto.
JUSTETF_HOLDINGS_BUCKET = 400
# Comblement compo des OPCVM via Morningstar EMEA (API authentifiée ms-emea-*,
# secrets MS_EMEA_*). FT/JustETF/émetteurs ventilent surtout les ETF ; restent
# ~7,1 k OPCVM avec morningstar_rating mais SANS géo. On en comble un bucket par
# mois, priorité AUM décroissant, FILL-ONLY STRICT (n'écrit que géo/secteur/
# holdings, jamais investissement_funds, saute tout fonds déjà ventilé). API
# statique HTTP (pas de navigateur). ~0,5 s/fonds → 600 ≈ 5-10 min ; l'univers
# est drainé en ~12 mois. Avant compute-metrics (data_completeness/primaire).
# Sans identifiants Morningstar, le script s'arrête proprement (exit 0, no-write).
MS_HOLDINGS_BUCKET = 600

# (chemin relatif à SCRIPTS_DIR, arguments). --apply est ajouté automatiquement.
MONTHLY_STEPS = [
    ("scrapers/ft-enricher.py", ["--workers", "6", "--delay", "0.15"]),
    # Comble les VENTILATIONS MANQUANTES (fonds sans holdings), priorité aux plus
    # référencés en AV → fait grimper la couverture look-through. Fill-only.
    ("scrapers/ft-enricher.py",
     ["--fill-breakdowns", "--by-referencing",
      "--limit", str(BREAKDOWN_FILL_BUCKET),
      "--workers", "6", "--delay", "0.15"]),
    # Rafraîchissement des ventilations périmées (rotation trimestrielle).
    ("scrapers/ft-enricher.py",
     ["--refresh-breakdowns",
      "--max-age-days", str(BREAKDOWN_MAX_AGE_DAYS),
      "--limit", str(BREAKDOWN_BUCKET),
      "--workers", "6", "--delay", "0.15"]),
    # Composition COMPLÈTE des ETF depuis les fichiers émetteurs (chantier A) :
    # constituants INTÉGRAUX (jusqu'à 500 lignes/ETF) + secteurs/géo agrégés,
    # source qualitativement supérieure au top 10. --refresh = re-pull mensuel
    # (iShares publie quotidiennement). Écrit AUSSI secteurs/géo → ces ISIN sont
    # ensuite skippés par JustETF (qui ne cible que les ETF « sans secteurs »),
    # donc placé AVANT lui. ~491 ETF iShares ≈ 15 min.
    ("scrapers/issuer-holdings.py", ["--issuer", "ishares", "--refresh"]),
    # Mêmes constituants intégraux pour les deux autres gros émetteurs ETF
    # (endpoints publics par ISIN : Amundi mapi, DWS holdings API). ~491 Amundi
    # + ~256 Xtrackers, fill-only/refresh mensuel, même modèle qu'iShares.
    ("scrapers/issuer-holdings.py", ["--issuer", "amundi", "--refresh"]),
    ("scrapers/issuer-holdings.py", ["--issuer", "xtrackers", "--refresh"]),
    # Invesco : dng-api donne l'exposition réelle (holdings/index) mais derrière
    # un WAF anti-bot qui renvoie 406 sur les rafales. PETIT lot fill-only (PAS
    # --refresh) pour rester sous le radar — draine les ~121 ETF en quelques mois.
    ("scrapers/issuer-holdings.py", ["--issuer", "invesco", "--limit", "25"]),
    # 2ᵉ source de compo, ETF uniquement : JustETF comble la géo/secteur/holdings
    # des ETF que FT/émetteurs ne ventilent pas. Fill-only (exclut nativement les
    # ETF déjà dotés de secteurs), priorité AUM décroissant. Avant compute-metrics
    # pour que data_completeness/primaire reflètent la nouvelle compo.
    ("scrapers/justetf-holdings-scraper.py",
     ["--limit", str(JUSTETF_HOLDINGS_BUCKET)]),
    # Comble la compo des OPCVM (géo/secteur/holdings) via Morningstar —
    # résolution secId par screener ecint entitlé, ventilation par sal-service v1
    # (api-global, apikey statique ; PAS oauth — le realm oauth n'entitle pas
    # sal-service). --include-unrated : la résolution secId par ISIN ne dépend PAS
    # du morningstar_rating (Morningstar référence bien plus de fonds qu'il n'en
    # note ; probe 20/06 = ~97 % de résolution sur les non-notés) → on draine TOUT
    # l'univers OPCVM/ETF (~14 k sans géo), pas seulement les notés. offset 0 = on
    # (re)comble toujours le top-N AUM encore manquant ; le dedup « déjà fait »
    # (géo ∪ holdings MS) saute nativement les fonds traités, monétaires inclus.
    # IMPORTANT : un seul bucket modéré par run, JAMAIS de runs dos à dos —
    # l'API publique sal-service throttle sous charge soutenue (constaté 20/06).
    ("scrapers/populate-holdings-morningstar.py",
     ["--limit", str(MS_HOLDINGS_BUCKET), "--offset", "0", "--include-unrated"]),
    ("enrichers/compute-metrics.py", []),
    # Recalcul data_completeness APRÈS compute-metrics (vol/perf fraîches) et AVANT
    # refresh-primary-share-class (qui privilégie les parts éligibles ≥50). Sans
    # ça le score se périme (fonds enrichis mais scorés bas → cachés). Réplique
    # recompute-completeness-v2.sql. (--apply ajouté par run_script.)
    ("migrations/recalc-completeness-v2.py", ["--per-type"]),
    # NB : le refresh EMEA des perfs OPCVM étrangers a été SORTI dans son propre
    # workflow mensuel (emea-refresh.yml) — l'inclure ici poussait le pipeline
    # au-dessus du plafond de 6 h des runners GitHub (timeout → dernières étapes
    # coupées). EMEA cible des fonds disjoints (non-FR sans prix), donc aucun
    # besoin de l'enchaîner avec compute-metrics.
    # Gap-fill complet ci-dessus (encours + nouveaux groupes) → recalcule le
    # représentant share-class (is_primary_share_class) qui porte la dédup de /api/funds.
    ("enrichers/refresh-primary-share-class.py", []),
    # Alpha vs indice de référence : rafraîchit d'abord les séries d'indices
    # (Yahoo pour S&P 500/DAX/Nasdaq + proxys ETF obligataires/actions euro ;
    # MSCI net TR pour World/EM/USA/Europe/Japan), puis recalcule l'alpha 1Y/3Y/5Y.
    # Après compute-metrics (a besoin de VL/perfs à jour). Fill/recompute, non destructif.
    ("enrichers/td-enricher.py", ["--refresh-indices"]),
    # Durabilité DDA (best-effort, fill-only) : extrait taxonomie / investissement
    # durable / PAI des DICI/KID quand publiés. Sourcing « en fond » : enrichit au
    # fil des mois, non destructif. Ne traite que les KID pas encore examinés.
    ("enrichers/sfdr-enricher.py", []),
    # Durabilité MiFID/DDA depuis l'ANNEXE précontractuelle SFDR (documenttype=398),
    # là où le KID est un cul-de-sac (taxonomie / investissement durable / PAI).
    # Fill-only, ne touche jamais sfdr_article, marque chaque fonds traité
    # (sustainability_source = 'sfdr-annex'*) → drain incrémental au fil des mois
    # sur l'univers Art.8/9 (~9 100 fonds). Cap par run pour rester dans le budget
    # temps du pipeline ; le reliquat est repris au run suivant.
    ("enrichers/sfdr-annex-enricher.py", ["--apply", "--limit", "3000"]),
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
