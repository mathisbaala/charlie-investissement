-- Chantier #3 — Fonds euros FE_Q : performance_1y = taux extrait du NOM
-- ====================================================================
-- Artefact de seed Quantalys : pour 43 fonds euros FE_Q_QUA*, performance_1y
-- était égale au nombre littéralement présent dans le nom (ex. « 5 SUR 5 EUR 4,5% »
-- → 4.5 ; « 2012-2013 : 3,375% FONDS GARANTI » → 3.375 ; parfois un % de
-- participation aux bénéfices ou un taux de vintage ancien). Ce n'est PAS une
-- vraie performance 1 an, et ces fonds sont hors mapping GVFM (pas de source de
-- taux réelle). performance_3y/5y étaient déjà null (nettoyage 19/06). On NULL
-- donc performance_1y pour ne pas afficher une perf trompeuse.
-- Vérifié : 43/43 ont leur valeur perf_1y présente dans le nom.
-- Appliqué en prod via MCP le 21/06/2026 (fichier = trace reproductible).

CREATE TABLE IF NOT EXISTS investissement_funds_feq_perf_backup_20260621 AS
SELECT isin, name, performance_1y, performance_3y, performance_5y, labels
FROM   investissement_funds
WHERE  isin LIKE 'FE_Q%' AND performance_1y IS NOT NULL;
ALTER TABLE investissement_funds_feq_perf_backup_20260621 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET    performance_1y = NULL
WHERE  isin LIKE 'FE_Q%' AND performance_1y IS NOT NULL;

-- Un fonds sans aucune perf ne peut pas porter le label « top-performer ».
UPDATE investissement_funds
SET    labels = labels - 'top-performer'
WHERE  isin LIKE 'FE_Q%'
  AND  labels ? 'top-performer'
  AND  performance_1y IS NULL AND performance_3y IS NULL AND performance_5y IS NULL;
