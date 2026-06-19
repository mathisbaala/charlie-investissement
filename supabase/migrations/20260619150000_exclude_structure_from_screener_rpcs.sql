-- Exclure le product_type 'structuré' du screener et des compteurs de référencement
-- ============================================================================
-- Contexte : ~6 233 véhicules mal classés 'opcvm' (PE/alternatifs CSSF, autocalls/
-- EMTN, fonds à formule de taux) ont été reclassés en 'fps' (PE) et 'structuré'
-- (produits structurés). 'fps' est déjà exclu du screener ; on ajoute 'structuré'
-- à la même liste noire dans les 4 RPC/vues qui alimentent le catalogue collectif
-- retail et les compteurs assureur/SGP, pour que ces produits n'y apparaissent pas.
--
-- Idempotent : insère 'structuré' dans la clause NOT IN (...'fps') uniquement si
-- absent. Recrée chaque fonction via son pg_get_functiondef modifié.

DO $$
DECLARE r record; newdef text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('get_insurers_list','get_management_companies_list',
                        'inv_refresh_primary_share_class','inv_search_funds_fuzzy')
  LOOP
    CONTINUE WHEN r.def ILIKE '%''structuré''%';  -- déjà à jour
    newdef := regexp_replace(
      r.def,
      '(product_type\s+not\s+in\s*\([^)]*''fps'')(\s*\))',
      '\1, ''structuré''\2', 'gi');
    IF newdef = r.def THEN
      RAISE EXCEPTION 'Aucun remplacement effectué sur % (motif introuvable)', r.proname;
    END IF;
    EXECUTE newdef;
  END LOOP;
END $$;
