-- ============================================================================
-- Recherche par ticker : propagation à travers les parts (share classes)
-- ----------------------------------------------------------------------------
-- La migration 20260616130000 a ajouté `tickers` + une colonne calculée
-- `tickers_search = array_to_string(tickers, ' ')` dans les vues. Problème
-- découvert en vérification : le screener dédoublonne les parts et n'expose
-- qu'UN représentant par groupe (is_primary_share_class). Or les tickers
-- appartiennent à une part précise — p. ex. la part capitalisante de la
-- Vanguard FTSE All-World cote « VWCE » (IE00BK5BQT80, NON primaire), mais le
-- représentant du groupe est la part distribuante « VWRL » (IE00B3RBWM25). Une
-- recherche « VWCE » ne matchait donc rien (533 ETF, ~20 %, étaient ainsi
-- « cachés » derrière une part sœur). Même nature de bug que le référencement
-- assureur, corrigé par propagation (cf. 20260611200000).
--
-- Correctif : `tickers_search` devient une VRAIE colonne stockée, contenant
-- l'UNION des tickers de TOUTES les parts du groupe (fallback : ses propres
-- tickers si pas de groupe). Le représentant primaire est ainsi trouvable par
-- le ticker de n'importe quelle part sœur. On stocke (plutôt qu'agréger dans la
-- vue) pour ne RIEN coûter au chemin chaud du screener — maintenance par
-- inv_refresh_tickers_search(), appelée en fin d'enrichissement (cf. le scraper
-- openfigi-tickers.py et le job hebdo). La colonne `tickers` (tableau par ISIN)
-- reste, elle, fidèle à la part (affichage exact sur la fiche).
-- ============================================================================

ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS tickers_search text;

-- Recalcule tickers_search pour tout l'univers : union des tickers du groupe de
-- parts (string_agg), repli sur les tickers propres si le fonds n'a pas de
-- groupe. `IS DISTINCT FROM` → n'écrit que les lignes réellement modifiées
-- (re-runs hebdo quasi-gratuits). Ne touche pas updated_at (maintenance interne).
CREATE OR REPLACE FUNCTION public.inv_refresh_tickers_search()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  WITH grp AS (
    SELECT share_class_group_id,
           string_agg(array_to_string(tickers, ' '), ' ') AS ts
    FROM investissement_funds
    WHERE tickers IS NOT NULL AND share_class_group_id IS NOT NULL
    GROUP BY share_class_group_id
  ),
  computed AS (
    SELECT f.isin,
           NULLIF(COALESCE(g.ts, array_to_string(f.tickers, ' ')), '') AS ts
    FROM investissement_funds f
    LEFT JOIN grp g ON g.share_class_group_id = f.share_class_group_id
  )
  UPDATE investissement_funds f
  SET tickers_search = c.ts
  FROM computed c
  WHERE c.isin = f.isin
    AND f.tickers_search IS DISTINCT FROM c.ts;
END;
$$;

REVOKE ALL     ON FUNCTION public.inv_refresh_tickers_search() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.inv_refresh_tickers_search() TO service_role;

-- Première population.
SELECT public.inv_refresh_tickers_search();

-- Les vues exposent désormais la colonne STOCKÉE (au lieu du array_to_string
-- calculé). Même nom, même type (text) → CREATE OR REPLACE sans drop.
CREATE OR REPLACE VIEW investissement_funds_cgp AS
SELECT
    isin,
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
    tickers_search
   FROM investissement_funds f;

CREATE OR REPLACE VIEW investissement_funds_cgp_ref AS
SELECT
    c.isin,
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
    c.tickers_search
   FROM investissement_funds_cgp c
     LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin;

GRANT SELECT ON investissement_funds_cgp     TO anon, authenticated, service_role;
GRANT SELECT ON investissement_funds_cgp_ref TO anon, authenticated, service_role;
