-- Top performers — retrait de `average_performance`
-- ============================================================================
-- `average_performance` est la moyenne arithmétique de performance_1y/3y/5y,
-- or 3y/5y sont stockés en CUMULÉ (non annualisé) : on moyennait une perf 1 an
-- avec des cumulés 3 et 5 ans → valeurs absurdes (~1946 % pour un titre très
-- performant). Le champ n'est plus affiché nulle part (cf. KpiStrip) ; on le
-- retire ici de la RPC : il n'apparaît plus dans le payload, ni comme critère
-- de tri (la route /api/screener/top-performers ne l'accepte plus non plus).
--
-- On recrée la fonction à l'identique de 20260611110000, à la seule différence
-- de la colonne `average_performance` (SELECT) et des branches `p_sort_by`
-- correspondantes. La colonne reste en base (non droppée) pour ne rien casser.

CREATE OR REPLACE FUNCTION public.get_top_performers(
  p_product_type   text    DEFAULT NULL,
  p_category       text    DEFAULT NULL,
  p_region         text    DEFAULT NULL,
  p_sort_by        text    DEFAULT 'performance_3y',
  p_limit          integer DEFAULT 10,
  p_min_completeness integer DEFAULT 70,
  p_min_aum        bigint  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT jsonb_agg(row_to_json(t))
  FROM (
    SELECT
      isin, name, product_type, asset_class, category_normalized, region_normalized,
      management_company_normalized AS gestionnaire,
      ter, ongoing_charges,
      performance_1y,
      inv_annualize_pt(performance_3y, 3, product_type) AS performance_3y,
      inv_annualize_pt(performance_5y, 5, product_type) AS performance_5y,
      volatility_1y, sharpe_3y, aum_eur, morningstar_rating,
      sfdr_article, sri AS risk_score, labels,
      pea_eligible, per_eligible, av_lux_eligible,
      data_completeness, kid_url, inception_date, track_record_years
    FROM investissement_funds
    WHERE
      (p_product_type IS NULL OR product_type = p_product_type)
      AND (p_category IS NULL OR category_normalized = p_category)
      AND (p_region IS NULL OR region_normalized = p_region)
      AND is_institutional IS NOT TRUE
      AND data_completeness >= p_min_completeness
      AND (p_min_aum IS NULL OR aum_eur >= p_min_aum)
      -- Plafond de plausibilité réservé aux véhicules diversifiés ;
      -- les titres vifs et la crypto atteignent légitimement ces niveaux.
      AND (performance_3y IS NULL
           OR product_type IN ('action', 'crypto')
           OR performance_3y <= 150)
      AND CASE p_sort_by
            WHEN 'performance_3y' THEN performance_3y IS NOT NULL
            WHEN 'performance_1y' THEN performance_1y IS NOT NULL
            WHEN 'sharpe_3y' THEN sharpe_3y IS NOT NULL
            WHEN 'aum_eur' THEN aum_eur IS NOT NULL
            ELSE TRUE
          END
    ORDER BY
      CASE p_sort_by
        WHEN 'performance_3y' THEN investissement_funds.performance_3y
        WHEN 'performance_1y' THEN investissement_funds.performance_1y
        WHEN 'sharpe_3y' THEN sharpe_3y
        WHEN 'aum_eur' THEN aum_eur::numeric
        ELSE data_completeness::numeric
      END DESC NULLS LAST
    LIMIT LEAST(p_limit, 50)
  ) t;
$function$;
