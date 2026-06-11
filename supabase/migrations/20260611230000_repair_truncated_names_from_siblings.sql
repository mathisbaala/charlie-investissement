-- ============================================================================
-- Réparation des noms tronqués via les share-class siblings
-- ----------------------------------------------------------------------------
-- Certains fonds ont un nom défectueux (code de part « K2 », nom de société de
-- gestion, suffixe « Capital/Gestion/AM ») hérité d'une source qui n'a capté
-- qu'un libellé de compartiment. Quand une AUTRE part du même
-- share_class_group_id porte un nom propre, on le propage à la part défectueuse.
--
-- Portée volontairement étroite : on NE touche PAS aux titres vifs (dont le nom
-- EST légitimement celui de la société, ex. « Allreal Holding AG ») ni aux ~328
-- fonds franco-obscurs à nom-code sans sibling — testé empiriquement, la source
-- de référence (Morningstar/FT) renvoie le même code ou rien (cf. memory
-- data-quality-map). Ces noms sont soit légitimes (fonds à nom court), soit
-- irrécupérables, et seront comblés au mieux par les enrichers planifiés.
--
-- Déjà appliqué en prod via MCP — migration de traçabilité, idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS investissement_funds_name_backup_20260611 (
  isin text, name text, share_class_group_id text
);
ALTER TABLE investissement_funds_name_backup_20260611 ENABLE ROW LEVEL SECURITY;

WITH defective AS (
  SELECT isin, share_class_group_id, name FROM investissement_funds
  WHERE share_class_group_id IS NOT NULL
    AND ( length(btrim(name)) < 5
          OR (management_company_normalized IS NOT NULL AND lower(btrim(name)) = lower(btrim(management_company_normalized)))
          OR name ~* '\m(capital|gestion|asset management|investment management|llp)\s*$' )
), best_sibling AS (
  SELECT d.isin, d.name AS old_name, d.share_class_group_id,
    (SELECT s.name FROM investissement_funds s
     WHERE s.share_class_group_id = d.share_class_group_id AND s.isin <> d.isin
       AND length(btrim(s.name)) >= 6
       AND s.name !~* '\m(capital|gestion|asset management|investment management|llp)\s*$'
       AND NOT (s.management_company_normalized IS NOT NULL AND lower(btrim(s.name)) = lower(btrim(s.management_company_normalized)))
     ORDER BY length(s.name) DESC LIMIT 1) AS good_name
  FROM defective d
)
INSERT INTO investissement_funds_name_backup_20260611 (isin, name, share_class_group_id)
SELECT isin, old_name, share_class_group_id FROM best_sibling WHERE good_name IS NOT NULL;

UPDATE investissement_funds f
SET name = b.good_name
FROM ( SELECT d.isin, d.share_class_group_id,
         (SELECT s.name FROM investissement_funds s
          WHERE s.share_class_group_id = d.share_class_group_id AND s.isin <> d.isin
            AND length(btrim(s.name)) >= 6
            AND s.name !~* '\m(capital|gestion|asset management|investment management|llp)\s*$'
            AND NOT (s.management_company_normalized IS NOT NULL AND lower(btrim(s.name)) = lower(btrim(s.management_company_normalized)))
          ORDER BY length(s.name) DESC LIMIT 1) AS good_name
       FROM investissement_funds d
       WHERE d.share_class_group_id IS NOT NULL
         AND ( length(btrim(d.name)) < 5
               OR (d.management_company_normalized IS NOT NULL AND lower(btrim(d.name)) = lower(btrim(d.management_company_normalized)))
               OR d.name ~* '\m(capital|gestion|asset management|investment management|llp)\s*$' )
     ) b
WHERE f.isin = b.isin AND b.good_name IS NOT NULL;
