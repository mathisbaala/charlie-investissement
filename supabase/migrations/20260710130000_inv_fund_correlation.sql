-- inv_fund_correlation — corrélation par paires entre fonds — 2026-07-10
-- ============================================================================
-- Fonction DÉDIÉE au calcul de corrélation demandée par le moteur d'allocation
-- (max-Sharpe / diversification). Autonome (n'exige pas de poids, contrairement
-- à inv_portfolio_analyze) : elle prend un ensemble d'ISIN et renvoie la matrice
-- de corrélation par paires, calculée sur les rendements HEBDOMADAIRES (grille
-- LOCF commune) issus de investissement_fund_prices, sur une fenêtre de p_years
-- années. C'est le jumeau SQL de app/src/lib/correlation.ts (mêmes coefficients).
--
-- Retour jsonb :
--   { "window": {"start": date, "end": date, "n_weeks": int},
--     "coverage": [{"isin": text, "n_points": int}, ...],   -- points par fonds
--     "pairs":    [{"a": isin, "b": isin, "c": corr}, ...] } -- c ∈ [-1,1] ou null
--
-- Convention identique à inv_portfolio_analyze : fenêtre = intersection des
-- historiques (max des débuts, borne p_years en arrière du plus court des fins),
-- pas hebdomadaire, LOCF (last observation carried forward). corr() de Postgres
-- renvoie NULL si variance nulle → paire non exploitable (transmise telle quelle).

CREATE OR REPLACE FUNCTION public.inv_fund_correlation(
  p_isins text[],
  p_years int DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_isins IS NULL OR cardinality(p_isins) < 2 THEN
    RETURN jsonb_build_object('error', 'need_at_least_2_isins');
  END IF;

  WITH
  req AS (
    SELECT u.isin, u.idx
    FROM unnest(p_isins) WITH ORDINALITY AS u(isin, idx)
  ),
  span AS (
    SELECT r.isin, r.idx,
           min(p.price_date) AS d0, max(p.price_date) AS d1
    FROM req r JOIN public.investissement_fund_prices p ON p.isin = r.isin
    GROUP BY r.isin, r.idx
  ),
  win AS (
    SELECT GREATEST(max(d0), (min(d1) - make_interval(years => p_years))::date) AS start_d,
           min(d1) AS end_d
    FROM span
  ),
  grid AS (
    SELECT g::date AS d
    FROM win, generate_series((SELECT start_d FROM win), (SELECT end_d FROM win),
                              interval '7 day') AS g
  ),
  locf AS (
    SELECT g.d, s.isin, s.idx,
      (SELECT p.nav FROM public.investissement_fund_prices p
        WHERE p.isin = s.isin AND p.price_date <= g.d
        ORDER BY p.price_date DESC LIMIT 1) AS nav
    FROM grid g CROSS JOIN span s
  ),
  rets AS (
    SELECT d, isin, idx,
      nav / NULLIF(lag(nav) OVER (PARTITION BY isin ORDER BY d), 0) - 1 AS ret
    FROM locf
  ),
  coverage AS (
    SELECT isin, count(*) FILTER (WHERE ret IS NOT NULL) AS n_points
    FROM rets GROUP BY isin
  ),
  pairs AS (
    SELECT a.isin AS ia, b.isin AS ib,
           round(corr(a.ret, b.ret)::numeric, 4) AS c
    FROM rets a JOIN rets b ON a.d = b.d AND a.idx < b.idx
    WHERE a.ret IS NOT NULL AND b.ret IS NOT NULL
    GROUP BY a.isin, b.isin
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object(
      'start', (SELECT start_d FROM win),
      'end',   (SELECT end_d FROM win),
      'n_weeks', (SELECT count(*) FROM grid)
    ),
    'coverage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('isin', isin, 'n_points', n_points) ORDER BY isin)
      FROM coverage
    ), '[]'::jsonb),
    'pairs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('a', ia, 'b', ib, 'c', c))
      FROM pairs
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- Lecture seule, exposée au rôle applicatif (comme inv_portfolio_analyze).
GRANT EXECUTE ON FUNCTION public.inv_fund_correlation(text[], int) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.inv_fund_correlation(text[], int) IS
  'Matrice de corrélation par paires entre fonds (rendements hebdo LOCF, fenêtre p_years) pour le moteur d''allocation. Jumeau SQL de app/src/lib/correlation.ts.';
