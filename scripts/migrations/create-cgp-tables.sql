-- ===========================================================================
-- create-cgp-tables.sql
-- ---------------------------------------------------------------------------
-- Tables pour l'agrégation des portefeuilles clients des CGP.
-- Sprint 1 : connecteur Generali Genepro (import PDF/CSV manuel).
-- Sprint 2 : réplication Cardif Finagora, Suravenir, Spirica.
--
-- Architecture :
--   cgp_clients      → un client par cabinet CGP
--   cgp_contracts    → un contrat AV par client × assureur
--   cgp_positions    → positions snapshot par contrat × date
--   cgp_transactions → mouvements (versements, rachats, arbitrages)
--
-- Le JOIN cgp_positions.isin → investissement_funds donne accès à TER,
-- SRI, SFDR, performance, asset_class sans aucune duplication.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. cgp_clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cgp_clients (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    cgp_id      UUID        NOT NULL,   -- cabinet CGP propriétaire (auth.users)
    client_ref  TEXT        NOT NULL,   -- référence interne Genepro/assureur
    last_name   TEXT        NOT NULL,
    first_name  TEXT,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cgp_clients_cgp_ref_unique UNIQUE (cgp_id, client_ref)
);

CREATE INDEX IF NOT EXISTS cgp_clients_cgp_idx ON cgp_clients (cgp_id);

COMMENT ON TABLE cgp_clients IS
    'Clients gérés par un cabinet CGP. client_ref = identifiant dans le portail assureur.';

-- ---------------------------------------------------------------------------
-- 2. cgp_contracts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cgp_contracts (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID        NOT NULL REFERENCES cgp_clients (id) ON DELETE CASCADE,
    cgp_id              UUID        NOT NULL,
    insurer             TEXT        NOT NULL,   -- 'generali'|'cardif'|'suravenir'|'spirica'
    contract_number     TEXT        NOT NULL,   -- N° de contrat assureur
    contract_name       TEXT,                   -- "Generali Patrimoine", "Cardif Liberté..."
    opening_date        DATE,
    total_value_eur     NUMERIC(18,2),          -- valorisation au dernier relevé
    last_valuation_date DATE,
    source_file         TEXT,                   -- nom du fichier source importé
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cgp_contracts_cgp_contract_unique UNIQUE (cgp_id, contract_number)
);

CREATE INDEX IF NOT EXISTS cgp_contracts_client_idx   ON cgp_contracts (client_id);
CREATE INDEX IF NOT EXISTS cgp_contracts_cgp_idx      ON cgp_contracts (cgp_id);
CREATE INDEX IF NOT EXISTS cgp_contracts_insurer_idx  ON cgp_contracts (insurer);

COMMENT ON TABLE cgp_contracts IS
    'Contrats d''assurance-vie. Un client peut avoir plusieurs contrats chez plusieurs assureurs.';

-- ---------------------------------------------------------------------------
-- 3. cgp_positions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cgp_positions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id     UUID        NOT NULL REFERENCES cgp_contracts (id) ON DELETE CASCADE,
    isin            TEXT        NOT NULL,       -- → investissement_funds (JOIN)
    fund_name       TEXT,                       -- libellé brut du relevé
    units           NUMERIC(18,6),              -- nombre de parts
    unit_value      NUMERIC(18,4),              -- valeur liquidative unitaire
    value_eur       NUMERIC(18,2) NOT NULL,     -- valorisation totale en €
    weight_pct      NUMERIC(7,4),               -- % du contrat
    valuation_date  DATE        NOT NULL,
    source_file     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- idempotent : un fonds ne peut apparaître qu'une fois par contrat × date
    CONSTRAINT cgp_positions_contract_isin_date_unique
        UNIQUE (contract_id, isin, valuation_date)
);

CREATE INDEX IF NOT EXISTS cgp_positions_contract_idx ON cgp_positions (contract_id);
CREATE INDEX IF NOT EXISTS cgp_positions_isin_idx     ON cgp_positions (isin);
CREATE INDEX IF NOT EXISTS cgp_positions_date_idx     ON cgp_positions (valuation_date DESC);

COMMENT ON TABLE cgp_positions IS
    'Positions snapshot. JOIN sur investissement_funds via isin pour TER/SRI/perf/SFDR.';

-- ---------------------------------------------------------------------------
-- 4. cgp_transactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cgp_transactions (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id       UUID        NOT NULL REFERENCES cgp_contracts (id) ON DELETE CASCADE,
    isin              TEXT,                   -- NULL si versement global sans support
    fund_name         TEXT,
    transaction_type  TEXT        NOT NULL,   -- 'versement'|'rachat'|'arbitrage_in'|'arbitrage_out'|'frais'
    amount_eur        NUMERIC(18,2) NOT NULL,
    units             NUMERIC(18,6),
    unit_value        NUMERIC(18,4),
    transaction_date  DATE        NOT NULL,
    description       TEXT,
    source_file       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cgp_transactions_dedup_unique
        UNIQUE (contract_id, transaction_type, transaction_date, isin, amount_eur)
);

CREATE INDEX IF NOT EXISTS cgp_transactions_contract_idx ON cgp_transactions (contract_id);
CREATE INDEX IF NOT EXISTS cgp_transactions_isin_idx     ON cgp_transactions (isin);
CREATE INDEX IF NOT EXISTS cgp_transactions_date_idx     ON cgp_transactions (transaction_date DESC);
CREATE INDEX IF NOT EXISTS cgp_transactions_type_idx     ON cgp_transactions (transaction_type);

COMMENT ON TABLE cgp_transactions IS
    'Mouvements : versements, rachats, arbitrages. isin NULL pour versements globaux.';

COMMIT;

-- ---------------------------------------------------------------------------
-- REQUÊTES UTILES
-- ---------------------------------------------------------------------------
--
-- Portefeuille d'un client avec enrichissement fund :
--   SELECT
--     p.isin, p.fund_name, p.value_eur, p.weight_pct,
--     f.ongoing_charges AS ter, f.sri, f.sfdr_article,
--     f.performance_1y, f.asset_class
--   FROM cgp_positions p
--   LEFT JOIN investissement_funds f ON f.isin = p.isin
--   WHERE p.contract_id = '<uuid>'
--     AND p.valuation_date = (
--       SELECT MAX(valuation_date) FROM cgp_positions
--       WHERE contract_id = '<uuid>'
--     )
--   ORDER BY p.value_eur DESC;
--
-- Exposition par classe d'actifs pour un CGP :
--   SELECT
--     f.asset_class,
--     SUM(p.value_eur)                                AS total_eur,
--     SUM(p.value_eur) * 100.0 / SUM(SUM(p.value_eur)) OVER () AS pct
--   FROM cgp_positions p
--   JOIN cgp_contracts c  ON c.id  = p.contract_id
--   LEFT JOIN investissement_funds f ON f.isin = p.isin
--   WHERE c.cgp_id = '<uuid>'
--     AND p.valuation_date = CURRENT_DATE
--   GROUP BY f.asset_class
--   ORDER BY total_eur DESC;
-- ---------------------------------------------------------------------------
