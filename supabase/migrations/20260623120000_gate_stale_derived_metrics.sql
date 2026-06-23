-- Garde de fraîcheur des métriques dérivées des prix ──────────────────────────
-- Problème : ~2 500 fonds (24 % des OPCVM affichant une perf) montrent des
-- métriques calculées sur une série de prix MORTE ou minuscule (ex. perf 1 an
-- -79 % calculée sur 2 points de 2021). Un contre-contrôle Bloomberg les
-- démasque immédiatement → risque de crédibilité.
--
-- Décision : on ne SCRAPE pas plus, on ARRÊTE d'afficher ce qu'on ne peut pas
-- garantir. Quand la série sous-jacente d'un produit cotant (opcvm/etf/crypto)
-- est absente, périmée (>45 j) ou minuscule (<8 points), on masque (NULL) toutes
-- les métriques DÉRIVÉES du prix : perf 1/3/5 ans, perf moyenne, volatilité,
-- sharpe, max drawdown, alpha. Les métadonnées (frais, SRI, labels, AUM…) restent.
--
-- Cohérent avec la doctrine « ne jamais exposer la complétude » : on masque, on
-- n'invente pas. Périmètre limité aux types dont la perf est CALCULÉE depuis
-- notre série ; les actions (snapshot Yahoo sans série) et obligations seedées
-- (taux statique AFT) sont volontairement hors champ → jamais masquées.
--
-- Source de fraîcheur : investissement_fund_price_coverage (last_price_date,
-- n_points), maintenue par db.upsert_prices, complète et fraîche.

-- 1. Seuils définis UNE SEULE FOIS ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inv_prices_stale(
  p_last  date,
  p_n     integer,
  p_type  text
) RETURNS boolean
  LANGUAGE sql
  STABLE
AS $$
  SELECT CASE
    -- Hors périmètre (action snapshot, obligation seedée, scpi/fonds_euros à
    -- cotation lente, etc.) : ne jamais masquer.
    WHEN p_type IS DISTINCT FROM 'opcvm'
     AND p_type IS DISTINCT FROM 'etf'
     AND p_type IS DISTINCT FROM 'crypto'        THEN false
    WHEN p_last IS NULL                          THEN true   -- aucune série en base
    WHEN p_last < current_date - 45              THEN true   -- série périmée
    -- Minceur : seulement si n_points est CONNU. n_points est NULL pour ~31 % des
    -- lignes de couverture (dont 2 084 fonds frais) → ne jamais masquer un fonds
    -- frais sur la seule absence de ce compteur. La péremption fait le vrai travail.
    WHEN p_n IS NOT NULL AND p_n < 8             THEN true   -- série minuscule (connue)
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.inv_prices_stale(date, integer, text) IS
  'true => masquer les métriques dérivées du prix (série absente/périmée >45j/minuscule <8 pts). Périmètre : opcvm/etf/crypto. Source unique des seuils (miroir TS : lib/format.ts shouldGateDerivedMetrics).';

GRANT EXECUTE ON FUNCTION public.inv_prices_stale(date, integer, text)
  TO anon, authenticated, service_role;

-- 2. Vue screener cgp — gate appliqué aux colonnes dérivées ────────────────────
--    Mêmes noms/types/ordre de colonnes qu'avant (cgp_ref et inv_funds_search en
--    héritent via c.* / SELECT *, inchangés). Seules les 14 colonnes dérivées
--    sont enveloppées d'un CASE WHEN <stale> THEN NULL.
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
    (CASE WHEN __stale THEN NULL ELSE performance_1y END)::numeric(8,4) AS performance_1y,
    CASE WHEN __stale THEN NULL ELSE inv_annualize_pt(performance_3y, 3::numeric, product_type) END AS performance_3y,
    CASE WHEN __stale THEN NULL ELSE inv_annualize_pt(performance_5y, 5::numeric, product_type) END AS performance_5y,
    (CASE WHEN __stale THEN NULL ELSE average_performance END)::numeric(8,4) AS average_performance,
    (CASE WHEN __stale THEN NULL ELSE volatility_1y END)::numeric(8,4) AS volatility_1y,
    (CASE WHEN __stale THEN NULL ELSE volatility_3y END)::numeric(8,4) AS volatility_3y,
    (CASE WHEN __stale THEN NULL ELSE sharpe_1y END)::numeric(8,4) AS sharpe_1y,
    (CASE WHEN __stale THEN NULL ELSE sharpe_3y END)::numeric(8,4) AS sharpe_3y,
    (CASE WHEN __stale THEN NULL ELSE max_drawdown_1y END)::numeric(8,4) AS max_drawdown_1y,
    (CASE WHEN __stale THEN NULL ELSE max_drawdown_3y END)::numeric(8,4) AS max_drawdown_3y,
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
            public.inv_prices_stale(cov.last_price_date, cov.n_points, f.product_type) AS __stale
       FROM investissement_funds f
       LEFT JOIN investissement_fund_price_coverage cov ON cov.isin = f.isin
   ) f;
