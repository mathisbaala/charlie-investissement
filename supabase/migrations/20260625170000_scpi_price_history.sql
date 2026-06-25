-- SCPI — historique du prix de part (accumulation) ─────────────────────────────
-- investissement_scpi_metrics est un SNAPSHOT (1 ligne/ISIN, écrasée à chaque run).
-- Le prix de part SCPI ne bouge qu'~1×/an (revalorisation annuelle) → on accumule
-- un point par an dans une table d'historique dédiée. À terme (≥2-3 ans), permettra
-- de matérialiser une série de rendement total pour le back-test. Aujourd'hui, valeur
-- immédiate faible (≈1 point) — on démarre l'accumulation.

CREATE TABLE IF NOT EXISTS investissement_scpi_price_history (
    isin            text        NOT NULL REFERENCES investissement_funds(isin) ON DELETE CASCADE,
    year            smallint    NOT NULL,
    price_per_share numeric,
    dvm             numeric,    -- taux de distribution de l'année (%), pour dériver le rendement total
    source          text        NOT NULL DEFAULT 'primaliance',
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (isin, year)
);

COMMENT ON TABLE investissement_scpi_price_history IS
    'Historique annuel du prix de part SCPI (+ DVM). Accumulé au fil des refresh '
    '(1 point/an). Base d''une future série de rendement total SCPI.';

ALTER TABLE investissement_scpi_price_history ENABLE ROW LEVEL SECURITY;

-- Backfill : le snapshot courant devient le 1er point, année extraite de `period`
-- (ex. '2024-05' → 2024, '2026-Q2' → 2026). On ne backfille que les prix réels.
INSERT INTO investissement_scpi_price_history (isin, year, price_per_share, dvm, source, updated_at)
SELECT m.isin,
       substring(m.period from '^\d{4}')::smallint AS year,
       m.price_per_share,
       m.dvm,
       COALESCE(m.source, 'primaliance'),
       now()
FROM investissement_scpi_metrics m
WHERE m.price_per_share IS NOT NULL
  AND m.period ~ '^\d{4}'
ON CONFLICT (isin, year) DO NOTHING;
