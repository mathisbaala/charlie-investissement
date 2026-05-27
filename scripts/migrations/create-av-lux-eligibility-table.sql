-- ===========================================================================
-- create-av-lux-eligibility-table.sql
-- ---------------------------------------------------------------------------
-- Table `investissement_av_lux_eligibility` : catalogue réel des fonds
-- disponibles dans chaque contrat d'assurance-vie luxembourgeoise.
--
-- Contexte :
--   Avant cette table, on utilisait un flag booléen `av_lux_eligible`
--   sur investissement_funds (heuristique : tout UCITS LU/*).
--   Ce booléen reste utile pour les requêtes rapides, mais ne dit pas
--   dans QUEL contrat le fonds est réellement disponible.
--
--   Cette table résout : "fonds X disponible dans contrat Y de compagnie Z ?"
--
-- Sources actuelles de données :
--   - Linxea (Spirit 2, Avenir 2, Vie, Zen, Spirit PER, Suravenir PER, PER)
--     via Morningstar ECINT API (scraper : av-lux-linxea-catalog.py)
--   - Cardif Lux Vie (CAP SECURE, Cardif Elite Lux, Liberty 2 Invest, etc.)
--     via API REST cardifluxvie.lu (scraper : av-lux-cardif-lux-vie-catalog.py)
--
-- Design :
--   PK sur (isin, contract_name) — un fonds peut être dans plusieurs contrats.
--   company_name identifie l'assureur (Linxea, Cardif Lux Vie, Generali Lux, …).
--   source_url = URL de la page / API où le fonds a été observé.
--   universe_id = identifiant interne Morningstar (nullable, Linxea only).
--   scraped_at = dernière date de scraping (pour détecter les retraits).
--
-- Idempotent.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS investissement_av_lux_eligibility (
    id              BIGSERIAL PRIMARY KEY,
    isin            TEXT        NOT NULL,
    company_name    TEXT        NOT NULL,
    contract_name   TEXT        NOT NULL,
    source_url      TEXT,
    universe_id     TEXT,
    scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- FK vers investissement_funds (si le fonds existe déjà en base)
    -- ON DELETE SET NULL pour ne pas perdre la donnée si le fonds est supprimé
    CONSTRAINT investissement_av_lux_eligibility_isin_fk
        FOREIGN KEY (isin)
        REFERENCES investissement_funds (isin)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,

    -- Unicité : un fonds ne peut être listé qu'une fois par contrat
    CONSTRAINT investissement_av_lux_eligibility_isin_contract_unique
        UNIQUE (isin, contract_name)
);

-- Index sur company_name pour filtrer par assureur
CREATE INDEX IF NOT EXISTS investissement_av_lux_eligibility_company_idx
    ON investissement_av_lux_eligibility (company_name);

-- Index sur isin pour les jointures avec investissement_funds
CREATE INDEX IF NOT EXISTS investissement_av_lux_eligibility_isin_idx
    ON investissement_av_lux_eligibility (isin);

-- Index sur contract_name pour les recherches par contrat
CREATE INDEX IF NOT EXISTS investissement_av_lux_eligibility_contract_idx
    ON investissement_av_lux_eligibility (contract_name);

-- Index sur scraped_at pour les rapports de fraîcheur
CREATE INDEX IF NOT EXISTS investissement_av_lux_eligibility_scraped_at_idx
    ON investissement_av_lux_eligibility (scraped_at DESC);

COMMENT ON TABLE investissement_av_lux_eligibility IS
    'Catalogue réel des fonds disponibles par contrat AV Lux. '
    'Peuplé par les scrapers av-lux-*-catalog.py. '
    'Clé : (isin, contract_name).';

COMMENT ON COLUMN investissement_av_lux_eligibility.company_name IS
    'Assureur ou plateforme : "Linxea", "Cardif Lux Vie", "Generali Luxembourg", etc.';

COMMENT ON COLUMN investissement_av_lux_eligibility.contract_name IS
    'Nom du contrat : "Linxea Spirit 2", "Cardif Elite Lux", "CAP SECURE LUXEMBOURG", etc.';

COMMENT ON COLUMN investissement_av_lux_eligibility.universe_id IS
    'ID univers Morningstar (FEEUR$$ALL_xxx) pour les contrats Linxea. NULL pour les autres.';

COMMIT;

-- ---------------------------------------------------------------------------
-- REQUÊTES UTILES POST-CRÉATION
-- ---------------------------------------------------------------------------
--
-- 1. Fonds disponibles dans un contrat spécifique :
--    SELECT f.isin, f.name, f.ter, f.performance_1y
--    FROM investissement_av_lux_eligibility e
--    JOIN investissement_funds f ON f.isin = e.isin
--    WHERE e.contract_name = 'Linxea Spirit 2'
--    ORDER BY f.performance_1y DESC NULLS LAST;
--
-- 2. Dans combien de contrats est disponible un fonds ?
--    SELECT e.isin, f.name, count(*) as nb_contrats,
--           string_agg(e.contract_name, ', ') as contrats
--    FROM investissement_av_lux_eligibility e
--    JOIN investissement_funds f ON f.isin = e.isin
--    GROUP BY e.isin, f.name
--    ORDER BY nb_contrats DESC
--    LIMIT 20;
--
-- 3. Distribution par assureur :
--    SELECT company_name, count(DISTINCT contract_name) as nb_contrats,
--           count(*) as nb_fonds
--    FROM investissement_av_lux_eligibility
--    GROUP BY company_name
--    ORDER BY nb_fonds DESC;
--
-- 4. Fonds retirés (plus vus depuis >30 jours) :
--    SELECT * FROM investissement_av_lux_eligibility
--    WHERE scraped_at < now() - interval '30 days'
--    ORDER BY scraped_at ASC;
-- ---------------------------------------------------------------------------
