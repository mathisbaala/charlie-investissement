-- ============================================================================
-- Resync du label dénormalisé « pea » avec pea_eligible
-- ----------------------------------------------------------------------------
-- Le label JSONB « pea » (posé par populate-screener-labels.py) n'est qu'une
-- dénormalisation de pea_eligible. Après les démotions PEA du jour
-- (20260611130000→170000), 528 fonds gardaient le label « pea » alors que
-- pea_eligible=false. Impact nul aujourd'hui (LABEL_DISPLAY n'affiche pas ce
-- label, le screener filtre sur les colonnes booléennes), mais on resynchronise
-- pour que la dénormalisation suive la source de vérité.
-- (Le label « pea-pme » était déjà cohérent : 0 cas.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS investissement_funds_labels_backup_20260611 AS
SELECT isin, labels
FROM   investissement_funds
WHERE  (labels ? 'pea'     AND pea_eligible     IS DISTINCT FROM TRUE)
   OR  (labels ? 'pea-pme' AND pea_pme_eligible IS DISTINCT FROM TRUE);

ALTER TABLE investissement_funds_labels_backup_20260611 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET    labels = labels - 'pea'
WHERE  labels ? 'pea' AND pea_eligible IS DISTINCT FROM TRUE;

UPDATE investissement_funds
SET    labels = labels - 'pea-pme'
WHERE  labels ? 'pea-pme' AND pea_pme_eligible IS DISTINCT FROM TRUE;
