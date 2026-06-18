-- Recherche tolérante aux fautes de frappe (trigrammes pg_trgm).
--
-- Sert de FILET : la route /api/funds n'appelle inv_search_funds_fuzzy que
-- lorsque la recherche normale (ilike) renvoie 0 résultat. On propose alors les
-- fonds dont le NOM est le plus proche (« Amundee » → Amundi…), avec les mêmes
-- garde-fous d'univers curé que le screener par défaut (primaire, complétude,
-- exclusion action/crypto/fps). Les filtres ad hoc de l'utilisateur sont ré-appliqués
-- côté route par intersection sur l'ISIN (source de vérité unique : applyFilters).

create extension if not exists pg_trgm;

-- Index trigramme sur le nom (table physique sous-jacente à la vue cgp_ref).
create index if not exists idx_funds_name_trgm
  on investissement_funds using gin (name gin_trgm_ops);

-- name % q   : similarité globale (typo de marque, « Amundee » → Amundi)
-- q <% name  : word_similarity, q matche une extension de mots du nom
--              (typo multi-mots, « msci wolrd » → … MSCI World …)
-- Les deux opérateurs exploitent l'index GIN trigramme (seuils par défaut).
create or replace function public.inv_search_funds_fuzzy(q text, lim integer default 50)
returns table(isin text, score real)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select c.isin, greatest(similarity(c.name, q), word_similarity(q, c.name)) as score
  from investissement_funds_cgp_ref c
  where c.is_primary_share_class = true
    and c.data_completeness >= 50
    and c.product_type not in ('action', 'crypto', 'fps')
    and (c.name % q or q <% c.name)
  order by greatest(similarity(c.name, q), word_similarity(q, c.name)) desc,
           c.aum_eur desc nulls last
  limit greatest(1, least(lim, 200));
$$;

-- Durcissement : non exposée publiquement (ni anon ni authenticated),
-- exécutable uniquement par le rôle applicatif (service_role côté serveur).
revoke all on function public.inv_search_funds_fuzzy(text, integer) from public, anon, authenticated;
grant execute on function public.inv_search_funds_fuzzy(text, integer) to service_role;
