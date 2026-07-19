-- ============================================================================
-- Accélération de l'onglet Partenaires : get_insurer_comparison(p_company)
-- ----------------------------------------------------------------------------
-- Un clic sur un ASSUREUR ouvre la page qui compare ses contrats. L'ancienne RPC
-- agrégeait, POUR CHAQUE contrat de l'assureur, les métriques de ses supports via
-- un JOIN LATERAL sur investissement_funds_cgp_ref (contracts @> [repr_key]).
-- Pour un gros assureur (AG2R = 242 contrats), les contrats partagent en grande
-- partie le MÊME pool de supports : le lateral re-scannait ~126 000 fois les
-- lignes de fonds (480k buffers), et la vue _cgp_ref recalcule inv_prices_stale()
-- + des regex par ligne. Résultat : ~1 s à chaud, ~4 s à FROID (premier clic sur
-- un assureur peu visité), avec des pics à cause du spill disque sous charge.
--
-- Correctif : on PRÉCALCULE hors-ligne les métriques par clé de contrat dans une
-- matview (investissement_contract_metrics_mv), en une seule passe (unnest des
-- tableaux `contracts`). Au runtime, la RPC devient une simple jointure indexée :
-- ~95 ms pour AG2R (≈40× plus rapide) et STABLE quelle que soit la charge.
--
-- La matview lit les colonnes BRUTES (sri, ongoing_charges/ter, asset_class_broad)
-- directement depuis investissement_funds + investissement_fund_insurers_mv, avec
-- les mêmes garde-fous de visibilité que le screener / la vue _cgp_ref :
--   is_primary_share_class AND data_completeness >= 50.
-- Équivalence du JSON produit vérifiée byte-à-byte (funds/avg_fee/sri_avg/top_class)
-- contre l'ancienne RPC sur les assureurs les plus lourds (AG2R, Suravenir, Spirica…).
--
-- Rafraîchissement : branché à la fin de inv_refresh_fund_insurers_mv() (après les
-- matviews dont elle dépend), donc suit la même cadence que le référencement.
-- ============================================================================

BEGIN;

-- 1) Métriques agrégées par clé de contrat (une passe au build ; lookup au runtime).
CREATE MATERIALIZED VIEW IF NOT EXISTS investissement_contract_metrics_mv AS
SELECT ck AS key,
       count(*)                                   AS funds,
       avg(fee)                                   AS avg_fee,
       avg(risk_score::numeric)                   AS sri_avg,
       mode() WITHIN GROUP (ORDER BY asset_class_broad)
         FILTER (WHERE asset_class_broad IS NOT NULL) AS top_class
FROM (
  SELECT unnest(m.contracts)               AS ck,
         COALESCE(f.ongoing_charges, f.ter) AS fee,
         f.sri                             AS risk_score,
         f.asset_class_broad               AS asset_class_broad
  FROM investissement_fund_insurers_mv m
  JOIN investissement_funds f ON f.isin = m.isin
  WHERE f.is_primary_share_class AND f.data_completeness >= 50
) x
GROUP BY ck;

-- Unique = permet un futur REFRESH ... CONCURRENTLY et accélère la jointure.
CREATE UNIQUE INDEX IF NOT EXISTS i_contract_metrics_mv_key
  ON investissement_contract_metrics_mv (key);

-- Hygiène anti-scraping (cf. supabase-security-hardening) : lue uniquement via des
-- fonctions SECURITY DEFINER, jamais par anon/authenticated.
REVOKE ALL ON investissement_contract_metrics_mv FROM PUBLIC, anon, authenticated;

-- 2) RPC réécrite : jointure sur la matview au lieu du JOIN LATERAL lourd.
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
           COALESCE(mm.funds, 0) AS funds, mm.avg_fee, mm.sri_avg, mm.top_class
    FROM groups g
    LEFT JOIN investissement_contract_metrics_mv mm ON mm.key = g.repr_key
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

-- 3) Branche le refresh de la nouvelle matview dans le pipeline existant.
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
  -- 4. Métriques par contrat (dépend de fund_insurers_mv + funds). Sert
  --    get_insurer_comparison(). Doit suivre fund_insurers_mv.
  REFRESH MATERIALIZED VIEW investissement_contract_metrics_mv;
END;
$function$;

COMMIT;
