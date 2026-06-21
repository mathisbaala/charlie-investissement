# Tier 3 — Couvrir les assureurs AV majeurs manquants (cadrage pour reprise)

> Spec autonome pour l'agent qui reprend ce chantier. Daté du 2026-06-21.
> Pré-requis : aucun sur l'historique. Tout le contexte est ici.

## 0. État d'avancement (mis à jour 2026-06-21)

**FAIT — 6 des 7 assureurs câblés** via un socle commun `scripts/scrapers/_av_pdf_common.py`
(curl_cffi + pdftotext, éligibilité-only, filtre sur ISIN en base, dédup anti-21000,
`scraped_at=now()`). Tous validés en dry-run (fetch+parse) ; l'écriture bout-en-bout
se fait au prochain run `av-refresh.yml` (`workflow_dispatch` pour valider tout de suite).

| Assureur | Scraper | Source | Contrats | ISIN bruts (avant filtre base) |
|----------|---------|--------|---------:|----:|
| CNP Assurances | `av-fr-cnp-catalog.py` | PDF cnp.fr (Nuances) + Lucya CNP + EasyVie | 7 | 1568 |
| Predica / Crédit Agricole | `av-fr-predica-catalog.py` | API WP REST predica.com → PDF par contrat | 12 | 700 |
| Abeille Vie (ex-Aviva) | `av-fr-abeille-catalog.py` | index `/abdoc/<code>_ANNEXE_FINANCIERE` | 17 | 545 |
| Groupama Gan Vie | `av-fr-groupama-gan-catalog.py` | webfg.net `/documents/pdf` (4 marques) | 17 | 304 |
| MACSF | `av-fr-macsf-catalog.py` | PDF macsf.fr (RES) | 3 | 23 |
| MAAF Vie (Covéa) | `av-fr-maaf-catalog.py` | notices PDF maaf.fr (Winalto) | 3 | 35 |
| ACM Vie (Crédit Mutuel/CIC) | `av-fr-acm-catalog.py` | hub acm.fr → PDF le plus récent | 6 | 115 |

Câblés dans `scripts/cron/av-catalog-refresh.py` (section « bancassureurs majeurs »),
avant le prune Tier 4 + le refresh matview.

**RESTE — Covéa MMA & GMF (7e assureur, partiel).** Pas de source publique scriptable :
listes UC seulement derrière quantalys (SPA cookie-wall) ou DataDome (tout `gmf.fr`/`mma.fr`
en 403/503). La gamme MAAF (Winalto) est câblée et MMA/GMF partagent l'essentiel des mêmes
supports Covéa Finance. Pour les couvrir : passer par `av-catalog-refresh-browser.py`
(Playwright) sur le portail quantalys MMA/GMF, ou attendre une annexe PDF publique.

---

## 1. Objectif

Ajouter au référencement assurance-vie (`investissement_av_lux_eligibility`) les
**assureurs majeurs français aujourd'hui absents** :

| Assureur | Notes |
|----------|-------|
| **CNP Assurances** | Énorme (partenaire La Banque Postale, Amétis…). LBP Life déjà présent à 50 UC seulement. |
| **Predica / Crédit Agricole Assurances** | Absent. Gammes Floriane, Predissime, Espace Liberté… |
| **Abeille Assurances (ex-Aviva France)** | Absent. Gammes Afer (déjà 155 UC partielles), Abeille Épargne Patrimoine. |
| **Groupama / Gan** | Absent. Gan Patrimoine, Groupama Modulation. |
| **MACSF** | Absent. RES Multisupport. |
| **Covéa (MMA / MAAF / GMF)** | Absent. MMA Multisupports, Winalto. |
| **Crédit Mutuel / ACM** | Absent. Plan Assurance Vie, Patrimoniale. |

**Définition de « fait »** par assureur : ≥1 contrat scrapé avec ses UC (ISIN
déjà présents en base), écrit dans `investissement_av_lux_eligibility`, scraper
fill-only/idempotent, intégré à un orchestrateur planifié, run CI vert.

## 2. Modèle de données (à respecter)

Table cible : **`investissement_av_lux_eligibility`** (un lien = une UC dispo sur un contrat).
Colonnes écrites par les scrapers :
- `isin` — doit déjà exister dans `investissement_funds` (les scrapers sont
  **éligibilité-only** : ils ne créent pas de fonds ; ils filtrent sur les ISIN connus).
- `company_name` — nom **assureur** (ex. `"CNP Assurances"`). ⚠️ cohérence des noms :
  un nom = un assureur dans la liste UI (`get_insurers_list`). Pas de doublons d'accent
  ni de variantes (« Generali Vie » ≠ « Generali Luxembourg » = entités distinctes).
- `contract_name` — nom du **contrat** (ex. `"Cachemire Patrimoine"`).
- `source_url` — URL source (traçabilité). Préfixe `manual:` réservé aux seeds manuels.
- `scraped_at` — timestamp UTC ISO. **Critique** : alimente le délistage Tier 4
  (`inv_prune_stale_av_eligibility`) — toujours le mettre à `now()`.

Clé de conflit upsert : `on_conflict="isin,contract_name"`.
⚠️ **GOTCHA Postgres 21000** : dédupliquer `(isin, contract_name)` **avant** l'upsert
batch (un même couple deux fois dans un batch casse l'upsert). Cf. le fix dans
`scrapers/av-fr-spirica-catalog.py` (`seen_keys`).

## 3. Stack technique (déjà en place, à réutiliser)

- **HTTP simple** : `requests` (CI-safe).
- **Anti-bot / TLS-impersonation** : `from curl_cffi import requests as cffi_requests` ;
  `session = cffi_requests.Session(impersonate="chrome")`. Léger, en CI (cf. requirements.txt).
  **NE PAS** utiliser `scrapling` (retiré du CI — il embarque un navigateur).
- **Parsing HTML** : `from parsel import Selector` (pas BeautifulSoup).
- **PDF** : `pdftotext` (binaire `poppler-utils`, installé par `av-refresh.yml`) ou `pdfplumber`.
- **Navigateur (dernier recours)** : Playwright + chromium, **uniquement** via le
  workflow dédié `av-refresh-browser.yml` (lourd). À éviter si une API/PDF existe.
- Accès DB : `from db import get_client, upsert_funds_bulk, log_run`. `--apply` pour écrire.

## 4. Playbook de recherche de source (par ordre de préférence)

1. **opcvm360 `/licontracts` (LE plus rentable)** — un agrégateur qui expose des
   contrats AV par ID **avec le nom d'assureur** (`insurerName`). Voir
   `scrapers/av-lux-opcvm360-catalog.py --dynamic` : il lit
   `https://services.opcvm360.com/api-v1/licontracts?iframeKey=<KEY>` → liste de contrats
   nommés, puis `…/instrs-iframes?licontracts=<id>&iframeKey=<KEY>` → fonds.
   **Action** : chercher d'autres `iframeKey` (chaque distributeur/CGP a la sienne ;
   celle en place = Meilleurtaux/MonFinancier). Une clé CNP/Predica/etc. débloquerait
   leurs contrats nommés d'un coup. Les clés se trouvent dans les iframes des sites
   comparateurs (`iframes.opcvm360.com/funds?iframekey=…`).
2. **PRIIPS XML / DICI feeds** — certains assureurs publient un flux XML de leurs
   supports (ex. OneLife : `priipsdocuments.com/onelife/IOD_xml/IODs_0.xml`, cf.
   `av-lux-apicil-onelife-catalog.py`). Chercher `priipsdocuments.com/<assureur>/…`.
3. **Annexes financières PDF** — l'assureur publie la « liste des supports » en PDF
   (ex. Generali, Baloise, AXA WealthEurope, Spirica/Sylvéa). Extraire les ISIN via
   `pdftotext`. Modèles : `av-lux-baloise-catalog.py`, `av-lux-axa-wealtheurope-catalog.py`.
4. **AMF GECO** — pour les UC qui sont des OPCVM FR, l'API GECO donne déjà les fonds
   (cf. `docs/data-collection-playbook.md` §12). Ne donne PAS le mapping contrat↔UC.
5. **HTML paginé** — liste de supports en pages HTML (ex. `av-lux-wealins-catalog.py`,
   curl_cffi + parsel sur un `<table>`).

## 5. Pistes concrètes par assureur (à vérifier en live)

- **CNP** : gros distributeur via La Banque Postale / Amétis / CNP Patrimoine. Tester
  opcvm360 (clés LBP/Amétis), sinon annexes PDF CNP.
- **Predica/CA** : distribution Crédit Agricole / LCL / BforBank. Souvent opcvm360
  (BforBank a une clé), sinon PDF Predica.
- **Abeille (ex-Aviva)** : Afer déjà partiel (155) → compléter via l'annexe Afer/Abeille
  (PDF) ; gamme Abeille Épargne Patrimoine.
- **Groupama/Gan** : annexes PDF Gan Patrimoine.
- **MACSF** : RES Multisupport — annexe PDF MACSF.
- **Covéa (MMA)** : MMA Multisupports / Winalto — annexe PDF.
- **Crédit Mutuel/ACM** : distribution CM/CIC — tester opcvm360, sinon PDF ACM.

> Méthode de validation d'une source SANS DB (creds locaux = stubs) : importer la
> fonction de fetch et la lancer contre le site, ou lancer le scraper en **dry-run**
> (sans `--apply` → ne touche pas `get_client`). Sonder d'abord avec `curl_cffi`
> (cf. la session du 21/06 qui a sondé opcvm360/wealins/linxea ainsi).

## 6. Où câbler un nouveau scraper

- Scraper HTTP/PDF (pas de navigateur) → liste `AV_CATALOG_STEPS` de
  `scripts/cron/av-catalog-refresh.py` (workflow `av-refresh.yml`, trimestriel).
  Si PDF : vérifier que `poppler-utils` est bien installé (déjà le cas).
- Scraper qui EXIGE un navigateur → `scripts/cron/av-catalog-refresh-browser.py`
  (workflow `av-refresh-browser.yml`). À éviter sauf nécessité prouvée.
- Chaque étape de l'orchestrateur est **non-fatale** et bornée par `STEP_TIMEOUT`
  (anti-hang) — un scraper lent/bloquant ne fige pas le job.
- Le **délistage Tier 4** (`prune-stale-av-eligibility.py`) tourne en fin
  d'orchestrateur : un nouveau scraper qui écrit `scraped_at=now()` est
  automatiquement protégé (ses liens sont « frais »).

## 7. Gotchas (ne pas réapprendre à ses dépens)

- **Dédup avant upsert** (Postgres 21000) — cf. §2.
- **Sources bloquantes** : quantalys.com et opcvm360-en-direct (403) peuvent **pendre
  sans fin** → toujours `timeout=` sur les requêtes ; le `STEP_TIMEOUT` orchestrateur
  est le filet. Cf. l'incident lmep-easypack (hang 2 h).
- **Noms d'assureur** : prendre le nom **autoritaire** de la source (ex. opcvm360
  `insurerName`) plutôt que deviner → évite les « Assureur inconnu » et les doublons.
- **fill-only** : ne jamais faire d'`upsert_fund` avec un `name` sur un ISIN inconnu
  (écrase). Filtrer sur les ISIN déjà en base (`existing_isins`).
- **Hygiène** : un contrat à 1-2 fonds pollue la liste UI (faux « petit assureur »).
  Viser des contrats réels (dizaines/centaines d'UC) ou ne pas écrire.
- **Vérifier en CI** : creds réels = secrets GitHub Actions seulement. Le dry-run local
  valide le fetch+parse ; un run `workflow_dispatch` valide l'écriture bout-en-bout.

## 8. Références de code (à copier/adapter)

| Besoin | Modèle |
|--------|--------|
| HTTP + table HTML | `scrapers/av-lux-wealins-catalog.py` (curl_cffi + parsel) |
| PDF annexe | `scrapers/av-lux-baloise-catalog.py`, `…-axa-wealtheurope-catalog.py` |
| Agrégateur nommé | `scrapers/av-lux-opcvm360-catalog.py` (`--dynamic`, `/licontracts`) |
| Flux PRIIPS XML | `scrapers/av-lux-apicil-onelife-catalog.py` |
| Dédup anti-21000 | `scrapers/av-fr-spirica-catalog.py` (`seen_keys`) |
| Orchestrateur HTTP | `scripts/cron/av-catalog-refresh.py` |
| Orchestrateur navigateur | `scripts/cron/av-catalog-refresh-browser.py` |
| Runbook données global | `docs/data-collection-playbook.md` |

## 9. État au démarrage (2026-06-21)

- 439 contrats / ~10,6k UC / ~247k liens couverts (Suravenir, BNP Cardif, Spirica,
  SwissLife, AXA, Linxea, Cardif Lux Vie, Generali Vie via opcvm360 dynamic, etc.).
- Tier 1 (hygiène) et Tier 2/4 (délistage) faits. Tier 3 = ce document.
- Backlog technique mineur (hors Tier 3) : linxea-av (URLs mortes), lmep (quantalys),
  utmost/mutualistes (rendent 0 par intermittence).
