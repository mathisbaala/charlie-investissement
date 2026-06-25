-- 20260625210000_relax_referenced_fund_visibility.sql
-- Chantier Référencement assureur (Partie 1) — recalibrage de la visibilité.
--
-- Problème : le mapping support×assureur×contrat est riche (259k liens / 11k UC /
-- 39 assureurs / 500 contrats) mais ~5 400 fonds RÉFÉRENCÉS ayant une performance
-- restaient CACHÉS du parcours CGP, parce que le plancher `data_completeness >= 50`
-- les écartait. Effet : AXA France 139 supports affichés vs 1 690 UC réelles ; BNP
-- Cardif 409 vs 5 555. Le CGP voyait ~8 % de l'offre réelle d'un assureur.
--
-- Décision (marketplace, cadrage [[portfolio-chantier-direction]]) : sous un filtre
-- assureur/contrat, un fonds référencé AYANT une perf est visible même sous le
-- plancher. On ne restreint jamais l'univers, on n'affiche aucune lacune ; on
-- relâche UNIQUEMENT le plancher de complétude, et SEULEMENT pour des fonds déjà
-- référencés (donc avec un nom + une perf — vérifié 0 coquille, 0 fonds sans nom).
--
-- Côté API : `app/src/app/api/funds/route.ts` applique le même relâchement
-- (`data_completeness >= floor OR performance_1y IS NOT NULL`) quand un filtre
-- insurer/contract est actif. Cette migration aligne les DEUX compteurs lus par
-- l'UI (carte /assureurs) pour garder l'invariant carte == total du screener.
-- La navigation neutre (sans filtre assureur) reste STRICTE (plancher dur 50).

-- ─── 1. get_insurers_list : relâche le plancher (référencé + perf) ──────────────
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
      AND v.product_type NOT IN ('action', 'crypto', 'fps', 'structuré')
    GROUP BY u
  ) t;
$function$;

-- ─── 2. investissement_contract_groups_mv : même relâchement dans le WHERE ──────
-- Une matview ne se redéfinit pas par CREATE OR REPLACE → DROP + CREATE. Structure
-- de colonnes IDENTIQUE (seul le WHERE de `cf` se relâche). Pas d'index ni de grant
-- explicite à restaurer (accès via get_contracts_list SECURITY DEFINER). Le RPC
-- inv_refresh_fund_insurers_mv() la rafraîchit ensuite par son nom (inchangé).
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
      AND (v.product_type <> ALL (ARRAY['action'::text, 'crypto'::text, 'fps'::text]))
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

-- Durcissement sécu (cf. [[supabase-security-hardening]]) : la MV n'est lue que via
-- get_contracts_list (SECURITY DEFINER). Pas d'accès direct anon/authenticated.
REVOKE ALL ON investissement_contract_groups_mv FROM anon, authenticated;
