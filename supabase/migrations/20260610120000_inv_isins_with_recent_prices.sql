-- RPC : ISINs distincts ayant au moins une VL depuis p_since, en pagination
-- keyset (isin > p_after) pour rester sous le statement timeout PostgREST.
-- Remplace la découverte par offset de compute-metrics (qui scannait ~900k
-- lignes d'un coup et dépassait le timeout). S'appuie sur l'index PK
-- (isin, price_date) → Index Only Scan, ~3 s / page de 1000.
CREATE OR REPLACE FUNCTION public.inv_isins_with_recent_prices(
  p_since date,
  p_after text DEFAULT '',
  p_lim   int  DEFAULT 1000
)
RETURNS TABLE(isin text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT pr.isin
  FROM public.investissement_fund_prices pr
  WHERE pr.price_date >= p_since
    AND pr.isin > p_after
  ORDER BY pr.isin
  LIMIT p_lim;
$$;
