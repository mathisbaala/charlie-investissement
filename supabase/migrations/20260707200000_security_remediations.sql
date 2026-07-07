-- Remédiations sécu (advisors) — 2026-07-07
-- =========================================
-- 1. ERROR rls_disabled_in_public : un backup était exposé à PostgREST sans RLS
--    (anon pouvait le lire). On active RLS (aucune policy = verrouillé, comme les
--    autres backups internes). Cf. [[supabase-security-hardening]].
alter table public.investissement_funds_region_backup_20260706 enable row level security;

-- 2. WARN function_search_path_mutable : figer le search_path (anti-hijack), au
--    même standard que le reste des fonctions du schéma.
alter function public.inv_prices_stale(date, integer, text) set search_path = public, pg_temp;
alter function public.inv_rebuild_composite_indices() set search_path = public, pg_temp;

-- NB : les matviews de référencement (investissement_fund_insurers_mv,
-- investissement_contract_groups_mv) ont été rafraîchies manuellement après la
-- reclassification opcvm→action/structuré du 2026-07-07 pour éviter tout écart
-- (titres vifs reclassés mais encore comptés dans le référencement).
