-- Cache de résolution ISIN → idInterne (share_id) GECO
-- ============================================================================
-- geco-nav résout ISIN→idInterne via 2 appels AMF avant de lire la série de VL.
-- Sur ~10,7k OPCVM FR rafraîchis chaque semaine, ça fait ~21k appels de
-- résolution récurrents. Ce cache (hit permanent — idInterne stable ; miss
-- re-tenté après TTL côté scraper) ramène le régime permanent à 1 appel
-- chart/fonds. Peuplé incrémentalement par geco-nav (--apply).
CREATE TABLE IF NOT EXISTS investissement_geco_share_map (
  isin        text PRIMARY KEY,
  share_id    bigint,                          -- idInterne de la part ; NULL si non résolu
  miss        boolean NOT NULL DEFAULT false,  -- true = résolution a échoué (négatif caché)
  resolved_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE investissement_geco_share_map IS
  'Cache ISIN→idInterne GECO (geco-nav). hit=share_id non NULL ; miss=true re-tenté après TTL.';
