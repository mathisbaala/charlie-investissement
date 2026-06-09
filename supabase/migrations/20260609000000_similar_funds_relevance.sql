-- get_similar_funds : améliorer la PERTINENCE pour les fonds larges.
--
-- Problème observé (ex. Vanguard FTSE All-World, ETF actions monde large) :
-- les « fonds similaires » remontaient des ETF thématiques sans rapport
-- (Sprott Uranium Miners, L&G Cyber Security, MSCI World Communication
-- Services). Cause : après les égalités SFDR/région/SRI, le tie-break final
-- était performance_3y DESC, qui fait remonter les thématiques les plus
-- chaudes du moment plutôt que les pairs « marché large ».
--
-- Correctifs :
--   1. Nouveaux axes de similarité : classe d'actif (asset_class_broad),
--      style de gestion (passif/actif), et ALIGNEMENT SECTORIEL — un fonds
--      large (sector NULL) ne ressemble pas à un fonds thématique (sector
--      renseigné), et inversement. `sector IS NOT DISTINCT FROM` récompense
--      broad↔broad et thème↔même-thème, pénalise broad↔thème.
--   2. Tie-break : on remplace performance_3y (qui faisait remonter les niches
--      les plus chaudes) par l'encours (AUM) — à similarité égale, on propose
--      d'abord les pairs phares reconnaissables plutôt que des fonds obscurs.
CREATE OR REPLACE FUNCTION public.get_similar_funds(p_isin text, p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_product_type text; v_category_normalized text; v_region_normalized text;
  v_asset_class_broad text; v_sector text; v_management_style text;
  v_sfdr_article smallint; v_sri smallint; v_ter numeric; v_results jsonb;
BEGIN
  SELECT product_type, category_normalized, region_normalized, asset_class_broad,
         sector, management_style, sfdr_article, sri, ter
  INTO v_product_type, v_category_normalized, v_region_normalized, v_asset_class_broad,
       v_sector, v_management_style, v_sfdr_article, v_sri, v_ter
  FROM investissement_funds WHERE isin = p_isin;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;

  -- Requête primaire : même type de produit ET même catégorie normalisée.
  SELECT jsonb_agg(row_to_json(r)) INTO v_results
  FROM (
    SELECT isin, name, management_company_normalized AS gestionnaire, product_type,
      category_normalized, region_normalized, sfdr_article, sri AS risk_score,
      ter, performance_1y, inv_annualize_pt(performance_3y, 3, product_type) AS performance_3y,
      morningstar_rating, retrocession_cgp, data_completeness,
      (CASE WHEN asset_class_broad = v_asset_class_broad THEN 2 ELSE 0 END +
       CASE WHEN sfdr_article = v_sfdr_article THEN 2 ELSE 0 END +
       CASE WHEN region_normalized = v_region_normalized THEN 1 ELSE 0 END +
       -- Proximité de risque : même SRI ±1 = très similaire (poids fort).
       CASE WHEN v_sri IS NOT NULL AND sri IS NOT NULL AND ABS(sri - v_sri) <= 1 THEN 3
            WHEN v_sri IS NOT NULL AND sri IS NOT NULL AND ABS(sri - v_sri) = 2 THEN 1
            ELSE 0 END +
       -- Même style de gestion (un ETF indiciel ressemble à un ETF indiciel).
       CASE WHEN management_style IS NOT DISTINCT FROM v_management_style THEN 1 ELSE 0 END +
       -- Alignement sectoriel : broad↔broad (tous deux NULL) ou même thème.
       CASE WHEN sector IS NOT DISTINCT FROM v_sector THEN 2 ELSE 0 END) AS similarity_score
    FROM investissement_funds
    WHERE isin <> p_isin AND product_type = v_product_type
      AND category_normalized = v_category_normalized AND data_completeness >= 60
    ORDER BY similarity_score DESC,
      ABS(COALESCE(sri, 99) - COALESCE(v_sri, sri, 99)) ASC,
      aum_eur DESC NULLS LAST, data_completeness DESC
    LIMIT p_limit
  ) r;

  -- Repli : élargir à (catégorie OU région) si pas assez de résultats.
  IF v_results IS NULL OR jsonb_array_length(v_results) < p_limit THEN
    SELECT jsonb_agg(row_to_json(r)) INTO v_results
    FROM (
      SELECT isin, name, management_company_normalized AS gestionnaire, product_type,
        category_normalized, region_normalized, sfdr_article, sri AS risk_score,
        ter, performance_1y, inv_annualize_pt(performance_3y, 3, product_type) AS performance_3y,
        morningstar_rating, retrocession_cgp, data_completeness,
        CASE WHEN category_normalized = v_category_normalized THEN 3 ELSE 0 END +
        CASE WHEN asset_class_broad = v_asset_class_broad THEN 2 ELSE 0 END +
        CASE WHEN sfdr_article = v_sfdr_article THEN 2 ELSE 0 END +
        CASE WHEN region_normalized = v_region_normalized THEN 1 ELSE 0 END +
        CASE WHEN v_sri IS NOT NULL AND sri IS NOT NULL AND ABS(sri - v_sri) <= 1 THEN 3
             WHEN v_sri IS NOT NULL AND sri IS NOT NULL AND ABS(sri - v_sri) = 2 THEN 1
             ELSE 0 END +
        CASE WHEN management_style IS NOT DISTINCT FROM v_management_style THEN 1 ELSE 0 END +
        CASE WHEN sector IS NOT DISTINCT FROM v_sector THEN 2 ELSE 0 END AS similarity_score
      FROM investissement_funds
      WHERE isin <> p_isin AND product_type = v_product_type
        AND (category_normalized = v_category_normalized OR region_normalized = v_region_normalized)
        AND data_completeness >= 60
      ORDER BY similarity_score DESC,
        ABS(COALESCE(sri, 99) - COALESCE(v_sri, sri, 99)) ASC,
        ABS(COALESCE(ter, 9) - COALESCE(v_ter, ter, 9)) ASC,
        data_completeness DESC, aum_eur DESC NULLS LAST
      LIMIT p_limit
    ) r;
  END IF;
  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$function$;
