-- Resync complet du label 'pea' sur la colonne autoritaire pea_eligible
-- =====================================================================
-- Pattern resync_pea_labels (cf. 20260611111126). Corrige la dérive pré-existante
-- (99 fonds éligibles sans label 'pea' + quelques labels orphelins) : le label
-- 'pea' du tableau JSONB `labels` doit être le miroir exact du booléen pea_eligible.
-- Après : pea_eligible TRUE == labels @> ["pea"] (0 dérive).
-- Appliqué en prod via MCP le 21/06/2026.

UPDATE investissement_funds
SET    labels = coalesce(labels,'[]'::jsonb) || '["pea"]'::jsonb
WHERE  pea_eligible IS TRUE AND NOT (coalesce(labels,'[]'::jsonb) ? 'pea');

UPDATE investissement_funds
SET    labels = labels - 'pea'
WHERE  (pea_eligible IS DISTINCT FROM TRUE) AND (labels ? 'pea');
