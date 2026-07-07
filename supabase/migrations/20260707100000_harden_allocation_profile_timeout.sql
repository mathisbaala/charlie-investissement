-- Durcissement du timeout de inv_fill_allocation_profile_from_composition()
-- =========================================================================
-- Dernière étape de holdings-drain-auto.yml (quotidien) : appelée via PostgREST,
-- donc sous le rôle authenticator qui impose statement_timeout=8s / lock_timeout=8s.
-- La fonction agrège toute la table investissement_fund_holdings (~333k lignes,
-- ~1,6 s à chaud) puis dérive allocation_profile des diversifiés. Elle tourne
-- JUSTE APRÈS 1h50 de drain qui vient d'écrire massivement dans holdings : cache
-- froid + contention → le seq scan dépasse 8 s et se fait annuler (SQLSTATE 57014,
-- cf. échec du run auto du 2026-07-07 08:00Z). Même schéma que
-- 20260706160000_harden_refresh_primary_share_class_timeout.
--
-- On donne à la fonction ses propres limites (proconfig), qui surchargent la session
-- uniquement pendant son exécution. ALTER (et non CREATE OR REPLACE) → aucun grant
-- rejoué, on évite le piège du re-REVOKE anon.
ALTER FUNCTION public.inv_fill_allocation_profile_from_composition() SET statement_timeout TO '300s';
ALTER FUNCTION public.inv_fill_allocation_profile_from_composition() SET lock_timeout TO '60s';
