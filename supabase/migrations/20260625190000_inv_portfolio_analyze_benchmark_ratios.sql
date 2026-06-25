-- Moteur portefeuille — comparaison enrichie ────────────────────────────────────
-- Ajoute Sharpe + perte max (drawdown) au bloc benchmark, pour une comparaison
-- portefeuille vs indice sur les MÊMES 5 ratios. CREATE OR REPLACE (signature
-- inchangée). Seules nouveautés : CTE bdd (drawdown benchmark) + 2 champs.

CREATE OR REPLACE FUNCTION public.inv_portfolio_analyze(
  p_isins     text[],
  p_weights   numeric[] DEFAULT NULL,
  p_years     int       DEFAULT 5,
  p_rf        numeric   DEFAULT 2.0,
  p_benchmark text      DEFAULT NULL
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
  IF p_isins IS NULL OR cardinality(p_isins) = 0 THEN
    RETURN jsonb_build_object('error', 'no_isins');
  END IF;
  IF p_weights IS NULL OR cardinality(p_weights) <> cardinality(p_isins) THEN
    p_weights := (SELECT array_agg(1.0) FROM unnest(p_isins));
  END IF;

  WITH
  req AS (
    SELECT u.isin, COALESCE(u.w, 1.0) AS raw_w, u.idx
    FROM unnest(p_isins, p_weights) WITH ORDINALITY AS u(isin, w, idx)
  ),
  cov0 AS (
    SELECT r.isin, r.raw_w, r.idx,
           min(p.price_date) AS d0, max(p.price_date) AS d1, count(*) AS npts
    FROM req r JOIN public.investissement_fund_prices p ON p.isin = r.isin
    GROUP BY r.isin, r.raw_w, r.idx
  ),
  cov AS (
    SELECT isin, idx, d0, d1, npts,
           raw_w / NULLIF(sum(raw_w) OVER (), 0) AS w
    FROM cov0
  ),
  win AS (
    SELECT GREATEST(max(d0), (min(d1) - make_interval(years => p_years))::date) AS start_d,
           min(d1) AS end_d,
           count(*) AS n_funds
    FROM cov
  ),
  grid AS (
    SELECT g::date AS d
    FROM win, generate_series((SELECT start_d FROM win), (SELECT end_d FROM win),
                              interval '7 day') AS g
  ),
  locf AS (
    SELECT g.d, c.isin, c.w, c.idx,
      (SELECT p.nav FROM public.investissement_fund_prices p
        WHERE p.isin = c.isin AND p.price_date <= g.d
        ORDER BY p.price_date DESC LIMIT 1) AS nav
    FROM grid g CROSS JOIN cov c
  ),
  rets AS (
    SELECT d, isin, w, idx, nav,
      nav / NULLIF(lag(nav) OVER (PARTITION BY isin ORDER BY d), 0) - 1 AS ret
    FROM locf
  ),
  blended AS (
    SELECT d, sum(w * ret) AS br
    FROM rets
    WHERE ret IS NOT NULL
    GROUP BY d
    HAVING count(*) = (SELECT n_funds FROM win)
  ),
  leveled AS (
    SELECT d, 100 * exp(sum(ln(1 + br)) OVER (ORDER BY d)) AS lvl
    FROM blended
  ),
  curve AS (
    SELECT (SELECT start_d FROM win) AS d, 100::numeric AS lvl
    UNION ALL
    SELECT d, lvl FROM leveled
  ),
  dd AS (
    SELECT d, lvl, lvl / max(lvl) OVER (ORDER BY d) - 1 AS drawdown
    FROM curve
  ),
  pstats AS (
    SELECT count(*) AS nweeks,
           stddev_samp(br) AS wsd,
           (SELECT lvl FROM leveled ORDER BY d DESC LIMIT 1) AS final_lvl
    FROM blended
  ),
  fstats AS (
    SELECT fr.isin, c.w,
           stddev_samp(fr.ret) * sqrt(52) AS vol,
           exp(sum(ln(1 + fr.ret))) - 1 AS total_ret
    FROM rets fr JOIN cov c ON c.isin = fr.isin
    WHERE fr.ret IS NOT NULL
    GROUP BY fr.isin, c.w
  ),
  pairs AS (
    SELECT a.isin AS ia, b.isin AS ib, corr(a.ret, b.ret) AS c
    FROM rets a JOIN rets b ON a.d = b.d AND a.idx < b.idx
    WHERE a.ret IS NOT NULL AND b.ret IS NOT NULL
    GROUP BY a.isin, b.isin
  ),
  bgrid AS (
    SELECT g.d,
      (SELECT ip.value FROM public.investissement_index_prices ip
        WHERE ip.index_code = p_benchmark AND ip.price_date <= g.d
        ORDER BY ip.price_date DESC LIMIT 1) AS val
    FROM grid g
    WHERE p_benchmark IS NOT NULL
  ),
  brets AS (
    SELECT d, val / NULLIF(lag(val) OVER (ORDER BY d), 0) - 1 AS ret
    FROM bgrid
  ),
  bleveled AS (
    SELECT d, 100 * exp(sum(ln(1 + ret)) OVER (ORDER BY d)) AS lvl
    FROM brets WHERE ret IS NOT NULL
  ),
  bcurve AS (
    SELECT (SELECT start_d FROM win) AS d, 100::numeric AS lvl
    UNION ALL
    SELECT d, lvl FROM bleveled
  ),
  bdd AS (
    SELECT lvl / max(lvl) OVER (ORDER BY d) - 1 AS drawdown FROM bcurve
  ),
  bstats AS (
    SELECT count(*) AS nweeks, stddev_samp(ret) AS wsd,
           (SELECT lvl FROM bleveled ORDER BY d DESC LIMIT 1) AS final_lvl
    FROM brets WHERE ret IS NOT NULL
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'requested',     cardinality(p_isins),
      'used',          (SELECT n_funds FROM win),
      'excluded',      (SELECT coalesce(jsonb_agg(isin), '[]'::jsonb)
                          FROM req WHERE isin NOT IN (SELECT isin FROM cov0)),
      'start',         (SELECT start_d FROM win),
      'end',           (SELECT end_d FROM win),
      'n_weeks',       (SELECT nweeks FROM pstats),
      'rf_pct',        p_rf
    ),
    'ratios', (SELECT jsonb_build_object(
        'total_return',     round((final_lvl/100 - 1)::numeric, 4),
        'annual_return',    round((power(final_lvl/100, 52.0 / NULLIF(nweeks,0)) - 1)::numeric, 4),
        'volatility',       round((wsd * sqrt(52))::numeric, 4),
        'sharpe',           round(((power(final_lvl/100, 52.0 / NULLIF(nweeks,0)) - 1 - p_rf/100)
                                    / NULLIF(wsd * sqrt(52), 0))::numeric, 3),
        'max_drawdown',     round((SELECT min(drawdown) FROM dd)::numeric, 4)
      ) FROM pstats),
    'curve', (SELECT coalesce(jsonb_agg(jsonb_build_object('d', d, 'v', round(lvl::numeric, 4)) ORDER BY d), '[]'::jsonb)
                FROM curve),
    'funds', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'isin', isin, 'weight', round(w::numeric, 4),
                  'volatility', round(vol::numeric, 4),
                  'total_return', round(total_ret::numeric, 4)) ORDER BY w DESC), '[]'::jsonb)
                FROM fstats),
    'correlation', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'a', ia, 'b', ib, 'c', round(c::numeric, 3))), '[]'::jsonb)
                FROM pairs),
    'benchmark', CASE WHEN p_benchmark IS NULL THEN NULL ELSE (
        SELECT jsonb_build_object(
          'code',          p_benchmark,
          'label',         (SELECT label FROM public.investissement_index_catalog WHERE index_code = p_benchmark),
          'total_return',  round((final_lvl/100 - 1)::numeric, 4),
          'annual_return', round((power(final_lvl/100, 52.0 / NULLIF(nweeks,0)) - 1)::numeric, 4),
          'volatility',    round((wsd * sqrt(52))::numeric, 4),
          'sharpe',        round(((power(final_lvl/100, 52.0 / NULLIF(nweeks,0)) - 1 - p_rf/100)
                                   / NULLIF(wsd * sqrt(52), 0))::numeric, 3),
          'max_drawdown',  round((SELECT min(drawdown) FROM bdd)::numeric, 4),
          'curve', (SELECT coalesce(jsonb_agg(jsonb_build_object('d', d, 'v', round(lvl::numeric, 4)) ORDER BY d), '[]'::jsonb)
                      FROM bcurve)
        ) FROM bstats
      ) END
  )
  INTO result;

  RETURN result;
END;
$$;
