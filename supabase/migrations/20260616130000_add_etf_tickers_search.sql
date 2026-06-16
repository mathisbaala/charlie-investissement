-- ============================================================================
-- Recherche par ticker boursier (ETF) — retour utilisateur : « DCAM » introuvable
-- ----------------------------------------------------------------------------
-- Les ETF cotés ont un (ou plusieurs) ticker boursier — p. ex. l'Amundi PEA Monde
-- MSCI World (FR001400U5Q4) s'échange sous « DCAM » sur Euronext Paris. La table
-- n'en stockait aucun : une recherche « DCAM » ne matchait ni `name` ni `isin`
-- → 0 résultat, alors que le fonds est bien en base.
--
-- On ajoute `tickers text[]` (multi-bourses : un même ISIN cote sous plusieurs
-- codes selon la place — DCAM/DCAMEUR/DCAMP…), peuplé fill-only par
-- scripts/scrapers/openfigi-tickers.py. Les vues du screener l'exposent :
--   - `tickers`        : le tableau (affichage éventuel d'un chip ticker)
--   - `tickers_search` : les codes concaténés par espaces, pour le filtre `ilike`
--                        de lib/search.ts. PostgREST ne sait pas faire d'`ilike`
--                        sur une colonne tableau → on dénormalise en texte ici.
--
-- CREATE OR REPLACE VIEW : les nouvelles colonnes sont ajoutées EN FIN de SELECT
-- (contrainte Postgres : ni l'ordre ni le type des colonnes existantes ne change),
-- donc aucun DROP, les dépendances (cgp_ref → cgp) restent intactes.
-- ============================================================================

ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS tickers text[];

CREATE OR REPLACE VIEW investissement_funds_cgp AS
SELECT
    isin,
    name,
    product_type,
    asset_class_broad,
    asset_class,
    category_normalized,
    region_normalized,
    sector,
    management_style,
    management_company_normalized AS gestionnaire,
    aum_eur,
    currency,
    inception_date,
    track_record_years,
    ter,
    ongoing_charges,
    entry_fee_max,
    exit_fee_max,
    performance_fee,
    retrocession_cgp,
    holding_period_years,
    performance_1y,
    inv_annualize_pt(performance_3y, 3::numeric, product_type) AS performance_3y,
    inv_annualize_pt(performance_5y, 5::numeric, product_type) AS performance_5y,
    average_performance,
    volatility_1y,
    volatility_3y,
    sharpe_1y,
    sharpe_3y,
    max_drawdown_1y,
    max_drawdown_3y,
    sri AS risk_score,
    sfdr_article,
    labels,
    pea_eligible,
    pea_pme_eligible,
    per_eligible,
    av_fr_eligible,
    av_lux_eligible,
    cto_eligible,
    ucits_compliant,
    is_institutional,
    CASE
        WHEN is_institutional IS FALSE OR is_institutional IS NULL THEN true
        ELSE false
    END AS accessible_retail,
    hedged,
    morningstar_rating,
    share_class_group_id,
    kid_url,
    kid_parsed_at,
    data_completeness,
    data_source,
    field_sources,
    updated_at,
    is_primary_share_class,
    tickers,
    array_to_string(tickers, ' ') AS tickers_search
   FROM investissement_funds f;

CREATE OR REPLACE VIEW investissement_funds_cgp_ref AS
SELECT
    c.isin,
    c.name,
    c.product_type,
    c.asset_class_broad,
    c.asset_class,
    c.category_normalized,
    c.region_normalized,
    c.sector,
    c.management_style,
    c.gestionnaire,
    c.aum_eur,
    c.currency,
    c.inception_date,
    c.track_record_years,
    c.ter,
    c.ongoing_charges,
    c.entry_fee_max,
    c.exit_fee_max,
    c.performance_fee,
    c.retrocession_cgp,
    c.holding_period_years,
    c.performance_1y,
    c.performance_3y,
    c.performance_5y,
    c.average_performance,
    c.volatility_1y,
    c.volatility_3y,
    c.sharpe_1y,
    c.sharpe_3y,
    c.max_drawdown_1y,
    c.max_drawdown_3y,
    c.risk_score,
    c.sfdr_article,
    c.labels,
    c.pea_eligible,
    c.pea_pme_eligible,
    c.per_eligible,
    c.av_fr_eligible,
    c.av_lux_eligible,
    c.cto_eligible,
    c.ucits_compliant,
    c.is_institutional,
    c.accessible_retail,
    c.hedged,
    c.morningstar_rating,
    c.share_class_group_id,
    c.kid_url,
    c.kid_parsed_at,
    c.data_completeness,
    c.data_source,
    c.field_sources,
    c.updated_at,
    m.insurers,
    m.contracts,
    c.is_primary_share_class,
    c.tickers,
    c.tickers_search
   FROM investissement_funds_cgp c
     LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin;

GRANT SELECT ON investissement_funds_cgp     TO anon, authenticated, service_role;
GRANT SELECT ON investissement_funds_cgp_ref TO anon, authenticated, service_role;
