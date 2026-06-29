-- Garde-fou anti-scraping sur les endpoints de DONNÉES (screener, fiche, séries
-- de VL). Distinct du quota IA (inv_ai_rate_limit) : ici on ne protège pas un
-- coût d'API mais notre BASE — empêcher l'aspiration en masse de l'univers de
-- fonds par pagination/énumération d'ISIN. Sans authentification, on borne par
-- IP — contournable (rotation d'IP/VPN), assumé : le but est de rendre le
-- scraping massif lent, coûteux et détectable, pas de le verrouiller à 100 %.
--
-- Fenêtres MINUTE (anti-burst) + HEURE (plafond soutenu). Buckets datés et
-- préfixés ('dm:'/'dh:') pour ne PAS se mélanger aux buckets IA ('h:'/'d:')
-- dans la table partagée investissement_ai_usage. Incrément atomique (UPSERT).
-- Limites généreuses passées par le code (env) : un humain qui navigue reste
-- loin sous le seuil ; un crawler qui énumère des centaines de pages mord.

CREATE OR REPLACE FUNCTION public.inv_data_rate_limit(
  p_ip text, p_min_limit int, p_hour_limit int, p_cost int DEFAULT 1
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_min_key text; v_hour_key text; v_min int; v_hour int;
BEGIN
  v_min_key  := 'dm:' || p_ip || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI');
  v_hour_key := 'dh:' || p_ip || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24');

  INSERT INTO investissement_ai_usage AS u (bucket_key, count, expires_at)
  VALUES (v_min_key, p_cost, now() + interval '2 minutes')
  ON CONFLICT (bucket_key) DO UPDATE SET count = u.count + p_cost
  RETURNING u.count INTO v_min;

  INSERT INTO investissement_ai_usage AS u (bucket_key, count, expires_at)
  VALUES (v_hour_key, p_cost, now() + interval '2 hours')
  ON CONFLICT (bucket_key) DO UPDATE SET count = u.count + p_cost
  RETURNING u.count INTO v_hour;

  -- Ménage opportuniste (probabiliste) des compteurs périmés.
  IF random() < 0.02 THEN
    DELETE FROM investissement_ai_usage WHERE expires_at < now();
  END IF;

  RETURN jsonb_build_object(
    'allowed', (v_min <= p_min_limit AND v_hour <= p_hour_limit),
    'minute', v_min, 'hour', v_hour,
    'minute_limit', p_min_limit, 'hour_limit', p_hour_limit,
    'scope', CASE WHEN v_hour > p_hour_limit THEN 'hour'
                  WHEN v_min  > p_min_limit  THEN 'minute'
                  ELSE 'ok' END
  );
END;
$function$;

-- GOTCHA Postgres : une fonction accorde EXECUTE à PUBLIC par défaut → anon
-- pourrait l'appeler via /rest/v1/rpc. On la réserve au backend (service_role),
-- cohérent avec le durcissement anti-scraping (cf. supabase-security-hardening).
REVOKE EXECUTE ON FUNCTION public.inv_data_rate_limit(text, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.inv_data_rate_limit(text, int, int, int) TO service_role;
