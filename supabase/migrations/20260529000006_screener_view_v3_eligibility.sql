-- ─── Screener VIEW v3 — ajout éligibilités + frais détaillés ─────────────────
-- Dépend de : migration 20260529000003 (colonnes av_fr_eligible, pea_pme_eligible,
--             cto_eligible) et 20260529000004 (entry_fee_max, etc.)
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Frais courants (normalisés en %)
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

  -- Frais détaillés (fraction décimale : 0.03 = 3 %)
  f.entry_fee_max,
  f.exit_fee_max,
  f.performance_fee,
  f.retrocession_cgp,
  f.holding_period_years,

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

  -- Éligibilités enveloppes fiscales (6 enveloppes)
  f.pea_eligible,
  f.pea_pme_eligible,
  f.per_eligible,
  f.av_fr_eligible,
  f.av_lux_eligible,
  f.cto_eligible,

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
