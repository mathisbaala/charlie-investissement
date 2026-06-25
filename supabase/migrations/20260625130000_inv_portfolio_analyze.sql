-- Moteur portefeuille — cœur (étape B + C) ──────────────────────────────────────
-- RPC qui prend une liste de fonds + poids et renvoie, en UN appel :
--   1. la COURBE composite pondérée (base 100), au rythme hebdomadaire ;
--   2. les RATIOS du portefeuille (perf annualisée, volatilité, Sharpe, max DD) ;
--   3. la MATRICE DE CORRÉLATION entre fonds.
--
-- Multi-rythme : chaque fonds est ré-échantillonné sur une grille hebdomadaire
-- commune par report de la dernière VL connue (LOCF). Un fonds euros (VL annuelle
-- au 31/12) reste donc PLAT entre deux années — exactement sa réalité (capital
-- garanti) → sa corrélation aux marchés ressort ~0. Pas de fausse précision.
--
-- Mélange HEBDO RÉÉQUILIBRÉ (poids constants), comme inv_rebuild_composite_indices :
-- niveau_t = niveau_{t-1} × (1 + Σ poids·rendement_fonds). Stable, standard.
--
-- Fenêtre d'analyse = recouvrement commun des historiques, plafonné à p_years et
-- finissant à la dernière date où TOUS les fonds ont une VL réelle (end = min des
-- dernières dates ; pas de report en fin de série). Les fonds sans aucune VL
-- locale sont exclus et signalés dans meta.excluded.
--
-- Note v1 : un support basse fréquence (fonds euros annuel) concentre son
-- rendement sur 1 semaine/an via le LOCF → sa volatilité hebdo est légèrement
-- surévaluée (reste faible) ; corrélation ~0 préservée. Lissage annuel = raffinement
-- ultérieur si besoin.

CREATE OR REPLACE FUNCTION public.inv_portfolio_analyze(
  p_isins   text[],
  p_weights numeric[] DEFAULT NULL,
  p_years   int       DEFAULT 5,
  p_rf      numeric   DEFAULT 2.0   -- taux sans risque annuel en % (pour le Sharpe)
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
  -- poids par défaut / longueur incohérente → équipondéré
  IF p_weights IS NULL OR cardinality(p_weights) <> cardinality(p_isins) THEN
    p_weights := (SELECT array_agg(1.0) FROM unnest(p_isins));
  END IF;

  WITH
  req AS (
    SELECT u.isin, COALESCE(u.w, 1.0) AS raw_w, u.idx
    FROM unnest(p_isins, p_weights) WITH ORDINALITY AS u(isin, w, idx)
  ),
  -- fonds réellement pricés + fenêtre de couverture par fonds
  cov0 AS (
    SELECT r.isin, r.raw_w, r.idx,
           min(p.price_date) AS d0, max(p.price_date) AS d1, count(*) AS npts
    FROM req r JOIN public.investissement_fund_prices p ON p.isin = r.isin
    GROUP BY r.isin, r.raw_w, r.idx
  ),
  -- poids renormalisés parmi les fonds pricés (somme = 1)
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
  -- LOCF : dernière VL ≤ date de grille, par fonds
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
  -- rendement composite hebdo = somme pondérée, sur les semaines où TOUS ont un rendement
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
  -- courbe complète = point de base 100 + niveaux
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
  -- stats par fonds (contexte UI)
  fstats AS (
    SELECT fr.isin, c.w,
           stddev_samp(fr.ret) * sqrt(52) AS vol,
           exp(sum(ln(1 + fr.ret))) - 1 AS total_ret
    FROM rets fr JOIN cov c ON c.isin = fr.isin
    WHERE fr.ret IS NOT NULL
    GROUP BY fr.isin, c.w
  ),
  -- matrice de corrélation (paires uniques i<j)
  pairs AS (
    SELECT a.isin AS ia, b.isin AS ib, corr(a.ret, b.ret) AS c
    FROM rets a JOIN rets b ON a.d = b.d AND a.idx < b.idx
    WHERE a.ret IS NOT NULL AND b.ret IS NOT NULL
    GROUP BY a.isin, b.isin
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
                FROM pairs)
  )
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.inv_portfolio_analyze(text[], numeric[], int, numeric) IS
  'Analyse un portefeuille pondéré : courbe composite hebdo (base 100), ratios '
  '(perf annualisée/vol/Sharpe/max DD) et matrice de corrélation. Multi-rythme '
  '(LOCF), mélange rééquilibré. Fonds sans VL locale exclus + signalés dans meta.';

REVOKE ALL ON FUNCTION public.inv_portfolio_analyze(text[], numeric[], int, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.inv_portfolio_analyze(text[], numeric[], int, numeric) TO anon, authenticated, service_role;
