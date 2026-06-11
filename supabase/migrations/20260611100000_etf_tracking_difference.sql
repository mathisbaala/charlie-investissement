-- Tracking difference ETF
-- ============================================================================
-- Le TER ne mesure pas le coût réel d'un ETF : c'est la « tracking difference »
-- (TD) annualisée — l'écart entre la performance de l'ETF et celle de son indice
-- de référence net total return — qui capture le coût total (frais + fiscalité
-- des dividendes + qualité de réplication + prêt de titres).
--
-- TD = perf ETF − perf indice net TR, sur une fenêtre alignée sur les dates
-- communes. Convention : valeur négative = l'ETF fait moins bien que son indice
-- (coût implicite) ; légèrement positive = réplication optimisée (prêt de titres).
--
-- Calculée par scripts/enrichers/td-enricher.py (fill/recompute, fenêtres 1Y/3Y/5Y).

-- ── Colonnes sur investissement_funds ───────────────────────────────────────
alter table investissement_funds
  add column if not exists benchmark_index           text,          -- nom lisible (ex. « MSCI World »)
  add column if not exists benchmark_code             text,          -- code interne → investissement_index_prices
  add column if not exists benchmark_variant          text,          -- 'net' | 'gross' | 'price'
  add column if not exists tracking_diff_1y           numeric(8,4),  -- % (négatif = sous-performance)
  add column if not exists tracking_diff_3y           numeric(8,4),  -- % annualisé
  add column if not exists tracking_diff_5y           numeric(8,4),  -- % annualisé
  add column if not exists tracking_diff_computed_at  timestamptz;

comment on column investissement_funds.tracking_diff_1y is
  'Tracking difference 1Y en % = perf ETF − perf indice TR (négatif = coût implicite / sous-performance).';
comment on column investissement_funds.tracking_diff_3y is
  'Tracking difference annualisée 3Y en %.';
comment on column investissement_funds.benchmark_variant is
  'Variante de l''indice utilisée pour la TD : net (idéal), gross, ou price (approximation, à signaler).';

-- ── Séries de prix des indices de référence (total return) ───────────────────
-- Table dédiée (et non investissement_fund_prices) pour ne pas polluer la
-- couverture des VL de fonds. `value` = niveau de l'indice (base arbitraire :
-- seul le ratio compte pour une performance).
create table if not exists investissement_index_prices (
  index_code  text not null,
  price_date  date not null,
  value       double precision not null,
  source      text,
  created_at  timestamptz not null default now(),
  primary key (index_code, price_date)
);

create index if not exists i_index_prices_code_date
  on investissement_index_prices (index_code, price_date);

-- Index partiel pour retrouver vite les ETF déjà mappés à un indice.
create index if not exists i_funds_benchmark_code
  on investissement_funds (benchmark_code)
  where benchmark_code is not null;
