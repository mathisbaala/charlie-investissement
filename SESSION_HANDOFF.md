# 📋 Session Handoff — 19 juin 2026

> Journée dense : **26 commits** poussés sur `main` (auto-déploy Vercel). Sprints DDA
> (alpha vs indice, durabilité, look-through), rafraîchissements de données planifiés,
> nettoyage de l'univers, et surtout : **analyse de DICI remise en service + rapport
> de fonds design + durcissement des coûts IA**.
>
> Doc précédente (19 mai) archivée dans `docs/bilans/`.

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

- **Profil d'allocation dérivé de la composition** *(migration `20260622..._derive_allocation_profile...` + commit `90615aa`)* : `allocation_profile` plafonnait à ~9 % (nom/catégorie déjà lus, ~8 900 diversifiés sans aucun signal = irréductible). Nouveau signal FIABLE = la composition réelle (part actions vs oblig/cash des holdings `asset_type`) via RPC `inv_fill_allocation_profile_from_composition()`, **fill-only strict** (jamais d'écrasement d'un mandat ou d'un « flexible »), branchée en fin de `classify-from-name` → **grandit avec le drain look-through**. +86 profils fiables → diversifiés labellisés **9 %→13,4 %**. ⚠️ PEA laissé de côté (collision agent). Cf. mémoire `allocation-profile`.

- **Compo look-through (chantier A) — INVESTIGUÉ À FOND, surface codable épuisée** : couverture globale **28,8 %** (6 959/24 150), ETF **52,6 %** (1 075/2 044), OPCVM **26,6 %**. Le plafond est piloté par l'OPCVM (16 222 manquants), zone du **drain Morningstar auto** (`holdings-drain-auto.yml`, déjà en place). Côté ETF (faible leverage global : 2 044/24 150), les leviers sont taris : **Invesco (111) = WAF/IP datacenter (HTTP 406)**, comme les bancassureurs AV ; **résidus Amundi/iShares/Xtrackers (~87) = fonds fantômes** (l'API émetteur ne les a pas, 0 récupérable, vérifié par re-run) ; **justETF re-drainé = +14 nets seulement** (le reste manquant = ETF obligataires/actifs sans ventilation publique — SPDR/HSBC/JPM/BNP/Fidelity). Construire de nouveaux fetchers (UBS/BNP/JPM) = **mauvais ROI** (risque WAF + beaucoup d'ETF sans compo publique + ~0 sur la couverture globale). **Décision : ne pas sur-investir** ; la couverture monte via le drain OPCVM auto + justETF/FT en rotation. Cf. [[lookthrough-portfolio]].

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
