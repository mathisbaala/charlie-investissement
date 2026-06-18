-- Suppression du mécanisme de relance waitlist (code mort).
--
-- Contexte : les relances e-mail (Resend, via pg_net) n'ont jamais fonctionné.
-- Les fonctions référencent des colonnes inexistantes sur public.waitlist
-- (followup_status, followup_due_at, followup_sent_at, followup_request_id,
-- followup_error) et la colonne `name` (la table expose `full_name`).
-- Aucun trigger n'est attaché à waitlist, et la table waitlist_email_responses
-- n'existe pas. Les deux jobs pg_cron étaient déjà désactivés (14/06/2026).
--
-- On préserve : la table waitlist + waitlist_survey_responses (inscrits),
-- get_waitlist_position(), et l'edge function send-waitlist-confirmation
-- (e-mail de confirmation transactionnel, indépendant des relances).

-- 1. Désinscription des jobs pg_cron (idempotent).
do $$
begin
  perform cron.unschedule('waitlist-followup-j1');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('waitlist-followup-j1-finalize');
exception when others then null;
end $$;

-- 2. Suppression des fonctions orphelines.
drop function if exists public.process_waitlist_followups(integer);
drop function if exists public.finalize_waitlist_followups(integer);
drop function if exists public.waitlist_set_followup_defaults();
drop function if exists public.update_waitlist_email_responses_updated_at();
