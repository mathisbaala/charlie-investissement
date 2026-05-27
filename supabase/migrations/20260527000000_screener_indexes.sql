-- Index screener CGP — 9 index pour les filtres fréquents
CREATE INDEX IF NOT EXISTS idx_funds_sfdr
  ON investissement_funds(sfdr_article);

CREATE INDEX IF NOT EXISTS idx_funds_sri
  ON investissement_funds(sri);

CREATE INDEX IF NOT EXISTS idx_funds_ter
  ON investissement_funds(ongoing_charges);

CREATE INDEX IF NOT EXISTS idx_funds_pea
  ON investissement_funds(pea_eligible);

CREATE INDEX IF NOT EXISTS idx_funds_per
  ON investissement_funds(per_eligible);

CREATE INDEX IF NOT EXISTS idx_funds_av_lux
  ON investissement_funds(av_lux_eligible);

CREATE INDEX IF NOT EXISTS idx_funds_completeness
  ON investissement_funds(data_completeness);

CREATE INDEX IF NOT EXISTS idx_funds_type_completeness
  ON investissement_funds(product_type, data_completeness);

CREATE INDEX IF NOT EXISTS idx_funds_name_gin
  ON investissement_funds USING gin(to_tsvector('french', coalesce(name, '')));
