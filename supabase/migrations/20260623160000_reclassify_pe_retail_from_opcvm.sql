-- Lot 2 / chantier 1 : reclassification du Private Equity retail mal classé.
-- ~255 FIP/FCPI/FCPR portent leur forme juridique EXPLICITE dans le nom mais étaient
-- typés product_type='opcvm' → invisibles en tant que PE et impossibles à filtrer.
-- (Les 193 FPCI et 5 FCPR déjà bien typés ne sont pas touchés.)
--
-- Détection STRICTE par jeton légal en frontière de mot (\yfip\y, etc.) — vérifié sans
-- collision (chaque fonds matche exactement un jeton). Le « private equity / capital
-- investissement » ambigu (17 fonds) est VOLONTAIREMENT laissé en opcvm (faux positifs).
-- Réversible via le backup. classify-from-name étant fill-only, ce re-typage d'un
-- product_type DÉJÀ posé doit être fait explicitement ici (l'enricher ne l'écraserait pas).

CREATE TABLE IF NOT EXISTS investissement_funds_pe_reclass_backup_20260623 AS
SELECT isin, product_type
FROM investissement_funds
WHERE product_type = 'opcvm'
  AND name ~* '\yfpci\y|\yfcpi\y|\yfcpr\y|\yfip\y';

ALTER TABLE investissement_funds_pe_reclass_backup_20260623 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET product_type = CASE
    WHEN name ~* '\yfpci\y' THEN 'fpci'
    WHEN name ~* '\yfcpi\y' THEN 'fcpi'
    WHEN name ~* '\yfcpr\y' THEN 'fcpr'
    WHEN name ~* '\yfip\y'  THEN 'fip'
  END
WHERE product_type = 'opcvm'
  AND name ~* '\yfpci\y|\yfcpi\y|\yfcpr\y|\yfip\y';
