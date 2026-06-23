-- Garde « métrique de risque physiquement implausible » (corruption NAV) ─────────
-- Contexte : la garde de fraîcheur (20260623120000) masque les métriques d'une
-- série ABSENTE/PÉRIMÉE/MINCE. Elle ne voit PAS une série fraîche et longue mais
-- dont une VALEUR interne est corrompue (ex. un point NAV à 3 € au lieu de 400 €).
-- Un tel glitch crée deux rendements quotidiens énormes → vol/drawdown explosent.
-- Exemples EXPOSÉS : UniGlobal (vol_3y 84,5 alors que vol_1y 5,7), UBS Core S&P 500
-- ETF (max_drawdown_3y −99 % — impossible pour le S&P 500), MSCI USA/Japan, etc.
--
-- Décision (23/06) : masquer les métriques de risque d'une FENÊTRE dès qu'une valeur
-- y est physiquement impossible pour un fonds coté NON LEVIER / NON CRYPTO. La
-- volatilité est le détecteur principal (un glitch la fait exploser) ; le drawdown
-- est un second signal indépendant (vol_3y peut rester sous le seuil — 56-59 — alors
-- que le drawdown atteint −99 %). Par fenêtre, on masque vol + sharpe + drawdown
-- ENSEMBLE (toutes issues de la même série corrompue) :
--   1y : si volatility_1y > 60
--   3y : si volatility_3y > 60  OU  max_drawdown_3y < −90
-- Hors périmètre (jamais masqué par cette garde) : crypto et fonds à levier/inverse
-- (vol/drawdown légitimement extrêmes) — exclus par asset_class_broad et par le nom.
--
-- Réversible (vue SQL pure, AUCUN prix touché). La réparation des séries corrompues
-- elles-mêmes (~442 fonds avec saut > 60 %/j) reste un chantier de suivi distinct.
-- ~99 fonds voient leurs métriques 1y masquées, ~121 leurs 3y ; 100 fonds volatils
-- mais sains (vol_3y 35-60, dd ≥ −90) restent VISIBLES (pas de sur-masquage).
-- Compose avec la garde de fraîcheur (__stale) et l'exception perf externe LU
-- (__ext_fresh, 20260623140000), toutes deux préservées telles quelles.

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
    -- Perfs : masquées si garde active SAUF perf externe fraîche ET saine (exception
    -- LU, migration 20260623140000) — inchangé.
    (CASE WHEN __stale AND NOT (__ext_fresh AND performance_1y >= -60  AND performance_1y <= 200)
          THEN NULL ELSE performance_1y END)::numeric(8,4) AS performance_1y,
    CASE WHEN __stale AND NOT (__ext_fresh AND performance_3y >= -90  AND performance_3y <= 1000)
         THEN NULL ELSE inv_annualize_pt(performance_3y, 3::numeric, product_type) END AS performance_3y,
    CASE WHEN __stale AND NOT (__ext_fresh AND performance_5y >= -95  AND performance_5y <= 1000)
         THEN NULL ELSE inv_annualize_pt(performance_5y, 5::numeric, product_type) END AS performance_5y,
    (CASE WHEN __stale THEN NULL ELSE average_performance END)::numeric(8,4) AS average_performance,
    -- Métriques de RISQUE : masquées si la garde de fraîcheur est active OU si la
    -- valeur est physiquement implausible (corruption NAV), par fenêtre.
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
            -- Périmètre de la garde d'insanité : opcvm/etf, hors crypto, hors levier/
            -- inverse (vol/drawdown légitimement extrêmes pour ces produits).
            ( f.product_type IN ('opcvm','etf')
              AND f.asset_class_broad IS DISTINCT FROM 'crypto'
              AND coalesce(f.name,'') !~* 'leverage|levier|inverse|\mbear\m|ultra|\m[2-3]x\m|\mx[2-3]\m|daily.*[2-3]'
              AND f.volatility_1y > 60 ) AS __insane_1y,
            ( f.product_type IN ('opcvm','etf')
              AND f.asset_class_broad IS DISTINCT FROM 'crypto'
              AND coalesce(f.name,'') !~* 'leverage|levier|inverse|\mbear\m|ultra|\m[2-3]x\m|\mx[2-3]\m|daily.*[2-3]'
              AND (f.volatility_3y > 60 OR f.max_drawdown_3y < -90) ) AS __insane_3y
       FROM investissement_funds f
       LEFT JOIN investissement_fund_price_coverage cov ON cov.isin = f.isin
   ) f;
