-- Lecture atomique du cache NL (lit + compte le hit en un seul aller-retour).
--
-- Motif : sur Vercel serverless, le Lambda gèle dès la réponse renvoyée. Un
-- comptage de hit en fire-and-forget (void rpc non attendu) est donc perdu la
-- plupart du temps → le compteur `hits` restait à 0 même sur des hits réels.
-- On fond la lecture et l'incrément dans un UPDATE ... RETURNING : l'appelant
-- attend déjà les filtres, donc le compteur est fiable sans latence supplémentaire
-- (un seul aller-retour au lieu de deux). Un miss (clé absente ou périmée)
-- ne met rien à jour et ne renvoie aucune ligne → traité comme un miss.

CREATE OR REPLACE FUNCTION public.inv_nlp_cache_get(p_key text, p_max_age_days int)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  UPDATE public.investissement_nlp_cache
     SET hits = hits + 1, last_hit_at = now()
   WHERE query_key = p_key
     AND created_at > now() - make_interval(days => p_max_age_days)
  RETURNING filters;
$function$;

REVOKE ALL ON FUNCTION public.inv_nlp_cache_get(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inv_nlp_cache_get(text, int) TO service_role;

-- L'ancien comptage séparé n'est plus utilisé (remplacé par la lecture atomique).
DROP FUNCTION IF EXISTS public.inv_nlp_cache_touch(text);

NOTIFY pgrst, 'reload schema';
