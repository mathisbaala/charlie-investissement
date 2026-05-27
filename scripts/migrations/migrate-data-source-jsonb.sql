-- ===========================================================================
-- migrate-data-source-jsonb.sql
-- ---------------------------------------------------------------------------
-- Ajout d'une colonne `field_sources JSONB` à `investissement_funds` pour
-- tracer la provenance de chaque champ (TER, performance_1y, sri, …)
-- indépendamment.
--
-- Contexte :
--   - `data_source TEXT` existe déjà et reste utilisé (rétrocompatibilité).
--   - Cette colonne est ajoutée de manière ADDITIVE : aucun code existant
--     ne casse, les nouveaux enrichers peuvent l'utiliser progressivement.
--
-- Structure JSONB attendue :
--   {
--     "ter": {"source": "kid_pdf", "at": "2026-05-19T08:12:00Z"},
--     "performance_1y": {"source": "morningstar", "at": "2026-05-15T..."},
--     "sri": {"source": "kid_pdf", "at": "2026-05-19T..."},
--     ...
--   }
--
-- Forme simplifiée acceptée également (V1, par souci de compacité) :
--   {"ter": "kid_pdf", "performance_1y": "morningstar", ...}
--
-- Convention :
--   - Une clé = un nom de colonne snake_case de investissement_funds.
--   - Une absence de clé = champ non couvert (ou source = data_source legacy).
--   - Une valeur NULL = champ explicitement non sourcé (volontairement effacé).
--
-- Idempotent : peut être ré-exécuté sans effet de bord.
-- ===========================================================================

BEGIN;

-- 1. Ajouter la colonne si elle n'existe pas
ALTER TABLE investissement_funds
    ADD COLUMN IF NOT EXISTS field_sources JSONB DEFAULT '{}'::jsonb;

-- 2. Garantir un type non-NULL (NULL serait ambigu vis-à-vis de l'objet vide)
UPDATE investissement_funds
    SET field_sources = '{}'::jsonb
    WHERE field_sources IS NULL;

-- 3. Contrainte de structure : `field_sources` doit être un objet JSONB
--    (pas un tableau, pas un scalaire). On évite les erreurs d'écriture côté
--    enricher.
ALTER TABLE investissement_funds
    DROP CONSTRAINT IF EXISTS investissement_funds_field_sources_object;

ALTER TABLE investissement_funds
    ADD CONSTRAINT investissement_funds_field_sources_object
        CHECK (jsonb_typeof(field_sources) = 'object');

-- 4. Index GIN pour permettre des requêtes du type :
--    SELECT … WHERE field_sources @> '{"ter": "kid_pdf"}'
--    SELECT … WHERE field_sources ? 'sri'
CREATE INDEX IF NOT EXISTS investissement_funds_field_sources_gin
    ON investissement_funds USING GIN (field_sources);

-- 5. Commentaire de documentation embarqué
COMMENT ON COLUMN investissement_funds.field_sources IS
    'Traçabilité par champ : {"<col>": "<source>" | {"source": "...", "at": "..."}}. '
    'Coexiste avec data_source (legacy) tant que les enrichers n''ont pas migré.';

COMMIT;

-- ---------------------------------------------------------------------------
-- VÉRIFICATIONS POST-MIGRATION (à exécuter manuellement après le COMMIT)
-- ---------------------------------------------------------------------------
-- 1. Colonne créée ?
--    SELECT column_name, data_type, column_default
--    FROM information_schema.columns
--    WHERE table_name = 'investissement_funds' AND column_name = 'field_sources';
--
-- 2. Index créé ?
--    SELECT indexname FROM pg_indexes
--    WHERE tablename = 'investissement_funds' AND indexname = 'investissement_funds_field_sources_gin';
--
-- 3. Distribution post-backfill (après avoir lancé migrate-data-source.py --apply) :
--    SELECT
--      jsonb_object_keys(field_sources) AS field,
--      COUNT(*) AS n
--    FROM investissement_funds
--    WHERE field_sources <> '{}'::jsonb
--    GROUP BY 1
--    ORDER BY 2 DESC
--    LIMIT 30;
-- ---------------------------------------------------------------------------
