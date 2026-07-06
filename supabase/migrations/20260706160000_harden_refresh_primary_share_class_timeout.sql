-- Durcissement du timeout de inv_refresh_primary_share_class()
-- ============================================================
-- Cette RPC de maintenance (dernière étape des pipelines hebdo/mensuel) passe par
-- PostgREST, donc par le rôle authenticator qui impose statement_timeout=8s et
-- lock_timeout=8s au niveau session. La requête est pourtant triviale (~5,5k lignes,
-- sous la seconde à vide), mais en fin de pipeline investissement_funds est sous
-- contention d'upserts : l'UPDATE attend les verrous ligne et se fait annuler à 8s
-- (SQLSTATE 57014, cf. échec du run weekly du 2026-07-06).
--
-- On donne à la fonction ses propres limites (proconfig), qui surchargent la session
-- uniquement pendant son exécution. ALTER (et non CREATE OR REPLACE) → aucun grant
-- rejoué, on évite le piège du re-REVOKE anon.
ALTER FUNCTION public.inv_refresh_primary_share_class() SET statement_timeout TO '300s';
ALTER FUNCTION public.inv_refresh_primary_share_class() SET lock_timeout TO '60s';
