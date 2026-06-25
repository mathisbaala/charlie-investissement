-- Fondation portefeuille — historique des taux servis des fonds euros + source
-- de série synthétique.
--
-- Les fonds euros n'ont pas de VL quotidienne (capital garanti, taux servi
-- publié 1×/an). Pour qu'ils soient back-testables / corrélables comme les
-- autres supports, on (1) persiste l'historique annuel des taux servis (source
-- GVFM, déjà parsé par fonds-euros-enricher.py mais jusqu'ici réduit à
-- perf_1y/3y/5y) et (2) matérialise une courbe NAV synthétique annuelle
-- (base 100, composition des taux) dans investissement_fund_prices via une
-- source dédiée — au RYTHME RÉEL du produit (annuel), sans fabriquer de fausse
-- précision quotidienne.

-- 1. Table d'historique des taux servis (1 ligne = 1 année pour 1 fonds euros)
CREATE TABLE IF NOT EXISTS investissement_fonds_euros_rates (
    isin        text        NOT NULL REFERENCES investissement_funds(isin) ON DELETE CASCADE,
    year        smallint    NOT NULL,
    rate_pct    numeric     NOT NULL,   -- taux servi net de frais de gestion, en % (ex. 2.50)
    source      text        NOT NULL DEFAULT 'gvfm',
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (isin, year)
);

COMMENT ON TABLE investissement_fonds_euros_rates IS
    'Historique annuel des taux servis des fonds euros (source GVFM). Sert à '
    'matérialiser une courbe NAV synthétique annuelle pour le moteur portefeuille '
    'et à afficher le détail des taux sur la fiche.';

-- Table interne (alimentée côté service role) — RLS activée, pas de policy anon
-- (cohérent avec le durcissement Supabase ; le service role bypasse la RLS).
ALTER TABLE investissement_fonds_euros_rates ENABLE ROW LEVEL SECURITY;

-- 2. Nouvelle source de prix pour la série synthétique fonds euros.
INSERT INTO investissement_fund_price_sources (id, code)
VALUES (7, 'synthetic-fonds-euros')
ON CONFLICT (id) DO NOTHING;
