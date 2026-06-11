-- ============================================================================
-- Fix faux positifs éligibilité PEA-PME (et PEA hors-UE associé)
-- ----------------------------------------------------------------------------
-- Contexte : la règle initiale (20260529000003 + enrich-eligibility.py) marquait
-- PEA-PME éligible tout fonds dont le NOM contient « small cap / mid cap /
-- micro cap ». Or « small cap » n'est PAS un critère PEA-PME : le PEA-PME est un
-- agrément réglementaire (≥75 % de titres de PME-ETI européennes éligibles),
-- déclaré fonds par fonds. Résultat : ~39 faux positifs, dont des ETF USA/World/
-- Japon qui ne sont même pas éligibles PEA.
--
-- Correctif :
--   1. On ne garde PEA-PME=TRUE que pour les fonds au nom explicitement
--      PME / PEA-PME / PME-ETI / petites entreprises (haute précision).
--   2. On démote les ETF small-cap hors-UE (réplication physique, jamais
--      labellisés PEA) en pea_eligible=FALSE.
-- Backup des valeurs avant modification dans une table dédiée.
-- ============================================================================

-- ── Backup ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investissement_funds_elig_backup_20260611 AS
SELECT isin, name, product_type, region_normalized, pea_eligible, pea_pme_eligible
FROM   investissement_funds
WHERE  pea_pme_eligible IS TRUE;

ALTER TABLE investissement_funds_elig_backup_20260611 ENABLE ROW LEVEL SECURITY;

-- ── 1. Démotion PEA-PME : tout ce qui n'est pas explicitement PME ───────────
UPDATE investissement_funds
SET    pea_pme_eligible = FALSE
WHERE  pea_pme_eligible IS TRUE
  AND  NOT (
        name ILIKE '%pea-pme%' OR name ILIKE '%pea pme%' OR name ILIKE '%peapme%'
     OR name ILIKE '%pme eti%' OR name ILIKE '%pme-eti%'
     OR name ~* '\mpme\M'      OR name ILIKE '%petites%'
  );

-- ── 2. Démotion PEA : ETF small-cap hors-UE (réplication physique) ──────────
-- Liste explicite (ISIN) pour ne pas toucher les ETF synthétiques PEA-éligibles
-- (Amundi PEA S&P 500 / Nasdaq / MSCI World, etc.).
UPDATE investissement_funds
SET    pea_eligible = FALSE
WHERE  isin IN (
  'IE00050J4789',  -- BNP Paribas Easy MSCI USA Small Cap
  'IE00B2QWDY88',  -- iShares MSCI JA(pan) Small Cap
  'IE00B3VWM098',  -- iShares MSCI USA Small Cap CTB
  'IE00BF4RFH31',  -- iShares MSCI World Small Cap
  'IE00B3CNHJ55',  -- L&G Russell 2000 US Small Cap
  'IE000F2IX674',  -- State Street World Small Cap
  'IE000F354Q61'   -- Xtrackers MSCI World Small Cap
);
