-- Recherche insensible aux accents (unaccent) dans les deux RPC de recherche.
-- « energie » trouve « Énergie », « societe » trouve « Société », etc. On enveloppe
-- le texte cherché ET les colonnes comparées dans unaccent(). (extension unaccent
-- déjà installée.) Pas d'index trigramme exploité ici — unaccert est STABLE, donc
-- ces prédicats restent en seq-scan sur l'univers déjà restreint (primaire +
-- complétude), ce qui était déjà le cas pour le haystack concaténé.

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
  is_primary_share_class boolean, tickers text[], tickers_search text, allocation_profile text,
  relevance integer
)
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $$
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
$$;
revoke all on function public.inv_funds_search(text) from public, anon, authenticated;
grant execute on function public.inv_funds_search(text) to service_role;

create or replace function public.inv_search_funds_fuzzy(q text, lim integer default 50)
returns table(isin text, score real)
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $$
  select c.isin,
    greatest(similarity(unaccent(c.name), unaccent(q)), word_similarity(unaccent(q), unaccent(c.name))) as score
  from investissement_funds_cgp_ref c
  where c.is_primary_share_class = true
    and c.data_completeness >= 50
    and c.product_type not in ('action', 'crypto', 'fps')
    and (unaccent(c.name) % unaccent(q) or unaccent(q) <% unaccent(c.name))
  order by greatest(similarity(unaccent(c.name), unaccent(q)), word_similarity(unaccent(q), unaccent(c.name))) desc,
           c.aum_eur desc nulls last
  limit greatest(1, least(lim, 200));
$$;
revoke all on function public.inv_search_funds_fuzzy(text, integer) from public, anon, authenticated;
grant execute on function public.inv_search_funds_fuzzy(text, integer) to service_role;
