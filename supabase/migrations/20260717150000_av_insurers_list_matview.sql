-- Perf onglet « Partenaires » (/assureurs) : get_insurers_list() recalculait la vue
-- investissement_funds_cgp_ref (unnest des insurers + agrégation) à CHAQUE appel = 8 s,
-- sur le chemin chaud de la page. get_contracts_list ne prend que 56 ms car il lit une
-- matview. On applique le même traitement : précalcul dans une matview rafraîchie par
-- l'orchestration existante inv_refresh_fund_insurers_mv(). Résultat : 8 016 ms -> ~4 ms.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.investissement_insurers_list_mv AS
  SELECT u AS company, count(*)::int AS funds
  FROM investissement_funds_cgp_ref v, unnest(v.insurers) AS u
  WHERE v.is_primary_share_class
    AND (v.data_completeness >= 50 OR v.performance_1y IS NOT NULL)
    AND v.product_type NOT IN ('action','crypto','fps','structuré','fcpr','fcpi','fip','fpci')
  GROUP BY u;

CREATE UNIQUE INDEX IF NOT EXISTS i_insurers_list_mv_company
  ON public.investissement_insurers_list_mv (company);

-- Sécurité : aucun accès direct anon/authenticated (aligné anti-scraping ;
-- la fonction SECURITY DEFINER lit la matview en tant que propriétaire).
REVOKE ALL ON public.investissement_insurers_list_mv FROM anon, authenticated, PUBLIC;

-- La fonction lit désormais la matview (rapide), même sortie jsonb qu'avant.
CREATE OR REPLACE FUNCTION public.get_insurers_list()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('company', company, 'funds', funds) ORDER BY funds DESC),
    '[]'::jsonb)
  FROM investissement_insurers_list_mv;
$function$;

-- Ré-assertion des grants (gotcha : recréation de RPC peut réintroduire EXECUTE à PUBLIC).
REVOKE EXECUTE ON FUNCTION public.get_insurers_list() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_insurers_list() TO service_role;

-- Branche le refresh de la nouvelle matview dans l'orchestration existante,
-- après fund_insurers_mv (dont dépend la vue cgp_ref) et contract_groups_mv.
CREATE OR REPLACE FUNCTION public.inv_refresh_fund_insurers_mv()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
 SET statement_timeout TO '600000'
AS $function$
BEGIN
  -- 1. Référencement par fonds (propagé au groupe de share-class).
  REFRESH MATERIALIZED VIEW investissement_fund_insurers_mv;
  -- 2. Regroupement des contrats au jeu de fonds identique (dépend de 1 via la
  --    vue investissement_funds_cgp_ref). Doit suivre fund_insurers_mv.
  REFRESH MATERIALIZED VIEW investissement_contract_groups_mv;
  -- 3. Liste des assureurs + compteurs (dépend aussi de cgp_ref). Sert get_insurers_list().
  REFRESH MATERIALIZED VIEW investissement_insurers_list_mv;
END;
$function$;
