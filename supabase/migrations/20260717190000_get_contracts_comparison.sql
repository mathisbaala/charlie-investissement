-- ============================================================================
-- get_contracts_comparison(p_keys) — comparateur TRANSVERSAL multi-assureurs.
-- ----------------------------------------------------------------------------
-- Le comparateur de la fiche assureur (get_insurer_comparison) ne compare que
-- les contrats d'UN même assureur. Le vrai besoin CGP « marketplace » est de
-- poser côte à côte des contrats de N'IMPORTE quels assureurs (ex. Linxea Spirit
-- vs Lucya Cardif vs Himalia). Cette RPC prend un tableau de clés représentatives
-- (repr_key = « Assureur::Contrat ») et retourne, pour chacune, les mêmes
-- métriques comparables que la fiche assureur, ENRICHIES du contexte assureur
-- (groupe, solidité) pour donner du sens à la mise en regard cross-assureur :
--   • enveloppe(s), statut, nombre de supports (UC) ;
--   • frais courants MOYENS des supports (fraction), SRI moyen, classe dominante ;
--   • conditions du contrat si sourcées (frais entrée/gestion UC/arbitrage, taux
--     fonds euros + millésime, gestion sous mandat, ticket) — meilleure ligne du
--     GROUPE dans investissement_av_contract_terms, préférence
--     scraped > curated > indicative puis as_of le plus récent ;
--   • solidité assureur (kind, groupe, solvabilité II, notation, PPB).
-- Le coût total de détention (supports + gestion contrat) est recomposé côté
-- front à partir de avg_fee + frais_gestion_uc_pct (helper lib/av-cost.ts).
--
-- L'ordre de sortie (ouverts d'abord, plus fournis d'abord) n'est PAS l'ordre de
-- sélection : le front réordonne selon p_keys pour respecter le choix du CGP.
-- Conventions identiques aux RPC sœurs (SECURITY DEFINER, search_path figé,
-- grants service_role only). Appliquée en prod via MCP le 17/07 ; ce fichier
-- scelle la migration dans le repo.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_contracts_comparison(p_keys text[])
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH sel AS (
    SELECT DISTINCT company, group_key, repr_key, repr_contract
    FROM investissement_contract_groups_mv
    WHERE repr_key = ANY(p_keys)
  ),
  grp AS (
    SELECT s.company, s.group_key, s.repr_key, s.repr_contract,
           bool_and(g.closed) AS closed,
           to_jsonb(array_agg(DISTINCT g.contract_type ORDER BY g.contract_type)) AS types
    FROM sel s
    JOIN investissement_contract_groups_mv g
      ON g.group_key = s.group_key AND g.company = s.company
    GROUP BY s.company, s.group_key, s.repr_key, s.repr_contract
  ),
  agg AS (
    SELECT gr.company, gr.group_key, gr.repr_key, gr.repr_contract, gr.closed, gr.types,
           sup.funds, sup.avg_fee, sup.sri_avg, sup.top_class
    FROM grp gr
    JOIN LATERAL (
      SELECT count(*) AS funds,
             avg(COALESCE(v.ongoing_charges, v.ter)) AS avg_fee,
             avg(v.risk_score::numeric) AS sri_avg,
             mode() WITHIN GROUP (ORDER BY v.asset_class_broad)
               FILTER (WHERE v.asset_class_broad IS NOT NULL) AS top_class
      FROM investissement_funds_cgp_ref v
      WHERE v.contracts @> ARRAY[gr.repr_key]
        AND v.is_primary_share_class AND v.data_completeness >= 50
    ) sup ON true
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'company',                  a.company,
      'key',                      a.repr_key,
      'contract',                 a.repr_contract,
      'types',                    a.types,
      'closed',                   a.closed,
      'funds',                    a.funds,
      'avg_fee',                  a.avg_fee,
      'sri_avg',                  a.sri_avg,
      'top_class',                a.top_class,
      'frais_entree_pct',         t.frais_entree_pct,
      'frais_gestion_uc_pct',     t.frais_gestion_uc_pct,
      'frais_arbitrage_pct',      t.frais_arbitrage_pct,
      'frais_arbitrage_note',     t.frais_arbitrage_note,
      'fonds_euros_taux_pct',     t.fonds_euros_taux_pct,
      'fonds_euros_annee',        t.fonds_euros_annee,
      'gestion_sous_mandat',      t.gestion_sous_mandat,
      'ticket_entree',            t.ticket_entree,
      'terms_confidence',         t.confidence,
      'insurer_kind',             p.kind,
      'insurer_groupe',           p.groupe,
      'insurer_solvabilite_2_pct',p.solvabilite_2_pct,
      'insurer_notation',         p.notation,
      'insurer_notation_agence',  p.notation_agence,
      'insurer_ppb_pct',          p.ppb_pct
    ) ORDER BY a.closed, a.funds DESC
  ), '[]'::jsonb)
  FROM agg a
  LEFT JOIN LATERAL (
    SELECT tt.frais_entree_pct, tt.frais_gestion_uc_pct, tt.frais_arbitrage_pct,
           tt.frais_arbitrage_note, tt.fonds_euros_taux_pct, tt.fonds_euros_annee,
           tt.gestion_sous_mandat, tt.ticket_entree, tt.confidence
    FROM investissement_av_contract_terms tt
    WHERE tt.key IN (
      SELECT g2.key FROM investissement_contract_groups_mv g2 WHERE g2.group_key = a.group_key
    )
    ORDER BY CASE tt.confidence WHEN 'scraped' THEN 3 WHEN 'curated' THEN 2 ELSE 1 END DESC,
             tt.as_of DESC NULLS LAST
    LIMIT 1
  ) t ON true
  LEFT JOIN investissement_av_insurer_profiles p ON p.company = a.company;
$function$;

REVOKE ALL ON FUNCTION public.get_contracts_comparison(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_contracts_comparison(text[]) TO service_role;

COMMIT;
