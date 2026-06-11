-- ============================================================================
-- QA — Classification crypto par le nom + sanité numérique (audit 36 035 lignes)
-- ----------------------------------------------------------------------------
-- Déclencheur : incohérences sur les fonds TOBAM (fonds Bitcoin classé
-- « obligation » à cause du mot « Treasury », noms à blancs multiples, AUM
-- Yahoo aberrant). Audit complet de investissement_funds qui suit.
--
-- PRINCIPE : la plupart des « anomalies » brutes sont LÉGITIMES par domaine et
-- NE sont PAS touchées (REIT en titres vifs = action_individuelle ; OAT/Livrets
-- TER=0 ; fonds monétaires Sharpe 40-80 = artefact vol≈0 ; SCPI ongoing>10% ;
-- fonds de dette étiquetés « Multi-Actifs » mais broad=obligation est plus
-- juste ; ultra-short tréso monétaire↔obligation ambigu ; crypto/quantum à
-- +3000% réels). On ne corrige QUE l'impossible.
--
-- Déjà appliqué en prod via MCP — migration de traçabilité, idempotente.
-- ============================================================================

-- ─── 1. Reclassement crypto (cause racine : aucune détection crypto par le nom) ──
-- Expo Bitcoin/BTC/crypto directe rangée en diversifie/obligation/alternatif
-- faute de catégorie crypto chez l'AMF. On EXCLUT les titres vifs
-- (product_type='action' → action_individuelle) et les ETF d'ACTIONS de
-- sociétés crypto (« Bitcoin Equities », « Blockchain Equity » → restent action).
CREATE TABLE IF NOT EXISTS investissement_funds_tobam_backup_20260611 AS
SELECT isin, name, asset_class, asset_class_broad, aum_eur, data_source, updated_at
FROM   investissement_funds
WHERE  name ILIKE '%tobam%';
ALTER TABLE investissement_funds_tobam_backup_20260611 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET    asset_class_broad = 'crypto'
WHERE  name ~* '\m(bitcoin|btc|ethereum|crypto|stablecoin)\M'
  AND  asset_class_broad IN ('alternatif','diversifie','obligation')
  AND  product_type <> 'action'
  AND  name !~* '\m(equit(y|ies)|actions?|stock)\M';

-- ─── 2. Nettoyage des noms ─────────────────────────────────────────────────────
-- Espaces multiples (« Tobam   Blockchain » → « Tobam Blockchain »).
UPDATE investissement_funds
SET    name = regexp_replace(btrim(name), '\s+', ' ', 'g')
WHERE  name ~ '\s{2,}';

-- Suffixe parasite « ** » / « *** » sur de VRAIS noms (hors placeholder AMF
-- « Fonds dédié*** » qui, lui, est une convention officielle → conservé).
UPDATE investissement_funds
SET    name = btrim(regexp_replace(name, '\s*\*+\s*$', ''))
WHERE  name ~ '\s\*\*' AND name !~ '^Fonds d[ée]di[ée]';

-- ─── 3. Sanité numérique ───────────────────────────────────────────────────────
-- Backup des lignes impactées (AUM≤0, perfs impossibles, classif titres vifs).
CREATE TABLE IF NOT EXISTS investissement_funds_qa_backup_20260611 AS
SELECT isin, name, asset_class_broad, aum_eur,
       performance_1y, performance_3y, performance_5y, average_performance, updated_at
FROM   investissement_funds
WHERE  aum_eur <= 0
   OR  ( product_type IN ('etf','opcvm','fps','fcpr','fpci') AND asset_class_broad <> 'crypto'
         AND ( performance_1y > 300 OR performance_3y > 800 OR performance_5y > 1500
               OR ( asset_class_broad IN ('obligation','monetaire')
                    AND ( performance_5y < -90 OR performance_3y < -90 OR performance_1y < -90 ) ) ) )
   OR  ( product_type='action' AND asset_class_broad IN ('matieres_premieres','action') )
   OR  name = 'SILVER GENERATION A';
ALTER TABLE investissement_funds_qa_backup_20260611 ENABLE ROW LEVEL SECURITY;

-- (a) AUM ≤ 0 → NULL (placeholder amf-geco trompeur sur le screener).
UPDATE investissement_funds SET aum_eur = NULL WHERE aum_eur <= 0;

-- (b) Perfs mathématiquement impossibles pour la classe d'actifs → NULL.
--     Sentinelles 10000 (UBS Low Vol ETF), monétaire à +820%, et surtout fonds
--     obligataires à -95/-100% (NAV corrompue → -100% cumulé). Hors crypto &
--     titres vifs, légitimement extrêmes. average_performance remis à NULL.
UPDATE investissement_funds SET
  performance_1y = CASE WHEN performance_1y > 300 OR (asset_class_broad IN ('obligation','monetaire') AND performance_1y < -90) THEN NULL ELSE performance_1y END,
  performance_3y = CASE WHEN performance_3y > 800 OR (asset_class_broad IN ('obligation','monetaire') AND performance_3y < -90) THEN NULL ELSE performance_3y END,
  performance_5y = CASE WHEN performance_5y > 1500 OR (asset_class_broad IN ('obligation','monetaire') AND performance_5y < -90) THEN NULL ELSE performance_5y END,
  average_performance = NULL
WHERE product_type IN ('etf','opcvm','fps','fcpr','fpci') AND asset_class_broad <> 'crypto'
  AND ( performance_1y > 300 OR performance_3y > 800 OR performance_5y > 1500
        OR ( asset_class_broad IN ('obligation','monetaire')
             AND ( performance_5y < -90 OR performance_3y < -90 OR performance_1y < -90 ) ) );

-- (c) Titres vifs mal classés (matieres_premieres/action) → action_individuelle.
UPDATE investissement_funds SET asset_class_broad = 'action_individuelle'
WHERE product_type='action' AND asset_class_broad IN ('matieres_premieres','action');

-- (d) SILVER GENERATION : thème « économie des seniors », pas le métal argent.
UPDATE investissement_funds SET asset_class_broad = 'action'
WHERE name = 'SILVER GENERATION A' AND asset_class_broad = 'matieres_premieres';
