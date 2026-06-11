-- ============================================================================
-- Fix asset_class_broad mal classé — réalignement sur category_normalized
-- ----------------------------------------------------------------------------
-- asset_class_broad est dérivé du NOM (classify-from-name.py, règles ordonnées :
-- « diversifie » et « matieres_premieres » passent avant « action »), ce qui
-- mal-classe des fonds d'actions : « Amundi Actions Dynamique » → diversifie,
-- « Amundi Actions Or » → matieres_premieres, fonds obligataires avec une part
-- nommée « ACTION » → action…
--
-- category_normalized (dérivé de la catégorie source AMF/provider) est plus
-- fiable. Quand les deux se contredisent de façon NETTE, on aligne le broad
-- sur la catégorie. On exclut :
--   • product_type='action' (titres vifs → action_individuelle, par design) ;
--   • les fonds alternatifs / short / levier (catégorie Actions mais stratégie
--     absolute return/long-short → alternatif légitime) ;
--   • la contradiction monétaire↔obligation (ultra-short bond : ambiguë, le
--     broad y est souvent meilleur que la catégorie → on ne touche pas).
-- Backup avant modification.
-- ============================================================================

CREATE TABLE IF NOT EXISTS investissement_funds_assetclass_backup_20260611 AS
SELECT isin, name, product_type, category_normalized, asset_class_broad
FROM   investissement_funds
WHERE  ( category_normalized ~* '^actions'
         AND product_type <> 'action'
         AND asset_class_broad IN ('diversifie','matieres_premieres','immobilier','obligation','monetaire')
         AND name !~* '(absolute\s*return|long\s*short|market\s*neutral|hedge|\mshort\M|inverse|2x|3x|levier|leverage)' )
   OR  ( category_normalized ~* '^(obligation|oblig)'
         AND product_type <> 'action'
         AND asset_class_broad IN ('action','diversifie')
         AND name !~* '(absolute\s*return|long\s*short|market\s*neutral|hedge)' );

ALTER TABLE investissement_funds_assetclass_backup_20260611 ENABLE ROW LEVEL SECURITY;

-- Actions : fonds d'actions mal classés diversifie/commodity/immo/oblig/monét
UPDATE investissement_funds
SET    asset_class_broad = 'action'
WHERE  category_normalized ~* '^actions'
  AND  product_type <> 'action'
  AND  asset_class_broad IN ('diversifie','matieres_premieres','immobilier','obligation','monetaire')
  AND  name !~* '(absolute\s*return|long\s*short|market\s*neutral|hedge|\mshort\M|inverse|2x|3x|levier|leverage)';

-- Obligations : fonds obligataires mal classés action/diversifie (token « ACTION » de part)
UPDATE investissement_funds
SET    asset_class_broad = 'obligation'
WHERE  category_normalized ~* '^(obligation|oblig)'
  AND  product_type <> 'action'
  AND  asset_class_broad IN ('action','diversifie')
  AND  name !~* '(absolute\s*return|long\s*short|market\s*neutral|hedge)';
