-- Réparation d'un spike NAV ponctuel unique — IE00BD4TY451 (UBS MSCI Australia)
-- 24/06 : la série est propre SAUF un point isolé le 2025-10-20 (nav=52.971,
-- voisins 26.910 et 27.535 → ×1,97 puis ÷0,52). Spike d'ingestion isolé qui
-- gonflait volatility_1y à 90,2. Remplacé par l'interpolation linéaire des
-- voisins (27.223). Série désormais mono-échelle propre → la métrique sera
-- recalculée correctement au prochain run compute-metrics (autorité), puis la
-- garde __insane cessera de la masquer.
-- Backup réversible : investissement_fund_prices_spike_backup_20260624 (RLS).

CREATE TABLE IF NOT EXISTS investissement_fund_prices_spike_backup_20260624 AS
SELECT * FROM investissement_fund_prices
WHERE isin='IE00BD4TY451' AND price_date='2025-10-20';
ALTER TABLE investissement_fund_prices_spike_backup_20260624 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_fund_prices
SET nav = round((26.910 + 27.535)/2, 3)   -- = 27.223
WHERE isin='IE00BD4TY451' AND price_date='2025-10-20' AND nav > 50;

-- REVERT : UPDATE investissement_fund_prices p SET nav=b.nav
--   FROM investissement_fund_prices_spike_backup_20260624 b
--   WHERE p.isin=b.isin AND p.price_date=b.price_date;
