-- ============================================================================
-- RPC de refresh de la matview de référencement assureur
-- ----------------------------------------------------------------------------
-- La matview investissement_fund_insurers_mv doit être rafraîchie après :
--   • un run de scraper d'éligibilité (nouvelles lignes av_lux_eligibility) ;
--   • tout pipeline qui modifie share_class_group_id / is_primary_share_class /
--     data_completeness (la MV propage le référencement au groupe et n'est lue
--     que sur la primaire — cf. 20260611200000).
-- Jusqu'ici manuel (simple rappel imprimé par un scraper) → risque de
-- référencement périmé. On expose un RPC appelable par le service-role, sur le
-- modèle de inv_refresh_primary_share_class(), pour le câbler dans les pipelines
-- planifiés et les scrapers.
--
-- ⚠ REFRESH ... CONCURRENTLY est interdit dans une fonction/bloc transactionnel ;
--   on fait donc un REFRESH simple (verrou AccessExclusive bref — la MV est
--   petite, ~11k lignes, et les pipelines tournent hors-pointe). Pour un refresh
--   non bloquant ponctuel, lancer manuellement
--   `REFRESH MATERIALIZED VIEW CONCURRENTLY investissement_fund_insurers_mv;`
--   (l'index unique i_fund_insurers_mv_isin le permet).
-- ============================================================================

-- ⚠ statement_timeout au niveau fonction : le REFRESH complet (~13 s) dépasse le
--   statement_timeout court imposé par PostgREST aux rôles API ; sans ce SET,
--   l'appel RPC échoue en 57014 (canceling statement due to statement timeout).
CREATE OR REPLACE FUNCTION public.inv_refresh_fund_insurers_mv()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
 SET statement_timeout TO '600000'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW investissement_fund_insurers_mv;
END;
$function$;

REVOKE ALL    ON FUNCTION public.inv_refresh_fund_insurers_mv() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.inv_refresh_fund_insurers_mv() TO service_role;
