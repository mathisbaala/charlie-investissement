-- ============================================================================
-- Repli des contrats quasi-doublons (même sélection de fonds)
-- ----------------------------------------------------------------------------
-- Un même assureur expose souvent plusieurs « contrats » au libellé différent
-- mais référençant EXACTEMENT le même jeu de fonds — wrappers juridiques (Vie /
-- Capitalisation / pers. morale / PEA) ou déclinaisons commerciales. Ex. mesuré :
-- Cardif Lux Vie 22 contrats → 7 jeux distincts ; SwissLife 51 → 32 ; Spirica
-- 42 → 26. C'est du bruit pour l'utilisateur de l'onglet Assurance vie.
--
-- On précalcule, par contrat, le hash de son jeu de fonds (ISIN des fonds
-- primaires + data_completeness>=50, soit le périmètre exactement visible au
-- screener), et le représentant de chaque groupe (company, set_hash). La RPC
-- get_contracts_list replie alors les variantes en une seule entrée.
--
-- ⚠ Le calcul (jointure complète funds + agrégation triée) coûte ~4 s : il vit
--   ici dans une MATVIEW rafraîchie hors-pointe avec investissement_fund_insurers_mv
--   (cf. RPC inv_refresh_fund_insurers_mv), PAS en direct dans la RPC de liste
--   (appelée au chargement de page). On NE fusionne PAS les contrats au jeu
--   seulement « proche » (ex. Suravenir, wrappers distributeurs différant de
--   quelques fonds) : ce sont de vraies sélections distinctes.
-- ============================================================================

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
  FROM cf
  GROUP BY key, company
)
SELECT
  p.key,
  p.company,
  p.contract,
  p.funds,
  p.company || '::' || p.set_hash                        AS group_key,
  -- Représentant déterministe : plus de fonds (égal dans un groupe), puis nom le
  -- plus court (= libellé « de base »), puis alphabétique.
  first_value(p.key)      OVER w                         AS repr_key,
  first_value(p.contract) OVER w                         AS repr_contract,
  (row_number() OVER w = 1)                              AS is_representative
FROM per_contract p
WINDOW w AS (
  PARTITION BY p.company, p.set_hash
  ORDER BY p.funds DESC, length(p.contract), p.contract
);

CREATE UNIQUE INDEX i_contract_groups_mv_key   ON investissement_contract_groups_mv (key);
CREATE INDEX        i_contract_groups_mv_group ON investissement_contract_groups_mv (group_key);

REVOKE ALL ON investissement_contract_groups_mv FROM anon, authenticated;

-- ─── get_contracts_list : replie les variantes ──────────────────────────────────
-- Une entrée par jeu de fonds (group_key), portant le contrat représentant + la
-- liste des variantes (mêmes fonds). Forme rétro-compatible (company/contract/
-- key/funds) + champs group_size et variants[]. Le filtrage screener se fait sur
-- la clé du représentant : identique aux variantes (même jeu) → sans perte.
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
      'variants',   variants
    ) ORDER BY company, funds DESC
  ), '[]'::jsonb)
  FROM (
    SELECT company, group_key, repr_key, repr_contract,
           max(funds) AS funds,
           count(*)   AS group_size,
           COALESCE(
             jsonb_agg(jsonb_build_object('contract', contract, 'key', key)
                       ORDER BY contract) FILTER (WHERE NOT is_representative),
             '[]'::jsonb
           ) AS variants
    FROM investissement_contract_groups_mv
    GROUP BY company, group_key, repr_key, repr_contract
  ) t;
$function$;

-- ─── Refresh : enchaîne les deux matviews ───────────────────────────────────────
-- contract_groups_mv dépend de investissement_funds_cgp_ref (→ fund_insurers_mv),
-- donc on rafraîchit fund_insurers_mv d'abord. Étend le RPC de 20260611250000.
CREATE OR REPLACE FUNCTION public.inv_refresh_fund_insurers_mv()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
 SET statement_timeout TO '600000'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW investissement_fund_insurers_mv;
  REFRESH MATERIALIZED VIEW investissement_contract_groups_mv;
END;
$function$;
