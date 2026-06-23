# Chantiers — Charlie Investissement

> Dernier audit : 2026-06-23 (10ᵉ passe — `/recul` : rescaling 5 séries multi-échelle + dédoublonnage migrations)

État global : **projet sain et bien tenu** — re-vérifié à cette passe : `tsc` clean,
**272/272 tests verts** (20 fichiers), **working tree propre**, **CI verte** (dernier run
`td-refresh` = success, aucun workflow en échec), zéro marqueur `TODO/FIXME` réel dans le
front (1 faux positif : `/fonds/XXX` dans un commentaire), zéro test `skip/only`. Le
backlog de fond est **soldé** : alpha diversifiés **TERMINÉ**, le reste tourne seul (drain
compo auto), est en suspens par choix (scrapers bloqués IP), ou est de la **dette mineure**.

> ✅ **Alpha diversifiés — TERMINÉ** (23/06) : run `28020564756` **success** (23 min,
> 8 097 alpha écrits, 0 échec). Diversifiés **14 → 2 110** avec alpha ; zéro régression
> sur les autres classes. Voir « ✅ Réglés ».

> ✅ **Séries NAV corrompues — RÉPARÉES (23/06)** : 65 points sur 25 ISIN corrigés en base
> (détection robuste + gardes anti-split/anti-multi-échelle), recompute déclenché, garde
> `__insane` 145 → 131, **18 séries ré-exposées avec métriques saines**. Reliquat = 7 séries
> multi-échelle/régime (re-fetch source, 🧹 Dette technique). Le **recompute GECO** est soldé
> par le même run. Voir « ✅ Réglés ».

> ✅ **Intégration `/recul` (23/06)** : 3 points soldés en aval des chantiers alpha + LU —
> (1) 25 fonds mal classés sortis de `diversifie` (alpha composite trompeur), (2) dérive
> des comptes alpha **diagnostiquée bénigne** (snapshot, pas un bug), (3) **garde** des
> métriques de risque aberrantes (corruption NAV : UniGlobal vol 84,5, S&P 500 dd −99 %).
> Migrations `20260623150000` + `160000`. Voir « ✅ Réglés ».

---

## 🚧 Chantiers en cours

### Drain composition look-through (OPCVM)
- **Priorité** : 🟡 Moyenne
- **Détecté le** : 2026-06-22
- **Où** : `.github/workflows/holdings-drain-auto.yml` + `scripts/enrichers/` (Morningstar EMEA)
- **Le problème** : la couverture compo (géo OU secteur) est à ~28,8 % (ETF 52,6 %, OPCVM 26,6 %). Le plafond est piloté par l'OPCVM (~15 000 fonds jamais tentés). La surface ETF codable est **épuisée** (verdict 22/06).
- **Comment l'aborder** : **ne rien faire** — le cron quotidien (02:00 UTC, anti-throttle) draine ~24 % du pool non-tenté en fond sur ~15 jours puis se tarit (recyclage TTL 30j). Surveillance passive : alerte issue si échec. Ne pas lancer de runs dos à dos (throttle Morningstar).
- **Effort estimé** : rapide (surveillance only)

---

## ⏸️ En suspens / mis de côté (décisions prises — ne pas re-proposer sans signal)

### Scrapers bloqués par IP datacenter (AV bancassureurs + ETF Invesco/UBS)
- **Priorité** : ⚪ Mineure
- **Détecté le** : 2026-06-21
- **Où** : `.github/workflows/av-refresh.yml`, scrapers Abeille/MAAF/MMA/GMF ; côté ETF, Invesco (~111) + UBS (HTTP 403, WAF)
- **Le problème** : ces sources renvoient 403/406 depuis les runners CI (IP datacenter). Mur WAF identique partout.
- **Comment l'aborder** : **décision ferme = re-seed manuel trimestriel** (secret `AV_PROXY_URL` dormant, non posé volontairement). Réouvrir seulement si un proxy résidentiel est décidé. Vanguard (~29 ETF, GraphQL ouvert) = seul proprement scrapable mais gain marginal (+0,1 pt), jugé non rentable.
- **Effort estimé** : moyen (si proxy un jour activé)

> Le volet LU est **résolu le 23/06** (voir « ✅ Réglés ») — il ne s'agissait pas d'un trou de
> données mais d'un faux positif de la garde de fraîcheur. Reste hors périmètre le plancher
> structurel ~8 600 (parts secondaires, micro-encours, fonds fermés/morts) jamais chassé (légitime).

---

## ✨ Features & améliorations

### Transparence per-fonds du score d'adéquation (« pourquoi ça colle »)
- **Priorité** : ⚪ Mineure
- **Détecté le** : 2026-06-22
- **Où** : `app/src/lib/fitScore.ts` + UI résultats recherche
- **Le problème** : le couloir intention/profil classe par fit composite, mais l'utilisateur ne voit pas *pourquoi* un fonds est bien classé. Explicitement non retenu au sprint 22/06.
- **Comment l'aborder** : exposer une ventilation lisible des composantes du fit (complétude / qualité / adéquation / prefs) sous forme de chips ou tooltip. `fitScore.ts` calcule déjà les sous-scores → surtout du front.
- **Effort estimé** : moyen

---

## 🧹 Dette technique

### 2 séries en détresse réelle restant masquées (légitime)
- **Priorité** : ⚪ Mineure
- **Détecté le** : 2026-06-23
- **Où** : `investissement_fund_prices` — H2O Multibonds (`FR0013536109`), Transition Evergreen (`FR0000035784`)
- **Le problème** : **NON corrompues** — ce sont des **déclins réels** (H2O side-pockets ~20→1 ; Transition Evergreen crash cleantech ~4→0,1). La garde `__insane` les masque par leur drawdown réel (dd <−90). Ce n'est pas un bug ; les masquer est défendable (drawdown extrême mais réel).
- **Comment l'aborder** : rien d'impératif. Option : exception ciblée si on veut afficher leur perf réelle malgré le drawdown (décision produit). Les 5 autres séries multi-échelle du reliquat ont été **réparées par rescaling** le 23/06 (voir « ✅ Réglés »).
- **Effort estimé** : rapide (décision produit)

> Les trois items mineurs du 23/06 (finder TER « temporaire », branche morte, placeholder AUM) sont tous traités ou confirmés inertes — voir « ✅ Réglés ».

---

## 📄 Doc à mettre à jour (écarts détectés — proposer, ne pas modifier)

### (aucun écart ouvert)
L'écart signalé en 5ᵉ passe (titre `SESSION_HANDOFF.md` périmé) est **corrigé** : le
fichier est désormais titré « Session Handoff — 23 juin 2026 » et son journal va jusqu'au
23/06. Aucun autre écart doc↔code détecté à cette passe.

---

## ✅ Réglés

> Historique repris de `SESSION_HANDOFF.md` (réconciliation 22/06). Le plus récent en haut.

- **Séries NAV multi-échelle (régime) — rescalées** — *Réglé le 2026-06-23* : reliquat du correctif NAV (`/recul`). Diagnostic des 7 séries restantes : **5 ETF** = deux échelles nettes avec **une bascule contiguë** (la source est passée à l'échelle récente ~dizaines = la vraie ; historique ~milliers ×85-119 erroné) → **rescaling** du segment historique vers l'échelle récente par facteur constant (invariant pour les métriques, corrige aussi l'affichage). **1 266 points sur 5 ISIN** (UBS Select, Invesco Hybrid, Xtrackers ASX, Amundi Prime Japan, First Trust Global) ; 0 saut restant, séries mono-échelle réalistes. Backup `investissement_fund_prices_rescale_backup_20260623` (RLS) + audit `scripts/db-fixes/rescale-nav-multiscale-20260623.sql`, recompute `compute-metrics.yml`. Les **2 dernières** (H2O Multibonds, Transition Evergreen) = détresse RÉELLE (pas corruption) → laissées masquées (légitime, cf. 🧹 Dette technique).

- **Réparation des séries de prix NAV corrompues** — *Réglé le 2026-06-23* : la garde `__insane` masquait le symptôme ; ce correctif **répare la cause** en base. Détection robuste en SQL (médiane ±70 j excluant ±10 j → neutralise les runs de glitchs ≤3 points ; garde anti-split lmed/rmed ∈ [0.8,1.25] ; 3 gardes anti-multi-échelle : exclusion crypto/blockchain, span new>8, désaccord médiane-série ×8). **65 points corrigés sur 25 ISIN** (lot d'ingestion 2024-05-22/24 ÷3,7 ; sentinelles BNP S&P 500 = 9,90 ×17 et Amundi Smart Overnight = 982,15 ; spikes ×100 sur dates-batch 2025-01-06 / 2025-10-20). Backup `investissement_fund_prices_glitch_backup_20260623` (RLS, revert documenté) + audit `scripts/db-fixes/repair-nav-glitches-20260623.sql`. Recompute via `compute-metrics.yml` (l'autorité, **pas** de piège `ft-metrics-wipe` — celui-ci ne vise que l'enrichissement opportuniste) déclenché immédiatement, run `28036782929` success. **Vérifié bout en bout** : garde `__insane` 145 → 131 ; **18 séries entièrement assainies et ré-exposées** dans la vue `_cgp` avec vol/sharpe/drawdown réalistes (UniGlobal vol_3y 84,5→6,2 ; HSBC Govt 74→2,2 ; UBS Japan 10000→18,3). Reliquat = 7 séries multi-échelle/régime non réparables à l'aveugle (re-fetch, cf. 🧹 Dette technique). Idempotent (`UPDATE … WHERE nav=old_nav`), 0 prix supprimé.

- **Recompute métriques OPCVM FR contre la queue GECO** — *Réglé le 2026-06-23* : fait **maintenant** plutôt qu'attendre le weekly-refresh du 29/06 — le run `compute-metrics.yml` (`28036782929`, success) déclenché pour le correctif NAV a recalculé **tout l'univers**, donc aussi les ~1 086 OPCVM FR rafraîchis par GECO le 23/06. Vérifié : `compute-metrics.py` est l'autorité (purge volontaire), n'écrase pas les perfs externes LU/IE (sans série locale → skip), aucun piège `ft-metrics-wipe`.

- **Métriques de risque aberrantes (corruption NAV) — garde d'affichage** — *Réglé le 2026-06-23* : **3ᵉ garde de la vue `_cgp`**, en intégration des chantiers alpha + LU. La garde de fraîcheur (`inv_prices_stale`) ne voit PAS une série fraîche+longue mais à **valeur interne corrompue** (un point NAV à 3 € au lieu de 400 € → 2 rendements quotidiens énormes → vol/drawdown explosent). Exemples exposés : UniGlobal (`vol_3y` 84,5 alors que `vol_1y` 5,7), UBS Core S&P 500 ETF (`max_drawdown_3y` −99 %, impossible). **Fix** = migration `20260623160000` : masque vol/sharpe/drawdown **par fenêtre**, hors crypto/levier — 1y si `vol_1y>60` ; 3y si `vol_3y>60` **OU** `dd_3y<−90` (le drawdown est un signal indépendant : des ETF S&P 500/MSCI ont `vol_3y` 56-59 sous le seuil mais `dd` −99 %). **~99 fonds nettoyés en 1y, ~121 en 3y** ; **112 volatils légitimes préservés** (vol_3y 35-60, dd ≥ −90, pas de sur-masquage). Compose proprement avec `__stale` et l'exception perf externe LU `__ext_fresh` (884 perfs LU intactes, 0 fuite alpha vérifiés). Réversible (vue SQL pure, 0 prix touché). **Suivi non fait** : réparer les ~442 séries corrompues elles-mêmes (distinguer glitch vs split). Cf. mémoire [[insane-risk-metrics-gate]].

- **Diversifiés mal classés (alpha composite trompeur) + dérive alpha = bénigne** — *Réglé le 2026-06-23* : en intégration du chantier alpha diversifiés. **(a)** Le benchmark composite actions/oblig était attribué à TOUT `asset_class_broad='diversifie'`, or **25 fonds mono-classe** y étaient mal rangés → alpha absurde (BNP Insticash *monétaire* vs 50/50 = −10,9 ; iShares MSCI World *ETF actions* 119 Md€ vs 50/50), d'autant plus visible qu'ils sont à très gros encours (tête de liste par AUM). **Fix** = migration `20260623150000` : 16 fonds par signal en base (nom monétaire / `category` Actions / Obligations) + 9 par curation nommée ratifiée (UniGlobal, DWS Akkumula/Top Dividende/Vermögensbildung) → `diversifie` 14 607 → **14 582** ; `asset_class_broad` corrigé, `allocation_profile`+benchmark+alpha **neutralisés** (NULL plutôt que faux, recompute auto au prochain `td-enricher` car `map_index` clé sur `asset_class_broad`). Backup réversible `investissement_funds_classif_backup_20260623`. Piège : `classify-from-name.py` est **fill-only** (ne re-classe jamais un fonds déjà classé) → correction SQL ciblée obligatoire. **(b)** Dérive des comptes alpha vs rapport initial (action 3 919→~3 470…) **diagnostiquée bénigne** : 0 fonds avec benchmark+série fraîche+3 fenêtres alpha vides → simple effet de snapshot `alpha_1y`, pas un bug (gotcha `ft-metrics-wipe` patché, `td-enricher` seul writer). Cf. mémoire [[diversified-misclassification-cleanup]].

- **Couverture prix OPCVM — volet LU** — *Réglé le 2026-06-23* : **diagnostic ≠ fiche du chantier**. Ce n'était PAS un trou à scraper (le refresh EMEA aurait été inutile : les perfs LU sont déjà en base, fraîches <40j, moyenne +14,9 %/1 an). C'était un **faux positif de la garde de fraîcheur** du matin (`inv_prices_stale`) : elle masque toute métrique d'un opcvm/etf/crypto **sans série de prix locale**, or les LU/IE n'en ont jamais eu — leur perf vient d'une **source externe directe** (AMF GECO / catalogue / Morningstar), pas d'un fossile maison. **Fix** = migration `20260623140000` : la vue `_cgp` démasque **uniquement les 3 perfs** (1/3/5 ans) d'un fonds sans série locale, **si** fraîches (`updated_at` <150j) **et** saines (bornes par métrique, écarte les ~5 aberrantes) ; vol/sharpe/drawdown/alpha **restent masqués** (provenance non garantie), et le vrai fossile (série locale **morte** >45j) **reste masqué** (non-régression vérifiée : 1 827 fossiles, 0 perf ré-exposée). Résultat : **734 perfs LU démasquées (488 primaires ≥50M)**, validé end-to-end sur l'API prod (`LU1295551144` : 1y 18,1 / 3y 13,9, vol/sharpe NULL). Provenance non utilisable comme gate (382/498 sans estampille). `tsc` clean, 272/272 tests. Cf. mémoire [[stale-metrics-freshness-gate]].

- **Alpha vs indice des fonds diversifiés** — *Réglé le 2026-06-23* : benchmarks **composites** actions/oblig pondérés par profil (`mix_25_75`/`mix_50_50`/`mix_75_25`, mélange quotidien rééquilibré `msci_world`+`global_agg`, fonction `inv_rebuild_composite_indices()`) + mapping `map_index` sur `allocation_profile` dans `td-enricher.py` (borne ±20 %/an). Migration `20260623130000`. **Diversifiés 14 → 2 110 avec alpha** (run `28020564756` success, 8 097 alpha total écrits, 0 échec) ; **zéro régression** (action 3 919 / oblig 1 959 / monétaire 169 inchangés). Distribution saine : moyenne −3 %/an (sous-perf active vs passif = attendu), bornes respectées. Plafond = couverture prix des diversifiés (~2 700 ayant une série), pas la logique. Fix de robustesse au passage : écriture incrémentale + timeout CI 120 min (commit `aed711e`). Cf. mémoire [[diversified-composite-benchmarks]].

- **Couverture prix OPCVM FR — cœur récupérable drainé** — *Réglé le 2026-06-23* : run `geco-nav.py --apply` complet (manuel, fill-only non destructif — n'écrit que des dates postérieures à la dernière VL connue) → 4 164/5 802 résolus, **1 180 VL écrites, +1 086 OPCVM FR repassés frais ≤5j (4 048 → 5 134)** — ~2× l'estimation initiale (~550). Zéro erreur HTTP / throttle (3 workers, 1,2 s/req), 23 min, loggé `investissement_pipeline_runs`. Données vérifiées saines (0 nav ≤0, EUR only, 0 date future). **Effet de bord tranché** : la garde fraîcheur (`inv_prices_stale` dans la vue `_cgp`) démasque les métriques des ~1 086 fonds nouvellement frais, **non encore recalculées contre la nouvelle queue** (geco-nav = étape 4 ; `compute-metrics` = étape 5 du `weekly-pipeline`) → **laissé à l'auto-réparation du `weekly-refresh`** (décision 23/06, évite le piège `ft-metrics-wipe` d'un compute-metrics manuel). Baseline consigné en mémoire (`opcvm-fr-price-coverage.md`). Reste hors périmètre : volet LU (~510, Morningstar EMEA) + plancher structurel ~8 600 (légitime).
- **`fetch_ter_morningstar` — tranché définitivement** — *Réglé le 2026-06-23* : finder Morningstar retiré du dispatcher de `fetch-ter-fundinfo.py` (Boursorama seul actif). Le TER Morningstar est possédé par les enrichers dédiés `morningstar-ter-fill.py` (rating connu sans TER) + `morningstar-lt-enricher.py` (rating NULL) ; le re-câbler ici doublait le throttle. Commentaire « temporairement » remplacé par la décision permanente. `py_compile` OK. (Script hors CI active de toute façon.)
- **Branche morte `docs/av-tier3-validation`** — *Réglé le 2026-06-23* : supprimée en local + remote (aucun commit en avance sur `main`).
- **Placeholder AUM ETF 1e9** — *Réglé le 2026-06-23 (confirmé inerte, won't-do)* : `fetch-etf-extended.py:427` n'est câblé à aucun workflow CI et n'a jamais pollué la base — 0 ETF à `aum_eur=1e9`. Le seul fonds à cette valeur est `FE_UAF_LIFE` (fonds euros seedé à 1 Md€ rond, sans rapport). Aucune action.
- **Indices proxy / alpha — 3 classes débloquées** — *Réglé le 2026-06-22* : immo/matières premières/alternatif passés de alpha=0 à 5–47 % de couverture (2 indices EUR + 3 règles, zéro code).
- **Profil d'allocation dérivé de la composition** — *Réglé le 2026-06-22* : RPC fill-only branchée au cron, diversifiés labellisés 9 %→13,4 %.
- **Migration `source_id` `fund_prices`** — *Réglé le 2026-06-22* : `DROP COLUMN source` + `VACUUM FULL`, gain −809 Mo. Close à 100 %.
- **Look-through (géo double-comptage + dédup secteurs + polish FE)** — *Réglé le 2026-06-22* : agrégation par code ISO + secteurs canoniques FR, clos à 100 %.
- **SCPI — DVM + TOF sur la fiche** — *Réglé le 2026-06-22* : taux distribution + occupation exposés, couverture prix 116/191 (reste = SCPI fiscales fermées, légitime).
- **Pertinence recherche — score d'adéquation (fit)** — *Réglé le 2026-06-22* : couloir intention/profil re-classé (complétude dominante) + proximité douce + prefs profil ; navigation neutre inchangée. QA prod 8/8.
- **Actions individuelles (0 prix)** — *Réglé le 2026-06-22* : WON'T-DO acté (exclues screener/recherche, simples holdings).
- **Éligibilité PEA re-gatée sur la composition** — *Réglé le 2026-06-22* : 3 069 fonds éligibles.
- **Fonds euros — perfs bidons** — *Réglé le 2026-06-22* : 43 `performance_1y` extraites du nom nullées.
- **Clé Anthropic exposée** — *Réglé le 2026-06-21* : rotée dans un Workspace à spend limit mensuelle.
- **Tier 3 bancassureurs AV (7/7)** — *Réglé le 2026-06-21* : câblés + validés CI, refresh trimestriel.
- **Sécurité Supabase (leaked-password + 2e vague RLS)** — *Réglé le 2026-06-20* : plan Pro + RLS, plus aucune ERROR sécu exposée.
- **Quota Supabase dépassé + optimisation storage** — *Réglé le 2026-06-19* : upgrade Pro + 2,03→1,41 Go.
- **Clé Anthropic invalide en prod (toute l'IA KO)** — *Réglé le 2026-06-19* : clé remplacée, IA opérationnelle sur 4 routes.
- **Analyse DICI non fonctionnelle + erreurs masquées** — *Réglé le 2026-06-19* : parse + rapport design + distinction 422/503.
- **Drainage de tokens IA (site public)** — *Réglé le 2026-06-19* : plafond global + cap PDF + IP non usurpable.
