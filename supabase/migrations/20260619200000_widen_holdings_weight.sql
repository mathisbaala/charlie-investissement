-- ─── Élargir la précision des poids de holdings ──────────────────────────────
-- Contexte : passage du « top 10 » à la composition COMPLÈTE des ETF (constituants
-- émetteur, chantier A). Un ETF large (MSCI World, S&P 500) contient des lignes
-- pondérées < 0,01 % qui, en numeric(6,4), arrondissaient à 0 et violaient le
-- NOT NULL / faussaient la somme des poids.
--   numeric(6,4) : max 99,9999  | plus petit poids non nul = 0,0001 = 0,01 %
--   numeric(9,6) : max 999,999999 | plus petit poids non nul = 0,000001 = 0,0001 %
-- La colonne reste une FRACTION (0,0523 = 5,23 %), cf. convention frais/perf.
ALTER TABLE investissement_fund_holdings
  ALTER COLUMN weight TYPE numeric(9,6);

COMMENT ON COLUMN investissement_fund_holdings.weight IS
  'Poids en fraction (0.052300 = 5,23 %). numeric(9,6) pour capter les petites lignes des compositions complètes.';
