# Reprise — Sweep conditions de contrats AV (mis en pause le 2026-07-14)

Chantier : collecte exhaustive des **conditions de contrat** d'assurance-vie (frais,
fonds euros, univers, options, ticket…) pour la fiche-contrat, selon l'ontologie de
`docs/mapping-assureurs-contrats-cgp.md` §3.1. **Mis en pause pour économiser du quota
de tokens** (~10 M consommés). Rien n'est perdu, tout est prêt à reprendre.

## MàJ 2026-07-16 — tranche 3 (fin des ≥100 UC), ~4,46 M tokens

Reprise du sweep (politique 5 M/tranche). Design **v2 inchangé** = workflow
`av-contract-terms-sweep-v2`, **1 agent Sonnet/contrat** qui source (1-2 WebSearch +
1-2 WebFetch, **PDF interdits**) puis **écrit lui-même** via `execute_sql` +
`json_populate_record` dollar-quoté `$ct$…$ct$` + `ON CONFLICT (key) DO UPDATE`.

- **Lot 1** (80 plus gros ≥100 UC, funds DESC) : **76/80 écrits** (37 curated / 39 indicative),
  ~2,57 M tokens. Run `wf_4336bd56-673`.
- **Lot 2** (58 restants ≥100 UC, dont les 4 « none » du lot 1) : **54/58 écrits**
  (16 curated / 37 indicative), ~1,89 M tokens. Run `wf_65caafe2-730` (même script réutilisé
  via `scriptPath`).
- **Cumul tranche 3 : ~4,46 M tokens**, +129 contrats nets → **321 en base**
  (138 curated / 183 indicative). Arrêt propre sous 5 M.
- **Reste** : **17 contrats ≥100 UC** = traîne dure (surtout Lux sans conditions publiques :
  Natixis Life Lux Liberalys, Cardif Lux ASTER/PERSPECTIVE, Spirica Patrimoine Privée…,
  les agents renvoient « none » faute de page HTML publique) + **114 contrats <100 UC**.
- Rappel convention (vérifiée) : `frais_*_pct`/`fonds_euros_taux_pct` = valeur en **%**
  (0.60 = 0,60 %) ; `fonds_euros_annee` = entier ; `univers_classes`/`options_gestion` =
  text[] (NOT NULL, au moins `{}`) ; `confidence`/`updated_at` NOT NULL → toujours dans le JSON.
- Requête de reprise (idempotente, prochaine tranche) : `funds >= 100 AND NOT EXISTS(...)`
  (les 17 durs, à tenter autrement — DIC/Lux) puis `funds >= 1 AND funds < 100`, `ORDER BY funds DESC`.

## MàJ 2026-07-15 (soir) — tranche 2, politique « 5 M tokens / tranche »

Décision Mathis : on avance par **tranches de ~5 M tokens** étalées sur plusieurs
semaines ; à ~5 M on **arrête proprement** et on n'y revient plus (les contrats déjà
écrits sont exclus de la requête liste → reprise sans doublon ni re-traitement).

- **Reprise faite** : salvage des 152 collectés du 14/07 appliqué en base (migration
  `20260714170000`, 3 lots) → 157 contrats. Puis sweep tranche 2.
- **Sweep tranche 2** : workflow **`av-contract-terms-sweep-v2`** (script archivé en
  session, run `wf_08aa9de6-823`). Design **1 agent/contrat** = source + recoupe + écrit
  en base immédiatement (incrémental, idempotent `ON CONFLICT (key)`, budget web serré,
  éviter les PDF). ⚠️ NE PAS reprendre le design pipeline 2-étages (v1 `wf_1600ef35-420`) :
  il enfilait tous les `source` avant les écritures → 0 écriture + 3,5 M tokens gaspillés.
- **Résultat tranche 2** (arrêt à ~5,85 M tokens neufs cumulés v1+v2, dont 3,55 M perdus
  par v1) : **192 contrats en base** (85 curated / 107 indicative), **+35 écrits**.
- **Reste à faire** (prochaines tranches) : **133 contrats ≥100 UC** puis **114 <100 UC**.
  Requête de reprise (déjà idempotente) : `funds >= 100` (puis `>= 1`) `AND NOT EXISTS`
  dans `av_contract_terms`, `ORDER BY funds DESC`.
- Mesure du coût (proxy) : sommer, sur les `agent-*.jsonl` du transcript workflow,
  `cache_creation + input + output` (EXCLURE `cache_read` qui gonfle le brut). ~5,85 M à
  l'arrêt. Proxy plus simple pour caler une tranche : ~5 M ≈ ~80 contrats traités.

## État au moment de la pause

- **Déjà LIVE en prod (base + fiche)** : **21 contrats** entièrement documentés
  (2 Linxea curés + 19 phares du pilote workflow). Table `investissement_av_contract_terms`.
- **Collecté par le sweep mais PAS encore en base** : **152 contrats** (≥300 UC),
  récupérés depuis le workflow `wf_b3b49243-752` avant l'arrêt (48 `curated`,
  104 `indicative`, 0 `unknown`). **Préservés dans deux fichiers du repo** :
  - `scripts/data/av_contract_terms_sweep_salvage.json` — données brutes récupérées.
  - `supabase/migrations/20260714170000_seed_av_contract_terms_sweep_salvage.sql`
    — **migration de seed PRÊTE À APPLIQUER** (152 lignes, 25 colonnes, échappement OK).
- **Restant à collecter** : ~42 contrats ≥300 UC (194 ciblés − 152 récupérés) + le reste
  du catalogue (≥100 UC = ~310 au total) si on veut aller plus loin.
- Workflow **arrêté** (TaskStop sur `w402y2y56`), `caffeinate` **coupé**, surveillance
  **stoppée** (plus de réveil programmé).

## Reprise en 3 étapes (quand le quota de tokens est rétabli)

### Étape 1 — Écrire en base les 152 contrats déjà collectés (rapide, ~1 appel)
Appliquer la migration de seed déjà générée. Elle coûte un gros émit SQL (~200k car.),
d'où le report ici. Deux options :
- **MCP** : lire `supabase/migrations/20260714170000_seed_av_contract_terms_sweep_salvage.sql`
  et l'appliquer via `apply_migration` (project_id `dehigtgzizsdehyhmjxn`). Si trop gros
  pour un seul appel, la découper en 3 lots (~51 lignes) — chaque ligne est autonome.
- Idempotent (`ON CONFLICT (key) DO UPDATE`) → rejouable sans risque.
Après application : **21 + 152 = 173 contrats live**. Vérifier :
`select count(*) from investissement_av_contract_terms;` (attendu 173) + une fiche prod
`/assureurs/contrat?key=Generali%20Vie%3A%3AXa%C3%A9lidia` (ou une clé du lot).

### Étape 2 — Balayer les ~42 contrats restants (workflow)
Relancer le même pipeline sur les clés ≥300 UC encore sans T&C :
```sql
SELECT g.repr_key FROM investissement_contract_groups_mv g
WHERE g.is_representative AND g.funds >= 300
  AND NOT EXISTS (SELECT 1 FROM investissement_av_contract_terms t WHERE t.key = g.repr_key)
ORDER BY g.funds DESC;
```
Puis Workflow `av-contract-terms-sweep` (script archivé dans la session ; sinon ré-écrire :
phase Liste = 1 agent qui exécute ce SQL via MCP execute_sql et renvoie `keys[]`, puis
`pipeline(items, sourceStage, verifyStage)` avec `ROW_SCHEMA` + l'ontologie §3.1, agents
`model:'sonnet'`, WebSearch/WebFetch). **Gotchas connus** :
- `args` arrive en STRING → `const items = typeof args==='string'?JSON.parse(args):args`.
- VALUES multi-lignes : générer le SQL par **script Python** (jamais à la main) → 25 valeurs/ligne.
- Débit réel ~1-2 agents/min (concurrence plafonnée par les cœurs CPU, pas 16) → ~194
  contrats ≈ 4-5 h. Lancer `caffeinate -dimsu -t 21600 &` pour éviter la veille.
- Récupérer le résultat : `result.rows` de l'output de tâche, OU parser les transcripts
  `subagents/workflows/<runId>/agent-*.jsonl` (dédup par `key`, garder la ligne au + de
  `source_urls` = étape verify) — c'est ce qui a servi au salvage ci-dessus.

### Étape 3 (optionnel) — Élargir sous ≥300 UC + scraper mensuel
Descendre le seuil (`funds >= 100` = ~310 contrats) pour la longue traîne, et/ou
laisser le scraper DIC mensuel `av-contract-terms.yml` (nécessite le secret GitHub
`ANTHROPIC_API_KEY`) prendre le relais en continu.

## Rappels
- Priorité produit (Mathis) : **la donnée** — mapping exhaustif assureurs × contrats.
- Fiche déjà câblée : dès qu'une ligne `av_contract_terms` existe pour un contrat,
  la fiche affiche le bloc « Conditions du contrat » + « Précisions » (notes) + source + millésime.
- Confidence : `curated` (≥2 sources / DIC), `indicative` (partiel), `scraped` (DIC auto).
  Certaines lignes du salvage sont issues de l'étape source seule (verify non passée) —
  re-vérifiables plus tard, mais data réelle + sourcée.
