-- ============================================================================
-- get_insurer_comparison(p_company) — page de comparaison des contrats d'un
-- assureur pour l'onglet Partenaires.
-- ----------------------------------------------------------------------------
-- Un clic sur un ASSUREUR (dans /assureurs) n'ouvre plus le screener filtré : il
-- ouvre une page qui COMPARE ses contrats côte à côte. Cette RPC agrège, en un
-- seul appel, les métriques comparables de CHAQUE groupe de contrats de
-- l'assureur (mêmes garde-fous de visibilité que get_contract_overview /
-- get_contracts_list) :
--   • enveloppe(s), statut, variantes (au même jeu de supports) ;
--   • nombre de supports (UC), frais courants MOYENS des supports (fraction),
--     SRI moyen, classe d'actifs dominante ;
--   • conditions propres au contrat si sourcées (frais d'entrée / gestion UC,
--     taux du fonds euros + millésime, gestion sous mandat) — meilleure ligne du
--     GROUPE dans investissement_av_contract_terms (prefer scraped, plus récent).
-- `funds_total` = union des supports référencés par l'assureur (matview de la
-- liste), pour le bouton « Voir les N supports » de l'en-tête.
--
-- Conventions identiques (SECURITY DEFINER, search_path figé, grants service_role).
-- Déjà appliquée en prod via MCP le 17/07 ; ce fichier scelle la migration dans le
-- repo (la RPC était initialement posée sans fichier de migration).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_insurer_comparison(p_company text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH groups AS (
    SELECT company, group_key, repr_key, repr_contract,
           bool_and(closed) AS closed,
           to_jsonb(array_agg(DISTINCT contract_type ORDER BY contract_type)) AS types,
           COALESCE(
             jsonb_agg(jsonb_build_object('contract', contract, 'key', key)
                       ORDER BY contract) FILTER (WHERE NOT is_representative),
             '[]'::jsonb
           ) AS variants
    FROM investissement_contract_groups_mv
    WHERE company = p_company
    GROUP BY company, group_key, repr_key, repr_contract
  ),
  agg AS (
    SELECT g.group_key, g.repr_key, g.repr_contract, g.closed, g.types, g.variants,
           s.funds, s.avg_fee, s.sri_avg, s.top_class
    FROM groups g
    JOIN LATERAL (
      SELECT count(*) AS funds,
             avg(COALESCE(v.ongoing_charges, v.ter)) AS avg_fee,
             avg(v.risk_score::numeric) AS sri_avg,
             mode() WITHIN GROUP (ORDER BY v.asset_class_broad)
               FILTER (WHERE v.asset_class_broad IS NOT NULL) AS top_class
      FROM investissement_funds_cgp_ref v
      WHERE v.contracts @> ARRAY[g.repr_key]
        AND v.is_primary_share_class AND v.data_completeness >= 50
    ) s ON true
  )
  SELECT jsonb_build_object(
    'company',     p_company,
    'funds_total', (SELECT funds FROM investissement_insurers_list_mv WHERE company = p_company),
    'contracts',   COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'key',                  a.repr_key,
          'contract',             a.repr_contract,
          'types',                a.types,
          'closed',               a.closed,
          'variants',             a.variants,
          'funds',                a.funds,
          'avg_fee',              a.avg_fee,
          'sri_avg',              a.sri_avg,
          'top_class',            a.top_class,
          'frais_entree_pct',     t.frais_entree_pct,
          'frais_gestion_uc_pct', t.frais_gestion_uc_pct,
          'fonds_euros_taux_pct', t.fonds_euros_taux_pct,
          'fonds_euros_annee',    t.fonds_euros_annee,
          'gestion_sous_mandat',  t.gestion_sous_mandat
        )
        ORDER BY a.closed, a.funds DESC
      )
      FROM agg a
      LEFT JOIN LATERAL (
        SELECT tt.frais_entree_pct, tt.frais_gestion_uc_pct, tt.fonds_euros_taux_pct,
               tt.fonds_euros_annee, tt.gestion_sous_mandat
        FROM investissement_av_contract_terms tt
        WHERE tt.key IN (
          SELECT g2.key FROM investissement_contract_groups_mv g2 WHERE g2.group_key = a.group_key
        )
        ORDER BY (tt.confidence = 'scraped') DESC, tt.as_of DESC NULLS LAST
        LIMIT 1
      ) t ON true
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_insurer_comparison(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_insurer_comparison(text) TO service_role;

COMMIT;
