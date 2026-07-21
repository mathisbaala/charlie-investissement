-- Cache d'interprétation des recherches en langage naturel.
--
-- Objectif : la route /api/parse traduit une phrase (« ETF monde peu cher ») en
-- filtres JSON via un appel LLM. C'est le poste IA le PLUS FRÉQUENT (un appel par
-- recherche). Beaucoup de requêtes sont identiques ou triviales et reviennent en
-- boucle (« ETF monde », « fonds prudent », « assurance vie »…). Ce cache mémorise
-- le résultat validé d'une requête normalisée : une phrase déjà interprétée est
-- resservie sans réappeler le modèle → zéro token, zéro quota, et plus rapide.
-- Aucune perte de pertinence : on ressert exactement le JSON que le modèle avait
-- produit et qui a passé la validation stricte (sanitizeParsedFilters).
--
-- Clé versionnée (`<version>:<requête normalisée>`) : bump de la version côté code
-- (NLP_CACHE_VERSION) = invalidation immédiate des entrées obsolètes quand le
-- mapping évolue, sans purge manuelle. TTL de fraîcheur appliqué à la lecture.

CREATE TABLE IF NOT EXISTS public.investissement_nlp_cache (
  query_key   text PRIMARY KEY,          -- '<version>:<requête normalisée>'
  query_text  text NOT NULL,             -- requête normalisée (lisible, pour analyse)
  filters     jsonb NOT NULL,            -- ParsedFilters validé, resservi tel quel
  hits        int NOT NULL DEFAULT 0,    -- nombre de fois resservi (tokens économisés)
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz NOT NULL DEFAULT now()
);

-- Analyse : quelles requêtes rapportent le plus (cache le plus rentable).
CREATE INDEX IF NOT EXISTS i_nlp_cache_hits ON public.investissement_nlp_cache (hits DESC);

-- Comptage d'un hit, en fire-and-forget (ne bloque jamais la réponse). SECURITY
-- DEFINER pour rester cohérent avec le reste des RPC service-only.
CREATE OR REPLACE FUNCTION public.inv_nlp_cache_touch(p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  UPDATE public.investissement_nlp_cache
     SET hits = hits + 1, last_hit_at = now()
   WHERE query_key = p_key;
$function$;

-- Accès service_role uniquement (l'app), jamais anon/authenticated.
ALTER TABLE public.investissement_nlp_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.investissement_nlp_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.investissement_nlp_cache TO service_role;

REVOKE ALL ON FUNCTION public.inv_nlp_cache_touch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inv_nlp_cache_touch(text) TO service_role;

NOTIFY pgrst, 'reload schema';
