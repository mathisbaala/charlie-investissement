-- inv_fund_correlation v2 — corrélations robustes par paires — 2026-07-13
-- ============================================================================
-- Refonte de la fonction dédiée au moteur d'allocation. La v1 avait trois
-- défauts qui produisaient des coefficients trompeurs :
--
--  1. Fenêtre = INTERSECTION des historiques (max des débuts, min des fins) :
--     un seul fonds récent écrasait la fenêtre de TOUTES les paires (corrélations
--     calculées sur une poignée de points → bruit pur).
--  2. LOCF pur : les fonds cotés mensuellement (SCPI…) produisaient 3 semaines
--     sur 4 un rendement de 0 artificiel, écrasant la corrélation vers 0
--     (fausse diversification).
--  3. Aucun seuil : un coefficient estimé sur 3 points était renvoyé tel quel.
--
-- v2 :
--  - Fenêtre GLOBALE = union bornée : de max(fins) − p_years au plus ancien
--    début disponible ; chaque paire est corrélée sur son PROPRE recouvrement
--    (semaines où les deux fonds ont une donnée), plus d'écrasement global.
--  - Un rendement hebdo n'existe que si une NOUVELLE VL est arrivée cette
--    semaine-là (sinon NULL, pas 0) ; le report LOCF ne fabrique plus de zéros
--    et s'arrête au dernier prix connu du fonds (pas de queue rassie).
--  - Seuil p_min_points (défaut 26 ≈ 6 mois hebdo) : en dessous, le coefficient
--    est NULL (le moteur applique alors son prior par classe d'actifs). Le
--    nombre de points `n` est renvoyé par paire pour le diagnostic.
--
-- Retour jsonb :
--   { "window":   {"start": date, "end": date, "n_weeks": int, "min_points": int},
--     "coverage": [{"isin": text, "n_points": int}, ...],          -- points par fonds
--     "pairs":    [{"a": isin, "b": isin, "n": int, "c": corr}, ...] }
--                                                     -- c ∈ [-1,1], ou null si n < seuil
--
-- Jumeau TS : app/src/lib/correlation.ts (Pearson identique sur séries alignées ;
-- le repli par classe quand c est null vit dans classCorrelation()).

-- La signature change (3e paramètre) : on supprime l'ancienne pour éviter une
-- surcharge ambiguë.
DROP FUNCTION IF EXISTS public.inv_fund_correlation(text[], int);

CREATE OR REPLACE FUNCTION public.inv_fund_correlation(
  p_isins text[],
  p_years int DEFAULT 3,
  p_min_points int DEFAULT 26
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
  -- Fenêtre globale : union des historiques, bornée à p_years en arrière de la
  -- fin la plus récente. Chaque paire se corrèle sur son propre recouvrement.
  win AS (
    SELECT GREATEST(min(d0), (max(d1) - make_interval(years => p_years))::date) AS start_d,
           max(d1) AS end_d
    FROM span
  ),
  grid AS (
    SELECT g::date AS d
    FROM win, generate_series((SELECT start_d FROM win), (SELECT end_d FROM win),
                              interval '7 day') AS g
  ),
  -- Dernière VL connue à chaque date de grille, AVEC sa date d'observation ;
  -- pas de report au-delà du dernier prix connu du fonds.
  locf AS (
    SELECT g.d, s.isin, s.idx, lp.nav, lp.src_date
    FROM grid g
    CROSS JOIN span s
    LEFT JOIN LATERAL (
      SELECT p.nav, p.price_date AS src_date
      FROM public.investissement_fund_prices p
      WHERE p.isin = s.isin AND p.price_date <= g.d
      ORDER BY p.price_date DESC LIMIT 1
    ) lp ON TRUE
    WHERE g.d <= s.d1
  ),
  -- Rendement seulement quand une NOUVELLE observation est arrivée depuis le
  -- pas précédent (src_date a avancé). Une VL reportée ne produit pas un 0
  -- artificiel : elle produit NULL, et la paire s'aligne sur les semaines où
  -- les deux fonds ont réellement coté.
  rets AS (
    SELECT d, isin, idx,
      CASE
        WHEN lp.src_date > lag(lp.src_date) OVER w
        THEN lp.nav / NULLIF(lag(lp.nav) OVER w, 0) - 1
      END AS ret
    FROM locf lp
    WINDOW w AS (PARTITION BY isin ORDER BY d)
  ),
  coverage AS (
    SELECT isin, count(*) FILTER (WHERE ret IS NOT NULL) AS n_points
    FROM rets GROUP BY isin
  ),
  pairs AS (
    SELECT a.isin AS ia, b.isin AS ib,
           count(*) AS n,
           round(corr(a.ret, b.ret)::numeric, 4) AS c
    FROM rets a JOIN rets b ON a.d = b.d AND a.idx < b.idx
    WHERE a.ret IS NOT NULL AND b.ret IS NOT NULL
    GROUP BY a.isin, b.isin
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object(
      'start', (SELECT start_d FROM win),
      'end',   (SELECT end_d FROM win),
      'n_weeks', (SELECT count(*) FROM grid),
      'min_points', p_min_points
    ),
    'coverage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('isin', isin, 'n_points', n_points) ORDER BY isin)
      FROM coverage
    ), '[]'::jsonb),
    'pairs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'a', ia, 'b', ib, 'n', n,
        'c', CASE WHEN n >= p_min_points THEN c END
      ))
      FROM pairs
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- Lecture seule, exposée au rôle applicatif (comme la v1).
GRANT EXECUTE ON FUNCTION public.inv_fund_correlation(text[], int, int) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.inv_fund_correlation(text[], int, int) IS
  'Corrélations par paires entre fonds (rendements hebdo sur observations fraîches, recouvrement par paire, fenêtre p_years, seuil p_min_points) pour le moteur d''allocation. Jumeau TS : app/src/lib/correlation.ts.';
