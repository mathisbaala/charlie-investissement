-- Indices obligataires dédiés : High Yield euro + dette émergente
-- =================================================================
-- Raffinement des proxies obligataires : les fonds HY et dette émergente,
-- jusque-là rattachés à l'IG corpo / l'agrégat monde, affichaient un alpha
-- gonflé par la prime de risque (proxy trop éloigné). On leur donne un indice
-- de catégorie proche. Proxys ETF via Yahoo en cours AJUSTÉ (rendement total) :
--   eur_hy  = iShares € High Yield Corp Bond (EUNW.DE)        — TR +28 %/4 ans
--   em_debt = iShares JPM $ EM Bond EUR Hedged (IS3C.DE)      — TR +26 %/4 ans
-- Routage : sous-routeur obligataire de td-enricher (BOND_HY_KW / BOND_EM_KW +
-- region_normalized='emerging'). Les hybrides (convertibles/CoCo/AT1) sont
-- désormais EXCLUS du benchmark (pas de proxy obligataire pertinent), et le
-- plafond d'alpha obligataire est resserré à ±10 %/an (rejette les NAV cassées).

INSERT INTO investissement_index_catalog
  (index_code, label, currency, variant, source, ticker, msci_code, keywords, asset_class_broad, region)
VALUES
  ('eur_hy',   'Obligations High Yield euro',     'EUR', 'net', 'yahoo', 'EUNW.DE', NULL,
     ARRAY[]::text[], 'obligation', 'europe'),
  ('em_debt',  'Obligations émergentes (EUR-H)',  'EUR', 'net', 'yahoo', 'IS3C.DE', NULL,
     ARRAY[]::text[], 'obligation', 'emerging')
ON CONFLICT (index_code) DO UPDATE SET
  label = EXCLUDED.label, currency = EXCLUDED.currency, variant = EXCLUDED.variant,
  source = EXCLUDED.source, ticker = EXCLUDED.ticker, msci_code = EXCLUDED.msci_code,
  keywords = EXCLUDED.keywords, asset_class_broad = EXCLUDED.asset_class_broad,
  region = EXCLUDED.region;
