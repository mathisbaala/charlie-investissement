-- Table de couverture des prix : 1 ligne par ISIN avec la dernière VL connue.
-- Permet une découverte instantanée des fonds "à jour" (compute-metrics) sans
-- scanner les 3,4 M lignes de investissement_fund_prices. Robuste à la densité
-- et au VACUUM, contrairement au scan DISTINCT qui dépassait le statement
-- timeout après un gros insert de VL (ex. balayage FT ~2,8 M lignes).
-- Maintenue par db.upsert_prices à chaque écriture de VL.
CREATE TABLE IF NOT EXISTS public.investissement_fund_price_coverage (
  isin            text PRIMARY KEY,
  last_price_date date,
  n_points        int,
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_price_coverage_last_date
  ON public.investissement_fund_price_coverage (last_price_date);

-- Backfill initial depuis l'existant (~6 s, agrégat parallèle).
INSERT INTO public.investissement_fund_price_coverage (isin, last_price_date, n_points)
SELECT isin, max(price_date), count(*)
FROM public.investissement_fund_prices
GROUP BY isin
ON CONFLICT (isin) DO UPDATE
  SET last_price_date = EXCLUDED.last_price_date,
      n_points        = EXCLUDED.n_points,
      updated_at      = now();
