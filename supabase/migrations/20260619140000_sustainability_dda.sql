-- ─────────────────────────────────────────────────────────────────────────────
-- sustainability_dda — Durabilité exploitable pour le DDA (sprint 2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Le recueil des préférences de durabilité (DDA / MiFID II depuis 08/2022) porte
-- sur 3 catégories : (a) % aligné taxonomie, (b) % investissement durable
-- (SFDR art. 2(17)), (c) prise en compte des PAI. La base couvre déjà bien le
-- socle (sfdr_article ~98 %, labels officiels FR ISR/Finansol) → la capacité DDA
-- est bâtie dessus immédiatement. On AJOUTE ici les colonnes des 3 catégories
-- précises, peuplées EN FOND par sfdr-enricher.py (fill-only) ; l'UI ne les
-- affiche que lorsqu'elles existent (jamais de mention de donnée manquante).
--
-- Migration légère : sfdr_article et labels sont DÉJÀ exposés par les vues cgp /
-- cgp_ref → aucune vue à recréer. On ajoute les colonnes + on étend get_fund_detail.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS taxonomy_alignment_pct     numeric(5,2),  -- % aligné taxonomie UE (0-100)
  ADD COLUMN IF NOT EXISTS sustainable_investment_pct numeric(5,2),  -- % investissement durable SFDR 2(17)
  ADD COLUMN IF NOT EXISTS pai_considered             boolean,       -- prise en compte des PAI
  ADD COLUMN IF NOT EXISTS sustainability_source      text,          -- provenance (sfdr-enricher, kid…)
  ADD COLUMN IF NOT EXISTS sustainability_computed_at timestamptz;

-- get_fund_detail : exposer SFDR (déjà présent) + les 3 catégories DDA.
CREATE OR REPLACE FUNCTION public.get_fund_detail(p_isin text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
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
      'ter', v_row.ter, 'ongoing_charges', v_row.ongoing_charges,
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
    )
    ||
    jsonb_build_object(
      'benchmark_index', v_row.benchmark_index,
      'benchmark_variant', v_row.benchmark_variant,
      'benchmark_is_category', v_row.benchmark_is_category,
      'benchmark_perf_1y', v_row.benchmark_perf_1y,
      'benchmark_perf_3y', inv_annualize_pt(v_row.benchmark_perf_3y, 3, 'opcvm'),
      'benchmark_perf_5y', inv_annualize_pt(v_row.benchmark_perf_5y, 5, 'opcvm'),
      'alpha_1y', v_row.alpha_1y, 'alpha_3y', v_row.alpha_3y, 'alpha_5y', v_row.alpha_5y,
      'taxonomy_alignment_pct', v_row.taxonomy_alignment_pct,
      'sustainable_investment_pct', v_row.sustainable_investment_pct,
      'pai_considered', v_row.pai_considered
    );
END;
$function$;
