-- derive-sector-region-from-category.sql
-- Enrichissement FILL-ONLY de `sector` et `region_normalized` à partir de la
-- classification `category` (AMF / fournisseur), déjà présente sur 94 % des OPCVM
-- investables. Idempotent (ne touche que les valeurs NULL), traçabilité field_sources.
-- Appliqué le 05/06/2026 : sector 13→77 % sur les OPCVM investables.
--
-- Principe : la category encode l'asset-class + la région ; seules les
-- « Actions Sectorielles X » désignent un secteur précis. Les fonds diversifiés /
-- géographiques / mixtes reçoivent `Multisecteur` (valeur honnête qui rend le
-- filtre secteur utilisable au lieu de NULL). Les obligations/monétaires restent
-- NULL en secteur (le secteur est un concept actions).

-- ── SECTEUR ───────────────────────────────────────────────────────────────────
WITH m AS (
  SELECT isin,
    CASE
      WHEN category ILIKE '%sectorielles technologies%' THEN 'Technologie'
      WHEN category ILIKE '%sectorielles santé%' OR category ILIKE '%biotech%' THEN 'Santé'
      WHEN category ILIKE '%sectorielles environnement%' THEN 'Environnement'
      WHEN category ILIKE '%sectorielles%nergie%' OR category ILIKE '%mati%res premi%res%' THEN 'Énergie'
      WHEN category ILIKE '%sectorielles or%' THEN 'Matériaux'
      WHEN category ILIKE '%sectorielles consommation%' THEN 'Consommation'
      WHEN category ILIKE '%services aux collectivit%' THEN 'Utilities'
      WHEN category ILIKE '%services financiers%' THEN 'Finance'
      WHEN category ILIKE '%sectorielles telecom%' THEN 'Communication'
      WHEN category ILIKE '%sectorielles industrie%' THEN 'Industrie'
      WHEN category ILIKE '%immobilier%' OR asset_class_broad = 'immobilier' THEN 'Immobilier'
      WHEN category ILIKE 'actions%' OR category ILIKE 'fonds actions' OR category ILIKE 'fonds mixtes'
           OR category ILIKE 'allocation%' OR category ILIKE '%multi classe%'
           OR asset_class_broad IN ('action','diversifie') THEN 'Multisecteur'
    END AS sec
  FROM investissement_funds
  WHERE sector IS NULL AND category IS NOT NULL
)
UPDATE investissement_funds f
SET sector = m.sec,
    field_sources = COALESCE(f.field_sources,'{}'::jsonb) || jsonb_build_object('sector','derived-from-category')
FROM m WHERE f.isin = m.isin AND m.sec IS NOT NULL;

-- ── RÉGION ────────────────────────────────────────────────────────────────────
WITH m AS (
  SELECT isin,
    CASE
      WHEN category ~* 'japon|japan' THEN 'japan'
      WHEN category ~* '\mchine\M|chinese|china' THEN 'china'
      WHEN category ~* '\minde\M|india' THEN 'india'
      WHEN category ~* 'br[ée]sil|brazil' THEN 'brazil'
      WHEN category ~* 'royaume-uni|united kingdom' THEN 'uk'
      WHEN category ~* 'allemagne|germany' THEN 'germany'
      WHEN category ~* 'suisse|switzerland' THEN 'switzerland'
      WHEN category ~* '(emergent|emerging).*(asie|asia)|(asie|asia).*(emergent|emerging)' THEN 'asia'
      WHEN category ~* 'emergent|emerging' THEN 'emerging'
      WHEN category ~* '\masie\M|\masia\M|pacifiqu|pacific' THEN 'asia'
      WHEN category ~* 'etats-unis|états-unis|am[ée]rique du nord|nord-am[ée]ric|united states|am[ée]rique' THEN 'usa'
      WHEN category ~* 'fran[çc]aises?|\mfrance\M' THEN 'france'
      WHEN category ~* 'zone euro|union europ|pays de l.?union|\meurope\M|europ[ée]en' THEN 'europe'
      WHEN category ~* 'internationa|\mmonde\M|mondial|\mglobal' THEN 'world'
    END AS reg
  FROM investissement_funds
  WHERE region_normalized IS NULL AND category IS NOT NULL
)
UPDATE investissement_funds f
SET region_normalized = m.reg,
    field_sources = COALESCE(f.field_sources,'{}'::jsonb) || jsonb_build_object('region_normalized','derived-from-category')
FROM m WHERE f.isin = m.isin AND m.reg IS NOT NULL;
