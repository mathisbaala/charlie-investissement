-- Indexes screener CGP v2 — à exécuter dans Supabase SQL Editor
-- https://supabase.com/dashboard/project/dehigtgzizsdehyhmjxn/sql
-- Durée estimée : 5-8 minutes (35 988 fonds)
--
-- Ces index couvrent les requêtes les plus fréquentes du screener :
--   - Filtres combinés product_type + risque/frais/perf
--   - Tri par performance ou AUM dans un type donné
--   - Recherche textuelle sur nom + gestionnaire
--   - Filtres enveloppe fiscale (PEA/AV/PER)

-- ─── Index de base (déjà présents, idempotents) ───────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_sfdr
  ON investissement_funds(sfdr_article);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_sri
  ON investissement_funds(sri);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_ter
  ON investissement_funds(ongoing_charges);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_pea
  ON investissement_funds(pea_eligible);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_av_lux
  ON investissement_funds(av_lux_eligible);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_per
  ON investissement_funds(per_eligible);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_completeness
  ON investissement_funds(data_completeness);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_type_completeness
  ON investissement_funds(product_type, data_completeness);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_name_gin
  ON investissement_funds USING gin(to_tsvector('french', coalesce(name, '')));

-- ─── Nouveaux index composites pour le screener ───────────────────────────────

-- Filtre type + SFDR (très courant : "OPCVM article 8/9")
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_type_sfdr
  ON investissement_funds(product_type, sfdr_article);

-- Filtre type + SRI (profil de risque)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_type_sri
  ON investissement_funds(product_type, sri);

-- Tri par performance 3Y dans un type (classement)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_type_perf3y
  ON investissement_funds(product_type, performance_3y DESC NULLS LAST);

-- Tri par AUM dans un type (les plus gros fonds en premier)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_type_aum
  ON investissement_funds(product_type, aum_eur DESC NULLS LAST);

-- Filtre par asset_class
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_asset_class
  ON investissement_funds(asset_class);

-- Filtre par asset_class_broad (catégorie large)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_asset_class_broad
  ON investissement_funds(asset_class_broad);

-- Filtre combiné asset_class + completeness (screener : univers propre)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_asset_class_completeness
  ON investissement_funds(asset_class, data_completeness);

-- Filtre par région géographique
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_region
  ON investissement_funds(region_normalized);

-- Filtre combiné region + asset_class (cas fréquent : "actions europe")
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_region_asset_class
  ON investissement_funds(region_normalized, asset_class);

-- Filtre enveloppe AV + type (cas d'usage principal des CGP)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_av_lux_type
  ON investissement_funds(av_lux_eligible, product_type)
  WHERE av_lux_eligible = true;

-- Filtre PEA + type
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_pea_type
  ON investissement_funds(pea_eligible, product_type)
  WHERE pea_eligible = true;

-- Filtre par management_company_normalized (filtre gestionnaire)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_mc_normalized
  ON investissement_funds(management_company_normalized);

-- Recherche textuelle sur management_company_normalized
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_mc_normalized_gin
  ON investissement_funds USING gin(to_tsvector('simple',
    coalesce(management_company_normalized, '') || ' ' || coalesce(management_company, '')
  ));

-- Tri par TER (frais) dans un type (comparaison coût)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_type_ter
  ON investissement_funds(product_type, ongoing_charges ASC NULLS LAST);

-- Fonds avec KID disponible (filtrage documents)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_kid_url
  ON investissement_funds(kid_url)
  WHERE kid_url IS NOT NULL;

-- Index partiel : fonds "prêts pour le screener" (completeness ≥ 60)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_screener_ready
  ON investissement_funds(product_type, asset_class, performance_3y DESC NULLS LAST)
  WHERE data_completeness >= 60;
