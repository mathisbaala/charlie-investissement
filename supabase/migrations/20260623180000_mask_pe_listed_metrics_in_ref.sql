-- Intégration (/recul) : cohérence screener ↔ fiche pour le private equity.
-- La garde de fraîcheur inv_prices_stale ne couvre que opcvm/etf/crypto → après la
-- reclassification (255 opcvm → fcpr/fcpi/fip), la perf périmée/parasite du non coté
-- n'était plus masquée et ressortait dans le screener (perf_3y -52,9% → +20,9%),
-- alors que la fiche (chantier 3) la masque déjà à juste titre (perf annualisée non
-- pertinente pour du non coté valorisé périodiquement).
--
-- On neutralise les métriques « cotées » (perf/vol/sharpe/drawdown/alpha) pour le PE
-- directement dans la vue _ref (lue par le screener ET inv_funds_search), sans toucher
-- la vue géante cgp. SRI/frais/labels/éligibilités restent (pertinents). Le SET de
-- colonnes est inchangé (valeurs wrappées en CASE) → inv_funds_search.select(c.*) reste
-- aligné, pas de recréation de fonction.

CREATE OR REPLACE VIEW investissement_funds_cgp_ref AS
SELECT r.*, (r.maturity_year IS NOT NULL) AS is_target_maturity
FROM (
  SELECT
    c.isin, c.name, c.product_type, c.asset_class_broad, c.asset_class,
    c.category_normalized, c.region_normalized, c.sector, c.management_style,
    c.gestionnaire, c.aum_eur, c.currency, c.inception_date, c.track_record_years,
    c.ter, c.ongoing_charges, c.entry_fee_max, c.exit_fee_max, c.performance_fee,
    c.retrocession_cgp, c.holding_period_years,
    -- Métriques de marché non pertinentes pour le non coté → NULL pour le PE.
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.performance_1y END)::numeric(8,4) AS performance_1y,
    CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.performance_3y END AS performance_3y,
    CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.performance_5y END AS performance_5y,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.average_performance END)::numeric(8,4) AS average_performance,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.volatility_1y END)::numeric(8,4) AS volatility_1y,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.volatility_3y END)::numeric(8,4) AS volatility_3y,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.sharpe_1y END)::numeric(8,4) AS sharpe_1y,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.sharpe_3y END)::numeric(8,4) AS sharpe_3y,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.max_drawdown_1y END)::numeric(8,4) AS max_drawdown_1y,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.max_drawdown_3y END)::numeric(8,4) AS max_drawdown_3y,
    c.risk_score, c.sfdr_article, c.labels, c.pea_eligible, c.pea_pme_eligible, c.per_eligible,
    c.av_fr_eligible, c.av_lux_eligible, c.cto_eligible, c.ucits_compliant,
    c.is_institutional, c.accessible_retail, c.hedged, c.morningstar_rating,
    c.share_class_group_id, c.kid_url, c.kid_parsed_at, c.data_completeness,
    c.data_source, c.field_sources, c.updated_at, m.insurers, m.contracts,
    c.is_primary_share_class, c.tickers, c.tickers_search, c.allocation_profile,
    c.benchmark_index, c.benchmark_variant, c.benchmark_is_category,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.alpha_1y END)::numeric(8,4) AS alpha_1y,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.alpha_3y END)::numeric(8,4) AS alpha_3y,
    (CASE WHEN c.product_type IN ('fcpr','fcpi','fip','fpci') THEN NULL ELSE c.alpha_5y END)::numeric(8,4) AS alpha_5y,
    CASE
      WHEN c.product_type IN ('opcvm', 'etf')
       AND c.asset_class_broad = 'obligation'
       AND c.name ~* '\y20(2[4-9]|3[0-9]|4[0-5])\y'
       AND c.name ~* 'oblig|bond|cr[ée]dit|rendement|[ée]ch[ée]ance|target|matur|portage|mill[ée]sim|horizon|ibonds|\yterm\y|high yield|perspective|opportunit|\ycap\y|buy.?and.?hold'
      THEN (regexp_match(c.name, '\y(20(?:2[4-9]|3[0-9]|4[0-5]))\y'))[1]::smallint
    END AS maturity_year
  FROM investissement_funds_cgp c
  LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin
) r;
