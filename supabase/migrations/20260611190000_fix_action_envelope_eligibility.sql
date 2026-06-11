-- ============================================================================
-- Fix faux positifs PER / AV-FR / AV-LUX sur les titres vifs (actions)
-- ----------------------------------------------------------------------------
-- 156 actions en direct (LVMH, Air Liquide, BNP…) étaient marquées
-- per_eligible / av_fr_eligible / av_lux_eligible = TRUE (héritage d'un seed
-- antérieur à 20260529000003, dont le garde `IS NULL` ne les a pas corrigées).
--
-- Or ces enveloppes ne détiennent pas de titres vifs :
--   • PER : uniquement des supports (UC/fonds), jamais d'actions en direct.
--   • AV (FR & LUX) : des UC (fonds), pas de titres vifs (hors private banking
--     marginal, non pertinent pour un screener retail).
-- pea_eligible et cto_eligible restent TRUE (corrects pour une action UE).
-- Backup avant modification.
-- ============================================================================

CREATE TABLE IF NOT EXISTS investissement_funds_action_elig_backup_20260611 AS
SELECT isin, name, per_eligible, av_fr_eligible, av_lux_eligible
FROM   investissement_funds
WHERE  product_type = 'action'
  AND  (per_eligible IS TRUE OR av_fr_eligible IS TRUE OR av_lux_eligible IS TRUE);

ALTER TABLE investissement_funds_action_elig_backup_20260611 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET    per_eligible    = FALSE,
       av_fr_eligible  = FALSE,
       av_lux_eligible = FALSE
WHERE  product_type = 'action'
  AND  (per_eligible IS TRUE OR av_fr_eligible IS TRUE OR av_lux_eligible IS TRUE);
