-- ============================================================================
-- Resync des labels dénormalisés « per » / « av-lux » avec les booléens
-- ----------------------------------------------------------------------------
-- Suite de 20260611190000 (titres vifs démotés PER/AV). Les labels JSONB
-- « per »/« av-lux » (posés par populate-screener-labels.py) sont une simple
-- dénormalisation de per_eligible/av_lux_eligible → on les resynchronise.
-- Impact UI nul (LABEL_DISPLAY n'affiche que les labels ESG), pure hygiène.
-- ============================================================================

CREATE TABLE IF NOT EXISTS investissement_funds_per_avlux_labels_backup_20260611 AS
SELECT isin, labels
FROM   investissement_funds
WHERE  (labels ? 'per'    AND per_eligible    IS DISTINCT FROM TRUE)
   OR  (labels ? 'av-lux' AND av_lux_eligible IS DISTINCT FROM TRUE);

ALTER TABLE investissement_funds_per_avlux_labels_backup_20260611 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET    labels = labels - 'per'
WHERE  labels ? 'per' AND per_eligible IS DISTINCT FROM TRUE;

UPDATE investissement_funds
SET    labels = labels - 'av-lux'
WHERE  labels ? 'av-lux' AND av_lux_eligible IS DISTINCT FROM TRUE;
