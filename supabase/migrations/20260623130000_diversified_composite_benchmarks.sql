-- Benchmarks COMPOSITES pour les fonds diversifiés (multi-actifs) ───────────────
-- Problème : les ~14 600 fonds diversifiés étaient à alpha=0 (14 seulement notés)
-- faute d'indice mono-classe pertinent — un proxy actions OU oblig seul ne
-- représente pas un fonds 50/50. Solution : des indices SYNTHÉTIQUES actions/oblig
-- pondérés selon le profil d'allocation, calculés depuis des composantes déjà en
-- base (msci_world net EUR + global_agg net EUR-H). Le moteur d'alpha (td-enricher)
-- consomme ensuite ces composites comme n'importe quel autre indice.
--
-- Mélange QUOTIDIEN RÉÉQUILIBRÉ (poids constants), pas buy-and-hold : le niveau du
-- jour = niveau veille × (1 + Σ poids·rendement_composante). Fidèle à un mandat
-- « 60/40 rééquilibré », et stable quelle que soit la fenêtre lue par le moteur.

-- 0. Autoriser la source 'composite' dans le catalogue ───────────────────────────
ALTER TABLE public.investissement_index_catalog
  DROP CONSTRAINT IF EXISTS investissement_index_catalog_source_check;
ALTER TABLE public.investissement_index_catalog
  ADD CONSTRAINT investissement_index_catalog_source_check
  CHECK (source = ANY (ARRAY['yahoo'::text, 'msci'::text, 'composite'::text]));

-- 1. Table de définition (composite → composantes + poids) ───────────────────────
CREATE TABLE IF NOT EXISTS public.investissement_index_composites (
  composite_code text   NOT NULL,
  component_code text   NOT NULL REFERENCES public.investissement_index_catalog(index_code),
  weight         numeric NOT NULL CHECK (weight > 0 AND weight <= 1),
  PRIMARY KEY (composite_code, component_code)
);

COMMENT ON TABLE public.investissement_index_composites IS
  'Définition des indices composites (mélanges actions/oblig). Σ poids par composite_code = 1. Séries reconstruites par inv_rebuild_composite_indices().';

-- Profils : prudent 25/75, équilibré & flexible & inconnu 50/50, dynamique 75/25.
-- Composantes : actions monde (msci_world) + oblig agrégat monde EUR-H (global_agg),
-- toutes deux net TR en EUR natif → mélange sans contamination FX.
INSERT INTO public.investissement_index_composites (composite_code, component_code, weight) VALUES
  ('mix_25_75', 'msci_world', 0.25), ('mix_25_75', 'global_agg', 0.75),
  ('mix_50_50', 'msci_world', 0.50), ('mix_50_50', 'global_agg', 0.50),
  ('mix_75_25', 'msci_world', 0.75), ('mix_75_25', 'global_agg', 0.25)
ON CONFLICT (composite_code, component_code) DO UPDATE SET weight = EXCLUDED.weight;

-- 2. Entrées catalogue (variant 'net', source 'composite' → ignorées par le refresh
--    Yahoo/MSCI, reconstruites depuis les composantes) ────────────────────────────
INSERT INTO public.investissement_index_catalog
  (index_code, label, currency, variant, source, ticker, msci_code, keywords, asset_class_broad, region, active) VALUES
  ('mix_25_75', 'Diversifié prudent (25 % actions / 75 % oblig)',   'EUR', 'net', 'composite', NULL, NULL, '{}', 'diversifie', 'monde', true),
  ('mix_50_50', 'Diversifié équilibré (50 % actions / 50 % oblig)', 'EUR', 'net', 'composite', NULL, NULL, '{}', 'diversifie', 'monde', true),
  ('mix_75_25', 'Diversifié dynamique (75 % actions / 25 % oblig)', 'EUR', 'net', 'composite', NULL, NULL, '{}', 'diversifie', 'monde', true)
ON CONFLICT (index_code) DO UPDATE SET
  label = EXCLUDED.label, currency = EXCLUDED.currency, variant = EXCLUDED.variant,
  source = EXCLUDED.source, asset_class_broad = EXCLUDED.asset_class_broad,
  region = EXCLUDED.region, active = EXCLUDED.active;

-- 3. Reconstruction des séries composites depuis leurs composantes ────────────────
CREATE OR REPLACE FUNCTION public.inv_rebuild_composite_indices()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_written integer := 0;
  v_n       integer;
  v_code    text;
BEGIN
  FOR v_code IN SELECT DISTINCT composite_code FROM public.investissement_index_composites LOOP
    DELETE FROM public.investissement_index_prices WHERE index_code = v_code;

    WITH comps AS (
      SELECT component_code, weight
      FROM public.investissement_index_composites WHERE composite_code = v_code
    ),
    -- valeurs des composantes (jointes au catalogue de la composante)
    vals AS (
      SELECT p.price_date, p.index_code, p.value, c.weight
      FROM public.investissement_index_prices p
      JOIN comps c ON c.component_code = p.index_code
      WHERE p.value IS NOT NULL
    ),
    -- ne garder que les dates où TOUTES les composantes ont une valeur
    common_dates AS (
      SELECT price_date FROM vals
      GROUP BY price_date
      HAVING count(*) = (SELECT count(*) FROM comps)
    ),
    filtered AS (
      SELECT v.* FROM vals v JOIN common_dates d ON d.price_date = v.price_date
    ),
    -- rendement quotidien par composante
    rets AS (
      SELECT price_date, weight,
        value / NULLIF(lag(value) OVER (PARTITION BY index_code ORDER BY price_date), 0) - 1 AS r
      FROM filtered
    ),
    -- rendement composite quotidien = somme pondérée (poids constants = rééquilibrage)
    blended AS (
      SELECT price_date, sum(weight * COALESCE(r, 0)) AS br
      FROM rets GROUP BY price_date
    ),
    -- niveau = produit cumulé des (1 + rendement), base 100
    leveled AS (
      SELECT price_date,
        100 * exp(sum(ln(1 + br)) OVER (ORDER BY price_date)) AS lvl
      FROM blended
    )
    INSERT INTO public.investissement_index_prices (index_code, price_date, value, source)
    SELECT v_code, price_date, lvl, 'composite' FROM leveled;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_written := v_written + v_n;
  END LOOP;
  RETURN v_written;
END;
$$;

COMMENT ON FUNCTION public.inv_rebuild_composite_indices() IS
  'Reconstruit les séries des indices composites (mélange quotidien rééquilibré des composantes). Appeler après chaque refresh des composantes. Retourne le nb de points écrits.';

-- 4. Construction initiale ────────────────────────────────────────────────────────
SELECT public.inv_rebuild_composite_indices();
