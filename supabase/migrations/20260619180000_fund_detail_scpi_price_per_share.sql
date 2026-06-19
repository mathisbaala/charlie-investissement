-- Exposer le prix de part SCPI dans get_fund_detail
-- ============================================================================
-- investissement_scpi_metrics.price_per_share (alimenté par scpi-primaliance-
-- enricher) n'était lu par aucun code. On l'ajoute à get_fund_detail (par
-- concaténation jsonb, ancrée sur le dernier champ) pour l'afficher sur la fiche
-- SCPI. Idempotent (no-op si price_per_share déjà présent).
DO $$
DECLARE def text; newdef text;
BEGIN
  SELECT pg_get_functiondef('public.get_fund_detail(text)'::regprocedure) INTO def;
  IF def ILIKE '%price_per_share%' THEN RETURN; END IF;
  newdef := regexp_replace(
    def,
    '(pai_considered''\s*,\s*v_row\.pai_considered\s*\))',
    '\1 || jsonb_build_object(''price_per_share'', (SELECT m.price_per_share FROM investissement_scpi_metrics m WHERE m.isin = p_isin))',
    'i');
  IF newdef = def THEN
    RAISE EXCEPTION 'Ancre pai_considered introuvable dans get_fund_detail';
  END IF;
  EXECUTE newdef;
END $$;
