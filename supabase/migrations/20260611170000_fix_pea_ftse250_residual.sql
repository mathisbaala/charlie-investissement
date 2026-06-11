-- ============================================================================
-- Fix résiduel PEA — AMUNDI ETF FTSE 250 (UK)
-- ----------------------------------------------------------------------------
-- Faux positif rescapé des vagues 20260611140000/150000 : ce fonds était
-- product_type='opcvm' au moment de la vague OPCVM, et son category_normalized
-- 'Actions Europe' l'a fait protéger par le garde-fou catégorie. Or le FTSE 250
-- est l'indice UK mid-cap — le UK est hors PEA depuis le Brexit. Reclassé 'etf'
-- ensuite (20260611160000), il restait donc marqué PEA à tort.
-- (Les FTSE MIB région 'uk' sont eux l'indice ITALIEN → UE → PEA, on n'y touche pas.)
-- ============================================================================

UPDATE investissement_funds
SET    pea_eligible = FALSE
WHERE  isin = 'FR0010988626'    -- AMUNDI ETF FTSE 250 UCITS ETF
  AND  pea_eligible IS TRUE;
