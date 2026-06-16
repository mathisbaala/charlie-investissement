-- Aligne les compteurs de supports du référencement assureur sur l'univers curé
-- du screener.
--
-- Problème : get_insurers_list et la matview investissement_contract_groups_mv
-- comptaient TOUS les fonds référencés (is_primary_share_class + data_completeness
-- >= 50), alors que le screener /api/funds exclut par défaut l'univers non-collectif
-- (product_type IN ('action','crypto','fps') = titres vifs, crypto, FPS). Résultat :
-- les cartes de l'onglet « Assurances vie » sur-annonçaient l'offre (ex. AXA France
-- 1450 affichés vs 859 réellement renvoyés au clic). Vérifié au fonds près.
--
-- Fix : ajouter le même filtre product_type aux deux compteurs. Le set_hash de la
-- matview est désormais calculé sur le jeu de fonds curé (regroupement plus juste).
--
-- Révert : les définitions d'origine sont conservées ci-dessous en commentaire.
--
-- ─── get_insurers_list (origine) ─────────────────────────────────────────────
--   SELECT u AS company, count(*) AS n
--   FROM investissement_funds_cgp_ref v, unnest(v.insurers) AS u
--   WHERE v.is_primary_share_class AND v.data_completeness >= 50
--   GROUP BY u
-- ─── contract_groups_mv.cf (origine) ─────────────────────────────────────────
--   WHERE v.is_primary_share_class AND v.data_completeness >= 50
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_insurers_list()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('company', company, 'funds', n) ORDER BY n DESC), '[]'::jsonb)
  FROM (
    SELECT u AS company, count(*) AS n
    FROM investissement_funds_cgp_ref v, unnest(v.insurers) AS u
    WHERE v.is_primary_share_class AND v.data_completeness >= 50
      AND v.product_type NOT IN ('action', 'crypto', 'fps')
    GROUP BY u
  ) t;
$function$;

DROP MATERIALIZED VIEW IF EXISTS public.investissement_contract_groups_mv;

CREATE MATERIALIZED VIEW public.investissement_contract_groups_mv AS
WITH cf AS (
  SELECT u.u AS key,
         split_part(u.u, '::'::text, 1) AS company,
         v.isin
  FROM investissement_funds_cgp_ref v,
       LATERAL unnest(v.contracts) u(u)
  WHERE v.is_primary_share_class AND v.data_completeness >= 50
    AND v.product_type NOT IN ('action', 'crypto', 'fps')
), per_contract AS (
  SELECT cf.key,
         cf.company,
         substr(cf.key, POSITION(('::'::text) IN (cf.key)) + 2) AS contract,
         count(*) AS funds,
         md5(string_agg(cf.isin, ','::text ORDER BY cf.isin)) AS set_hash
  FROM cf
  GROUP BY cf.key, cf.company
), typed AS (
  SELECT per_contract.key,
         per_contract.company,
         per_contract.contract,
         per_contract.funds,
         per_contract.set_hash,
         per_contract.contract ~* 'fermé|closed'::text AS closed,
         CASE
           WHEN per_contract.contract ~* 'plan d.epargne en actions|\mpea\M'::text THEN 'pea'::text
           WHEN per_contract.contract ~* 'retraite|\mper\M|perin|\mpero\M|perp|madelin'::text THEN 'per'::text
           WHEN per_contract.contract ~* '\mpep\M|plan d.epargne populaire'::text THEN 'pep'::text
           WHEN per_contract.contract ~* 'capitalisation|\mcapi'::text THEN 'capi'::text
           ELSE 'av'::text
         END AS contract_type
  FROM per_contract
)
SELECT key,
       company,
       contract,
       funds,
       closed,
       contract_type,
       (company || '::'::text) || set_hash AS group_key,
       first_value(key) OVER w AS repr_key,
       first_value(contract) OVER w AS repr_contract,
       row_number() OVER w = 1 AS is_representative
FROM typed
WINDOW w AS (PARTITION BY company, set_hash ORDER BY closed, (
       CASE contract_type
         WHEN 'av'::text THEN 0
         WHEN 'capi'::text THEN 1
         WHEN 'per'::text THEN 2
         WHEN 'pea'::text THEN 3
         ELSE 4
       END), (length(contract)), contract);

-- Durcissement (cf. supabase-security-hardening) : pas d'accès direct anon/auth ;
-- la donnée passe par get_contracts_list (SECURITY DEFINER).
REVOKE ALL ON public.investissement_contract_groups_mv FROM anon, authenticated;
