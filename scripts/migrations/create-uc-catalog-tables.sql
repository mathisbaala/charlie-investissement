-- Migration : tables catalogue UC par contrat assureur
-- Créer AVANT de lancer uc-catalog-linxea-morningstar.py
--
-- Deux tables :
--   investissement_insurer_contracts  — catalogue des contrats assureurs (Linxea Avenir 2, etc.)
--   investissement_contract_uc        — jonction contrat ↔ ISIN disponible

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 1 : contrats assureurs (catalogue produit)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investissement_insurer_contracts (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    insurer             VARCHAR(60) NOT NULL,          -- 'spirica', 'suravenir', 'generali', 'bnp-cardif'
    distributor         VARCHAR(60),                   -- 'linxea', 'altaprofits', 'placement-direct'
    contract_name       VARCHAR(200) NOT NULL,          -- 'Linxea Spirit 2', 'Linxea Avenir 2'
    contract_type       VARCHAR(20),                   -- 'AV', 'PER', 'CAPI'
    morningstar_universe_id VARCHAR(40),               -- 'FEEUR$$ALL_5627' (Morningstar ECINT)
    uc_count            INTEGER,                       -- nb UCs scraped
    source_url          TEXT,
    source              VARCHAR(60),                   -- 'linxea-morningstar', 'spirica-direct', etc.
    scraped_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_insurer_contract UNIQUE (insurer, contract_name)
);

-- Index pour requête fréquente : "tous les contrats d'un assureur"
CREATE INDEX IF NOT EXISTS idx_insurer_contracts_insurer
    ON investissement_insurer_contracts (insurer);

-- Index pour lookup par universe_id (requête pivot)
CREATE INDEX IF NOT EXISTS idx_insurer_contracts_universe
    ON investissement_insurer_contracts (morningstar_universe_id)
    WHERE morningstar_universe_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 2 : jonction contrat ↔ ISIN
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investissement_contract_uc (
    contract_id     UUID         NOT NULL REFERENCES investissement_insurer_contracts(id) ON DELETE CASCADE,
    isin            VARCHAR(12)  NOT NULL,
    fund_name       VARCHAR(300),                      -- nom dans le contrat (peut différer de investissement_funds)
    morningstar_id  VARCHAR(20),                       -- SecId Morningstar (F0GBR04BU3...)
    available       BOOLEAN      NOT NULL DEFAULT TRUE, -- FALSE = UC retirée
    source          VARCHAR(60),
    scraped_at      TIMESTAMPTZ,

    PRIMARY KEY (contract_id, isin)
);

-- Index pour requête fréquente : "dans quels contrats est disponible cet ISIN ?"
CREATE INDEX IF NOT EXISTS idx_contract_uc_isin
    ON investissement_contract_uc (isin);

-- Index pour lookup CGP : "quels ISINs pour ce contrat ?"
CREATE INDEX IF NOT EXISTS idx_contract_uc_contract
    ON investissement_contract_uc (contract_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Vue pratique : pivot fonds ↔ contrats (enrichit investissement_funds)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW investissement_fund_contracts AS
SELECT
    uc.isin,
    f.name             AS fund_name,
    f.data_completeness,
    c.insurer,
    c.distributor,
    c.contract_name,
    c.contract_type,
    c.morningstar_universe_id,
    uc.available,
    uc.scraped_at
FROM investissement_contract_uc uc
JOIN investissement_insurer_contracts c ON c.id = uc.contract_id
LEFT JOIN investissement_funds f ON f.isin = uc.isin
WHERE uc.available = TRUE;

COMMENT ON VIEW investissement_fund_contracts IS
    'Vue pivot : pour chaque ISIN, liste les contrats assureurs qui le proposent.';
