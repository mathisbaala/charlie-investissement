-- Durcissement sécu — REVOKE public sur inv_fund_correlation — 2026-07-14
-- ============================================================================
-- inv_fund_correlation (SECURITY DEFINER, ajoutée en PR #12) avait conservé les
-- grants EXECUTE par défaut (PUBLIC → anon/authenticated), échappant à la vague
-- anti-scraping du 28-29/06 qui révoquait tous les RPC data. L'advisor sécurité
-- Supabase le signalait en WARN 0028/0029 (anon/authenticated SECURITY DEFINER
-- executable). L'app appelle cette fonction via service_role uniquement.

REVOKE ALL ON FUNCTION public.inv_fund_correlation(text[], integer, integer)
  FROM PUBLIC, anon, authenticated;
