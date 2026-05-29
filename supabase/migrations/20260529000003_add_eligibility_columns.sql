-- ─── Colonnes éligibilités enveloppes ───────────────────────────────────────
-- Complète pea_eligible / per_eligible / av_lux_eligible déjà existants.
-- av_fr_eligible  : Assurance-Vie France (contrats français)
-- pea_pme_eligible: PEA-PME (fonds actions PME <1Md€ de capitalisation)
-- cto_eligible    : Compte-Titres Ordinaire

ALTER TABLE investissement_funds
  ADD COLUMN IF NOT EXISTS av_fr_eligible   boolean,
  ADD COLUMN IF NOT EXISTS pea_pme_eligible boolean,
  ADD COLUMN IF NOT EXISTS cto_eligible     boolean;

-- Index pour filtrage screener
CREATE INDEX IF NOT EXISTS idx_funds_av_fr_eligible   ON investissement_funds (av_fr_eligible)   WHERE av_fr_eligible  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funds_pea_pme_eligible ON investissement_funds (pea_pme_eligible) WHERE pea_pme_eligible IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funds_cto_eligible     ON investissement_funds (cto_eligible)     WHERE cto_eligible    IS NOT NULL;

-- ─── Peuplement initial par règles métier ────────────────────────────────────

-- CTO : tout instrument hors fonds euros et livrets
UPDATE investissement_funds
SET cto_eligible = TRUE
WHERE product_type IN ('opcvm','etf','fcp','sicav','action','obligation','fps','fpci','fcpr','opci','scpi','crypto')
  AND cto_eligible IS NULL;

UPDATE investissement_funds
SET cto_eligible = FALSE
WHERE product_type IN ('fonds_euros','livret')
  AND cto_eligible IS NULL;

-- AV-France : OPCVM/ETF UCITS domiciliés FR/LU/IE + fonds euros (par nature AV)
UPDATE investissement_funds
SET av_fr_eligible = TRUE
WHERE product_type IN ('opcvm','etf','fcp','sicav')
  AND (isin LIKE 'FR%' OR isin LIKE 'LU%' OR isin LIKE 'IE%')
  AND av_fr_eligible IS NULL;

UPDATE investissement_funds
SET av_fr_eligible = TRUE
WHERE product_type = 'fonds_euros'
  AND av_fr_eligible IS NULL;

-- Actions/obligations individuelles : pas éligibles AV directement (sauf via OPCVM)
UPDATE investissement_funds
SET av_fr_eligible = FALSE
WHERE product_type IN ('action','obligation','crypto','livret')
  AND av_fr_eligible IS NULL;

-- PEA-PME : fonds avec "PME" ou "small" dans le nom ou la catégorie normalisée
UPDATE investissement_funds
SET pea_pme_eligible = TRUE
WHERE product_type IN ('opcvm','etf','fcp','sicav')
  AND pea_eligible = TRUE
  AND (
    name ILIKE '%pea-pme%' OR name ILIKE '%pea pme%' OR name ILIKE '%peapme%'
    OR name ILIKE '%small cap%' OR name ILIKE '% pme %' OR name ILIKE '%petites%'
    OR category_normalized ILIKE '%small%' OR category_normalized ILIKE '%pme%'
    OR category_normalized ILIKE '%micro cap%' OR category_normalized ILIKE '%mid cap%'
  )
  AND pea_pme_eligible IS NULL;

-- Tout le reste en FALSE explicite (non éligible PEA-PME)
UPDATE investissement_funds
SET pea_pme_eligible = FALSE
WHERE pea_pme_eligible IS NULL
  AND product_type NOT IN ('fps','fpci','fcpr');
-- fps/fpci/fcpr restent NULL (fonds pro, cas à part)
