# 🔎 Audit de couverture — 16 assureurs demandés (2026-07-10)

> Objectif : vérifier, pour une liste de 16 assureurs, que **contrats + fonds (UC)**
> sont bien présents dans le pipeline, et **compléter ce qui manque** avec des
> sources trouvées sur les sites officiels.
>
> Méthode : chaque scraper `av-*-catalog.py` a été exécuté **en dry-run** (aucune
> écriture DB, aucun appel d'API payante). Les comptes d'ISIN ont été re-vérifiés
> par extraction regex directe des PDF (robuste au layout). Validation locale via
> un shim `pdftotext`→`pdfplumber` (poppler non installable sans brew sur ce poste).

## TL;DR

**Les 16 assureurs sont déjà en base** (vérifié sur l'API publique de prod, cf.
§« Base live »). Le manque n'est donc pas « l'assureur », mais **des contrats et des
fonds à l'intérieur**. Trois natures de manque :

1. **Bug de visibilité** (corrigé dans cette branche) : **Generali Luxembourg** avait
   716 fonds référencés mais **0 contrat navigable** (contract_name == company_name,
   exclu par la matview). → renommé « Generali Luxembourg Univers Global » + migration.
2. **Contrats déjà codés mais pas encore en base** (attendent un run CI `--apply`,
   seul Mathis a les secrets) : **ACM** (+ Options Capi, Plan Capitalisation),
   **MACSF** (+ RES Retraite, RES Capitalisation), **Afer** (+ Afer Génération).
   Aucun code à écrire — juste lancer le workflow.
3. **Fonds manquants** (le vrai fond du sujet) : les scrapers sont *éligibilité-only* —
   une UC n'apparaît que si son ISIN est **déjà** dans `investissement_funds`. Ex. MACSF
   cite 23 ISIN mais 18 en base ; Macif 18→14. Les UC absentes de la table `funds` sont
   invisibles. Les faire entrer = pipeline *fonds* (plus gros ; identité scrapa­ble
   gratuitement, enrichissement perf/frais parfois payant).

**Vrais trous structurels** : **La Banque Postale Life** est un *seed orphelin*
(49 fonds, 1 contrat, **aucun scraper** → jamais rafraîchi, sera purgé à terme).
Cas marginaux portail-only : Macif Multi Vie, contrats Utmost hors « Liberté ».

## Tableau de couverture

| # | Assureur demandé | Scraper | Découverte | Dry-run (preuve) | Statut |
|---|---|---|---|---|---|
| 1 | Suravenir | `av-fr-suravenir-catalog.py` | HTML+PDF | 2 269 ISIN / 81 086 liens | ✅ complet |
| 2 | Linxea | `av-lux-linxea-catalog.py` | Navigateur (JWT Morningstar) | CI navigateur uniquement¹ | ✅ (job dédié) |
| 3 | SwissLife France | `av-fr-swisslife-catalog.py` | API produits | 56 contrats (43 actifs) | ✅ complet |
| 4 | Generali Luxembourg | `av-lux-generali-catalog.py` | PDF dynamique | 816 fonds | ✅ complet |
| 5 | Cardif Lux Vie | `av-lux-cardif-lux-vie-catalog.py` | Navigateur (SPA) | CI navigateur uniquement¹ | ✅ (job dédié) |
| 6 | Apicil / OneLife | `av-lux-apicil-onelife-catalog.py` | XML PRIIPs | 514 fonds | ✅ complet |
| 7 | Predica | `av-fr-predica-catalog.py` | WP REST dynamique | 12 contrats / 708 ISIN | ✅ complet |
| 8 | Baloise Life | `av-lux-baloise-catalog.py` | PDF | 282 fonds | ✅ complet |
| 9 | AXA Wealth Europe | `av-lux-axa-wealtheurope-catalog.py` | PDF | **330 ISIN**² | ✅ complet |
| 10 | Afer | `av-fr-mutualistes-catalog.py` (CATALOG) | Liste en dur | Multisupport 137 + Génération 55 ISIN | ✅ (gamme complète) |
| 11 | ACM Vie | `av-fr-acm-catalog.py` | HTML dynamique | 6 contrats / 115 ISIN | ✅ complet |
| 12 | Utmost Luxembourg S.A. | `av-lux-utmost-catalog.py` (CATALOG) | Liste en dur | Liberté 69 ISIN | ✅ (seul contrat public) |
| 13 | **La Banque Postale Life** | — | — | — | ❌ **aucun scraper** |
| 14 | Carac | `av-fr-mutualistes-catalog.py` (CATALOG) | Liste en dur | Profiléo 12 + Épargne Patrimoine 33 ISIN | ✅ (2 contrats principaux) |
| 15 | MACSF | `av-fr-macsf-catalog.py` (CATALOG) | Liste en dur | RES MS/Retraite/Capi — 23 ISIN | ✅ (gamme RES complète) |
| 16 | Macif Vie | `av-fr-mutualistes-catalog.py` (CATALOG) | Liste en dur | Macif Épargne Vie 18 ISIN | ⚠️ partiel (voir §Manques) |

¹ Linxea et Cardif Lux Vie exigent Playwright + une session/JWT réels ; ils tournent
dans le workflow `av-refresh-browser.yml` (cf. `docs/av-referencing.md` §3-4), pas en
HTTP local. Non exécutables sur ce poste sans navigateur — comportement attendu.

² Le dry-run local via le shim `pdfplumber` ne comptait que 28 fonds pour AXA WE : c'est
un **artefact de shim**, ce scraper parse **par position de colonne** et pdfplumber
n'aligne pas les colonnes comme poppler. L'extraction ISIN brute du même PDF donne
**330 ISIN** → le scraper est sain en CI (poppler réel). Même réserve pour tout scraper
« parse par colonnes » (generali-lux, baloise) : leurs comptes de *fonds* locaux sont
indicatifs, pas la preuve d'un manque.

## Base live (API publique de prod — lecture gratuite)

Interroger `https://www.charliewealth.fr/api/screener/{insurers,contracts}` (GET public,
non authentifié, aucune écriture) donne l'état **réel** de la base. Compte de fonds par
assureur demandé, au 2026-07-10 :

| Assureur | Fonds en base | Contrats en base | vs scraper |
|---|---:|---:|---|
| Suravenir | 1 971 | 119 | ✅ |
| Linxea | 1 483 | 8 | ✅ |
| SwissLife France | 1 220 | 33 | ✅ |
| Generali Luxembourg | 716 | **0 → 1** (corrigé) | ⚠️ bug visibilité |
| Cardif Lux Vie | 610 | 7 | ✅ |
| Apicil / OneLife | 435 | 1 | ✅ |
| Predica | 380 | 12 | ✅ aligné |
| Baloise Life | 275 | 1 | ✅ |
| AXA Wealth Europe | 258 | 1 | ✅ |
| Afer | 114 | 1 | ➕ manque « Génération » (codé) |
| ACM Vie | 102 | 4 | ➕ manque « Options Capi », « Plan Capitalisation » (codés) |
| Utmost Luxembourg S.A. | 64 | 1 | ✅ |
| La Banque Postale Life | 49 | 1 | ❌ seed orphelin (pas de scraper) |
| Carac | 29 | 2 | ✅ |
| MACSF | 18 | 1 | ➕ manque « RES Retraite », « RES Capitalisation » (codés) |
| Macif Vie | 14 | 1 | ⚠️ portail-only pour Multi Vie |

« codé » = le scraper découvre déjà ce contrat en dry-run ; il entrera en base au prochain
run CI `av-refresh.yml --apply` (secrets requis). Aucune ligne de code à écrire pour ceux-là.

## Vérification des liens en dur (santé des URLs)

Toutes les URLs codées en dur des scrapers « liste » ont été re-téléchargées ce jour :
elles répondent **HTTP 200** et rendent des ISIN (aucun lien mort). La seule exception,
**La France Mutualiste** (hors liste demandée), échoue en TLS chez `curl_cffi` mais le
scraper a déjà un **fallback `curl`** prévu pour ce cas précis.

## Manques identifiés (non comblés — et pourquoi)

1. **La Banque Postale Life** — pas de scraper. Recherche infructueuse d'une annexe
   financière / liste UC **publique et statique**. Les contrats grand public LBP
   (Cachemire, Vivaccio, Solésio) sont assurés par **CNP Assurances** (déjà couvert par
   `av-fr-cnp-catalog.py`). L'entité luxembourgeoise « LBP Life » distribue surtout via
   courtiers (docs derrière portail). **Reco** : demander à Mathis s'il a un accès
   courtier / une annexe PDF, sinon la traiter via le job navigateur comme Linxea/Cardif.

2. **Macif — contrat Multi Vie (Mutavie)** — existe, mais sa liste de supports n'est
   servie que par un portail JS (`apps.mutavie.fr`) protégé anti-bot (DataDome, 403).
   La « note d'information » PDF publique ne contient pas les ISIN (0 trouvé). Seul
   **Macif Épargne Vie** reste ajoutable en statique (déjà dans le CATALOG). **Reco** :
   scraping navigateur si ce contrat est prioritaire.

3. **Utmost Luxembourg — contrats hors « Liberté »** (Selection, Apex…) : documents en
   espace courtier, pas d'annexe publique. « Liberté » (code 2626) est le seul public.

## Comment reproduire ces dry-runs

```bash
cd charlie-investissement
python3 -m venv .venv && .venv/bin/pip install curl_cffi parsel supabase requests \
    lxml beautifulsoup4 pdfplumber python-dotenv
# poppler (pdftotext) absent : un shim pdfplumber a été posé dans .venv/bin/pdftotext.
cd scripts/scrapers
PATH="$PWD/../../.venv/bin:$PATH" ../../.venv/bin/python av-fr-macsf-catalog.py   # dry-run
```

Sans `--apply`, aucun scraper ne touche la base (les creds Supabase ne sont jamais
appelés). L'écriture réelle passe par les workflows CI (`av-refresh*.yml`).
