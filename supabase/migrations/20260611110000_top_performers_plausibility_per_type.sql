-- Top performers — borne de plausibilité par type de produit
-- ============================================================================
-- La RPC `get_top_performers` filtrait `performance_3y <= 150` (perf 3 ans
-- CUMULÉE brute, en base). Ce plafond est un garde-fou anti-aberration pensé
-- pour les véhicules diversifiés (cf. data-standards §11.18 : « performance_1y
-- > 150 % = impossible pour un indice ») : un ETF/OPCVM non-levier à +150 %
-- cumulé sur 3 ans relève quasi toujours de l'erreur de données.
--
-- Problème : la valeur AFFICHÉE est l'annualisée `inv_annualize_pt(...,3,...)`,
-- et le tri se fait sur le cumulé brut DÉCROISSANT. Pour les TITRES VIFS
-- (`action`) et la CRYPTO, +150 % cumulé sur 3 ans est parfaitement banal, si
-- bien que des milliers de lignes butent contre le plafond : le haut du
-- classement se retrouve plaqué au plafond et annualise tout à
--   (1 + 150/100)^(1/3) − 1 ≈ 35,6 %
-- → « mur » de valeurs ~35,6 % identiques, ET exclusion des vrais leaders
-- (BTC & co, valeurs de croissance) qui sont précisément les top performers.
--
-- Fix : exempter `action` et `crypto` du plafond de 150 %. Le plafond reste
-- actif pour les fonds (etf/opcvm/obligation/fonds_euros…), où il joue bien son
-- rôle de filtre d'erreurs. scpi/livret stockent un taux annuel < 150 % : la
-- borne ne les a jamais touchés.
--
-- NB : cette fonction n'avait jamais été versionnée en migration (créée à la
-- main en base) — on la recapture ici en intégralité pour mettre fin au drift.

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
      average_performance, volatility_1y, sharpe_3y, aum_eur, morningstar_rating,
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
            WHEN 'average_performance' THEN average_performance IS NOT NULL
            WHEN 'sharpe_3y' THEN sharpe_3y IS NOT NULL
            WHEN 'aum_eur' THEN aum_eur IS NOT NULL
            ELSE TRUE
          END
    ORDER BY
      CASE p_sort_by
        WHEN 'performance_3y' THEN investissement_funds.performance_3y
        WHEN 'performance_1y' THEN investissement_funds.performance_1y
        WHEN 'average_performance' THEN average_performance
        WHEN 'sharpe_3y' THEN sharpe_3y
        WHEN 'aum_eur' THEN aum_eur::numeric
        ELSE data_completeness::numeric
      END DESC NULLS LAST
    LIMIT LEAST(p_limit, 50)
  ) t;
$function$;
