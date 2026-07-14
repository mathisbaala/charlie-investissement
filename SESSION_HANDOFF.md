# 📋 Session Handoff — 14 juillet 2026

> Base du document : journée dense du **19 juin** (26 commits, sprints DDA), réconciliée
> le **22 juin**, auditée le **23 juin**, **gros chantier PORTEFEUILLE le 25 juin**
> (retour client CGP — Partie 2), **sprint complétude + sécurité/conformité 28-29 juin**,
> puis **plateforme ALLOCATION + onglet CABINET (07-13 juillet)** et **audit chantier +
> data-quality (14 juillet)**. Voir journal 07-14/07 ci-dessous, puis 28-29/06, puis
> 25/06, + `CHANTIERS.md`.
>
> Doc précédente (19 mai) archivée dans `docs/bilans/`.

---

## 🔄 Journal 07-14/07 — Allocation, cabinet, référencement & data-quality

**Plateforme d'allocation `/allocation` (07-13/07)** : réponse au retour CGP « générer une
allocation à partir d'un profil client ». Studio interactif (`AllocationStudio.tsx`,
`lib/allocationService.ts` + `optimizer.ts`) branché sur `/api/portfolio/optimize` (fonds réels
du contrat, corrélations DB ; repli démo si base injoignable) : **max-Sharpe par contrat**,
**frontière efficiente Markowitz** interactive, **HRP** (corrélations robustes), **goal-based**,
**préférences client** + poches par SRI, **rétrocessions réelles** (via l'onglet cabinet).
Restitutions : **export PowerPoint `.pptx` éditable au format Métagram**, **PDF**, rationale
généré. Démo autonome `npm run demo:allocation`. Guide `docs/allocation-optimizer.md`.

**Onglet « Mon cabinet » `/cabinet`** : données structurelles du cabinet (partenariats assureurs,
contrats distribués, **conventions de rétrocession** en cascade : exception par fonds → taux UC du
contrat → estimation de place), saisies une fois et réutilisées par l'allocation. Fix mode strict
React (chargement infini du référencement).

**Chatbot → guide contextuel de page** : le chatbot IA cède la place à un guide contextuel par
page ; visite guidée + guide couvrent désormais `/allocation` et `/cabinet`.

**Référencement assureurs (PR #12)** : scraper **MAIF Vie (ARS)** via l'API JSON maif.fr,
**Generali Vie France** (Himalia + e-Xaélidia), **Generali Lux** nommé distinctement (716 fonds),
réparation colonnes **LMEP Easypack (AG2R)**, **Oradéa Vie retirée** (source décommissionnée).
Seed catalogue AV depuis annexes PDF (CNP…) + cycle de vie des fonds semés.

**Enricher frais TER (Morningstar EMEA)** : `ms-fees` (OngoingCharge/ExpenseRatioNet), écriture
incrémentale + fail-fast, câblé en shard de rotation mensuel. **Refonte design** : Inter partout +
accent clay désaturé, italiques redressés, titres poids 500. **Classif** : structurés + titres
vifs mal classés reclassés ; SCPI/non-coté ne sont plus `management_style='alternatif'`.

**Audit chantier + data-quality (14/07)** : `CHANTIERS.md` rattrapé (dernier audit 29/06).
`tsc` clean, **584/584 tests verts**. Fixes du jour : **workflow SFDR/DDA** (étape KID retirée
du cron hebdo — elle débordait le timeout de 2h et faisait annuler le run en silence ; gardée en
manuel + monthly-pipeline) ; **commentaire `allocation/page.tsx`** rafraîchi ; **pipeline
data-quality 09/07 appliqué en prod** (`run-data-quality-fixes.sh APPLY=1` : ~506 perfs
fraction→%, 75 ter alignés, 9 entités HTML, 5 vol saturées → NULL, + recalculs average-perf /
track-record / completeness v2). Cf. `CHANTIERS.md` (21ᵉ passe).

---

## 🔄 Journal 28-29/06 — Complétude, sécurité & conformité

**Sprint complétude (28/06)** : TER **+533** (`kid-ter-fill.py`), MiFID **+186** (`sfdr-annex-enricher.py`,
premiers indicateurs durabilité depuis l'annexe précontractuelle SFDR), **géo OPCVM FR réparée**
(fix parser super-régions `ft-enricher` + nouvel enricher `quantalys-geo-enricher.py` ; aberrantes
1680 → 0, propres → 6378), AUM +72. Fixes UX : pertinence recherche (dé-biais vivier fit + tiebreak
AUM), logo OG dans l'aperçu de lien, visite guidée v2. Polish UX « contenu d'abord » (titres en
Topbar, accueil sans hero).

**Sécurité & conformité (29/06)** :
- **Rate-limit + plafond de pagination anti-scraping** sur `/api/funds`, `/api/funds/[isin]`,
  `/api/fonds/[isin]/nav` (migration `20260629120000`, +13 tests → 334 verts).
- **Politique de confidentialité RGPD** (`/confidentialite`) + `PrivacyNote` près des uploads.
- **Legacy anon key Supabase neutralisée** (migration `20260629140000`) : `REVOKE anon` sur les
  44 tables encore ouvertes (→ 0) + coupure du re-grant (default privileges `postgres`). App en
  `service_role` only (vérifié), 0 ERROR advisor. La anon key devient inoffensive même si laissée
  active côté dashboard. Reliquat = fonctions d'extension `pg_trgm`/`unaccent` (sans surface data).
- **Drain MiFID câblé en CI** : l'enricher annexe (`documenttype=398`) existait mais n'avait tourné
  que sur 9 % des Art.8/9 et dans aucun cron → drain **hebdo** (`sfdr-refresh.yml`, mardi, lots 3000)
  + ajouté au `monthly-pipeline.py`. Le pool restant (~6 650) se draine seul sur ~3 semaines.
- **Hygiène git** : 4 branches locales mergées du sprint 28/06 élaguées (reste `main`).

**État** : `tsc` clean, **334/334 tests verts**, working tree propre, CI saine. Détail + suivi dans
`CHANTIERS.md` (19ᵉ passe).

---

## 🔄 Journal 25/06 — Moteur PORTEFEUILLE (Partie 2) + fondations data

**Contexte** : retour d'un client CGP en deux points — (1) listes/référencement par assureur,
(2) **construire des portefeuilles et back-tester** (ratios + **corrélation**). On a concentré
l'effort sur (2), le gros morceau, et livré de bout en bout.

### Livré et en ligne (vérifié live sur `www.charliewealth.fr/portefeuille`)
- **Moteur** : RPC `inv_portfolio_analyze` (migrations `20260625130000` cœur + `150000` benchmark).
  Courbe composite hebdo **multi-rythme** (LOCF), ratios (perf ann./vol/Sharpe/max DD),
  **matrice de corrélation**, **back-test vs indice** (overlay + sur/sous-perf), **projection €**.
- **UI** `/portefeuille` : pondération → ratios → corrélation colorée → back-test (sélecteur
  d'indice, défaut MSCI World) → projection en euros → **lien partageable** (sans compte) +
  entrée menu de gauche (`Rail`). Route `/api/portfolio/analyze`, helpers `lib/portfolio.ts`.
- **Fondations data** : **fonds euros back-testables** (table `investissement_fonds_euros_rates`
  + courbe synthétique annuelle, source `synthetic-fonds-euros`, 41 fonds) ; **SCPI accumulation
  démarrée** (`investissement_scpi_price_history`, 42 SCPI, 1 pt/an).
- **Qualité** : `tsc` clean, **298 tests verts**, `/qa` + `/verification` passés (2 fixes QA :
  tour masqué sur /portefeuille, bloc résultats gardé sur `used>0`).

### Itérations UX + navigation (25/06, après livraison)
Suite aux retours, plusieurs passes design/UX :
- **Page Portefeuille refaite** : titre externe (`PageShell`/`PageHeader`) — corrige le **scroll**
  (le `<main>` du layout est `overflow-hidden` : chaque page fournit son conteneur scrollable) ;
  **recalcul automatique** (débounce) au moindre changement (poids/fonds/indice/période), plus de
  bouton « Analyser » ; bandeau **KPI** coloré ; éditeur de poids épuré (input sans flèches + barre,
  ISIN seul) ; **sélecteur de période** back-test (1/3/5 ans/Max) ; **comparaison enrichie** sur
  5 ratios (RPC : Sharpe + perte max ajoutés au benchmark, migration `20260625190000`) ; date FR,
  texte décoratif retiré.
- **Onglet Comparé fond par fond** : `/api/portfolio/lookthrough` → géo+secteurs PAR FONDS
  (`geoByFund`/`sectorsByFund`, plus de blend) ; `LookThroughView` en matrices ; dédup géo par code
  pays ; texte décoratif retiré.
- **Accueil épuré + onglet « Profil client » RETIRÉ** : accueil = recherche langage naturel +
  formulaire profil (composant `ClientProfileForm` extrait) ; suppression grilles enveloppe/assureur
  + top performers ; `/matching` redirige (307) vers `/accueil` ; liens screener/sitemap/prompt chat
  mis à jour ; visite guidée : « Profil client » → « Portefeuille ». Menu = Accueil / Recherche /
  Portefeuille / Assurances vie / Documents.
- **Barre de recherche** (langage naturel) sous le titre Portefeuille → renvoie au screener
  `/recherche?q=…` (pas de screener recréé dans la page) ; sert d'amorce + d'ajout de fonds.
- **Sélection jusqu'à 10 fonds** (`SELECT_MAX=10`) ; **comparaison limitée à 4** (`COMPARE_MAX=4`,
  bouton « Comparer (max 4) » désactivé au-delà) ; **Portefeuille actif pour 2-10** (vérifié à 7 :
  KPI + courbe + corrélation 7×7).
- **Onglet Comparé en graphes** : géo + secteurs en barres groupées horizontales (1 barre/fonds),
  lignes communes en chips — fini la matrice « liste de courses ».
- 298 tests verts, tsc clean, tout déployé + vérifié live.

### Tranché — NE PAS revenir dessus
- **LU sans série (~855) → back-test = WON'T-DO** : FT = impasse (test 0/20), ce sont des
  doublons de parts ; la résolution par part sœur n'est sûre que pour ~51 (hedged/devise
  non fiable/mal groupés → 26 % divergent). Décision : **ne pas exposer de proxy** (risque de
  back-test faux > gain marginal). Détail complet dans `CHANTIERS.md` § ⏸ « LU sans série ».
- **SCPI** : seule l'accumulation prospective est possible (pas d'archive publique) → série
  exploitable dans ~2-3 ans.

### Livré depuis (mis à jour 25/06)
- **Référencement assureur (Partie 1)** : ✅ **RÉSOLU le 25/06** (A+B+C livrés). L'offre assureur
  réelle est désormais visible (référencés exploitables **741 → 6 414** au seuil strict ; ~5 400
  supports débloqués), invariant **carte == total exact**, doublon AG2R nettoyé, cause racine de la
  péremption de complétude corrigée + câblée au pipeline. Détail dans `CHANTIERS.md` § ✅ Réglés.
- **Ajouter des fonds depuis la page portefeuille** : ✅ **LIVRÉ le 25/06** (composant `FundAdder`,
  recherche inline ISIN/nom dans la base, helper `appendHolding` + 6 tests). Détail § ✅ Réglés.

---

## 🔄 Journal 23/06 (suite²) — Intégration `/recul` des chantiers alpha + LU

> Prise de hauteur sur les 2 chantiers du jour (alpha diversifiés + démasquage LU),
> puis intégration active : vérifier qu'ils s'emboîtent, et solder les 3 points de
> qualité de données qu'ils faisaient remonter. **3 gardes de la vue `_cgp` cohabitent
> désormais sans conflit** : fraîcheur `__stale` · perf externe LU `__ext_fresh` · risque
> implausible `__insane`. 884 perfs LU intactes, 0 fuite alpha, 272/272 tests.

- **#1 Diversifiés mal classés — CORRIGÉ** *(migration `20260623150000`)* : le benchmark composite était donné à TOUT `diversifie`, or **25 fonds mono-classe** y étaient mal rangés → alpha trompeur (BNP Insticash *monétaire* −10,9 ; iShares MSCI World *ETF actions* 119 Md€ ; UniGlobal/DWS actions +5,9 à +19,3), surtout visibles car gros encours. 16 corrigés par signal en base (nom monétaire / `category` Actions/Obligations) + 9 par **curation nommée ratifiée**. `diversifie` 14 607→**14 582**, alpha composite neutralisé (recompute auto `td-enricher`). Backup `investissement_funds_classif_backup_20260623`. Piège : `classify-from-name.py` **fill-only** → SQL ciblé obligatoire.
- **#2 Dérive des comptes alpha — DIAGNOSTIC bénin** : **0** fonds avec benchmark+série fraîche+3 fenêtres alpha vides → simple effet de snapshot (`alpha_1y` à un instant donné), pas un bug. Gotcha `ft-metrics-wipe` patché (`td-enricher` seul writer, efface explicitement). Rien à réparer.
- **#3 Corruption NAV — GARDE d'affichage** *(migration `20260623160000`)* : la garde de fraîcheur ne voit pas une série fraîche mais à **valeur corrompue** (point NAV à 3 € → vol/drawdown explosent : UniGlobal vol_3y 84,5 ; UBS S&P 500 dd −99 %). La vue `_cgp` masque vol/sharpe/drawdown **par fenêtre** (1y si vol_1y>60 ; 3y si vol_3y>60 OU dd<−90), hors crypto/levier. ~99 fonds en 1y, ~121 en 3y ; 112 volatils légitimes préservés. Réversible (0 prix touché). **Suivi non fait** : réparer les ~442 séries elles-mêmes (glitch vs split). Cf. mémoires `diversified-misclassification-cleanup`, `insane-risk-metrics-gate`.

---

## 🔄 Journal 23/06 (suite) — Alpha des fonds diversifiés (chantier de fond)

- **Alpha diversifiés — RÉSOLU** *(migration `20260623130000` + commits `5e5e813`/`aed711e`)* : les ~14 600 diversifiés étaient à alpha=0 (14 notés) faute d'indice mono-classe pertinent. Solution sans réécrire le moteur d'alpha : des indices **composites** actions/oblig (`mix_25_75` prudent / `mix_50_50` équilibré-flexible-inconnu / `mix_75_25` dynamique), construits par **mélange quotidien rééquilibré** de `msci_world` + `global_agg` (net EUR) via la fonction SQL `inv_rebuild_composite_indices()` ; `td-enricher.map_index` mappe chaque diversifié sur son composite selon `allocation_profile` (avant le match exact, pour ne pas capter un indice actions de passage ; borne alpha dédiée ±20 %/an). **Résultat : diversifiés 14 → 2 110 avec alpha**, run `td-refresh` success (8 097 alpha total, 0 échec), **zéro régression** (action/oblig/monétaire inchangés), distribution saine (moyenne −3 %/an = sous-perf active vs passif, attendu). Plafond = couverture prix des diversifiés (~2 700 avec série), pas la logique. **Fix robustesse** : écriture incrémentale (flush/500) + timeout CI 60→120 min (le 1er run avait été annulé au timeout en écrivant tout à la fin). Cf. mémoire `diversified-composite-benchmarks`.

---

## 🔄 Journal 23/06 — audit chantiers (`/chantier`) + nettoyages

> Audit complet du projet (doc + git + code + base). Verdict : **projet sain** —
> `tsc` clean, 272/272 tests verts, zéro `TODO/FIXME` réel dans le front. Carte
> actionnable écrite dans **`CHANTIERS.md`** (fichier unique, mémoire vivante des
> chantiers). Trois nettoyages traités, deux faux-doutes levés en base.

- **`fetch_ter_morningstar` — tranché définitivement** (`scripts/scrapers/fetch-ter-fundinfo.py`) : le commentaire « désactivé temporairement » était périmé. Vérifié : script **hors CI active**, et le TER Morningstar est possédé par les enrichers dédiés `morningstar-ter-fill.py` (rating connu sans TER) + `morningstar-lt-enricher.py` (rating NULL). Le re-câbler ici doublait le throttle Morningstar. → Finder retiré du dispatcher (**Boursorama seul actif**), décision rendue permanente et documentée dans le code. `py_compile` OK.
- **Branche morte `docs/av-tier3-validation`** : 0 commit en avance sur `main` → **supprimée local + remote**.
- **Placeholder AUM ETF 1e9** (`fetch-etf-extended.py:427`) : **confirmé inerte** — script hors CI, **0 ETF** en base à `aum_eur=1e9` (le seul fonds à cette valeur est `FE_UAF_LIFE`, un fonds euros seedé à 1 Md€ rond, sans rapport). Won't-do.
- **Alpha diversifiés — confirmé NON fait** : 14/14 607 diversifiés ont un alpha (0,1 %). Reste **le seul vrai chantier de fond** (benchmarks composites = vrai code). Les classes mono sont, elles, débloquées (action 42 %, oblig 38 %, monétaire 39 %, matières premières 22 %, alternatif 6,5 %, immo 3,1 %).
- **Couverture prix OPCVM — confirmée non corrigeable par code** : 63 % avec un prix, **48,9 % frais (≤35j)**. Plafond structurel (fonds vivants sans source publique), grignoté en continu par `weekly-refresh`. Pas un bug, ne pas chercher à « clore ».

---

## 🔄 Journal 22/06 (post-19/06) — réglage des chantiers ouverts un par un

> Objectif de la session : reprendre la liste « Prochains chantiers » et la **traiter
> intégralement**, en vérifiant l'état RÉEL (base + live) avant de coder, et en
> documentant chaque item pour ne plus y revenir.

- **Backlog AV** *(déployé)* — Faux chantier : Spirica + mutualistes fonctionnent (sondés live le 22/06 : sources 200, ~280/336 ISIN en base, 62 080 lignes Spirica fraîches du 21/06). Seuls les commentaires `# rend 0 — à re-câbler` étaient périmés → corrigés (`av-catalog-refresh.py`). Reste réel = Abeille/MAAF/MMA/GMF bloqués par IP datacenter (proxy dormant = décision utilisateur).
- **Look-through — double-comptage géo + polish FE** *(déployé, `34baba5` + `6b10262`)* — Vrai bug : l'« Exposition agrégée » groupait par libellé brut, donc « Germany » (FT) et « Allemagne » (Morningstar) comptaient double (même code `DE`). Fix : agrégation par **code ISO** + libellé canonique, rétrocompatible. Polish FE : re-fetch sur clé ISIN stable + garde de course, accessibilité des barres (role=img/aria-label), erreur réseau distinguée. **Chantier look-through clos à 100 %.** 245/245 tests, tsc clean.
- **SCPI — DVM + TOF sur la fiche** *(déployé, `9c44ee2`)* — La table `scpi_metrics` portait déjà taux de distribution (DVM, 109), taux d'occupation (TOF, 101) et capitalisation, mais seul le prix de part était affiché. Ajout des lignes DVM + TOF (avec l'année). Couverture prix SCPI = 116/191 (le reste = SCPI fiscales fermées, légitime). Capitalisation non ajoutée (= doublon Encours). *Vérifié live en QA : Primovie affiche « Taux de distribution (2024) 4,04 % » + « Taux d'occupation (2024) 94,7 % ».*
- **QA prod read-only** — Parcours CGP complet sondé (recherche NLP, fiches ETF+SCPI, comparaison, look-through, profil, assureurs, documents). **Health 98/100, zéro erreur console, zéro bug fonctionnel.** Les 3 livraisons du jour vérifiées live (dont la dédup géo confirmée via l'API : un pays = une ligne). Rapport : `.gstack/qa-reports/qa-report-charlie-investissement-2026-06-22.md` (gitignored). Seul finding **F1** (chips Profil scrollables) → **fermé, working-as-designed** (scroll single-line volontaire + dégradé d'affordance, `Card` sans overflow-hidden donc non rogné).
- **Look-through — dédup secteurs** *(déployé, `70952fb`)* — Suite du fix géo : la base mêle 3 taxonomies de secteurs (Morningstar « Technology » / GICS « Information Technology » / FR « Technologie ») → l'agrégation triple-comptait. `canonicalSector()` rabat les variantes dominantes sur un libellé FR unique + écarte le junk (ISIN collé en secteur, « Volatilité sur 1 an »). *Vérifié live : secteurs renvoyés en FR canonique sans doublon.* 250/250 tests.
- **Pertinence recherche — investigué, RAS** — Sondé en prod (NLP « obligataire court terme faible risque » → 1 185 ; « ETF S&P 500 » → 37 pertinents ; typo « Amundo » → Amundi via fuzzy pg_trgm ; loading states corrects, deep-link sans flash). **Déjà excellente après le sprint 20/06 → aucun changement défendable.** Pas de code touché (ne pas re-ouvrir comme chantier).
- **Décisions fermes prises** : (a) **Actions individuelles = WON'T-DO** (`b04c16f`) — exclues du screener+recherche par design, simples holdings look-through, prix inutile ; (b) **Proxy AV non activé** — re-seed manuel trimestriel retenu (secret `AV_PROXY_URL` non posé, vérifié `gh secret list`).
- **Pertinence recherche — score d'adéquation (fit)** *(déployé, `a70d92c`)* — Itération de fond **demandée par le user** (dépasse le « RAS » ci-dessus). Le couloir **intention/profil** (recherche descriptive OU profil client) est désormais re-classé par un **score de fit composite** (TS pur, `app/src/lib/fitScore.ts`, **aucune migration**) : `0.55·complétude + 0.22·qualité(Morningstar/alpha/Sharpe/ancienneté/encours) + 0.13·adéquation − 0.10·dépassement doux + prefs`. **Complétude DOMINANTE** = garde-fou : un fonds bien renseigné n'est pas rétrogradé sous un fonds creux, et la **navigation neutre garde `data_completeness` strict** (inchangée). Trois leviers : (a) classement par adéquation à l'intention/au profil ; (b) **proximité douce** — les seuils de confort non structurants sont élargis (TER ×1.15, drawdown +5, perf −3, vol +3, Sharpe −0.2) et le quasi-match est classé **DERRIÈRE** au lieu d'être exclu ; SRI/SFDR/univers/zone/enveloppes/labels restent **durs** ; (c) **signaux profil exploités** (objectif revenus → classes génératrices de revenus, TMI ≥ 30 → PER/PEA, novice → moins d'alternatif, petit montant → accessible retail) en **préférences douces** `prefs` (jamais des filtres durs), aussi injectées dans le parse NLP quand un profil est actif. Un **tri explicite** (clic colonne / « le moins cher ») désactive le couloir = **mode strict**. **QA prod live 8/8** : neutre inchangé (7 844, tri completeness) ; fit `action` top tous dc=100 ordonnés qualité ; `ter_max=0.2` = **+20 quasi-matches** (433 vs 413 strict) **invisibles en page 1** ; `pref_income` bascule le top vers oblig + SCPI ; mode strict = seuils exacts ; texte/fuzzy/ISIN intacts ; latence **0,44–0,91 s** (couloir fit enrichit ≤ 300 lignes, pas de timeout). 266 tests, tsc clean. Transparence per-fonds (« pourquoi ça colle ») **non retenue** ce sprint. Cf. mémoire `fit-score-ranking-20260622`.
- **À suivre** : voir « Prochains chantiers » plus bas (liste réconciliée au 22/06).

---

## 🎯 Ce qui a été livré le 19/06 (par chantier)

### 1. Analyse de DICI + rapport de fonds design  *(chantier principal de fin de journée)*
- **Bug racine résolu** : la clé `ANTHROPIC_API_KEY` en prod était **invalide** (`401 invalid x-api-key`) → toutes les fonctionnalités IA tombaient (DICI, chat, recherche NLP). Clé remplacée dans Vercel + redéployée → **tout refonctionne**.
- **Erreurs honnêtes** : l'UI affichait « DICI invalide » pour *toute* panne. Désormais distinction `422 unreadable` (document) vs `503 ai_unavailable` (service/clé) ; la recherche NLP ne retombe plus silencieusement sur `{}` sans trace.
- **Rapport DICI design** (`/documents`) : upload PDF → `DiciReport` (hero, KPI, objectif, **scénarios de performance KID** en barres dégradées, jauge SRI, frais, risques) **+ enrichissement « données de marché »** du fonds rattaché en base (courbe VL `NavChart`, sous-jacents géo/secteur `CompositionCard`, volatilité/Sharpe/drawdown). Extraction enrichie (scénarios + coûts).
- Commits : `a0a2bb6` (rapport), `b3b6e0c` (coûts IA, ci-dessous).

### 2. Durcissement des coûts IA  *(site public → ne pas vider les tokens)*
- **Plafond GLOBAL journalier** (toutes IP) en plus du plafond par IP → mur dur contre une attaque distribuée. Env `AI_GLOBAL_DAY_LIMIT` (**prod = 60**, cible ~20 €/mois).
- **IP de comptage non usurpable** : `x-real-ip` / `x-vercel-forwarded-for` d'abord (le 1er maillon de `x-forwarded-for` était spoofable et contournait le quota).
- **Garde taille PDF** (`DICI_MAX_BYTES`, défaut 3 Mo) + validation magie `%PDF` **avant** tout appel modèle (un PDF de 600 pages = facture énorme).
- RPC `inv_ai_rate_limit` étendue (`p_global_day_limit`), rétro-compatible.

### 3. Benchmark / Alpha vs indice / Perf nette  *(sprint 1 DDA)*
- Généralisation du calcul d'écart fonds/indice **au-delà des ETF** : catalogue d'indices + règles d'affectation en base, `alpha_*` et `benchmark_perf_*` par fenêtres, `benchmark_is_category` (indice exact vs indice de catégorie). Perf nette de frais de contrat (`PerfNetteCard`).
- **Indices obligataires + actions euro** ajoutés (proxies ETF accumulants) → alpha obligataire 0→1609, monétaire 0→137 ; proxies HY/EM dédiés + exclusion des hybrides + plafond d'alpha resserré (±10 %/an oblig vs ±30 actions).
- Fixes : `is_category` réservé aux vrais trackers ; doublon d'affichage « Indice indice net TR » sur la fiche.
- Commits : `f2cb1be`, `fde325b`, `6f88120`, `9a8a255`, `3f27bf4`.

### 4. Recueil DDA / durabilité  *(sprint 2)*
- SFDR + labels officiels (ISR/Greenfin/Finansol), carte fiche `DurabiliteCard`, filtre screener (jsonb `@>`), préférence profil « labellisé », colonnes MiFID (taxonomie / inv. durable / PAI) enrichies en fond. Commit `c234f5f`.

### 5. Look-through portefeuille  *(sprint 3)*
- Section « Exposition agrégée » inline sous la comparaison (≤4 fonds équipondérés) → géo/secteur agrégés + détection de doublons. Sourcing des compositions priorisé par référencement. Commits `1d6e2c6`, `ea4aa6d`, `1504a1b`.

### 6. Données & fraîcheur (rafraîchissements planifiés)
- **Crypto** : refresh hebdo (CoinGecko en `requests`) — `93a2832`.
- **Fonds euros** : refresh annuel, fenêtre d'années **dynamique** (fini le figé 2022-2024) — `f560e92`.
- **SCPI** : métriques trimestrielles (Primaliance en `requests`/`parsel`, fini `scrapling` qui cassait en CI) + **prix de part** affiché sur la fiche — `bff5daf`, `4fe2761`, `7d86f58`.
- **OPCVM étrangers** : perfs Morningstar EMEA en refresh mensuel (~706 fonds LU/IE sans autre source) — `8fe54ad`.
- **GECO (OPCVM FR)** : couverture **hebdo complète** (~10,7k) + **cache ISIN→idInterne** (≈3× moins d'appels AMF) + dédup des dates avant upsert — `b06dfb4`, `d2bccde`, `35948fb`.

### 7. Classification & nettoyage de l'univers
- Reclassement **~6 233 véhicules** mal classés `opcvm` : 5 479 → `fps` (PE/alternatifs), 754 → `structuré` (nouveau type, exclu du screener) — `0113129`.
- Garde **OpenFIGI** : reclasser les titres vifs (actions/REIT) ingérés en `opcvm` — `f2f183b`.

### 8. CI / sécurité / infra
- Credentials Morningstar EMEA → **secrets** (plus en dur) + bump `actions/checkout@v5` / `setup-python@v6` (Node 20 EOL) — `cfbc72a`.
- Groupe de concurrence dédié pour la garde de classification (évitait l'annulation de runs) — `c60e0ed`.
- Refresh Morningstar EMEA **sorti du pipeline mensuel** vers son propre workflow (le pipeline dépassait le timeout 6h) — `fef1041`.

### 10. Polish UI — page « Profil client »
- **Barre d'action retirée** : la barre flottante sous le formulaire portait les chips « Filtres screener » devenues vides → trop lourde pour rien. Remplacée par le seul bouton « Trouver les fonds adaptés » aligné à droite (+ lien « Effacer » si profil actif). Code mort retiré (`filterChips`, import `describeScreenerFilters`) — `7dda4cf`.

### 9. Quota Supabase + optimisation storage  *(fin de journée)*
- **Alerte « DB Size Exceeded »** : base à **2,03 Go** vs limite Free 0,5 Go (grace period jusqu'au 18/07 puis erreurs 402). Cause = `investissement_fund_prices` (10,5 M lignes, historique prix 2021→2026 = fenêtre perf 5 ans, **données légitimes**). Impossible de tenir sous 0,5 Go sans casser la perf → **upgrade Supabase Pro** (org `Charlie`, plan vérifié `pro`, 8 Go inclus).
- **Optimisation storage sans impact produit, 2,03 → 1,41 Go (−32 %)** : REINDEX PK prices `CONCURRENTLY` (bloat ~2×, 750→406 Mo), VACUUM FULL `fund_prices`/`funds`/`av_lux_eligibility`, purge logs cron + **job récurrent `inv-purge-cron-logs`** (dim 03:30), 8 index morts/redondants supprimés. Aucune donnée produit touchée. Détails : mémoire `db-storage-optimization-20260619`.

---

## ✅ Problèmes résolus aujourd'hui

| Problème | État |
|---|---|
| Clé Anthropic invalide en prod → toute l'IA KO | **Résolu** (clé remplacée, déployée, vérifiée) |
| Analyse DICI non fonctionnelle | **Résolu** (parse + rattachement + rapport, vérifié bout en bout en prod) |
| Erreur IA masquée en « DICI invalide » | **Résolu** (422 vs 503, messages dédiés) |
| Site public exposé au drainage de tokens | **Résolu** (plafond global + cap PDF + IP non usurpable) |
| Alphas obligataires aberrants (NAV cassées, proxies trop loin) | **Résolu** (proxies dédiés, plafonds, td-enricher autoritaire) |
| Doublon « Indice indice net TR » sur la fiche | **Résolu** |
| Faux TER SCPI / overflow prix de part | **Résolu** |
| Dates dupliquées dans la série GECO (upsert) | **Résolu** |
| Fonds euros figés sur 2022-2024 | **Résolu** (fenêtre dynamique) |
| ~6 233 PE/structurés gonflant le screener | **Résolu** (reclassés fps/structuré) |
| Quota Supabase dépassé (DB 2 Go / 0,5 Go, risque 402) | **Résolu** (upgrade Pro + storage 2,03→1,41 Go) |

---

## 🟢 État opérationnel actuel (prod)

- **Frontend** : Next.js 16 sur Vercel, auto-déploy au push `main`. Domaine principal `www.charliewealth.fr` (apex `charliewealth.fr` → 308 ; `charlie-investissement.vercel.app` conservé).
- **IA opérationnelle** sur 4 routes (`/api/parse`, `/api/dici/parse`, `/api/chat`, `/api/parse-profile`) — clé valide, vérifié 200 partout.
- **DICI live** : upload → rapport design + enrichissement marché. Vérifié end-to-end (upload navigateur réel) sans erreur console.
- **Garde-fous coût actifs** : par IP (`AI_HOUR_LIMIT`/`AI_DAY_LIMIT` = 25/25), GLOBAL (`AI_GLOBAL_DAY_LIMIT` = 60), taille PDF (`DICI_MAX_BYTES` = 3 Mo), validation `%PDF`. Tous réglables via env Vercel (redeploy requis).
- **Modèles** : extraction DICI + recherche/profil sur **Haiku 4.5** (cheap) ; chat sur **Sonnet 4.6**.
- **Recherche / screener** : couloir **intention/profil** classé par **score d'adéquation (fit)** (complétude dominante) ; **navigation neutre** = tri `data_completeness` strict (inchangé) ; **proximité douce** (quasi-match classé derrière) + **prefs profil** douces. Déployé `a70d92c` (cf. Journal 22/06 + mémoire `fit-score-ranking-20260622`).
- Logs serveur Vercel : 0 erreur depuis le fix clé.

---

## ⚠️ Pièges à éviter (à jour)

1. **Clé Anthropic** : rotée le 21/06 dans un **Workspace avec spend limit mensuelle** (Console) = plafond dur garanti au centime. ✅ Fait.
2. **Recalcul td-enricher** (benchmark/alpha) : relancer **APRÈS** le code `map_index` final, sinon alphas obsolètes (cf. mémoire `alpha-bonds-euro-indices`).
3. **Scrapers en seeding** : NE PAS les lancer en mode upsert global (destructif). Les enrichers sont fill-only ; les refreshs ciblent des colonnes précises.
4. **`.env` locaux = stubs** : vérif locale = `tsc` + `vitest` (pas de build complet, pas d'appel DB/IA réel). Credentials réels = env Vercel.
5. **Rate-limit fail-open** : une panne de comptage laisse passer (on ne casse pas le produit) → le plafond Anthropic reste le filet ultime.
6. **Morningstar EMEA** : credentials en secrets CI ; 1 worker (blocage IP).
7. **Vue cgp** : le screener exclut `action`/`crypto`/`fps`/`structuré` (sinon offre sur-annoncée).
9. **Vue cgp — 3 gardes empilées** (23/06) : `__stale` (fraîcheur) · `__ext_fresh` (perf externe LU démasquée) · `__insane_1y/3y` (vol/sharpe/drawdown physiquement impossibles). Toute reconstruction de la vue doit **préserver les trois** (cf. migrations `120000`/`140000`/`160000`, la dernière est le superset courant). Le front lit la vue, **pas de miroir TS** des gardes.
10. **`classify-from-name.py` est fill-only** : il ne re-classe JAMAIS un fonds déjà classé → toute correction de classification passe par un SQL ciblé + backup (cf. `classif_backup_20260623`).
8. **QA-data impossible hors prod** : les secrets Supabase/Anthropic sont marqués **« Sensitive »** sur Vercel → non relisibles (`vercel env pull` rend des valeurs **vides** ; preview de branche = 0 env → **500**). Seul l'env **production** injecte les secrets au runtime → toute QA contre la vraie base se fait **en prod après merge** (rollback instantané = filet). Ne pas tenter de QA une preview/un local avec data réelle, c'est une impasse.

---

## 🚧 Prochains chantiers (état réel au 22/06)

> ⚠️ Cette section a été **réconciliée le 22/06** contre l'état réel en base + git
> (le handoff datait du 19/06 et listait comme « à faire » des chantiers déjà clos).

### ✅ Clos depuis le 19/06 (ne plus relister comme à faire)
- ~~**Clé Anthropic exposée**~~ → **FAIT (21/06)**, Workspace avec spend limit.
- ~~**UC AV assureurs** (trou structurel ?)~~ → **FAUX** : Tier 3 **7/7 bancassureurs câblés** (21/06), validé bout-en-bout en CI, refresh trimestriel (`av-refresh.yml`).
- ~~**Sécurité Supabase — leaked-password**~~ → **CLOS (20/06)**, plan Pro.
- ~~**Presets d'accès rapide CGP**~~ → **REJETÉ DÉFINITIVEMENT (20/06)** — ne JAMAIS re-proposer.
- ~~**Audit PEA large**~~ → re-gaté sur la **composition** (22/06, `ce3366c`/`21d9f8e`), **3 069 fonds éligibles** en base.
- ~~**Fonds euros perfs bidons**~~ → 43 `performance_1y` extraites du nom **nullées** (22/06).
- ~~**Look-through ~3 %**~~ → en réalité **~24 %** (≈ 5 985 fonds / 24 868 ; Morningstar 2 818, FT 1 628, émetteurs ~1 147, justETF 392). Drain compo en cours (cadence espacée anti-throttle).

### ✅ Tranché / clos le 22/06 (ne plus relister)
- ~~**SCPI**~~ → **TRAITÉ** (`9c44ee2`) : couverture prix 116/191 (reste = SCPI fiscales fermées) + DVM/TOF exposés sur la fiche.
- ~~**Actions individuelles** (0 prix)~~ → **WON'T-DO** (`b04c16f`) : exclues du screener+recherche par design (`api/funds/route.ts:198`), simples constituants look-through, prix inutile. Réouverture seulement si on ajoute un univers actions au screener. Cf. mémoire `actions-no-price-wontdo`.
- ~~**Backlog AV résiduel**~~ → réduit à zéro côté code (Spirica/mutualistes OK, scrapling→parsel vide). Reste Abeille/MAAF/MMA/GMF bloqués IP datacenter → **DÉCISION : re-seed manuel trimestriel** (proxy `AV_PROXY_URL` non activé, ne pas re-proposer sans signal). Cf. `tier3-bancassureurs-av`.
- ~~**QA prod**~~ → 98/100, F1 fermé (working-as-designed).
- ~~**Pertinence recherche (itération de fond)**~~ → **LIVRÉ** (`a70d92c`) : score d'adéquation (fit) + proximité douce + prefs profil dans le couloir intention/profil ; navigation neutre inchangée. QA prod live 8/8. Cf. mémoire `fit-score-ranking-20260622`. Reste optionnel : transparence per-fonds (« pourquoi ça colle »), non retenue ce sprint.

### ✅ Traités le 22/06 (2e passe — vérif live + action)
- **Migration `source_id` — CLOSE à 100 %** : observation post-déploiement OK (`source_id` 0 NULL, seul writer `upsert_prices` n'écrit que `source_id`, aucune vue/index/RPC ne référençait `source`) → `DROP COLUMN source` (instantané) **+ `VACUUM (FULL, ANALYZE)`** passé sans timeout via MCP. Gain **1 981→1 172 Mo (−809 Mo)** : heap 1 119→735 + index PK 861→437 (reconstruit). Bien au-delà des ~130 Mo estimés. Code (`db.py`) + mémoire `fund-prices-source-id-migration` à jour.
- **Drain compo look-through — automatisé** : couverture (géo OU secteur) vérifiée live = **6 740 / 24 150 = 27,9 %** au départ. Diagnostic 22/06 : offset 0 (plus gros non-notés) = **0 % de rendement** (tous `no_sec_id`, ne pas y aller) ; bande retail plus profonde = rendement réel **~24 %** (probe optimiste à 40 % sur petit échantillon). 1er vrai shard (offset 3000, 1000 fonds, ~2h) → **+205 fonds → 28,8 %**. Reste **~15 000 fonds jamais tentés** (×24 % ≈ +3 600 → plafond ~43 %). **Mis en loop auto** : nouveau workflow `holdings-drain-auto.yml` (cron **1 run/jour 02:00 UTC**, cadence lente anti-throttle, offset 0 + filtre « non tentés <30j » qui fait avancer le pool tout seul, alerte issue si échec, groupe `data-refresh`). Draine en fond ~15 jours puis se tarit (TTL recycle à 30j). `holdings-drain.yml` (manuel) conservé pour les boosts ponctuels. **✅ Câblage PROUVÉ vert le 22/06** : smoke-test `workflow_dispatch limit=30` (run `27968546538`) `completed/success` — 30 tentatives écrites en base (chemin d'écriture + avancement du pool TTL confirmés ; 0 nouvelle compo car offset 0 ne retrouvait que des restes `no_sec_id` après le shard manuel du midi, comportement attendu), fill-only/idempotent sans crash. **Ne plus re-vérifier** : l'auto tourne seul, alerte issue si échec.

### ✅ Traités le 22/06 (3e passe — amélioration continue, GO user)
- **Indices proxy / alpha — 3 classes débloquées** *(migration `20260622170835`)* : immobilier/matières premières/alternatif étaient à **alpha=0** faute de benchmark. Ajout de 2 indices EUR/yahoo (tickers validés en direct sur Yahoo avant écriture, ~6 ans) — `reit_eur`=IPRP.AS, `commodities`=SXRS.DE — + 3 règles (alternatif réutilise le €STR `eur_mmf` existant). **Zéro changement de code** (plafond ±30 % catégorie d'office). Run `td-refresh` du 22/06 vert → **alternatif 0→88/186 (47 %), matières premières 0→34/84 (40 %), immobilier 0→51/947 (5,4 %)**. Le 5,4 % immobilier = plafond réel (seuls ~46 fonds immobiliers ont une série de prix ; NAV lissées/illiquides). Alphas plausibles & bornés. **Diversifiés (10 266) NON traités** = nécessitent des benchmarks composites (vrai code, chantier séparé). Cf. mémoire `alpha-bonds-euro-indices`.

- **Profil d'allocation dérivé de la composition** *(migration `20260622..._derive_allocation_profile...` + commit `90615aa`)* : `allocation_profile` plafonnait à ~9 % (nom/catégorie déjà lus, ~8 900 diversifiés sans aucun signal = irréductible). Nouveau signal FIABLE = la composition réelle (part actions vs oblig/cash des holdings `asset_type`) via RPC `inv_fill_allocation_profile_from_composition()`, **fill-only strict** (jamais d'écrasement d'un mandat ou d'un « flexible »), branchée en **étape finale de `holdings-drain-auto.yml`** (quotidien, via `scripts/enrichers/derive-allocation-profile.py`) → re-dérive après chaque tranche drainée, donc **grandit avec le drain look-through**. +86 profils fiables → diversifiés labellisés **9 %→13,4 %**. ⚠️ PEA laissé de côté (collision agent). Cf. mémoire `allocation-profile`.

- **Compo look-through (chantier A) — INVESTIGUÉ À FOND, surface codable épuisée** : couverture globale **28,8 %** (6 959/24 150), ETF **52,6 %** (1 075/2 044), OPCVM **26,6 %**. Le plafond est piloté par l'OPCVM (16 222 manquants), zone du **drain Morningstar auto** (`holdings-drain-auto.yml`, déjà en place). Côté ETF (faible leverage global : 2 044/24 150), les leviers sont taris : **Invesco (111) = WAF/IP datacenter (HTTP 406)**, comme les bancassureurs AV ; **résidus Amundi/iShares/Xtrackers (~87) = fonds fantômes** (l'API émetteur ne les a pas, 0 récupérable, vérifié par re-run) ; **justETF re-drainé = +14 nets seulement** (le reste manquant = ETF obligataires/actifs sans ventilation publique — SPDR/HSBC/JPM/BNP/Fidelity). Construire de nouveaux fetchers (UBS/BNP/JPM) = **mauvais ROI** (risque WAF + beaucoup d'ETF sans compo publique + ~0 sur la couverture globale). **Décision : ne pas sur-investir** ; la couverture monte via le drain OPCVM auto + justETF/FT en rotation. Cf. [[lookthrough-portfolio]].
  - **Test direct des 3 émetteurs non câblés (22/06, NE PAS re-tester)** : **UBS** = HTTP 403 / `etf.ubs.com` injoignable → **WAF/IP datacenter** (même mur qu'Invesco), mort. **Vanguard** = endpoint GraphQL `POST https://www.fr.vanguard/gpx/graphql` **ouvert** (1,4 Mo, aucun blocage) → **seul proprement scrapable**, mais ~29 ETF seulement (fetcher GraphQL à écrire = +0,1 pt global). **BNP** = WordPress + widget data vendor, fiches/recherche en 404 au sondage → faisable mais coûteux, gisement ~89 surtout oblig/ESG. Bilan : seul Vanguard vaut le coup et c'est marginal → non construit.

### 🔒 Reste ouvert MAIS hors de ma main (ne PAS toucher — collision)
- **Couverture prix OPCVM (~52 %)** — *dépend des pipelines FT/GECO = `weekly-refresh`, surveillé par l'agent*. Lacune de couverture (fonds vivants sans source), pas du mort à purger. Monter la couverture = toucher la rotation FT/GECO → collision.
- **PEA éligibilité** + **FE_Q fonds euros** — *traités par l'agent (22/06)*, ne pas y retoucher.

### 🟢 Traitable maintenant, sans collision
- **(plus rien)** — le board énuméré est soldé ET les 2 candidats neufs sont résolus :
  - ~~dédup secteurs look-through~~ → **LIVRÉ** (`70952fb`, vérifié live).
  - ~~itération pertinence recherche~~ → **LIVRÉ** (`a70d92c`, 22/06) : le « RAS » initial a été dépassé à la demande du user → score d'adéquation (fit) + proximité douce + prefs profil ; QA prod live 8/8.
- Tous les leviers restants sont en **zone agent** (Morningstar drain, couverture OPCVM) ou **réservés** (migration `source_id`). Rien d'actionnable de mon côté sans collision.

---

## 📚 Documentation

- `SESSION_HANDOFF.md` ← ce fichier (état courant)
- `docs/bilans/bilan-2026-06-19.md` ← bilan daté du jour
- `docs/SCRAPER_MAP.md` ← carte des sources + **rafraîchissements planifiés** (section juin 2026)
- `docs/kid-parsing-runbook.md` ← parsing KID en masse + renvoi rapport DICI live
- `docs/data-standards-v3.md` ← conventions de données
- Mémoire projet (`~/.claude/.../memory/`) : `dici-report`, `ai-rate-limit`, `alpha-bonds-euro-indices`, `scheduled-refresh`, `data-freshness-volets`, etc.
