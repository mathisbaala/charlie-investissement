-- Fiabilisation du plafond de dépense IA.
--
-- Contexte : le code applicatif (lib/rateLimit.ts) appelle inv_ai_rate_limit en
-- passant 5 paramètres nommés, dont p_global_day_limit (plafond GLOBAL journalier,
-- toutes IP confondues = plafond dur de dépense contre une attaque distribuée par
-- rotation d'IP). Or la migration d'origine (20260609100000) ne définissait qu'une
-- surcharge à 4 paramètres, SANS plafond global. La version à 5 paramètres avait été
-- appliquée à la main en prod mais n'était PAS versionnée ici → sur une reconstruction
-- depuis les migrations, on récupérait la version à 4 paramètres, l'appel RPC échouait
-- (paramètre inconnu), et `aiRateLimit` étant fail-open (toute erreur laisse passer),
-- TOUT le rationnement IA sautait en silence.
--
-- Cette migration : (1) fige la version canonique à 5 paramètres comme source de vérité,
-- (2) supprime la surcharge morte à 4 paramètres (jamais appelée : le code passe toujours
-- les 5 paramètres nommés) pour lever toute ambiguïté de résolution.

CREATE OR REPLACE FUNCTION public.inv_ai_rate_limit(
  p_ip text,
  p_hour_limit int,
  p_day_limit int,
  p_cost int DEFAULT 1,
  p_global_day_limit int DEFAULT 1000000000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hour_key text; v_day_key text; v_global_key text;
  v_hour int; v_day int; v_global int;
BEGIN
  v_hour_key   := 'h:' || p_ip || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24');
  v_day_key    := 'd:' || p_ip || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_global_key := 'g:'              || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  INSERT INTO investissement_ai_usage AS u (bucket_key, count, expires_at)
  VALUES (v_hour_key, p_cost, now() + interval '2 hours')
  ON CONFLICT (bucket_key) DO UPDATE SET count = u.count + p_cost
  RETURNING u.count INTO v_hour;

  INSERT INTO investissement_ai_usage AS u (bucket_key, count, expires_at)
  VALUES (v_day_key, p_cost, now() + interval '25 hours')
  ON CONFLICT (bucket_key) DO UPDATE SET count = u.count + p_cost
  RETURNING u.count INTO v_day;

  INSERT INTO investissement_ai_usage AS u (bucket_key, count, expires_at)
  VALUES (v_global_key, p_cost, now() + interval '25 hours')
  ON CONFLICT (bucket_key) DO UPDATE SET count = u.count + p_cost
  RETURNING u.count INTO v_global;

  -- Nettoyage probabiliste des buckets périmés (amorti, sans job dédié).
  IF random() < 0.02 THEN
    DELETE FROM investissement_ai_usage WHERE expires_at < now();
  END IF;

  RETURN jsonb_build_object(
    'allowed', (v_hour <= p_hour_limit AND v_day <= p_day_limit AND v_global <= p_global_day_limit),
    'hour', v_hour, 'day', v_day, 'global', v_global,
    'hour_limit', p_hour_limit, 'day_limit', p_day_limit, 'global_day_limit', p_global_day_limit,
    'scope', CASE WHEN v_global > p_global_day_limit THEN 'global'
                  WHEN v_day    > p_day_limit        THEN 'day'
                  WHEN v_hour   > p_hour_limit       THEN 'hour'
                  ELSE 'ok' END
  );
END;
$function$;

-- L'app appelle la RPC en service_role uniquement (cf. lib/supabase.ts). On ne
-- l'expose ni à anon ni à authenticated (posture anti-scraping / sécurité).
REVOKE ALL ON FUNCTION public.inv_ai_rate_limit(text, int, int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inv_ai_rate_limit(text, int, int, int, int) TO service_role;

-- Surcharge morte à 4 paramètres (sans plafond global) : supprimée pour lever
-- l'ambiguïté de résolution et garantir que seule la version « plafond dur » subsiste.
DROP FUNCTION IF EXISTS public.inv_ai_rate_limit(text, int, int, int);

NOTIFY pgrst, 'reload schema';
