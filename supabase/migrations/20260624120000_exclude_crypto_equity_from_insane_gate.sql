-- Garde __insane : exclure les ETF crypto-actions (légitimement volatils) ─────
-- Contexte : la garde de risque (20260623160000) masque vol/sharpe/drawdown au
-- dessus de seuils « physiquement impossibles » pour un fonds coté non levier /
-- non crypto. Elle excluait déjà asset_class_broad='crypto' et les noms levier/
-- inverse. Mais des ETF d'ACTIONS thématiques crypto (Melanion Bitcoin Equities,
-- VanEck Crypto & Blockchain) sont classés asset_class_broad='action' tout en
-- détenant des titres crypto-corrélés (mineurs, Coinbase, MicroStrategy) : leur
-- volatilité 61-62 % est RÉELLE (séries propres vérifiées le 24/06, aucun glitch,
-- mouvements quotidiens jusqu'à ±25 %), pas une corruption NAV.
--
-- Fix : on étend l'exclusion par NOM à crypto|bitcoin|blockchain (+ « digital
-- asset »), cohérent avec l'exclusion crypto/levier existante. Ces fonds restent
-- donc VISIBLES avec leur vol réelle au lieu d'être masqués à tort.
-- Réversible (vue SQL pure, aucun prix touché). Seule la liste d'exclusion change.

CREATE OR REPLACE VIEW investissement_funds_cgp AS
 SELECT isin,
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
    (CASE WHEN __stale AND NOT (__ext_fresh AND performance_1y >= -60  AND performance_1y <= 200)
          THEN NULL ELSE performance_1y END)::numeric(8,4) AS performance_1y,
    CASE WHEN __stale AND NOT (__ext_fresh AND performance_3y >= -90  AND performance_3y <= 1000)
         THEN NULL ELSE inv_annualize_pt(performance_3y, 3::numeric, product_type) END AS performance_3y,
    CASE WHEN __stale AND NOT (__ext_fresh AND performance_5y >= -95  AND performance_5y <= 1000)
         THEN NULL ELSE inv_annualize_pt(performance_5y, 5::numeric, product_type) END AS performance_5y,
    (CASE WHEN __stale THEN NULL ELSE average_performance END)::numeric(8,4) AS average_performance,
    (CASE WHEN __stale OR __insane_1y THEN NULL ELSE volatility_1y END)::numeric(8,4) AS volatility_1y,
    (CASE WHEN __stale OR __insane_3y THEN NULL ELSE volatility_3y END)::numeric(8,4) AS volatility_3y,
    (CASE WHEN __stale OR __insane_1y THEN NULL ELSE sharpe_1y END)::numeric(8,4) AS sharpe_1y,
    (CASE WHEN __stale OR __insane_3y THEN NULL ELSE sharpe_3y END)::numeric(8,4) AS sharpe_3y,
    (CASE WHEN __stale OR __insane_1y THEN NULL ELSE max_drawdown_1y END)::numeric(8,4) AS max_drawdown_1y,
    (CASE WHEN __stale OR __insane_3y THEN NULL ELSE max_drawdown_3y END)::numeric(8,4) AS max_drawdown_3y,
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
    tickers_search,
    allocation_profile,
    benchmark_index,
    benchmark_variant,
    benchmark_is_category,
    (CASE WHEN __stale THEN NULL ELSE alpha_1y END)::numeric(8,4) AS alpha_1y,
    (CASE WHEN __stale THEN NULL ELSE alpha_3y END)::numeric(8,4) AS alpha_3y,
    (CASE WHEN __stale THEN NULL ELSE alpha_5y END)::numeric(8,4) AS alpha_5y
   FROM (
     SELECT f.*,
            public.inv_prices_stale(cov.last_price_date, cov.n_points, f.product_type) AS __stale,
            (cov.last_price_date IS NULL AND f.updated_at > (current_date - 150)) AS __ext_fresh,
            ( f.product_type IN ('opcvm','etf')
              AND f.asset_class_broad IS DISTINCT FROM 'crypto'
              AND coalesce(f.name,'') !~* 'leverage|levier|inverse|\mbear\m|ultra|\m[2-3]x\m|\mx[2-3]\m|daily.*[2-3]|crypto|bitcoin|blockchain|digital asset'
              AND f.volatility_1y > 60 ) AS __insane_1y,
            ( f.product_type IN ('opcvm','etf')
              AND f.asset_class_broad IS DISTINCT FROM 'crypto'
              AND coalesce(f.name,'') !~* 'leverage|levier|inverse|\mbear\m|ultra|\m[2-3]x\m|\mx[2-3]\m|daily.*[2-3]|crypto|bitcoin|blockchain|digital asset'
              AND (f.volatility_3y > 60 OR f.max_drawdown_3y < -90) ) AS __insane_3y
       FROM investissement_funds f
       LEFT JOIN investissement_fund_price_coverage cov ON cov.isin = f.isin
   ) f;
