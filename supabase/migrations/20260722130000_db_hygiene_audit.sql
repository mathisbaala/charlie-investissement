-- Hygiène DB — passe d'audit 22/07/2026 (accès base + sécurité + rangement).
-- Ces changements ont été appliqués en prod directement via MCP pendant l'audit ;
-- ce fichier les CONSIGNE de façon idempotente pour la reproductibilité (db reset).
-- Tout est IF EXISTS / idempotent : rejouable sans effet de bord, et sans échec si
-- une table de backup ad hoc n'existe pas dans un environnement reconstruit.

-- 1) Sécurité — RLS sur les 2 tables de backup publiques du 21/07 (elles étaient
--    exposées à PostgREST sans RLS = advisor ERROR rls_disabled_in_public). Aucune
--    policy (déni par défaut) : cohérent avec le reste des investissement_* (l'app
--    lit en service_role, jamais en anon).
alter table if exists public.investissement_funds_etf_fee_pollution_backup_20260721 enable row level security;
alter table if exists public.investissement_av_contract_terms_fe_backup_20260721   enable row level security;

-- 2) Rangement — 2 index morts sur NOS tables (advisor unused_index, jamais choisis
--    par le planner ; le GIN pèse en écriture). NE PAS toucher aux index de
--    charlie_dossier (app sœur).
drop index if exists public.i_nlp_cache_hits;
drop index if exists public.investissement_fund_documents_parsed_data_gin;

-- 3) Sécurité — durcissement du getter de cache NLP (SECURITY DEFINER exposé via
--    /rest/v1/rpc). anon était déjà révoqué (3e vague anti-scraping) ; on retire
--    aussi authenticated (le produit n'a AUCUN compte utilisateur, et l'app appelle
--    en service_role). Ferme l'advisor 0029. service_role + postgres conservent EXECUTE.
revoke execute on function public.inv_nlp_cache_get(text, integer) from authenticated;
revoke execute on function public.inv_nlp_cache_get(text, integer) from anon;
