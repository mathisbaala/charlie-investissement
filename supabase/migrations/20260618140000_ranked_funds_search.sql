-- Recherche de fonds classée par pertinence (sur TOUTES les pages, pas seulement
-- la 1re comme le faisaient les "prepend" applicatifs ticker/nom).
--
-- inv_funds_search(q) renvoie les fonds qui matchent la requête texte AVEC un score
-- de pertinence (colonne `relevance`), à plat. La route /api/funds l'utilise comme
-- SOURCE pour les recherches texte, puis applique les filtres structurés PostgREST
-- PAR-DESSUS (.eq/.in/.or), trie par `relevance` puis par le tri courant, pagine et
-- compte. → pas de duplication de la logique de filtres (source unique : applyFilters).
--
-- Score :
--   3 = nom exact, ou ticker exact (mot entier dans tickers_search, requête mono-mot)
--   2 = le NOM contient tous les mots cherchés
--   1 = match via une autre colonne (gestionnaire, zone, catégorie, secteur…)
-- Matching = chaque mot doit apparaître dans la concaténation des colonnes cherchées
-- (équivalent du OR par colonne de lib/search.ts, AND entre mots).
-- Garde-fous d'univers (part primaire, complétude ≥ 50) intégrés ; l'exclusion
-- action/crypto/fps reste côté route (conditionnelle au filtre univers).

create or replace function public.inv_funds_search(q text)
returns table(
  isin text, name text, product_type text, asset_class_broad text, asset_class text,
  category_normalized text, region_normalized text, sector text, management_style text,
  gestionnaire text, aum_eur bigint, currency character, inception_date date,
  track_record_years real, ter numeric, ongoing_charges numeric, entry_fee_max numeric,
  exit_fee_max numeric, performance_fee numeric, retrocession_cgp numeric,
  holding_period_years smallint, performance_1y numeric, performance_3y numeric,
  performance_5y numeric, average_performance numeric, volatility_1y numeric,
  volatility_3y numeric, sharpe_1y numeric, sharpe_3y numeric, max_drawdown_1y numeric,
  max_drawdown_3y numeric, risk_score smallint, sfdr_article smallint, labels jsonb,
  pea_eligible boolean, pea_pme_eligible boolean, per_eligible boolean, av_fr_eligible boolean,
  av_lux_eligible boolean, cto_eligible boolean, ucits_compliant boolean, is_institutional boolean,
  accessible_retail boolean, hedged boolean, morningstar_rating smallint, share_class_group_id text,
  kid_url text, kid_parsed_at timestamptz, data_completeness smallint, data_source text,
  field_sources jsonb, updated_at timestamptz, insurers text[], contracts text[],
  is_primary_share_class boolean, tickers text[], tickers_search text,
  relevance integer
)
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $$
  with t as (
    select array_agg('%' || tok || '%') as pats, count(*) as n, lower(trim(q)) as ql
    from unnest(regexp_split_to_array(lower(trim(q)), '\s+')) tok
    where tok <> ''
  )
  select c.*,
    (case
       when lower(c.name) = t.ql then 3
       when t.n = 1 and c.tickers_search is not null
            and lower(c.tickers_search) ~ ('\y' || t.ql || '\y') then 3
       when lower(c.name) like all (t.pats) then 2
       else 1
     end)::int as relevance
  from investissement_funds_cgp_ref c, t
  where c.is_primary_share_class = true
    and c.data_completeness >= 50
    and lower(
      coalesce(c.name,'') || ' ' || coalesce(c.isin,'') || ' ' ||
      coalesce(c.tickers_search,'') || ' ' || coalesce(c.gestionnaire,'') || ' ' ||
      coalesce(c.category_normalized,'') || ' ' || coalesce(c.region_normalized,'') || ' ' ||
      coalesce(c.asset_class,'') || ' ' || coalesce(c.sector,'')
    ) like all (t.pats);
$$;

revoke all on function public.inv_funds_search(text) from public, anon, authenticated;
grant execute on function public.inv_funds_search(text) to service_role;
