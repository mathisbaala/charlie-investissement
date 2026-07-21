# Runbook — Refresh annuel des taux fonds euros au niveau CONTRAT

Rafraîchit `investissement_av_contract_terms.fonds_euros_taux_pct` (+ `fonds_euros_annee`,
`fonds_euros_nom`, `frais_gestion_fonds_euros_pct`) avec les taux servis de l'année écoulée.

> **Distinct de `annual-refresh.yml`** : ce dernier rafraîchit les *fonds* de type
> `product_type='fonds_euros'` (perf 1y/3y/5y via goodvalueformoney). Ici on traite les
> **contrats** d'assurance-vie (table `investissement_av_contract_terms`), une autre surface.

## Pourquoi ce n'est PAS un job GitHub Actions

Le refresh repose sur un **workflow multi-agents Claude** : un agent par assureur fait de la
**recherche web** (table de taux officielle de l'assureur, publiée janvier–mars N+1) puis
propose des valeurs sourcées. GitHub Actions tourne des scrapers Python *headless*, sans
runtime Claude ni navigation agentique → **impossible d'en faire un step CI**. La cadence est
donc semi-manuelle, déclenchée à la main une fois par an (rappel auto en février, cf. plus bas).

## Cadence

Les assureurs publient les taux servis de l'année N entre **janvier et mars N+1**. Rejouer
**chaque année vers mars**.

## Procédure

1. **Lister les assureurs à traiter** (contrats à taux périmé/manquant) :
   ```sql
   SELECT company, COUNT(*) AS n
   FROM investissement_av_contract_terms
   WHERE (fonds_euros_annee < <ANNEE_CIBLE> OR fonds_euros_annee IS NULL)
     AND (fonds_euros_taux_pct IS NOT NULL OR fonds_euros_nom IS NOT NULL
          OR lower(coalesce(garantie_fonds_euros,'')) IN ('true','oui','1','yes'))
   GROUP BY company ORDER BY n DESC;
   ```
   → construire le tableau `args` = `[{company, n, bulk_hint?}, ...]` (bulk_hint:true pour AG2R
   La Mondiale, dont ~240 contrats partagent l'actif général « La Mondiale »).

2. **Lancer le workflow** (Claude Code, outil Workflow) :
   `scripts/workflows/av-fonds-euros-refresh.js`, en passant `args` = le tableau ci-dessus.
   Les agents sont **en lecture seule** (SELECT + web) et renvoient des propositions structurées
   `{bulk, contrats:[{taux, annee, confidence, officiel, qa_alert, ...}]}`.

3. **Consolider + construire un SQL gardé** (un sous-agent qui lit le résultat, expanse le bulk
   AG2R, exclut les items à risque). Garde-fous OBLIGATOIRES :
   - filtre `key` + `(fonds_euros_annee < ANNEE OR NULL)` ; **jamais** `taux = NULL`.
   - `fe_nom`/`frais_fe` en COALESCE (ne pas écraser par null).
   - **`confidence`** ∈ `{scraped, curated, indicative}` — contrainte CHECK. Donnée d'une source
     officielle assureur → `curated` (JAMAIS `'sourcé'` : casse la transaction, erreur 23514).
   - **AG2R bulk** : exclure PER/PERO/PERI/PERCO/RETRAITE/ACQS/Lux/multi-devise ; `PER` en
     **word-boundary** (`~ '\yPER\y'`) sinon attrape « OPEN PERSPECTIVES CAPI ».

4. **Backup avant écriture** :
   `CREATE TABLE investissement_av_contract_terms_fe_backup_<AAAAMMJJ> AS SELECT * FROM investissement_av_contract_terms;`
   Rollback = restaurer par `key` depuis ce backup.

5. **Appliquer** en une transaction (`BEGIN; … COMMIT;`), puis vérifier la couverture
   (`fonds_euros_annee = ANNEE`).

## Règles de fiabilité (non négociables)

- **Ne JAMAIS surévaluer un taux fonds euros** (outil client-facing). En cas de doute sur un
  contrat à frais de gestion FE élevés (le taux « headline » du fonds général surévalue le net
  réel), **laisser la valeur N-1** — l'année N-1 signale honnêtement « pas de N ». Ne pas
  fabriquer de chiffre.
- **Fonds euros luxembourgeois / contrats fermés** = souvent non publiés → laisser `null`, ne
  pas chasser (cul-de-sac structurel).
- Les *frais* (entrée/gestion UC/arbitrage) ne sont, eux, quasi pas sourçables par contrat
  (DIC non accessibles) — ce runbook ne traite QUE le fonds euros.

## Historique

- **2025 (21/07/2026)** : 1er run. 39 agents, 338 lignes appliquées (217 AG2R bulk + 121
  par-contrat) + 10 pièges de frais résolus. Couverture taux 2025 ≈ 77 %. Backup
  `investissement_av_contract_terms_fe_backup_20260721`. Anomalies QA corrigées : 7 APICIL
  mal étiquetés `Natixis Life Luxembourg`, doublon casse CNP Alysés, ligne-entité Sogécap.
