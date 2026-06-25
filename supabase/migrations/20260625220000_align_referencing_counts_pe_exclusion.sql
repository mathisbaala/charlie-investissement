-- 20260625220000_align_referencing_counts_pe_exclusion.sql
-- Chantier Référencement assureur (Partie 1) — précision carte == total.
--
-- Les compteurs assureur/contrat et le screener par défaut excluaient des listes
-- de product_type DIFFÉRENTES → écart résiduel carte vs total :
--   • screener /api/funds défaut : exclut action,crypto,fps,structuré,fcpr,fcpi,fip,fpci (8)
--   • get_insurers_list          : excluait action,crypto,fps,structuré (4) → +PE comptés
--   • contract_groups_mv         : excluait action,crypto,fps (3) → +structuré +PE comptés
-- Ex. AXA France : carte 873 vs total screener 869 (= 4 FCPR référencés comptés
-- par la carte mais hors univers curé par défaut).
--
-- Fix : aligner les DEUX compteurs sur la liste EXACTE du screener par défaut (8
-- types). Le Private Equity et les structurés restent opt-in (universe explicite),
-- jamais dans le compteur par défaut → carte == total exact côté assureur ET contrat.

-- ─── get_insurers_list : exclusion alignée (8 types) ───────────────────────────
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
    WHERE v.is_primary_share_class
      AND (v.data_completeness >= 50 OR v.performance_1y IS NOT NULL)
      AND v.product_type NOT IN ('action', 'crypto', 'fps', 'structuré', 'fcpr', 'fcpi', 'fip', 'fpci')
    GROUP BY u
  ) t;
$function$;

-- ─── contract_groups_mv : exclusion alignée (8 types) ──────────────────────────
DROP MATERIALIZED VIEW IF EXISTS investissement_contract_groups_mv;
CREATE MATERIALIZED VIEW investissement_contract_groups_mv AS
  WITH cf AS (
    SELECT u.u AS key,
           split_part(u.u, '::'::text, 1) AS company,
           v.isin
    FROM investissement_funds_cgp_ref v,
         LATERAL unnest(v.contracts) u(u)
    WHERE v.is_primary_share_class
      AND (v.data_completeness >= 50 OR v.performance_1y IS NOT NULL)
      AND v.product_type NOT IN ('action', 'crypto', 'fps', 'structuré', 'fcpr', 'fcpi', 'fip', 'fpci')
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

REVOKE ALL ON investissement_contract_groups_mv FROM anon, authenticated;
