-- get_similar_funds : rendre la similarité sensible au RISQUE (SRI).
--
-- Avant : tri par catégorie/région puis performance_3y DESC. Pour un fonds
-- prudent catégorisé "Actions/world" (ex. iShares Conservative Portfolio,
-- SRI 3, vol 3,9%), la fonction remontait les ETF les plus performants de la
-- même catégorie (gold miners +42%, SRI 6) — incohérent et risqué côté
-- adéquation/conseil. Désormais la proximité de SRI est une dimension de
-- similarité de premier plan et sert de tie-break avant la performance.
CREATE OR REPLACE FUNCTION public.get_similar_funds(p_isin text, p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_product_type text; v_category_normalized text; v_region_normalized text;
  v_sfdr_article smallint; v_sri smallint; v_results jsonb;
BEGIN
  SELECT product_type, category_normalized, region_normalized, sfdr_article, sri
  INTO v_product_type, v_category_normalized, v_region_normalized, v_sfdr_article, v_sri
  FROM investissement_funds WHERE isin = p_isin;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  SELECT jsonb_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT isin, name, management_company_normalized AS gestionnaire, product_type,
      category_normalized, region_normalized, sfdr_article, sri AS risk_score,
      ter, performance_1y, inv_annualize_pt(performance_3y, 3, product_type) AS performance_3y,
      morningstar_rating, retrocession_cgp, data_completeness,
      (CASE WHEN sfdr_article = v_sfdr_article THEN 2 ELSE 0 END +
       CASE WHEN region_normalized = v_region_normalized THEN 1 ELSE 0 END +
       -- Proximité de risque : même SRI ±1 = très similaire (poids fort).
       CASE WHEN v_sri IS NOT NULL AND sri IS NOT NULL AND ABS(sri - v_sri) <= 1 THEN 3
            WHEN v_sri IS NOT NULL AND sri IS NOT NULL AND ABS(sri - v_sri) = 2 THEN 1
            ELSE 0 END) AS similarity_score
    FROM investissement_funds
    WHERE isin <> p_isin AND product_type = v_product_type
      AND category_normalized = v_category_normalized AND data_completeness >= 60
    ORDER BY similarity_score DESC,
      ABS(COALESCE(sri, 99) - COALESCE(v_sri, sri, 99)) ASC,
      data_completeness DESC, performance_3y DESC NULLS LAST
    LIMIT p_limit
  ) r;

  IF v_results IS NULL OR jsonb_array_length(v_results) < p_limit THEN
    SELECT jsonb_agg(row_to_json(r)) INTO v_results
    FROM (
      SELECT isin, name, management_company_normalized AS gestionnaire, product_type,
        category_normalized, region_normalized, sfdr_article, sri AS risk_score,
        ter, performance_1y, inv_annualize_pt(performance_3y, 3, product_type) AS performance_3y,
        morningstar_rating, retrocession_cgp, data_completeness,
        CASE WHEN category_normalized = v_category_normalized THEN 3 ELSE 0 END +
        CASE WHEN sfdr_article = v_sfdr_article THEN 2 ELSE 0 END +
        CASE WHEN region_normalized = v_region_normalized THEN 1 ELSE 0 END +
        CASE WHEN v_sri IS NOT NULL AND sri IS NOT NULL AND ABS(sri - v_sri) <= 1 THEN 3
             WHEN v_sri IS NOT NULL AND sri IS NOT NULL AND ABS(sri - v_sri) = 2 THEN 1
             ELSE 0 END AS similarity_score
      FROM investissement_funds
      WHERE isin <> p_isin AND product_type = v_product_type
        AND (category_normalized = v_category_normalized OR region_normalized = v_region_normalized)
        AND data_completeness >= 60
      ORDER BY similarity_score DESC,
        ABS(COALESCE(sri, 99) - COALESCE(v_sri, sri, 99)) ASC,
        data_completeness DESC, performance_3y DESC NULLS LAST
      LIMIT p_limit
    ) r;
  END IF;
  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$function$;
