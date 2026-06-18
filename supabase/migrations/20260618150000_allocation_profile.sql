-- ─────────────────────────────────────────────────────────────────────────────
-- allocation_profile — profil d'allocation des fonds DIVERSIFIÉS
-- ─────────────────────────────────────────────────────────────────────────────
-- Retour terrain (gérant Thomas, 18/06/2026) : « il manque la classification
-- Flexible pour les fonds ». Aujourd'hui tous les diversifiés tombent dans
-- asset_class_broad='diversifie' sans distinction du profil de risque/allocation.
-- On ajoute une 4e dimension, alignée sur les catégories Morningstar d'allocation
-- (Cautious / Moderate / Aggressive / Flexible), uniquement pour les diversifiés.
--
-- Détection : heuristique par le nom + la catégorie (comme PEA/ETF/crypto, cf.
-- classify-from-name.py). NULL quand aucun mot-clé → couverture partielle assumée
-- (~9 % des diversifiés portent un profil explicite dans leur nom).
--
-- Threading : les vues cgp / cgp_ref et la RPC inv_funds_search listent leurs
-- colonnes EXPLICITEMENT → la nouvelle colonne est ajoutée à la main, en fin de
-- liste (append-only, compatible CREATE OR REPLACE VIEW malgré les dépendances).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonne + contrainte de domaine
ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS allocation_profile text;

ALTER TABLE investissement_funds
  DROP CONSTRAINT IF EXISTS investissement_funds_allocation_profile_check;
ALTER TABLE investissement_funds
  ADD CONSTRAINT investissement_funds_allocation_profile_check
  CHECK (allocation_profile IS NULL
         OR allocation_profile IN ('prudent','equilibre','dynamique','flexible'));

-- Index partiel : le filtre screener ne porte que sur les valeurs non nulles.
CREATE INDEX IF NOT EXISTS i_funds_allocation_profile
  ON investissement_funds (allocation_profile)
  WHERE allocation_profile IS NOT NULL;

-- 2. Vue screener cgp — append allocation_profile en fin de projection
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
    tickers_search,
    allocation_profile
   FROM investissement_funds f;

-- 3. Vue référencement cgp_ref — append c.allocation_profile en fin de projection
CREATE OR REPLACE VIEW investissement_funds_cgp_ref AS
 SELECT c.isin,
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
    c.tickers_search,
    c.allocation_profile
   FROM investissement_funds_cgp c
     LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin;

-- 4. RPC recherche classée — le type de retour change → DROP + CREATE.
--    c.* (depuis cgp_ref) inclut désormais allocation_profile en avant-dernière
--    position ; on l'ajoute au RETURNS TABLE juste avant `relevance`.
DROP FUNCTION IF EXISTS inv_funds_search(text);
CREATE OR REPLACE FUNCTION public.inv_funds_search(q text)
 RETURNS TABLE(isin text, name text, product_type text, asset_class_broad text, asset_class text, category_normalized text, region_normalized text, sector text, management_style text, gestionnaire text, aum_eur bigint, currency character, inception_date date, track_record_years real, ter numeric, ongoing_charges numeric, entry_fee_max numeric, exit_fee_max numeric, performance_fee numeric, retrocession_cgp numeric, holding_period_years smallint, performance_1y numeric, performance_3y numeric, performance_5y numeric, average_performance numeric, volatility_1y numeric, volatility_3y numeric, sharpe_1y numeric, sharpe_3y numeric, max_drawdown_1y numeric, max_drawdown_3y numeric, risk_score smallint, sfdr_article smallint, labels jsonb, pea_eligible boolean, pea_pme_eligible boolean, per_eligible boolean, av_fr_eligible boolean, av_lux_eligible boolean, cto_eligible boolean, ucits_compliant boolean, is_institutional boolean, accessible_retail boolean, hedged boolean, morningstar_rating smallint, share_class_group_id text, kid_url text, kid_parsed_at timestamp with time zone, data_completeness smallint, data_source text, field_sources jsonb, updated_at timestamp with time zone, insurers text[], contracts text[], is_primary_share_class boolean, tickers text[], tickers_search text, allocation_profile text, relevance integer)
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
       when unaccent(lower(c.name)) = t.ql then 3
       when t.n = 1 and c.tickers_search is not null
            and unaccent(lower(c.tickers_search)) ~ ('\y' || t.ql || '\y') then 3
       when unaccent(lower(c.name)) like all (t.pats) then 2
       else 1
     end)::int as relevance
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

-- Grants : restaurer l'état durci (anon/authenticated révoqués, cf. mémoire
-- supabase-security-hardening). DROP réinitialise les privilèges à PUBLIC.
REVOKE ALL ON FUNCTION public.inv_funds_search(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_funds_search(text) TO service_role;

-- 5. Fiche fonds (RPC jsonb) — exposer allocation_profile
CREATE OR REPLACE FUNCTION public.get_fund_detail(p_isin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row investissement_funds%ROWTYPE;
  v_ter_pctile numeric; v_perf3y_pctile numeric; v_peer_count int;
BEGIN
  SELECT * INTO v_row FROM investissement_funds WHERE isin = p_isin;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_row.ter IS NOT NULL AND v_row.category_normalized IS NOT NULL THEN
    SELECT
      ROUND(COUNT(*) FILTER (WHERE ter > v_row.ter)::numeric /
            NULLIF(COUNT(*) FILTER (WHERE ter IS NOT NULL), 0) * 100, 1),
      COUNT(*) FILTER (WHERE ter IS NOT NULL)
    INTO v_ter_pctile, v_peer_count
    FROM investissement_funds
    WHERE category_normalized = v_row.category_normalized AND isin <> p_isin;
  END IF;

  IF v_row.performance_3y IS NOT NULL AND v_row.category_normalized IS NOT NULL THEN
    SELECT ROUND(COUNT(*) FILTER (WHERE performance_3y < v_row.performance_3y)::numeric /
                 NULLIF(COUNT(*) FILTER (WHERE performance_3y IS NOT NULL), 0) * 100, 1)
    INTO v_perf3y_pctile
    FROM investissement_funds
    WHERE category_normalized = v_row.category_normalized AND isin <> p_isin;
  END IF;

  RETURN
    jsonb_build_object(
      'isin', v_row.isin, 'name', v_row.name, 'product_type', v_row.product_type,
      'management_company', v_row.management_company,
      'gestionnaire', v_row.management_company_normalized,
      'currency', v_row.currency, 'asset_class_broad', v_row.asset_class_broad,
      'asset_class', v_row.asset_class, 'category', v_row.category,
      'category_normalized', v_row.category_normalized, 'region_exposure', v_row.region_exposure,
      'region_normalized', v_row.region_normalized, 'sector', v_row.sector,
      'management_style', v_row.management_style,
      'ter', v_row.ter,
      'ongoing_charges', v_row.ongoing_charges,
      'risk_score', v_row.sri, 'srri', v_row.srri, 'sfdr_article', v_row.sfdr_article,
      'performance_1y', v_row.performance_1y,
      'performance_3y', inv_annualize_pt(v_row.performance_3y, 3, v_row.product_type),
      'performance_5y', inv_annualize_pt(v_row.performance_5y, 5, v_row.product_type),
      'average_performance', v_row.average_performance,
      'volatility_1y', v_row.volatility_1y, 'volatility_3y', v_row.volatility_3y,
      'sharpe_1y', v_row.sharpe_1y, 'sharpe_3y', v_row.sharpe_3y,
      'max_drawdown_1y', v_row.max_drawdown_1y, 'max_drawdown_3y', v_row.max_drawdown_3y,
      'aum_eur', v_row.aum_eur, 'morningstar_rating', v_row.morningstar_rating
    )
    ||
    jsonb_build_object(
      'inception_date', v_row.inception_date, 'track_record_years', v_row.track_record_years,
      'pea_eligible', v_row.pea_eligible, 'per_eligible', v_row.per_eligible,
      'av_lux_eligible', v_row.av_lux_eligible, 'ucits_compliant', v_row.ucits_compliant,
      'is_institutional', v_row.is_institutional,
      'accessible_retail', CASE WHEN v_row.is_institutional IS FALSE OR v_row.is_institutional IS NULL THEN true ELSE false END,
      'hedged', v_row.hedged, 'distributor_france', v_row.distributor_france,
      'min_subscription_eur', v_row.min_subscription_eur, 'labels', v_row.labels,
      'kid_url', v_row.kid_url, 'kid_parsed_at', v_row.kid_parsed_at,
      'share_class_group_id', v_row.share_class_group_id, 'field_sources', v_row.field_sources,
      'data_source', v_row.data_source, 'data_completeness', v_row.data_completeness,
      'created_at', v_row.created_at, 'updated_at', v_row.updated_at,
      'allocation_profile', v_row.allocation_profile,
      'ter_percentile_in_category', v_ter_pctile,
      'perf3y_percentile_in_category', v_perf3y_pctile,
      'peer_count_in_category', v_peer_count
    );
END;
$function$;
