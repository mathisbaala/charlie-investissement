-- Index DB pour le screener CGP
-- À exécuter une fois dans Supabase SQL Editor : https://supabase.com/dashboard/project/dehigtgzizsdehyhmjxn/sql
-- Durée estimée : 2-3 minutes (35 988 fonds)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_sfdr
  ON investissement_funds(sfdr_article);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_sri
  ON investissement_funds(sri);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_ter
  ON investissement_funds(ongoing_charges);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_pea
  ON investissement_funds(is_pea_eligible);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_av
  ON investissement_funds(is_av_eligible);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_per
  ON investissement_funds(is_per_eligible);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_completeness
  ON investissement_funds(data_completeness);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_type_completeness
  ON investissement_funds(product_type, data_completeness);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_funds_name_gin
  ON investissement_funds USING gin(to_tsvector('french', coalesce(name, '')));
