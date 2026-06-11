-- ============================================================================
-- Type de contrat structuré (#5) + drapeau « fermé à la commercialisation » (#4)
-- ----------------------------------------------------------------------------
-- Le type d'enveloppe et le statut commercial sont noyés dans le libellé du
-- contrat (« (Assurance Vie) », « (Plan Epargne Retraite) », « Capitalisation »,
-- « (fermé à la commercialisation) »…). On les dérive du nom dans la matview de
-- regroupement, puis get_contracts_list les agrège PAR GROUPE :
--   • types[]  = ensemble des types des variantes (un groupe au jeu de fonds
--                identique peut couvrir AV + Capi + PER + PEA) ;
--   • closed   = bool_and(closed) → vrai seulement si TOUTES les variantes sont
--                fermées (si une variante reste ouverte, l'offre est dispo).
--
-- Heuristique de type (précédence PEA > PER > PEP > Capi > AV par défaut, le
-- domaine étant l'assurance vie / capitalisation). Couverture mesurée :
-- av 186, capi 103, per 34, pea 20, pep 1. Représentant du groupe = ouvert
-- d'abord, puis type le plus « de base » (AV), puis nom le plus court.
--
-- Étend la matview de 20260611260000 (mêmes index/grants). get_contracts_list
-- gagne les champs `types`/`closed` (rétro-compatible).
-- ============================================================================

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS investissement_contract_groups_mv;

CREATE MATERIALIZED VIEW investissement_contract_groups_mv AS
WITH cf AS (
  SELECT u AS key, split_part(u, '::', 1) AS company, v.isin
  FROM investissement_funds_cgp_ref v, unnest(v.contracts) u
  WHERE v.is_primary_share_class AND v.data_completeness >= 50
),
per_contract AS (
  SELECT key, company,
         substr(key, position('::' in key) + 2)        AS contract,
         count(*)                                       AS funds,
         md5(string_agg(isin, ',' ORDER BY isin))       AS set_hash
  FROM cf GROUP BY key, company
),
typed AS (
  SELECT *,
    (contract ~* 'fermé|closed') AS closed,
    CASE
      WHEN contract ~* 'plan d.epargne en actions|\mpea\M'            THEN 'pea'
      WHEN contract ~* 'retraite|\mper\M|perin|\mpero\M|perp|madelin' THEN 'per'
      WHEN contract ~* '\mpep\M|plan d.epargne populaire'            THEN 'pep'
      WHEN contract ~* 'capitalisation|\mcapi'                       THEN 'capi'
      ELSE 'av'
    END AS contract_type
  FROM per_contract
)
SELECT
  key, company, contract, funds, closed, contract_type,
  company || '::' || set_hash                            AS group_key,
  first_value(key)      OVER w                           AS repr_key,
  first_value(contract) OVER w                           AS repr_contract,
  (row_number() OVER w = 1)                              AS is_representative
FROM typed
WINDOW w AS (
  PARTITION BY company, set_hash
  ORDER BY closed,
    CASE contract_type WHEN 'av' THEN 0 WHEN 'capi' THEN 1 WHEN 'per' THEN 2 WHEN 'pea' THEN 3 ELSE 4 END,
    length(contract), contract
);

CREATE UNIQUE INDEX i_contract_groups_mv_key   ON investissement_contract_groups_mv (key);
CREATE INDEX        i_contract_groups_mv_group ON investissement_contract_groups_mv (group_key);
REVOKE ALL ON investissement_contract_groups_mv FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_contracts_list()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'company',    company,
      'contract',   repr_contract,
      'key',        repr_key,
      'funds',      funds,
      'group_size', group_size,
      'types',      types,
      'closed',     closed,
      'variants',   variants
    ) ORDER BY closed, company, funds DESC
  ), '[]'::jsonb)
  FROM (
    SELECT company, group_key, repr_key, repr_contract,
           max(funds)       AS funds,
           count(*)         AS group_size,
           bool_and(closed) AS closed,
           to_jsonb(array_agg(DISTINCT contract_type ORDER BY contract_type)) AS types,
           COALESCE(
             jsonb_agg(jsonb_build_object('contract', contract, 'key', key)
                       ORDER BY contract) FILTER (WHERE NOT is_representative),
             '[]'::jsonb
           ) AS variants
    FROM investissement_contract_groups_mv
    GROUP BY company, group_key, repr_key, repr_contract
  ) t;
$function$;

COMMIT;
