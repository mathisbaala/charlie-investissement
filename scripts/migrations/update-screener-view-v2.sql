-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration screener VIEW v2 — à exécuter dans Supabase SQL Editor
-- https://supabase.com/dashboard/project/dehigtgzizsdehyhmjxn/sql
-- ═══════════════════════════════════════════════════════════════════════════════
-- Ce script :
--   1. Ajoute la colonne category_normalized à la table
--   2. Recrée investissement_funds_cgp avec :
--      - asset_class (en plus de asset_class_broad)
--      - Normalisation TER : ROUND(ter * 100, 4) quand stocké en fraction (ter < 0.1)
--      - pea_eligible (renommé depuis la table)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ÉTAPE 1 : Ajouter category_normalized si inexistant
ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS category_normalized text;

COMMENT ON COLUMN investissement_funds.category_normalized IS
  'Catégorie Morningstar normalisée (~20 labels stables, ex: Actions Zone Euro, Obligations EUR, Multi-Actifs Prudents)';

-- ÉTAPE 2 : Recréer la VIEW avec les colonnes manquantes + normalisation TER
-- La vue expose les colonnes utiles au screener CGP avec des alias clairs.
-- NORMALISATION TER : certains scrapers stockent le TER en fraction (0.0022 = 0.22%),
-- d'autres en pourcentage (0.22 = 0.22%). On normalise ici pour que l'API reçoive
-- toujours des valeurs en pourcentage.

CREATE OR REPLACE VIEW investissement_funds_cgp AS
SELECT
  -- Identifiants
  f.isin,
  f.name,
  f.product_type,

  -- Classification
  f.asset_class_broad,
  f.asset_class,
  f.category_normalized,
  f.region_normalized,
  f.sector,
  f.management_style,

  -- Gestionnaire
  f.management_company_normalized AS gestionnaire,

  -- Encours et devise
  f.aum_eur,
  f.currency,
  f.inception_date,
  f.track_record_years,

  -- Frais (normalisés en %) : si stocké en fraction (<0.1 et >0), on multiplie par 100
  CASE
    WHEN f.ter IS NOT NULL AND f.ter > 0 AND f.ter < 0.1
    THEN ROUND(CAST(f.ter * 100 AS numeric), 4)
    ELSE f.ter
  END AS ter,
  CASE
    WHEN f.ongoing_charges IS NOT NULL AND f.ongoing_charges > 0 AND f.ongoing_charges < 0.1
    THEN ROUND(CAST(f.ongoing_charges * 100 AS numeric), 4)
    ELSE f.ongoing_charges
  END AS ongoing_charges,

  -- Performances (%)
  f.performance_1y,
  f.performance_3y,
  f.performance_5y,
  f.average_performance,
  f.volatility_1y,
  f.volatility_3y,
  f.sharpe_1y,
  f.sharpe_3y,
  f.max_drawdown_1y,
  f.max_drawdown_3y,

  -- Risque
  f.sri          AS risk_score,
  f.sfdr_article,
  f.labels,

  -- Éligibilité enveloppe fiscale
  f.pea_eligible,
  f.av_lux_eligible,
  f.per_eligible,

  -- Caractéristiques institutionnelles
  f.ucits_compliant,
  f.is_institutional,
  CASE
    WHEN f.is_institutional IS FALSE OR f.is_institutional IS NULL
    THEN TRUE
    ELSE FALSE
  END AS accessible_retail,
  f.hedged,

  -- Scoring Morningstar
  f.morningstar_rating,

  -- Regroupement parts
  f.share_class_group_id,

  -- Document KID
  f.kid_url,
  f.kid_parsed_at,

  -- Qualité données
  f.data_completeness,
  f.data_source,
  f.field_sources,
  f.updated_at

FROM investissement_funds f;

-- ─── Activer RLS si nécessaire ────────────────────────────────────────────────
-- (garder les mêmes politiques que la table source)

-- Vérification : la vue doit désormais exposer asset_class et category_normalized
-- SELECT isin, asset_class, category_normalized, ter FROM investissement_funds_cgp LIMIT 5;
