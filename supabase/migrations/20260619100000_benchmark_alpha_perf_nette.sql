-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_alpha_perf_nette — Benchmark généralisé + alpha vs indice
-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 1 « value-for-money DDA ». Aujourd'hui le calcul d'écart vit dans
-- td-enricher.py, restreint aux ETF (product_type='etf') via un catalogue codé
-- en dur de 7 indices → seuls ~120 fonds portent un benchmark. On généralise :
--
--   1. Le catalogue d'indices et les RÈGLES d'affectation sortent du Python et
--      deviennent des tables de référence (source de vérité, éditable en SQL).
--   2. On affecte un benchmark à TOUT fonds (pas seulement les ETF) : match
--      exact par mot-clé (ETF vanille → is_category=false) ou, à défaut, par
--      catégorie/région (fonds actif → indice de catégorie, is_category=true).
--   3. On stocke benchmark_perf (rendement de l'indice, cumulé) + alpha (écart
--      fonds − indice : 1y cumulé, 3y/5y annualisé) sur des fenêtres date-
--      alignées → alpha autoritaire et triable sans annualisation à chaud.
--
-- La « perf nette de frais » côté client est calculée À LA LECTURE (perf VL,
-- déjà nette de TER, moins les frais de gestion du contrat) — pas de colonne
-- stockée (cf. lib/format.ts perfNetteClient).
--
-- alpha_* généralise et remplace tracking_diff_* (conservées pour compat, plus
-- écrites). L'UI bascule sur alpha_*.
--
-- Threading : les vues cgp / cgp_ref et la RPC inv_funds_search listent leurs
-- colonnes EXPLICITEMENT → colonnes ajoutées à la main en fin de projection
-- (append-only), comme la migration allocation_profile.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonnes sur investissement_funds ───────────────────────────────────────
-- benchmark_index / benchmark_code / benchmark_variant / tracking_diff_* existent
-- déjà (migration 20260611100000). On ajoute le reste.
ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS benchmark_is_category boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS benchmark_perf_1y     numeric(10,4),  -- cumulé %, comme performance_*
  ADD COLUMN IF NOT EXISTS benchmark_perf_3y     numeric(10,4),
  ADD COLUMN IF NOT EXISTS benchmark_perf_5y     numeric(10,4),
  ADD COLUMN IF NOT EXISTS alpha_1y              numeric(8,4),   -- cumulé % (1 an)
  ADD COLUMN IF NOT EXISTS alpha_3y              numeric(8,4),   -- annualisé %/an
  ADD COLUMN IF NOT EXISTS alpha_5y              numeric(8,4),   -- annualisé %/an
  ADD COLUMN IF NOT EXISTS benchmark_computed_at timestamptz;

-- Index partiel pour le tri/filtre screener par alpha (mêmes prédicats que la
-- requête screener : primaire + suffisamment renseigné).
CREATE INDEX IF NOT EXISTS i_funds_alpha_3y
  ON investissement_funds (alpha_3y DESC NULLS LAST)
  WHERE is_primary_share_class = true AND data_completeness >= 50;

-- 2. Catalogue d'indices (source de vérité, remplace INDEX_CATALOG Python) ─────
CREATE TABLE IF NOT EXISTS investissement_index_catalog (
  index_code        text PRIMARY KEY,
  label             text NOT NULL,
  currency          char(3) NOT NULL,
  variant           text NOT NULL CHECK (variant IN ('net','gross','price')),
  source            text NOT NULL CHECK (source IN ('yahoo','msci')),
  ticker            text,        -- ticker Yahoo (source='yahoo')
  msci_code         text,        -- code MSCI (source='msci')
  keywords          text[] NOT NULL DEFAULT '{}',  -- détection exacte ETF (nom/catégorie)
  asset_class_broad text,
  region            text,        -- région normalisée couverte (pour les règles)
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now()
);

-- Seed : les 7 indices déjà chargés (migrés du dict Python) + Nasdaq-100 TR.
INSERT INTO investissement_index_catalog
  (index_code, label, currency, variant, source, ticker, msci_code, keywords, asset_class_broad, region)
VALUES
  ('sp500',       'S&P 500',                'USD', 'gross', 'yahoo', '^SP500TR', NULL,
     ARRAY['s&p 500','sp 500','s&p500','sp500'], 'action', 'usa'),
  ('dax',         'DAX',                    'EUR', 'gross', 'yahoo', '^GDAXI',   NULL,
     ARRAY['dax 40',' dax ','dax index'], 'action', 'germany'),
  ('nasdaq100',   'Nasdaq-100',             'USD', 'gross', 'yahoo', '^XNDX',    NULL,
     ARRAY['nasdaq 100','nasdaq-100','nasdaq100'], 'action', 'usa'),
  ('msci_world',  'MSCI World',             'EUR', 'net',   'msci',  NULL, '990100',
     ARRAY['msci world'], 'action', 'world'),
  ('msci_em',     'MSCI Emerging Markets',  'EUR', 'net',   'msci',  NULL, '891800',
     ARRAY['msci em ','emerging','émergent','emergent'], 'action', 'emerging'),
  ('msci_usa',    'MSCI USA',               'EUR', 'net',   'msci',  NULL, '984000',
     ARRAY['msci usa'], 'action', 'usa'),
  ('msci_europe', 'MSCI Europe',            'EUR', 'net',   'msci',  NULL, '990500',
     ARRAY['msci europe'], 'action', 'europe'),
  ('msci_japan',  'MSCI Japan',             'EUR', 'net',   'msci',  NULL, '990400',
     ARRAY['msci japan','msci japon'], 'action', 'japan')
ON CONFLICT (index_code) DO UPDATE SET
  label = EXCLUDED.label, currency = EXCLUDED.currency, variant = EXCLUDED.variant,
  source = EXCLUDED.source, ticker = EXCLUDED.ticker, msci_code = EXCLUDED.msci_code,
  keywords = EXCLUDED.keywords, asset_class_broad = EXCLUDED.asset_class_broad,
  region = EXCLUDED.region;

-- 3. Règles d'affectation fonds → indice (par priorité) ───────────────────────
-- Appliquées quand le match EXACT par mot-clé échoue : on retombe sur l'indice
-- de CATÉGORIE (is_category_proxy=true → l'UI affiche « indice de catégorie »).
-- NULL = wildcard. Première règle active qui matche (ordre priority) gagne.
CREATE TABLE IF NOT EXISTS investissement_benchmark_rules (
  id                bigserial PRIMARY KEY,
  priority          smallint NOT NULL,
  match_asset_class text,
  match_region      text,
  match_style       text,            -- management_style (réservé, NULL = tous)
  index_code        text NOT NULL REFERENCES investissement_index_catalog(index_code),
  is_category_proxy boolean NOT NULL DEFAULT true,
  active            boolean NOT NULL DEFAULT true
);

-- Seed : actions par région. Les 7 indices couvrent ~96 % des fonds action
-- ayant une région. asia/china/india → MSCI EM (proxy large assumé). france →
-- MSCI Europe (proxy, faute d'indice CAC GR net TR gratuit fiable). Obligations
-- / diversifiés / immobilier : pas de règle (indice à sourcer → non mappés,
-- masqués en UI). usa → MSCI USA (net TR EUR, cohérent avec parts EUR).
INSERT INTO investissement_benchmark_rules
  (priority, match_asset_class, match_region, index_code, is_category_proxy)
VALUES
  (10, 'action', 'world',    'msci_world',  true),
  (10, 'action', 'usa',      'msci_usa',    true),
  (10, 'action', 'europe',   'msci_europe', true),
  (10, 'action', 'france',   'msci_europe', true),
  (10, 'action', 'emerging', 'msci_em',     true),
  (10, 'action', 'japan',    'msci_japan',  true),
  (20, 'action', 'asia',     'msci_em',     true),
  (20, 'action', 'china',    'msci_em',     true),
  (20, 'action', 'india',    'msci_em',     true)
ON CONFLICT DO NOTHING;

-- 4. Vue screener cgp — append benchmark/alpha en fin de projection ────────────
CREATE OR REPLACE VIEW investissement_funds_cgp AS
 SELECT isin,
    name,
    product_type,
    asset_class_broad,
    asset_class,
    category_normalized,
    region_normalized,
    sector,
    management_style,
    management_company_normalized AS gestionnaire,
    aum_eur,
    currency,
    inception_date,
    track_record_years,
    ter,
    ongoing_charges,
    entry_fee_max,
    exit_fee_max,
    performance_fee,
    retrocession_cgp,
    holding_period_years,
    performance_1y,
    inv_annualize_pt(performance_3y, 3::numeric, product_type) AS performance_3y,
    inv_annualize_pt(performance_5y, 5::numeric, product_type) AS performance_5y,
    average_performance,
    volatility_1y,
    volatility_3y,
    sharpe_1y,
    sharpe_3y,
    max_drawdown_1y,
    max_drawdown_3y,
    sri AS risk_score,
    sfdr_article,
    labels,
    pea_eligible,
    pea_pme_eligible,
    per_eligible,
    av_fr_eligible,
    av_lux_eligible,
    cto_eligible,
    ucits_compliant,
    is_institutional,
    CASE
        WHEN is_institutional IS FALSE OR is_institutional IS NULL THEN true
        ELSE false
    END AS accessible_retail,
    hedged,
    morningstar_rating,
    share_class_group_id,
    kid_url,
    kid_parsed_at,
    data_completeness,
    data_source,
    field_sources,
    updated_at,
    is_primary_share_class,
    tickers,
    tickers_search,
    allocation_profile,
    benchmark_index,
    benchmark_variant,
    benchmark_is_category,
    alpha_1y,
    alpha_3y,
    alpha_5y
   FROM investissement_funds f;

-- 5. Vue référencement cgp_ref — append c.benchmark/alpha en fin de projection ─
CREATE OR REPLACE VIEW investissement_funds_cgp_ref AS
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
    m.insurers,
    m.contracts,
    c.is_primary_share_class,
    c.tickers,
    c.tickers_search,
    c.allocation_profile,
    c.benchmark_index,
    c.benchmark_variant,
    c.benchmark_is_category,
    c.alpha_1y,
    c.alpha_3y,
    c.alpha_5y
   FROM investissement_funds_cgp c
     LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin;

-- 6. RPC recherche classée — c.* (depuis cgp_ref) inclut désormais les colonnes
--    benchmark/alpha → on les ajoute au RETURNS TABLE juste avant `relevance`.
DROP FUNCTION IF EXISTS inv_funds_search(text);
CREATE OR REPLACE FUNCTION public.inv_funds_search(q text)
 RETURNS TABLE(isin text, name text, product_type text, asset_class_broad text, asset_class text, category_normalized text, region_normalized text, sector text, management_style text, gestionnaire text, aum_eur bigint, currency character, inception_date date, track_record_years real, ter numeric, ongoing_charges numeric, entry_fee_max numeric, exit_fee_max numeric, performance_fee numeric, retrocession_cgp numeric, holding_period_years smallint, performance_1y numeric, performance_3y numeric, performance_5y numeric, average_performance numeric, volatility_1y numeric, volatility_3y numeric, sharpe_1y numeric, sharpe_3y numeric, max_drawdown_1y numeric, max_drawdown_3y numeric, risk_score smallint, sfdr_article smallint, labels jsonb, pea_eligible boolean, pea_pme_eligible boolean, per_eligible boolean, av_fr_eligible boolean, av_lux_eligible boolean, cto_eligible boolean, ucits_compliant boolean, is_institutional boolean, accessible_retail boolean, hedged boolean, morningstar_rating smallint, share_class_group_id text, kid_url text, kid_parsed_at timestamp with time zone, data_completeness smallint, data_source text, field_sources jsonb, updated_at timestamp with time zone, insurers text[], contracts text[], is_primary_share_class boolean, tickers text[], tickers_search text, allocation_profile text, benchmark_index text, benchmark_variant text, benchmark_is_category boolean, alpha_1y numeric, alpha_3y numeric, alpha_5y numeric, relevance integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with t as (
    select array_agg('%' || unaccent(tok) || '%') as pats, count(*) as n,
           unaccent(lower(trim(q))) as ql
    from unnest(regexp_split_to_array(lower(trim(q)), '\s+')) tok
    where tok <> ''
  )
  select c.*,
    (case
       when unaccent(lower(c.name)) = t.ql then 3
       when t.n = 1 and c.tickers_search is not null
            and unaccent(lower(c.tickers_search)) ~ ('\y' || t.ql || '\y') then 3
       when unaccent(lower(c.name)) like all (t.pats) then 2
       else 1
     end)::int as relevance
  from investissement_funds_cgp_ref c, t
  where c.is_primary_share_class = true
    and c.data_completeness >= 50
    and unaccent(lower(
      coalesce(c.name,'') || ' ' || coalesce(c.isin,'') || ' ' ||
      coalesce(c.tickers_search,'') || ' ' || coalesce(c.gestionnaire,'') || ' ' ||
      coalesce(c.category_normalized,'') || ' ' || coalesce(c.region_normalized,'') || ' ' ||
      coalesce(c.asset_class,'') || ' ' || coalesce(c.sector,'')
    )) like all (t.pats);
$function$;

REVOKE ALL ON FUNCTION public.inv_funds_search(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_funds_search(text) TO service_role;

-- 7. Fiche fonds (RPC jsonb) — exposer benchmark/alpha (perf annualisée) ───────
CREATE OR REPLACE FUNCTION public.get_fund_detail(p_isin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row investissement_funds%ROWTYPE;
  v_ter_pctile numeric; v_perf3y_pctile numeric; v_peer_count int;
BEGIN
  SELECT * INTO v_row FROM investissement_funds WHERE isin = p_isin;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_row.ter IS NOT NULL AND v_row.category_normalized IS NOT NULL THEN
    SELECT
      ROUND(COUNT(*) FILTER (WHERE ter > v_row.ter)::numeric /
            NULLIF(COUNT(*) FILTER (WHERE ter IS NOT NULL), 0) * 100, 1),
      COUNT(*) FILTER (WHERE ter IS NOT NULL)
    INTO v_ter_pctile, v_peer_count
    FROM investissement_funds
    WHERE category_normalized = v_row.category_normalized AND isin <> p_isin;
  END IF;

  IF v_row.performance_3y IS NOT NULL AND v_row.category_normalized IS NOT NULL THEN
    SELECT ROUND(COUNT(*) FILTER (WHERE performance_3y < v_row.performance_3y)::numeric /
                 NULLIF(COUNT(*) FILTER (WHERE performance_3y IS NOT NULL), 0) * 100, 1)
    INTO v_perf3y_pctile
    FROM investissement_funds
    WHERE category_normalized = v_row.category_normalized AND isin <> p_isin;
  END IF;

  RETURN
    jsonb_build_object(
      'isin', v_row.isin, 'name', v_row.name, 'product_type', v_row.product_type,
      'management_company', v_row.management_company,
      'gestionnaire', v_row.management_company_normalized,
      'currency', v_row.currency, 'asset_class_broad', v_row.asset_class_broad,
      'asset_class', v_row.asset_class, 'category', v_row.category,
      'category_normalized', v_row.category_normalized, 'region_exposure', v_row.region_exposure,
      'region_normalized', v_row.region_normalized, 'sector', v_row.sector,
      'management_style', v_row.management_style,
      'ter', v_row.ter,
      'ongoing_charges', v_row.ongoing_charges,
      'risk_score', v_row.sri, 'srri', v_row.srri, 'sfdr_article', v_row.sfdr_article,
      'performance_1y', v_row.performance_1y,
      'performance_3y', inv_annualize_pt(v_row.performance_3y, 3, v_row.product_type),
      'performance_5y', inv_annualize_pt(v_row.performance_5y, 5, v_row.product_type),
      'average_performance', v_row.average_performance,
      'volatility_1y', v_row.volatility_1y, 'volatility_3y', v_row.volatility_3y,
      'sharpe_1y', v_row.sharpe_1y, 'sharpe_3y', v_row.sharpe_3y,
      'max_drawdown_1y', v_row.max_drawdown_1y, 'max_drawdown_3y', v_row.max_drawdown_3y,
      'aum_eur', v_row.aum_eur, 'morningstar_rating', v_row.morningstar_rating
    )
    ||
    jsonb_build_object(
      'inception_date', v_row.inception_date, 'track_record_years', v_row.track_record_years,
      'pea_eligible', v_row.pea_eligible, 'per_eligible', v_row.per_eligible,
      'av_lux_eligible', v_row.av_lux_eligible, 'ucits_compliant', v_row.ucits_compliant,
      'is_institutional', v_row.is_institutional,
      'accessible_retail', CASE WHEN v_row.is_institutional IS FALSE OR v_row.is_institutional IS NULL THEN true ELSE false END,
      'hedged', v_row.hedged, 'distributor_france', v_row.distributor_france,
      'min_subscription_eur', v_row.min_subscription_eur, 'labels', v_row.labels,
      'kid_url', v_row.kid_url, 'kid_parsed_at', v_row.kid_parsed_at,
      'share_class_group_id', v_row.share_class_group_id, 'field_sources', v_row.field_sources,
      'data_source', v_row.data_source, 'data_completeness', v_row.data_completeness,
      'created_at', v_row.created_at, 'updated_at', v_row.updated_at,
      'allocation_profile', v_row.allocation_profile,
      'ter_percentile_in_category', v_ter_pctile,
      'perf3y_percentile_in_category', v_perf3y_pctile,
      'peer_count_in_category', v_peer_count
    )
    ||
    jsonb_build_object(
      'benchmark_index', v_row.benchmark_index,
      'benchmark_variant', v_row.benchmark_variant,
      'benchmark_is_category', v_row.benchmark_is_category,
      'benchmark_perf_1y', v_row.benchmark_perf_1y,
      'benchmark_perf_3y', inv_annualize_pt(v_row.benchmark_perf_3y, 3, 'opcvm'),
      'benchmark_perf_5y', inv_annualize_pt(v_row.benchmark_perf_5y, 5, 'opcvm'),
      'alpha_1y', v_row.alpha_1y,
      'alpha_3y', v_row.alpha_3y,
      'alpha_5y', v_row.alpha_5y
    );
END;
$function$;
-- (CREATE OR REPLACE préserve les grants existants de get_fund_detail.)

-- Réf tables : durcissement RLS (cf. mémoire supabase-security-hardening) — pas
-- de lecture publique, accès via service_role uniquement.
ALTER TABLE investissement_index_catalog  ENABLE ROW LEVEL SECURITY;
ALTER TABLE investissement_benchmark_rules ENABLE ROW LEVEL SECURITY;
