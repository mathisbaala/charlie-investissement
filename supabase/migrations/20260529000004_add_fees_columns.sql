-- ─── Colonnes frais détaillés (KID PRIIPS) ───────────────────────────────────
-- Complète ongoing_charges (frais courants) avec les frais transactionnels.
-- Toutes les valeurs sont stockées en fraction décimale (0.03 = 3 %).
--
-- entry_fee_max      : frais d'entrée maximum (commission souscription)
-- exit_fee_max       : frais de sortie maximum (commission rachat)
-- performance_fee    : commission de surperformance (si applicable)
-- retrocession_cgp   : rétrocession CGP (critique pour usage CGP)
-- holding_period_years: durée de détention recommandée (en années, entier)

ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS entry_fee_max        numeric(8,6),
  ADD COLUMN IF NOT EXISTS exit_fee_max         numeric(8,6),
  ADD COLUMN IF NOT EXISTS performance_fee      numeric(8,6),
  ADD COLUMN IF NOT EXISTS retrocession_cgp     numeric(8,6),
  ADD COLUMN IF NOT EXISTS holding_period_years smallint;

-- Index utiles screener (ex: filtrer fonds sans frais d'entrée)
CREATE INDEX IF NOT EXISTS idx_funds_entry_fee_max    ON investissement_funds (entry_fee_max)    WHERE entry_fee_max    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funds_performance_fee  ON investissement_funds (performance_fee)  WHERE performance_fee  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funds_retrocession_cgp ON investissement_funds (retrocession_cgp) WHERE retrocession_cgp IS NOT NULL;

-- ETF ont des frais d'entrée nuls par défaut (échangés en bourse)
UPDATE investissement_funds
SET entry_fee_max = 0, exit_fee_max = 0
WHERE product_type = 'etf'
  AND entry_fee_max IS NULL;
