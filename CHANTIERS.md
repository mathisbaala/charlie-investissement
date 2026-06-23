# Chantiers — Charlie Investissement

> Dernier audit : 2026-06-23 (2ᵉ passe)

État global : **projet sain et bien tenu** — `tsc` clean, 272/272 tests verts, zéro
marqueur `TODO/FIXME` réel dans le front, doc à jour (`SESSION_HANDOFF.md` réconcilié
au 22/06). L'essentiel du backlog est **soldé ou tranché par décision**. Ce qui reste
est soit **automatisé et tourne seul** (drain compo), soit **en suspens par choix**
(scrapers bloqués IP), soit de la **dette mineure**.

---

## 🚧 Chantiers en cours

### Gate fraîcheur des métriques dérivées (AUTRE AGENT — ne pas toucher)
- **Priorité** : 🟠 Importante
- **Détecté le** : 2026-06-23
- **Où** : `supabase/migrations/20260623120000_gate_stale_derived_metrics.sql` (untracked) ; miroir TS attendu dans `app/src/lib/format.ts`
- **Le problème** : masque (NULL) les perfs/vol/sharpe/drawdown/alpha quand la série de prix est absente/périmée (>45j)/minuscule (<8 pts), pour opcvm/etf/crypto. **Travail d'un autre agent, partiellement atterri** : la migration est **déjà appliquée en PROD** (`inv_prices_stale` existe, la vue `investissement_funds_cgp` gate déjà `__stale` en live), **MAIS** (a) le fichier de migration est **non commité** (DB ≠ git), (b) le miroir TS `shouldGateDerivedMetrics` référencé dans le COMMENT de la migration **n'existe pas encore** dans `format.ts`.
- **Comment l'aborder** : **laissé à l'agent qui l'a écrit** (décision user 2026-06-23). Risques à surveiller de son côté : commiter la migration (sinon perdue / DB désynchro), créer le miroir TS pour que le front masque comme la vue. NE PAS commiter ni modifier depuis ce poste.
- **Effort estimé** : moyen (côté l'autre agent)

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

### Couverture prix OPCVM (~49 % frais)
- **Priorité** : 🟡 Moyenne
- **Détecté le** : 2026-06-22
- **Où** : pipelines FT/GECO (`weekly-refresh.yml`)
- **État vérifié (2026-06-23)** : 20 660 OPCVM, **13 017 avec un prix (63 %)**, **10 099 frais ≤35j (48,9 %)**. **Non corrigeable par code** — plafond de couverture structurel (fonds vivants sans source de prix publique), pas un bug. NE PAS chercher à « clore » : la rotation `weekly-refresh` le grignote en continu.
- **Le problème** : ~51 % des OPCVM sans série de prix fraîche. **Lacune de couverture** (fonds vivants sans source publique), pas du mort à purger.
- **Comment l'aborder** : zone des pipelines de rafraîchissement (rotation FT/GECO) — toucher = collision avec l'agent data. Monter la couverture passe par étendre la rotation, pas par du code applicatif.
- **Effort estimé** : lourd

---

## ✨ Features & améliorations

### Alpha vs indice pour les fonds diversifiés (~14 600)
- **Priorité** : 🟡 Moyenne
- **Détecté le** : 2026-06-22
- **Où** : `scripts/enrichers/` (td-enricher), catalogue d'indices en base, `app/src/lib` (fiche fonds)
- **État vérifié (2026-06-23)** : **NON fait** — 14/14 607 diversifiés ont un alpha (0,1 %). Confirmé en base. C'est le **seul vrai chantier de fond restant**.
- **Le problème** : les fonds diversifiés restent à alpha≈0 — ils n'ont pas de benchmark mono-classe (un proxy ETF unique ne convient pas). Les classes mono ont été débloquées le 22/06 (action 41,7 %, oblig 38 %, monétaire 38,9 %, matières premières 21,5 %, alternatif 6,5 %, immo 3,1 %).
- **Comment l'aborder** : construire des **benchmarks composites** (ex. 60/40, pondérés par `allocation_profile`) puis une règle d'affectation. C'est du **vrai code** (nouvelle logique d'agrégation d'indices), pas une simple ligne de catalogue. Commencer par un POC sur les diversifiés « équilibrés » avec compo connue.
- **Effort estimé** : lourd

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

### Titre de `SESSION_HANDOFF.md` daté du 19/06 alors que le contenu va jusqu'au 22/06
- **Priorité** : ⚪ Mineure
- **Détecté le** : 2026-06-23
- **Où** : `SESSION_HANDOFF.md:1`
- **Le problème** : le titre « Session Handoff — 19 juin 2026 » est trompeur : le journal et les chantiers sont réconciliés au 22/06. Cosmétique mais peut induire en erreur à la reprise.
- **Comment l'aborder** : retitrer en « 22 juin 2026 » (ou « 19→22 juin »). En attente d'accord.
- **Effort estimé** : rapide

---

## ✅ Réglés

> Historique repris de `SESSION_HANDOFF.md` (réconciliation 22/06). Le plus récent en haut.

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
