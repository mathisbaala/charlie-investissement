-- Pertinence de la recherche texte : score CONTINU au lieu de 3 crans (1/2/3).
--
-- Constat : `inv_funds_search` sélectionne déjà TOUS les fonds qui matchent (le
-- `like all` sur le haystack concaténé — recall inchangé), mais la note de
-- pertinence n'avait que 3 valeurs entières. À l'intérieur d'un cran (surtout le
-- gros sac « relevance=1 » = mot trouvé ailleurs que dans le nom : catégorie,
-- zone, secteur, gestionnaire), la route départage par `aum_eur` seul → les
-- gros fonds génériques passaient devant le vrai match. Sensation « à côté de la
-- plaque » sur les requêtes de type nom/marque/thème.
--
-- Correctif : relevance devient un `real` (0..1) gradué, et à l'intérieur de
-- chaque cran la SIMILARITÉ TRIGRAMME du nom (pg_trgm, déjà utilisé par
-- inv_search_funds_fuzzy) départage en continu — un nom proche de la requête
-- remonte avant un gros fonds sans rapport. L'encours reste le tie-break FINAL
-- côté route (à relevance strictement égale). Aucune ligne matchée en plus/moins :
-- SEUL l'ordre change → risque minimal, pas de changement de recall.
--
-- Barème (real) :
--   1.00  nom exactement égal à la requête
--   0.97  ticker exact (requête mono-mot bornée \y…\y dans tickers_search)
--   0.90 + 0.06·sim   le nom COMMENCE par la requête (préfixe : « Amundi MSCI World … »)
--   0.70 + 0.18·sim   le nom contient TOUS les mots (ordre quelconque)
--   0.20 + 0.40·sim   match seulement dans le haystack (catégorie/zone/secteur/gestionnaire)
-- sim = similarity(unaccent(name), ql) ∈ [0,1].
--
-- DROP requis (changement de type de retour integer→real). On reproduit le
-- durcissement sécu (PUBLIC/anon/authenticated révoqués, EXECUTE = service_role).
-- Signature de colonnes STRICTEMENT identique à 20260623120500 (c.* depuis _ref,
-- liste fixe) — seule la dernière colonne `relevance` passe de integer à real.

DROP FUNCTION IF EXISTS public.inv_funds_search(text);
CREATE OR REPLACE FUNCTION public.inv_funds_search(q text)
 RETURNS TABLE(isin text, name text, product_type text, asset_class_broad text, asset_class text, category_normalized text, region_normalized text, sector text, management_style text, gestionnaire text, aum_eur bigint, currency character, inception_date date, track_record_years real, ter numeric, ongoing_charges numeric, entry_fee_max numeric, exit_fee_max numeric, performance_fee numeric, retrocession_cgp numeric, holding_period_years smallint, performance_1y numeric, performance_3y numeric, performance_5y numeric, average_performance numeric, volatility_1y numeric, volatility_3y numeric, sharpe_1y numeric, sharpe_3y numeric, max_drawdown_1y numeric, max_drawdown_3y numeric, risk_score smallint, sfdr_article smallint, labels jsonb, pea_eligible boolean, pea_pme_eligible boolean, per_eligible boolean, av_fr_eligible boolean, av_lux_eligible boolean, cto_eligible boolean, ucits_compliant boolean, is_institutional boolean, accessible_retail boolean, hedged boolean, morningstar_rating smallint, share_class_group_id text, kid_url text, kid_parsed_at timestamp with time zone, data_completeness smallint, data_source text, field_sources jsonb, updated_at timestamp with time zone, insurers text[], contracts text[], is_primary_share_class boolean, tickers text[], tickers_search text, allocation_profile text, benchmark_index text, benchmark_variant text, benchmark_is_category boolean, alpha_1y numeric, alpha_3y numeric, alpha_5y numeric, maturity_year smallint, is_target_maturity boolean, relevance real)
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
       when unaccent(lower(c.name)) = t.ql then 1.0
       when t.n = 1 and c.tickers_search is not null
            and unaccent(lower(c.tickers_search)) ~ ('\y' || t.ql || '\y') then 0.97
       when unaccent(lower(c.name)) like (t.ql || '%')
            then 0.90 + 0.06 * similarity(unaccent(c.name), t.ql)
       when unaccent(lower(c.name)) like all (t.pats)
            then 0.70 + 0.18 * similarity(unaccent(c.name), t.ql)
       else 0.20 + 0.40 * similarity(unaccent(c.name), t.ql)
     end)::real as relevance
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
