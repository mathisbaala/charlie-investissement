-- Migration : ajout des colonnes screener manquantes
-- À exécuter dans Supabase SQL Editor :
-- https://supabase.com/dashboard/project/dehigtgzizsdehyhmjxn/sql

-- Zone géographique d'investissement (france|europe|eurozone|usa|japon|asie|emergents|monde|autres)
ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS geography text;

-- Catégorie normalisée (Morningstar categories → ~15 labels propres)
ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS category_normalized text;

-- Commentaires pour clarté
COMMENT ON COLUMN investissement_funds.geography IS 'Zone géographique principale : france|europe|eurozone|usa|usa_canada|japon|asie|emergents|monde|autres';
COMMENT ON COLUMN investissement_funds.management_company_normalized IS 'Nom canonique du gestionnaire (groupes consolidés)';
COMMENT ON COLUMN investissement_funds.asset_class IS 'Classe d''actifs : actions|obligations|monetaire|immobilier|multi-actifs|euro_garanti|private_equity|infrastructure|crypto|alternatif|matieres_premieres';
COMMENT ON COLUMN investissement_funds.category_normalized IS 'Catégorie Morningstar normalisée (~15 labels stables)';
