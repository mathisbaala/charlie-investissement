-- Chantier #2 — Re-gate PEA sur la composition (investissement_fund_geos)
-- =======================================================================
-- Vague PEA du 19/06 : ~432 fonds actions « en attente de compo » (éligibilité
-- PEA dépend de ≥75% d'actions UE/EEE, mais la compo n'était pas dispo). Depuis,
-- les drains holdings (Morningstar EMEA, issuer iShares/Amundi/Xtrackers, justetf)
-- ont enrichi `investissement_fund_geos`. On re-gate :
--   • fraction UE/EEE calculée par source — ISO2 réels (issuer:*/justetf, couverture
--     ≥80%) OU FT via country_label='Eurozone' normalisé par les régions top
--     mutuellement exclusives (Greater Europe / Americas / Greater Asia, denom ≥80%).
--     La géo Morningstar coarse (super-régions EU avec CH inclus / UK exclu) est
--     volontairement écartée du gate.
--   • bascule à TRUE si eu_frac ≥ 80% (seuil légal 75%, marge de prudence).
-- Garde-fous :
--   • asset_class_broad='action' (≠ asset_class='actions' qui contient des ETF
--     obligataires faussement classés actions → 100% UE mais NON PEA).
--   • garde cohérence-nom (exclut World/ex-Europe/EM/US/Asie/Bund/short… : la compo
--     FT est parfois fausse).
--   • JAMAIS toucher un fonds dont le nom contient « pea » (ETF synthétiques type
--     Amundi PEA S&P 500 = éligibles malgré sous-jacents US).
--   • retraits par LISTE EXPLICITE seulement (5 ETF hors-UE, nom+compo concordants) :
--     un faux négatif est pire qu'un faux positif pour un CGP → pas d'UPDATE balayant.
-- Résultat : +118 à TRUE, −5 délistés (2956 → 3069).
-- Appliqué en prod via MCP le 21/06/2026 (fichier = trace reproductible).

CREATE TABLE IF NOT EXISTS investissement_funds_pea_backup_20260621 AS
SELECT isin, name, product_type, asset_class_broad, category_normalized, pea_eligible, labels
FROM   investissement_funds WHERE asset_class_broad='action';
ALTER TABLE investissement_funds_pea_backup_20260621 ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE pea_flip AS
WITH eu AS (SELECT unnest(ARRAY['FR','DE','IT','ES','NL','BE','AT','PT','FI','IE','LU','SE','DK',
  'PL','CZ','RO','HU','SK','BG','HR','SI','EE','LV','LT','CY','MT','GR','NO','IS','LI']) AS cc),
iso AS (SELECT isin, sum(weight) tot, sum(weight) FILTER (WHERE country_code IN (SELECT cc FROM eu)) eu_w
        FROM investissement_fund_geos
        WHERE source IN ('issuer:ishares','issuer:amundi','issuer:xtrackers','justetf') GROUP BY isin),
iso_eu AS (SELECT isin, eu_w/NULLIF(tot,0) eu_frac FROM iso WHERE tot>=0.80),
ft AS (SELECT isin, max(weight) FILTER (WHERE country_label='Greater Europe') gr_eu,
              max(weight) FILTER (WHERE country_label='Eurozone') eurozone,
              max(weight) FILTER (WHERE country_label='Americas') americas,
              max(weight) FILTER (WHERE country_label='Greater Asia') asia
       FROM investissement_fund_geos WHERE source='financial-times' GROUP BY isin),
ft_eu AS (SELECT isin, eurozone/NULLIF(coalesce(gr_eu,0)+coalesce(americas,0)+coalesce(asia,0),0) eu_frac,
                 coalesce(gr_eu,0)+coalesce(americas,0)+coalesce(asia,0) denom FROM ft),
best AS (SELECT f.isin, CASE WHEN i.eu_frac IS NOT NULL THEN i.eu_frac
                             WHEN t.denom>=0.80 THEN t.eu_frac END eu_frac
         FROM investissement_funds f LEFT JOIN iso_eu i ON i.isin=f.isin LEFT JOIN ft_eu t ON t.isin=f.isin)
SELECT b.isin
FROM   investissement_funds f JOIN best b ON b.isin=f.isin
WHERE  f.pea_eligible IS NOT TRUE
  AND  f.asset_class_broad='action'
  AND  coalesce(f.category_normalized,'') !~* '(oblig|bond|monétaire|monetaire|money market)'
  AND  b.eu_frac >= 0.80
  AND  f.name !~* '(ex.?europe|ex.?emu|\mworld\M|\mmonde\M|\mglobal\M|emerging|emergent|\bmsci em\b|middle east|africa|\mwater\M|new energy|\busa\M|nasdaq|s&p|china|chine|japan|japon|\masia\M|\masie\M|bund|\mshort\M|inverse|daily \(-|leverage|2x|3x)';

UPDATE investissement_funds SET pea_eligible = TRUE WHERE isin IN (SELECT isin FROM pea_flip);
UPDATE investissement_funds
SET    labels = coalesce(labels,'[]'::jsonb) || '["pea"]'::jsonb
WHERE  isin IN (SELECT isin FROM pea_flip) AND NOT (coalesce(labels,'[]'::jsonb) ? 'pea');

UPDATE investissement_funds SET pea_eligible = FALSE
WHERE  isin IN ('LU1681045537','LU0292109005','FR0010527275','IE00BZ0PKT83','FR0010524777')
  AND  name NOT ILIKE '%pea%';
UPDATE investissement_funds SET labels = labels - 'pea'
WHERE  isin IN ('LU1681045537','LU0292109005','FR0010527275','IE00BZ0PKT83','FR0010524777')
  AND  labels ? 'pea';

DROP TABLE pea_flip;
