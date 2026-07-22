-- Rétention RGPD des événements de télémétrie (minimisation des données).
-- Purge quotidienne des lignes de investissement_user_events plus vieilles que la
-- fenêtre de rétention. Données pseudonymisées (cf. lib/analytics.ts) ; 18 mois est
-- en deçà du plafond CNIL de 25 mois pour la mesure d'audience. Pour changer la durée :
-- soit modifier le DEFAULT ci-dessous, soit replanifier le cron avec un autre argument.

CREATE OR REPLACE FUNCTION public.inv_purge_user_events(p_retention_months int DEFAULT 18)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.investissement_user_events
  WHERE ts < now() - make_interval(months => p_retention_months);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

-- Réservé au backend / cron (rôle postgres). Pas d'exposition à l'API PostgREST :
-- on retire l'EXECUTE des rôles anon/authenticated (cohérent avec le durcissement sécu).
REVOKE ALL ON FUNCTION public.inv_purge_user_events(int) FROM PUBLIC, anon, authenticated;

-- Planification quotidienne (03:17 UTC, heure creuse, hors heure ronde). cron.schedule
-- est idempotent par jobname : ré-exécuter cette migration met simplement le job à jour.
SELECT cron.schedule(
  'inv-purge-user-events',
  '17 3 * * *',
  $cron$ SELECT public.inv_purge_user_events(); $cron$
);
