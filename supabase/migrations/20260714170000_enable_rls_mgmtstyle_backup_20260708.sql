-- Durcissement sécu — RLS sur backup mgmtstyle — 2026-07-14
-- ============================================================================
-- Backup interne du chantier mgmt-style/asset-class (08/07), créé sans RLS.
-- L'advisor sécurité Supabase le signalait en ERROR `rls_disabled_in_public`
-- (« table publiquement accessible »). On l'aligne sur TOUS les autres backups :
-- RLS activé, aucune policy → anon/authenticated bloqués, service_role bypasse
-- (l'app n'accède qu'en service_role). Passe l'objet en INFO `rls_enabled_no_policy`.

ALTER TABLE public.investissement_funds_mgmtstyle_backup_20260708 ENABLE ROW LEVEL SECURITY;

-- Cohérence avec le durcissement anti-scraping (app = service_role only) :
-- on retire aussi les privilèges résiduels sur ce backup.
REVOKE ALL ON public.investissement_funds_mgmtstyle_backup_20260708 FROM authenticated, anon;
