-- ============================================================================
-- get_contract_overview(p_key) — fiche-contrat pour l'onglet Assurance vie
-- ----------------------------------------------------------------------------
-- L'onglet /assureurs ne redirige plus vers le screener : un clic sur un contrat
-- ouvre une FICHE. Cette RPC agrège, pour une clé de contrat "Assureur::Contrat"
-- (le repr_key d'un groupe de variantes au même jeu de fonds), tout ce qu'on
-- peut dire HONNÊTEMENT du contrat à partir des données réelles en base :
--   • enveloppe(s), statut commercial, variantes (repris de la matview de groupe) ;
--   • nombre de supports (UC) référencés ;
--   • frais courants MOYENS des supports (fraction — converti en % côté API/UI) ;
--   • répartition des supports par classe d'actifs, par zone, par gestionnaire ;
--   • histogramme SRI des supports.
-- Les CONDITIONS du contrat lui-même (frais de gestion/versement/arbitrage, taux
-- du fonds euros, options) NE SONT PAS en base — la fiche les affiche « à venir ».
--
-- Mêmes conventions que get_contracts_list (SECURITY DEFINER, search_path figé),
-- et mêmes garde-fous de visibilité que le screener :
--   is_primary_share_class AND data_completeness >= 50 AND contracts @> [p_key].
-- Les frais/SRI/zone viennent de la vue investissement_funds_cgp_ref (colonnes
-- risk_score = SRI, ongoing_charges/ter = fraction).
--
-- Grants : le hardening anti-scraping a révoqué anon/PUBLIC sur les fonctions et
-- l'app parle en service_role. On réplique : REVOKE PUBLIC/anon, GRANT service_role
-- (sinon le default-privilege re-grant ré-exposerait la fonction à anon).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_contract_overview(p_key text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH supports AS (
    SELECT v.isin, v.asset_class_broad, v.region_normalized,
           v.risk_score, v.gestionnaire,
           COALESCE(v.ongoing_charges, v.ter) AS fee
    FROM investissement_funds_cgp_ref v
    WHERE v.is_primary_share_class
      AND v.data_completeness >= 50
      AND v.contracts @> ARRAY[p_key]
  ),
  -- Groupe (enveloppe/statut/variantes) contenant cette clé de contrat.
  grp AS (
    SELECT g.company, g.repr_key, g.repr_contract, g.group_key
    FROM investissement_contract_groups_mv g
    WHERE g.key = p_key
    LIMIT 1
  ),
  grp_agg AS (
    SELECT gg.company,
           gg.repr_contract AS contract,
           to_jsonb(array_agg(DISTINCT g2.contract_type ORDER BY g2.contract_type)) AS types,
           bool_and(g2.closed) AS closed,
           COALESCE(
             jsonb_agg(jsonb_build_object('contract', g2.contract, 'key', g2.key)
                       ORDER BY g2.contract) FILTER (WHERE g2.key <> gg.repr_key),
             '[]'::jsonb
           ) AS variants
    FROM grp gg
    JOIN investissement_contract_groups_mv g2 ON g2.group_key = gg.group_key
    GROUP BY gg.company, gg.repr_contract
  )
  SELECT jsonb_build_object(
    'key',      p_key,
    'company',  COALESCE((SELECT company  FROM grp_agg), split_part(p_key, '::', 1)),
    'contract', COALESCE((SELECT contract FROM grp_agg), substr(p_key, position('::' in p_key) + 2)),
    'types',    COALESCE((SELECT types    FROM grp_agg), '["av"]'::jsonb),
    'closed',   COALESCE((SELECT closed   FROM grp_agg), false),
    'variants', COALESCE((SELECT variants FROM grp_agg), '[]'::jsonb),
    'funds',    (SELECT count(*) FROM supports),
    'avg_fee',  (SELECT avg(fee) FROM supports WHERE fee IS NOT NULL),
    'classes',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'n', n) ORDER BY n DESC, label), '[]'::jsonb)
                 FROM (SELECT COALESCE(asset_class_broad, 'non classé') AS label, count(*) AS n
                       FROM supports GROUP BY 1 ORDER BY n DESC LIMIT 8) x),
    'regions',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'n', n) ORDER BY n DESC, label), '[]'::jsonb)
                 FROM (SELECT region_normalized AS label, count(*) AS n
                       FROM supports WHERE region_normalized IS NOT NULL AND region_normalized <> ''
                       GROUP BY 1 ORDER BY n DESC LIMIT 8) x),
    'managers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'n', n) ORDER BY n DESC, label), '[]'::jsonb)
                 FROM (SELECT gestionnaire AS label, count(*) AS n
                       FROM supports WHERE gestionnaire IS NOT NULL AND gestionnaire <> ''
                       GROUP BY 1 ORDER BY n DESC LIMIT 6) x),
    'sri',      (SELECT COALESCE(jsonb_object_agg(risk_score::text, n), '{}'::jsonb)
                 FROM (SELECT risk_score, count(*) AS n
                       FROM supports WHERE risk_score IS NOT NULL GROUP BY 1) x)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_contract_overview(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_contract_overview(text) TO service_role;

COMMIT;
