-- ============================================================================
-- Bornes de plausibilité des perfs — toutes classes (suite recompute complet)
-- ----------------------------------------------------------------------------
-- Le recompute complet (workflow compute-metrics) a révélé deux trous au garde
-- initial (qui ne bornait que monétaire/obligataire) :
--   1. un ETF actions (« UBS Factor MSCI USA Low Volatility ») repassait à
--      ~9999% (perf clampée sur une série VL euronext corrompue) — la classe
--      « action » n'avait aucune borne haute ;
--   2. ~19 fonds obligataires SANS série VL (non recalculés, donc hors d'atteinte
--      du garde) gardaient des valeurs héritées de scrapers dans la bande
--      -65/-90% (ETF IG gov/corp à -80% = impossibles).
--
-- On aligne tout l'univers sur les mêmes bornes que PERF_BOUNDS
-- (compute-metrics.py). Bornes hautes actions volontairement larges (lèvent le
-- garbage type clamp, pas le levier 2x/3x). Sans borne : crypto et
-- action_individuelle (titres vifs) — légitimement extrêmes.
--
-- Déjà appliqué en prod via MCP — migration de traçabilité, idempotente.
-- Backup ajouté dans investissement_funds_qa_backup_20260611.
-- ============================================================================

WITH b(acb, lo, hi) AS (VALUES
  ('monetaire',          -25.0,   75.0),
  ('obligation',         -65.0,  250.0),
  ('diversifie',         -90.0,  800.0),
  ('immobilier',         -90.0,  800.0),
  ('alternatif',         -95.0,  800.0),
  ('matieres_premieres', -95.0, 1500.0),
  ('action',            -100.0, 3000.0)
), aff AS (
  SELECT f.isin FROM investissement_funds f JOIN b ON b.acb = f.asset_class_broad
  WHERE (f.performance_1y IS NOT NULL AND (f.performance_1y < b.lo OR f.performance_1y > b.hi))
     OR (f.performance_3y IS NOT NULL AND (f.performance_3y < b.lo OR f.performance_3y > b.hi))
     OR (f.performance_5y IS NOT NULL AND (f.performance_5y < b.lo OR f.performance_5y > b.hi))
)
INSERT INTO investissement_funds_qa_backup_20260611
  (isin, name, asset_class_broad, aum_eur, performance_1y, performance_3y, performance_5y, average_performance, updated_at)
SELECT f.isin, f.name, f.asset_class_broad, f.aum_eur,
       f.performance_1y, f.performance_3y, f.performance_5y, f.average_performance, f.updated_at
FROM   investissement_funds f WHERE f.isin IN (SELECT isin FROM aff);

WITH b(acb, lo, hi) AS (VALUES
  ('monetaire',          -25.0,   75.0),
  ('obligation',         -65.0,  250.0),
  ('diversifie',         -90.0,  800.0),
  ('immobilier',         -90.0,  800.0),
  ('alternatif',         -95.0,  800.0),
  ('matieres_premieres', -95.0, 1500.0),
  ('action',            -100.0, 3000.0)
)
UPDATE investissement_funds f SET
  performance_1y = CASE WHEN f.performance_1y < b.lo OR f.performance_1y > b.hi THEN NULL ELSE f.performance_1y END,
  performance_3y = CASE WHEN f.performance_3y < b.lo OR f.performance_3y > b.hi THEN NULL ELSE f.performance_3y END,
  performance_5y = CASE WHEN f.performance_5y < b.lo OR f.performance_5y > b.hi THEN NULL ELSE f.performance_5y END
FROM b
WHERE b.acb = f.asset_class_broad
  AND ( (f.performance_1y IS NOT NULL AND (f.performance_1y < b.lo OR f.performance_1y > b.hi))
     OR (f.performance_3y IS NOT NULL AND (f.performance_3y < b.lo OR f.performance_3y > b.hi))
     OR (f.performance_5y IS NOT NULL AND (f.performance_5y < b.lo OR f.performance_5y > b.hi)) );
