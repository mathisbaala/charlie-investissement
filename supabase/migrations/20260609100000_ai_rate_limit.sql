-- Garde-fou anti-abus sur les appels IA (Claude) : plafonds par IP, par heure
-- ("session") et par jour. Sans authentification, on borne par IP — contournable
-- (VPN), c'est assumé : le but est juste d'empêcher un visiteur de cramer tous
-- les crédits IA en une heure pendant la démo, pas de verrouiller à 100 %.
--
-- Compteur partagé en base (les fonctions serverless Vercel ne partagent pas de
-- mémoire). Buckets datés ('h:<ip>:<YYYY-MM-DDTHH>' et 'd:<ip>:<YYYY-MM-DD>')
-- incrémentés atomiquement via UPSERT.

CREATE TABLE IF NOT EXISTS public.investissement_ai_usage (
  bucket_key text PRIMARY KEY,
  count      int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investissement_ai_usage ENABLE ROW LEVEL SECURITY;
-- Aucune policy publique : seul le service role (backend) y accède. RLS activé
-- par principe ; le client navigateur n'a jamais accès à cette table.

CREATE OR REPLACE FUNCTION public.inv_ai_rate_limit(
  p_ip text, p_hour_limit int, p_day_limit int, p_cost int DEFAULT 1
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_hour_key text; v_day_key text; v_hour int; v_day int;
BEGIN
  v_hour_key := 'h:' || p_ip || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24');
  v_day_key  := 'd:' || p_ip || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  INSERT INTO investissement_ai_usage AS u (bucket_key, count, expires_at)
  VALUES (v_hour_key, p_cost, now() + interval '2 hours')
  ON CONFLICT (bucket_key) DO UPDATE SET count = u.count + p_cost
  RETURNING u.count INTO v_hour;

  INSERT INTO investissement_ai_usage AS u (bucket_key, count, expires_at)
  VALUES (v_day_key, p_cost, now() + interval '25 hours')
  ON CONFLICT (bucket_key) DO UPDATE SET count = u.count + p_cost
  RETURNING u.count INTO v_day;

  -- Ménage opportuniste (probabiliste) des compteurs périmés.
  IF random() < 0.02 THEN
    DELETE FROM investissement_ai_usage WHERE expires_at < now();
  END IF;

  RETURN jsonb_build_object(
    'allowed', (v_hour <= p_hour_limit AND v_day <= p_day_limit),
    'hour', v_hour, 'day', v_day,
    'hour_limit', p_hour_limit, 'day_limit', p_day_limit,
    'scope', CASE WHEN v_day > p_day_limit THEN 'day'
                  WHEN v_hour > p_hour_limit THEN 'hour'
                  ELSE 'ok' END
  );
END;
$function$;
