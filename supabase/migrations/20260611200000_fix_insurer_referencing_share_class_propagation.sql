-- ============================================================================
-- Référencement assureur : propagation au groupe de share-class + compteurs alignés
-- ----------------------------------------------------------------------------
-- Deux défauts corrigés sur l'onglet « Assurance vie » (page /assureurs → screener) :
--
-- 1. FONDS RÉFÉRENCÉS INVISIBLES (bug). La matview investissement_fund_insurers_mv
--    agrégeait le référencement PAR ISIN EXACT (GROUP BY isin). Or le screener ne
--    montre qu'une share-class par fonds (is_primary_share_class). Tout fonds
--    référencé uniquement via une share-class secondaire — dont la primaire ne
--    portait donc pas la clé — disparaissait du screener. Mesure sur « Cardif Elite » :
--    991 groupes référencés, seulement 737 dont la primaire portait la clé → ~254
--    fonds (~13 %) silencieusement absents. Le fix propage l'union du référencement
--    à TOUTES les share-class du groupe (clé = share_class_group_id), de sorte que
--    la primaire — la seule visible — porte toujours le tag.
--
-- 2. COMPTEURS INCOHÉRENTS (UX). get_insurers_list / get_contracts_list comptaient
--    les ISIN BRUTS (toutes share-class, données incomplètes incluses). Le screener,
--    lui, déduplique sur la primaire et filtre data_completeness >= 50. D'où « la
--    carte annonce 3 899, le clic atterrit sur ~2 200 ». On recalcule désormais les
--    compteurs DIRECTEMENT sur les lignes que le screener affiche (primaire +
--    data_completeness >= 50, tous univers) → le nombre affiché == le nombre listé,
--    par construction.
--
-- get_fund_insurers (fiche fonds) est aligné sur le même modèle propagé pour rester
-- cohérent avec le screener.
--
-- ⚠ La matview doit être dropée pour changer sa requête ; la vue dépendante
--   investissement_funds_cgp_ref est donc recréée à l'identique. SELECT reste révoqué
--   pour anon/authenticated sur la matview (durcissement sécu) ; la vue conserve son
--   accès lecture. CREATE OR REPLACE FUNCTION préserve les grants des RPC.
-- ============================================================================

BEGIN;

-- 1. Décrochage de la vue dépendante (recréée à l'identique en fin de migration).
DROP VIEW IF EXISTS investissement_funds_cgp_ref;

-- 2. Matview propagée au groupe de share-class.
DROP MATERIALIZED VIEW IF EXISTS investissement_fund_insurers_mv;

CREATE MATERIALIZED VIEW investissement_fund_insurers_mv AS
WITH base AS (
  -- Référencements bruts, rattachés à leur groupe de share-class.
  SELECT
    COALESCE(f.share_class_group_id, e.isin) AS grp_key,
    e.company_name,
    e.contract_name
  FROM investissement_av_lux_eligibility e
  JOIN investissement_funds_cgp f ON f.isin = e.isin
  WHERE e.company_name IS NOT NULL
    AND e.company_name <> 'Assureur inconnu'
),
grp_agg AS (
  -- Union du référencement par groupe.
  SELECT
    grp_key,
    array_agg(DISTINCT company_name ORDER BY company_name) AS insurers,
    array_agg(DISTINCT (company_name || '::' || contract_name) ORDER BY (company_name || '::' || contract_name))
      FILTER (WHERE contract_name IS NOT NULL AND contract_name <> company_name) AS contracts
  FROM base
  GROUP BY grp_key
)
-- Propagation à toutes les share-class du groupe (dont la primaire, seule visible).
SELECT f.isin, g.insurers, g.contracts
FROM investissement_funds_cgp f
JOIN grp_agg g ON g.grp_key = COALESCE(f.share_class_group_id, f.isin);

-- Index unique (refresh CONCURRENTLY) + GIN pour le filtre overlaps du screener.
CREATE UNIQUE INDEX i_fund_insurers_mv_isin     ON investissement_fund_insurers_mv (isin);
CREATE INDEX        i_fund_insurers_mv_insurers ON investissement_fund_insurers_mv USING gin (insurers);
CREATE INDEX        i_fund_insurers_mv_contracts ON investissement_fund_insurers_mv USING gin (contracts);

-- Préserve le durcissement sécu : pas de lecture directe de la matview hors owner/service.
REVOKE ALL ON investissement_fund_insurers_mv FROM anon, authenticated;

-- 3. Recréation à l'identique de la vue screener (mêmes colonnes, même ordre).
CREATE VIEW investissement_funds_cgp_ref AS
SELECT c.isin,
    c.name,
    c.product_type,
    c.asset_class_broad,
    c.asset_class,
    c.category_normalized,
    c.region_normalized,
    c.sector,
    c.management_style,
    c.gestionnaire,
    c.aum_eur,
    c.currency,
    c.inception_date,
    c.track_record_years,
    c.ter,
    c.ongoing_charges,
    c.entry_fee_max,
    c.exit_fee_max,
    c.performance_fee,
    c.retrocession_cgp,
    c.holding_period_years,
    c.performance_1y,
    c.performance_3y,
    c.performance_5y,
    c.average_performance,
    c.volatility_1y,
    c.volatility_3y,
    c.sharpe_1y,
    c.sharpe_3y,
    c.max_drawdown_1y,
    c.max_drawdown_3y,
    c.risk_score,
    c.sfdr_article,
    c.labels,
    c.pea_eligible,
    c.pea_pme_eligible,
    c.per_eligible,
    c.av_fr_eligible,
    c.av_lux_eligible,
    c.cto_eligible,
    c.ucits_compliant,
    c.is_institutional,
    c.accessible_retail,
    c.hedged,
    c.morningstar_rating,
    c.share_class_group_id,
    c.kid_url,
    c.kid_parsed_at,
    c.data_completeness,
    c.data_source,
    c.field_sources,
    c.updated_at,
    COALESCE(m.insurers, '{}'::text[]) AS insurers,
    COALESCE(m.contracts, '{}'::text[]) AS contracts,
    c.is_primary_share_class
   FROM investissement_funds_cgp c
     LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin;

GRANT SELECT ON investissement_funds_cgp_ref TO anon, authenticated, service_role;

-- 4. Compteurs alignés sur ce que le screener affiche réellement.
--    Source = lignes primaires + data_completeness >= 50 (tous univers), exactement
--    le périmètre « référencés exploitables » ; un overlaps(insurers|contracts) sur
--    ces mêmes lignes redonne ce total → carte == screener.

CREATE OR REPLACE FUNCTION public.get_insurers_list()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('company', company, 'funds', n) ORDER BY n DESC),
    '[]'::jsonb
  )
  FROM (
    SELECT u AS company, count(*) AS n
    FROM investissement_funds_cgp_ref v, unnest(v.insurers) AS u
    WHERE v.is_primary_share_class
      AND v.data_completeness >= 50
    GROUP BY u
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.get_contracts_list()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'company',  split_part(u, '::', 1),
        'contract', substr(u, position('::' in u) + 2),
        'key',      u,
        'funds',    n
      )
      ORDER BY split_part(u, '::', 1), n DESC
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT u, count(*) AS n
    FROM investissement_funds_cgp_ref v, unnest(v.contracts) AS u
    WHERE v.is_primary_share_class
      AND v.data_completeness >= 50
    GROUP BY u
  ) t;
$function$;

-- 5. Fiche fonds : référencement du fonds aligné sur le modèle propagé.
--    On part de insurers[] (toutes les compagnies référençant le groupe, y compris
--    sans contrat nommé) et on rattache les contrats correspondants.
CREATE OR REPLACE FUNCTION public.get_fund_insurers(p_isin text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH ref AS (
    SELECT insurers, contracts
    FROM investissement_funds_cgp_ref
    WHERE isin = p_isin
    LIMIT 1
  ),
  comp AS (
    SELECT unnest(insurers) AS company FROM ref
  ),
  ctr AS (
    SELECT split_part(u, '::', 1)              AS company,
           substr(u, position('::' in u) + 2)  AS contract
    FROM ref, unnest(contracts) AS u
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('company', c.company, 'contracts', t.contracts)
      ORDER BY c.company
    ),
    '[]'::jsonb
  )
  FROM comp c
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT ctr.contract ORDER BY ctr.contract)
             FILTER (WHERE ctr.contract IS NOT NULL) AS contracts
    FROM ctr WHERE ctr.company = c.company
  ) t ON true;
$function$;

COMMIT;
