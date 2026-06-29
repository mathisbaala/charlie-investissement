-- Durcissement anti-scraping (suite de la 3e vague du 28/06) : coupe tout accès
-- du rôle anon au schéma public, et coupe le RE-GRANT automatique.
--
-- Contexte de sûreté : l'app tourne exclusivement en service_role
-- (app/src/lib/supabase.ts → SUPABASE_SERVICE_ROLE_KEY), le produit n'a pas de
-- comptes, et aucune référence anon / NEXT_PUBLIC_SUPABASE n'existe côté front.
-- → la legacy anon key n'est utilisée par aucun client légitime.
--
-- Effet : (1) révoque les grants existants (44 tables encore ouvertes à anon ;
-- RLS bloquait déjà l'accès, ceci ferme la 2e couche), et (2) neutralise la
-- legacy anon key même si elle reste active côté dashboard Supabase.
-- On ne touche PAS aux schémas storage / graphql / graphql_public (internes
-- Supabase), ni aux fonctions d'extension pg_trgm / unaccent (support du tri
-- fuzzy, utilisées par service_role, sans surface de données).

REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Coupe le re-grant pour les objets créés par postgres (= les migrations).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- Idem pour les objets créés par supabase_admin (best-effort, non bloquant :
-- le rôle de migration n'a en général pas les droits de modifier ses defaults).
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'default privileges supabase_admin non modifiables (non bloquant): %', SQLERRM;
END $$;
