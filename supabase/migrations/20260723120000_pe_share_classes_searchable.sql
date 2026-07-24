-- Recherche : rendre trouvables les SHARE-CLASSES de PRIVATE EQUITY ───────────
-- Retour CGP (23/07) : « je cherchais EPVE3 (Eurazeo Private Value Europe 3), il
-- ne s'affiche pas ; je ne le vois qu'en "fonds similaire" en cliquant sur une
-- autre part ». Cause : la recherche texte ne renvoie QUE le représentant primaire
-- de chaque groupe de share-classes (is_primary_share_class = true) et filtre au
-- plancher data_completeness >= 50. Pour un OPCVM/ETF c'est le bon comportement
-- (12 parts quasi identiques → 1 ligne). Pour du NON COTÉ (fcpr/fcpi/fip/fpci),
-- chaque part est un PRODUIT DISTINCT (minimum de souscription, frais, enveloppe,
-- parfois brand Idinvest/Eurazeo diffèrent) que le CGP doit pouvoir trouver
-- nommément — et le PE est structurellement peu renseigné (pas de VL quotidienne),
-- donc le plancher de complétude le masquerait même après avoir levé is_primary.
--
-- Fix SQL (chemin texte uniquement) : les deux RPC de recherche texte admettent
-- désormais les parts de PE quel que soit is_primary_share_class ET sous le plancher
-- de complétude. fps/structuré RESTENT hors périmètre (produits volontairement
-- écartés du catalogue retail, cf. 20260619150000). La route /api/funds applique le
-- MÊME prédicat côté application (baseFilters admitPE + dedup non-coté par ISIN) ;
-- le chemin NAVIGATION/référencement reste strictement primaire (invariant
-- carte==total intact — il ne vaut pas sous une recherche texte de toute façon).
--
-- ⚠ CORRIGE AUSSI UNE PANNE DE RECHERCHE : la migration 20260722160100 a ajouté
-- les 4 colonnes de défiscalisation (tax_scheme/tax_reduction_rate/tax_lock_up_years/
-- vintage_year) à la vue investissement_funds_cgp_ref SANS recréer inv_funds_search
-- (qui fait `select c.*` depuis cette vue). Résultat : la RETURNS TABLE figée ne
-- correspond plus aux colonnes réellement renvoyées → « return type mismatch …
-- returns text instead of real at column 71 » et TOUTE recherche texte tombe en 500.
-- On recrée donc inv_funds_search avec la RETURNS TABLE À JOUR (les 4 colonnes tax
-- avant relevance), ce qui remet la fonction en phase avec la vue.
--
-- Recréation de la dernière définition (inv_funds_search : 20260722100000 + colonnes
-- défisc de 20260722160100 ; inv_search_funds_fuzzy : 20260618160000 + patch
-- 20260619150000), la clause WHERE relâche le PE. RETURNS TABLE réaligné sur la vue ;
-- on reproduit le durcissement sécu (REVOKE PUBLIC/anon/authenticated, GRANT service_role).

-- ── 1. inv_funds_search (recherche texte classée par pertinence) ─────────────
DROP FUNCTION IF EXISTS public.inv_funds_search(text);
CREATE OR REPLACE FUNCTION public.inv_funds_search(q text)
 RETURNS TABLE(isin text, name text, product_type text, asset_class_broad text, asset_class text, category_normalized text, region_normalized text, sector text, management_style text, gestionnaire text, aum_eur bigint, currency character, inception_date date, track_record_years real, ter numeric, ongoing_charges numeric, entry_fee_max numeric, exit_fee_max numeric, performance_fee numeric, retrocession_cgp numeric, holding_period_years smallint, performance_1y numeric, performance_3y numeric, performance_5y numeric, average_performance numeric, volatility_1y numeric, volatility_3y numeric, sharpe_1y numeric, sharpe_3y numeric, max_drawdown_1y numeric, max_drawdown_3y numeric, risk_score smallint, sfdr_article smallint, labels jsonb, pea_eligible boolean, pea_pme_eligible boolean, per_eligible boolean, av_fr_eligible boolean, av_lux_eligible boolean, cto_eligible boolean, ucits_compliant boolean, is_institutional boolean, accessible_retail boolean, hedged boolean, morningstar_rating smallint, share_class_group_id text, kid_url text, kid_parsed_at timestamp with time zone, data_completeness smallint, data_source text, field_sources jsonb, updated_at timestamp with time zone, insurers text[], contracts text[], is_primary_share_class boolean, tickers text[], tickers_search text, allocation_profile text, benchmark_index text, benchmark_variant text, benchmark_is_category boolean, alpha_1y numeric, alpha_3y numeric, alpha_5y numeric, maturity_year smallint, is_target_maturity boolean, esg_exclusions jsonb, sustainable_investment_pct numeric, taxonomy_alignment_pct numeric, pai_considered boolean, tax_scheme text, tax_reduction_rate numeric, tax_lock_up_years smallint, vintage_year smallint, relevance real)
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
  -- Non coté (fcpr/fcpi/fip/fpci) : toutes les parts, quel que soit is_primary et
  -- sans plancher de complétude. Sinon : représentant primaire + plancher >= 50.
  where (c.is_primary_share_class = true or c.product_type in ('fcpr','fcpi','fip','fpci'))
    and (c.data_completeness >= 50 or c.product_type in ('fcpr','fcpi','fip','fpci'))
    and unaccent(lower(
      coalesce(c.name,'') || ' ' || coalesce(c.isin,'') || ' ' ||
      coalesce(c.tickers_search,'') || ' ' || coalesce(c.gestionnaire,'') || ' ' ||
      coalesce(c.category_normalized,'') || ' ' || coalesce(c.region_normalized,'') || ' ' ||
      coalesce(c.asset_class,'') || ' ' || coalesce(c.sector,'')
    )) like all (t.pats);
$function$;

REVOKE EXECUTE ON FUNCTION public.inv_funds_search(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_funds_search(text) TO service_role;

-- ── 2. inv_search_funds_fuzzy (filet trigramme, tolérance aux fautes) ─────────
-- Même relâchement PE. On CONSERVE l'exclusion product_type not in
-- ('action','crypto','fps','structuré') : fcpr/fcpi/fip/fpci n'y figurent pas,
-- donc ils passent ; fps/structuré restent écartés.
CREATE OR REPLACE FUNCTION public.inv_search_funds_fuzzy(q text, lim integer default 50)
RETURNS TABLE(isin text, score real)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  select c.isin,
    greatest(similarity(unaccent(c.name), unaccent(q)), word_similarity(unaccent(q), unaccent(c.name))) as score
  from investissement_funds_cgp_ref c
  where (c.is_primary_share_class = true or c.product_type in ('fcpr','fcpi','fip','fpci'))
    and (c.data_completeness >= 50 or c.product_type in ('fcpr','fcpi','fip','fpci'))
    and c.product_type not in ('action', 'crypto', 'fps', 'structuré')
    and (unaccent(c.name) % unaccent(q) or unaccent(q) <% unaccent(c.name))
  order by greatest(similarity(unaccent(c.name), unaccent(q)), word_similarity(unaccent(q), unaccent(c.name))) desc,
           c.aum_eur desc nulls last
  limit greatest(1, least(lim, 200));
$$;
REVOKE ALL ON FUNCTION public.inv_search_funds_fuzzy(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_search_funds_fuzzy(text, integer) TO service_role;
