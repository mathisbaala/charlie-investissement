# Chantiers — Charlie Investissement

> Dernier audit : 2026-06-23 (6ᵉ passe)

État global : **projet sain et bien tenu** — `tsc` clean (vérifié), **272/272 tests verts**
(vérifié), zéro marqueur `TODO/FIXME` réel dans le front, working tree propre, doc à jour
(`SESSION_HANDOFF.md` retitré « 23 juin »). L'essentiel du backlog est **soldé ou tranché
par décision**. Ce qui reste : **un seul chantier de fond actif** (recalcul alpha
diversifiés, run CI **en vol**), le reste est soit **automatisé et tourne seul** (drain
compo), soit **en suspens par choix** (scrapers bloqués IP), soit de la **dette mineure**.

> ✅ **Alpha diversifiés — TERMINÉ** (23/06) : run `28020564756` **success** (23 min,
> 8 097 alpha écrits, 0 échec). Diversifiés **14 → 2 110** avec alpha ; zéro régression
> sur les autres classes. Voir « ✅ Réglés ».

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

### Couverture prix OPCVM — reste le volet LU (FR drainé le 23/06, voir « ✅ Réglés »)
- **Priorité** : ⚪ Mineure
- **Détecté le** : 2026-06-22
- **Où** : refresh Morningstar EMEA (`emea-refresh.yml`)
- **État (2026-06-23)** : **volet FR résolu** (run GECO complet → +1 086 fonds frais, voir Réglés). Reste **~510 LU primaires ≥50M** récupérables via la source Morningstar EMEA existante, **plus** le plancher structurel **~8 600 non récupérables** (parts secondaires, micro-encours, fonds fermés/morts, faux ISIN) qui ne sera **jamais** chassé (légitime).
- **Comment l'aborder** : fill-only, aucun code neuf — déclencher un refresh Morningstar EMEA (`emea-refresh.yml`). ⚠️ **throttle sal-service : jamais de runs dos à dos**, cadence espacée (cf. mémoire enricher Morningstar holdings). Gain attendu modeste (~510 fonds), priorité basse une fois le gros volet FR fait.
- **Effort estimé** : moyen (un run espacé), non urgent

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

### (aucune ouverte) — voir « ✅ Réglés »
Les trois items mineurs détectés au 23/06 (finder TER « temporaire », branche morte, placeholder AUM) sont tous traités ou confirmés inertes. Rien d'actionnable ici.

---

## 📄 Doc à mettre à jour (écarts détectés — proposer, ne pas modifier)

### (aucun écart ouvert)
L'écart signalé en 5ᵉ passe (titre `SESSION_HANDOFF.md` périmé) est **corrigé** : le
fichier est désormais titré « Session Handoff — 23 juin 2026 » et son journal va jusqu'au
23/06. Aucun autre écart doc↔code détecté à cette passe.

---

## ✅ Réglés

> Historique repris de `SESSION_HANDOFF.md` (réconciliation 22/06). Le plus récent en haut.

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
