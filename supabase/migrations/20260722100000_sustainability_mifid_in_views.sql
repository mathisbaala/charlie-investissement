-- Durabilité MiFID dans les vues : expose les 3 colonnes DDA au screener/moteur ─
-- Contexte : sustainable_investment_pct / taxonomy_alignment_pct / pai_considered
-- existent sur investissement_funds depuis 20260619140000 (annexe SFDR, ~200
-- valeurs) et sont désormais alimentées en masse depuis les EET
-- (esg-exclusions-enricher.py, cf. docs/mapping-eet-mifid.md — 1 189 fonds au
-- 22/07/2026), mais n'étaient exposées par AUCUNE vue. Même recette que
-- 20260721160000 (esg_exclusions) : colonnes APPENDUES en fin de vue (ordre
-- existant préservé), inv_funds_search recréée avec RETURNS TABLE figé +
-- 3 colonnes avant relevance, sécu re-posée à l'identique.

-- ── Vue légère (screener) : colonnes APPENDUES en fin ──────────────────────────
-- CREATE OR REPLACE VIEW n'accepte qu'un ajout en fin de liste (les colonnes
-- existantes gardent position et nom). Reprise à l'identique de 20260624120000,
-- + esg_exclusions puis les 3 colonnes durabilité en dernières positions.
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
    (CASE WHEN __stale THEN NULL ELSE alpha_5y END)::numeric(8,4) AS alpha_5y,
    esg_exclusions,
    sustainable_investment_pct,
    taxonomy_alignment_pct,
    pai_considered
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

-- ── Vue _ref (screener + allocation) : colonne appendue en fin, ordre préservé ─
-- Des matviews dépendent de _ref (av_insurers_list, contract_metrics) → pas de
-- DROP possible sans cascade. On garde CREATE OR REPLACE : la liste externe est
-- désormais EXPLICITE (ordre strictement identique à 20260623180000) pour pouvoir
-- appendre esg_exclusions APRÈS is_target_maturity (r.* l'aurait insérée avant).
CREATE OR REPLACE VIEW investissement_funds_cgp_ref AS
SELECT
  r.isin, r.name, r.product_type, r.asset_class_broad, r.asset_class,
  r.category_normalized, r.region_normalized, r.sector, r.management_style,
  r.gestionnaire, r.aum_eur, r.currency, r.inception_date, r.track_record_years,
  r.ter, r.ongoing_charges, r.entry_fee_max, r.exit_fee_max, r.performance_fee,
  r.retrocession_cgp, r.holding_period_years,
  r.performance_1y, r.performance_3y, r.performance_5y, r.average_performance,
  r.volatility_1y, r.volatility_3y, r.sharpe_1y, r.sharpe_3y,
  r.max_drawdown_1y, r.max_drawdown_3y,
  r.risk_score, r.sfdr_article, r.labels, r.pea_eligible, r.pea_pme_eligible,
  r.per_eligible, r.av_fr_eligible, r.av_lux_eligible, r.cto_eligible,
  r.ucits_compliant, r.is_institutional, r.accessible_retail, r.hedged,
  r.morningstar_rating, r.share_class_group_id, r.kid_url, r.kid_parsed_at,
  r.data_completeness, r.data_source, r.field_sources, r.updated_at,
  r.insurers, r.contracts, r.is_primary_share_class, r.tickers, r.tickers_search,
  r.allocation_profile, r.benchmark_index, r.benchmark_variant, r.benchmark_is_category,
  r.alpha_1y, r.alpha_3y, r.alpha_5y,
  r.maturity_year,
  (r.maturity_year IS NOT NULL) AS is_target_maturity,
  r.esg_exclusions,
  r.sustainable_investment_pct, r.taxonomy_alignment_pct, r.pai_considered
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
    END AS maturity_year,
    c.esg_exclusions,
    c.sustainable_investment_pct, c.taxonomy_alignment_pct, c.pai_considered
  FROM investissement_funds_cgp c
  LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin
) r;

-- ── inv_funds_search : c.* depuis _ref avec RETURNS TABLE figé ────────────────
-- La colonne ajoutée ferait échouer la fonction (« structure of query does not
-- match function result type »). DROP + recréation à l'identique de
-- 20260706120000, + esg_exclusions et les 3 colonnes durabilité avant relevance. On reproduit le
-- durcissement sécu (PUBLIC/anon/authenticated révoqués, EXECUTE = service_role).
DROP FUNCTION IF EXISTS public.inv_funds_search(text);
CREATE OR REPLACE FUNCTION public.inv_funds_search(q text)
 RETURNS TABLE(isin text, name text, product_type text, asset_class_broad text, asset_class text, category_normalized text, region_normalized text, sector text, management_style text, gestionnaire text, aum_eur bigint, currency character, inception_date date, track_record_years real, ter numeric, ongoing_charges numeric, entry_fee_max numeric, exit_fee_max numeric, performance_fee numeric, retrocession_cgp numeric, holding_period_years smallint, performance_1y numeric, performance_3y numeric, performance_5y numeric, average_performance numeric, volatility_1y numeric, volatility_3y numeric, sharpe_1y numeric, sharpe_3y numeric, max_drawdown_1y numeric, max_drawdown_3y numeric, risk_score smallint, sfdr_article smallint, labels jsonb, pea_eligible boolean, pea_pme_eligible boolean, per_eligible boolean, av_fr_eligible boolean, av_lux_eligible boolean, cto_eligible boolean, ucits_compliant boolean, is_institutional boolean, accessible_retail boolean, hedged boolean, morningstar_rating smallint, share_class_group_id text, kid_url text, kid_parsed_at timestamp with time zone, data_completeness smallint, data_source text, field_sources jsonb, updated_at timestamp with time zone, insurers text[], contracts text[], is_primary_share_class boolean, tickers text[], tickers_search text, allocation_profile text, benchmark_index text, benchmark_variant text, benchmark_is_category boolean, alpha_1y numeric, alpha_3y numeric, alpha_5y numeric, maturity_year smallint, is_target_maturity boolean, esg_exclusions jsonb, sustainable_investment_pct numeric, taxonomy_alignment_pct numeric, pai_considered boolean, relevance real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with t as (
    select array_agg('%' || unaccent(tok) || '%') as pats, count(*) as n,
           unaccent(lower(trim(q))) as ql
    from unnest(regexp_split_to_array(lower(trim(q)), '\s+')) tok
    where tok <> ''
  )
  select c.*,
    (case
       when unaccent(lower(c.name)) = t.ql then 1.0
       when t.n = 1 and c.tickers_search is not null
            and unaccent(lower(c.tickers_search)) ~ ('\y' || t.ql || '\y') then 0.97
       when unaccent(lower(c.name)) like (t.ql || '%')
            then 0.90 + 0.06 * similarity(unaccent(c.name), t.ql)
       when unaccent(lower(c.name)) like all (t.pats)
            then 0.70 + 0.18 * similarity(unaccent(c.name), t.ql)
       else 0.20 + 0.40 * similarity(unaccent(c.name), t.ql)
     end)::real as relevance
  from investissement_funds_cgp_ref c, t
  where c.is_primary_share_class = true
    and c.data_completeness >= 50
    and unaccent(lower(
      coalesce(c.name,'') || ' ' || coalesce(c.isin,'') || ' ' ||
      coalesce(c.tickers_search,'') || ' ' || coalesce(c.gestionnaire,'') || ' ' ||
      coalesce(c.category_normalized,'') || ' ' || coalesce(c.region_normalized,'') || ' ' ||
      coalesce(c.asset_class,'') || ' ' || coalesce(c.sector,'')
    )) like all (t.pats);
$function$;

REVOKE EXECUTE ON FUNCTION public.inv_funds_search(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_funds_search(text) TO service_role;
