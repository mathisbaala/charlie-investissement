-- Fonds obligataires datés (à échéance / target maturity) : découvrabilité.
-- Un utilisateur cherchait des « fonds obligataires datés » sans pouvoir les isoler :
-- ils existent bien en base (~313, millésimes 2024→2036) mais sont noyés dans les
-- ~4 260 fonds obligataires, faute de notion d'échéance modélisée.
--
-- On dérive deux colonnes DEPUIS LE NOM, directement dans la vue _ref (auto-fraîches,
-- zéro maintenance — pas de colonne en base ni de backfill à rejouer à chaque fonds) :
--   maturity_year       : millésime d'échéance (smallint) ou NULL
--   is_target_maturity  : fonds daté ou non
-- Heuristique de PRÉCISION (validée sur échantillon) : on restreint aux fonds COLLECTIFS
-- obligataires (opcvm/etf) — ce qui écarte les titres vifs (product_type='obligation' :
-- Bund/BTP/OAT) — ET on exige un vocabulaire d'échéance, ce qui écarte les fonds à
-- formule datés (« Amundi April 11th 2024 »). Le millésime est borné 2024→2045.
--
-- La vue légère investissement_funds_cgp n'est PAS recréée (chemin critique du screener) :
-- la route /api/funds bascule sur _ref quand le filtre échéance est actif — exactement le
-- mécanisme déjà utilisé pour le filtre assureur (le filtre réduit l'ensemble, pas de timeout).

CREATE OR REPLACE VIEW investissement_funds_cgp_ref AS
SELECT r.*, (r.maturity_year IS NOT NULL) AS is_target_maturity
FROM (
  SELECT
    c.isin, c.name, c.product_type, c.asset_class_broad, c.asset_class,
    c.category_normalized, c.region_normalized, c.sector, c.management_style,
    c.gestionnaire, c.aum_eur, c.currency, c.inception_date, c.track_record_years,
    c.ter, c.ongoing_charges, c.entry_fee_max, c.exit_fee_max, c.performance_fee,
    c.retrocession_cgp, c.holding_period_years, c.performance_1y, c.performance_3y,
    c.performance_5y, c.average_performance, c.volatility_1y, c.volatility_3y,
    c.sharpe_1y, c.sharpe_3y, c.max_drawdown_1y, c.max_drawdown_3y, c.risk_score,
    c.sfdr_article, c.labels, c.pea_eligible, c.pea_pme_eligible, c.per_eligible,
    c.av_fr_eligible, c.av_lux_eligible, c.cto_eligible, c.ucits_compliant,
    c.is_institutional, c.accessible_retail, c.hedged, c.morningstar_rating,
    c.share_class_group_id, c.kid_url, c.kid_parsed_at, c.data_completeness,
    c.data_source, c.field_sources, c.updated_at, m.insurers, m.contracts,
    c.is_primary_share_class, c.tickers, c.tickers_search, c.allocation_profile,
    c.benchmark_index, c.benchmark_variant, c.benchmark_is_category,
    c.alpha_1y, c.alpha_3y, c.alpha_5y,
    CASE
      WHEN c.product_type IN ('opcvm', 'etf')
       AND c.asset_class_broad = 'obligation'
       AND c.name ~* '\y20(2[4-9]|3[0-9]|4[0-5])\y'
       AND c.name ~* 'oblig|bond|cr[ée]dit|rendement|[ée]ch[ée]ance|target|matur|portage|mill[ée]sim|horizon|ibonds|\yterm\y|high yield|perspective|opportunit|\ycap\y|buy.?and.?hold'
      THEN (regexp_match(c.name, '\y(20(?:2[4-9]|3[0-9]|4[0-5]))\y'))[1]::smallint
    END AS maturity_year
  FROM investissement_funds_cgp c
  LEFT JOIN investissement_fund_insurers_mv m ON m.isin = c.isin
) r;

-- inv_funds_search fait `select c.*` depuis _ref dans une RETURNS TABLE à liste fixe :
-- les 2 nouvelles colonnes feraient échouer la fonction (« too many columns »). On les
-- ajoute à la signature (avant relevance) → la recherche texte expose aussi le millésime
-- et peut être combinée au filtre échéance. DROP requis (changement de type de retour) ;
-- on reproduit le durcissement sécu (PUBLIC révoqué, EXECUTE limité à service_role).
DROP FUNCTION IF EXISTS public.inv_funds_search(text);
CREATE OR REPLACE FUNCTION public.inv_funds_search(q text)
 RETURNS TABLE(isin text, name text, product_type text, asset_class_broad text, asset_class text, category_normalized text, region_normalized text, sector text, management_style text, gestionnaire text, aum_eur bigint, currency character, inception_date date, track_record_years real, ter numeric, ongoing_charges numeric, entry_fee_max numeric, exit_fee_max numeric, performance_fee numeric, retrocession_cgp numeric, holding_period_years smallint, performance_1y numeric, performance_3y numeric, performance_5y numeric, average_performance numeric, volatility_1y numeric, volatility_3y numeric, sharpe_1y numeric, sharpe_3y numeric, max_drawdown_1y numeric, max_drawdown_3y numeric, risk_score smallint, sfdr_article smallint, labels jsonb, pea_eligible boolean, pea_pme_eligible boolean, per_eligible boolean, av_fr_eligible boolean, av_lux_eligible boolean, cto_eligible boolean, ucits_compliant boolean, is_institutional boolean, accessible_retail boolean, hedged boolean, morningstar_rating smallint, share_class_group_id text, kid_url text, kid_parsed_at timestamp with time zone, data_completeness smallint, data_source text, field_sources jsonb, updated_at timestamp with time zone, insurers text[], contracts text[], is_primary_share_class boolean, tickers text[], tickers_search text, allocation_profile text, benchmark_index text, benchmark_variant text, benchmark_is_category boolean, alpha_1y numeric, alpha_3y numeric, alpha_5y numeric, maturity_year smallint, is_target_maturity boolean, relevance integer)
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

-- Durcissement : la recréation re-applique les grants Supabase par défaut (anon,
-- authenticated). On les révoque comme sur l'original — seul service_role exécute
-- (la route /api/funds appelle côté serveur).
REVOKE EXECUTE ON FUNCTION public.inv_funds_search(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_funds_search(text) TO service_role;
