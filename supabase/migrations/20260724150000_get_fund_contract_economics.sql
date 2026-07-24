-- ============================================================================
-- Fiche fonds : économie par contrat (« combien ça coûte chez qui »)
-- ----------------------------------------------------------------------------
-- La fiche fonds listait déjà les contrats/assureurs où le fonds est référencé
-- (get_fund_insurers) mais sans jamais afficher les FRAIS D'ENVELOPPE propres à
-- chaque contrat — pourtant déjà en base dans investissement_av_contract_terms.
-- Résultat : impossible de lire « ce support coûte X chez tel assureur, Y chez
-- tel autre » sans quitter la fiche.
--
-- get_fund_contract_economics part du même référencement propagé au groupe de
-- share-class (investissement_funds_cgp_ref.contracts) et attache, pour chaque
-- clé « Assureur::Contrat », les frais du contrat.
--
-- Résolution des frais en DEUX temps, pour maximiser la couverture sans jamais
-- inventer de donnée :
--   1. frais renseignés SUR la clé exacte (te) ;
--   2. sinon, frais du contrat REPRÉSENTATIF de son groupe (tg via
--      investissement_contract_groups_mv.repr_key). Les variantes d'un même
--      groupe (Capitalisation / PM / PER / Retraite d'un contrat) partagent par
--      construction la même grille de frais de gestion et d'entrée — c'est la
--      définition même du groupe. Récupère ~127 contrats référencés de plus.
-- On ne renvoie QUE les contrats effectivement chiffrés (gestion UC ou entrée) ;
-- les autres restent en simple libellé dans la carte.
--
-- SECURITY DEFINER + search_path figé, aligné sur get_fund_insurers.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_fund_contract_economics(p_isin text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH ref AS (
    SELECT contracts
    FROM investissement_funds_cgp_ref
    WHERE isin = p_isin
    LIMIT 1
  ),
  keys AS (
    SELECT DISTINCT u AS key,
           split_part(u, '::', 1)             AS company,
           substr(u, position('::' in u) + 2) AS contract
    FROM ref, unnest(contracts) AS u
  ),
  resolved AS (
    SELECT
      k.key, k.company, k.contract,
      COALESCE(te.frais_entree_pct,              tg.frais_entree_pct)              AS frais_entree_pct,
      COALESCE(te.frais_gestion_uc_pct,          tg.frais_gestion_uc_pct)          AS frais_gestion_uc_pct,
      COALESCE(te.frais_gestion_fonds_euros_pct, tg.frais_gestion_fonds_euros_pct) AS frais_gestion_fonds_euros_pct,
      COALESCE(te.frais_arbitrage_pct,           tg.frais_arbitrage_pct)           AS frais_arbitrage_pct,
      COALESCE(te.confidence,                    tg.confidence)                    AS confidence
    FROM keys k
    LEFT JOIN investissement_av_contract_terms te
      ON te.key = k.key
     AND (te.frais_gestion_uc_pct IS NOT NULL OR te.frais_entree_pct IS NOT NULL)
    LEFT JOIN investissement_contract_groups_mv g
      ON g.key = k.key
    LEFT JOIN investissement_av_contract_terms tg
      ON tg.key = g.repr_key
     AND (tg.frais_gestion_uc_pct IS NOT NULL OR tg.frais_entree_pct IS NOT NULL)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'key',                           key,
        'company',                       company,
        'contract',                      contract,
        'frais_entree_pct',              frais_entree_pct,
        'frais_gestion_uc_pct',          frais_gestion_uc_pct,
        'frais_gestion_fonds_euros_pct', frais_gestion_fonds_euros_pct,
        'frais_arbitrage_pct',           frais_arbitrage_pct,
        'confidence',                    confidence
      )
      ORDER BY company, contract
    ),
    '[]'::jsonb
  )
  FROM resolved
  WHERE frais_gestion_uc_pct IS NOT NULL
     OR frais_entree_pct IS NOT NULL;
$function$;

-- Alignement des grants sur les autres RPC de la fiche fonds.
REVOKE ALL ON FUNCTION public.get_fund_contract_economics(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fund_contract_economics(text) TO anon, authenticated, service_role;
