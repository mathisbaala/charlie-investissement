-- Élargissement du catalogue d'indices : obligataire + actions euro
-- =================================================================
-- L'alpha n'était calculé que pour les fonds ACTION (les 8 indices seedés dans
-- 20260619100000 sont tous action). Obligations / monétaires n'avaient AUCUNE
-- règle → pas d'indice → pas d'alpha (3 618 fonds oblig + 279 monétaires à 0 %).
--
-- Faute de source d'indice obligataire gratuite et fiable, on utilise la VL d'un
-- ETF UCITS ACCUMULANT représentatif comme proxy d'indice (source='yahoo'). Les
-- parts accumulantes sont impératives : un ETF distribuant sous-estimerait le
-- rendement total des coupons → faux alpha positif systématique. Tickers validés
-- en live (≥ 5 ans d'historique, écart vs distribuant = coupons → confirme acc).
--
-- Routage : les règles ne disposant que de (asset_class_broad, region_normalized),
-- on ne peut pas distinguer govt/corp d'un fonds euro générique → on route les
-- bonds euro vers eur_govt (référence de taux) et tout le reste vers global_agg
-- (agrégat mondial EUR-hedged, benchmark de manuel pour un fonds oblig générique).
-- eur_corp est chargé pour complétude / routage granulaire futur (sous-classe).
--
-- Aucun changement applicatif : l'UI/API consomment benchmark_index/alpha_* de
-- façon générique. td-enricher --refresh-indices (cron mensuel) chargera les
-- nouvelles séries Yahoo ; td-enricher (cron hebdo) recalculera l'alpha.

-- 1. Nouveaux indices proxy (ETF accumulant via Yahoo) ─────────────────────────
INSERT INTO investissement_index_catalog
  (index_code, label, currency, variant, source, ticker, msci_code, keywords, asset_class_broad, region)
VALUES
  ('eur_govt',    'Obligations souveraines zone euro',  'EUR', 'net',   'yahoo', 'XGLE.DE', NULL,
     ARRAY[]::text[], 'obligation', 'europe'),
  ('eur_corp',    'Obligations Investment Grade euro',  'EUR', 'net',   'yahoo', 'XBLC.MI', NULL,
     ARRAY[]::text[], 'obligation', 'europe'),
  ('global_agg',  'Obligations agrégat monde (EUR-H)',  'EUR', 'net',   'yahoo', 'EUNA.DE', NULL,
     ARRAY[]::text[], 'obligation', 'world'),
  ('eur_mmf',     'Monétaire euro (€STR)',              'EUR', 'net',   'yahoo', 'XEON.DE', NULL,
     ARRAY[]::text[], 'monetaire', 'europe'),
  ('cac40_gr',    'CAC 40 GR',                          'EUR', 'gross', 'yahoo', 'C40.PA',  NULL,
     ARRAY['cac 40','cac40'], 'action', 'france'),
  ('eurostoxx50', 'EURO STOXX 50',                      'EUR', 'net',   'yahoo', 'C50.PA',  NULL,
     ARRAY['euro stoxx 50','eurostoxx 50','euro stoxx50'], 'action', 'europe'),
  ('stoxx600',    'STOXX Europe 600',                   'EUR', 'net',   'yahoo', 'XSX6.DE', NULL,
     ARRAY['stoxx europe 600','stoxx 600'], 'action', 'europe')
ON CONFLICT (index_code) DO UPDATE SET
  label = EXCLUDED.label, currency = EXCLUDED.currency, variant = EXCLUDED.variant,
  source = EXCLUDED.source, ticker = EXCLUDED.ticker, msci_code = EXCLUDED.msci_code,
  keywords = EXCLUDED.keywords, asset_class_broad = EXCLUDED.asset_class_broad,
  region = EXCLUDED.region;

-- 2. Actions françaises : CAC 40 GR au lieu du proxy MSCI Europe ───────────────
-- On dispose désormais d'un proxy CAC 40 gross-return (ETF acc) → plus précis que
-- le repli MSCI Europe noté dans le seed initial.
UPDATE investissement_benchmark_rules
   SET index_code = 'cac40_gr'
 WHERE match_asset_class = 'action' AND match_region = 'france'
   AND index_code = 'msci_europe';

-- 3. Nouvelles règles de catégorie (obligataire + monétaire) ───────────────────
-- Idempotent : on n'insère que les règles (asset_class, region, index) absentes.
-- priority 10 = bonds euro → eur_govt ; 30 = catch-all bonds → global_agg
-- (attrape world/usa/emerging/asia/null-region après les règles euro).
INSERT INTO investissement_benchmark_rules
  (priority, match_asset_class, match_region, index_code, is_category_proxy)
SELECT v.priority, v.match_asset_class, v.match_region, v.index_code, v.is_category_proxy
FROM (VALUES
  (10::smallint, 'obligation'::text, 'europe'::text,   'eur_govt'::text,   true),
  (10::smallint, 'obligation'::text, 'france'::text,   'eur_govt'::text,   true),
  (10::smallint, 'obligation'::text, 'eurozone'::text, 'eur_govt'::text,   true),
  (10::smallint, 'obligation'::text, 'germany'::text,  'eur_govt'::text,   true),
  (10::smallint, 'monetaire'::text,  NULL::text,       'eur_mmf'::text,    true),
  (30::smallint, 'obligation'::text, NULL::text,       'global_agg'::text, true)
) AS v(priority, match_asset_class, match_region, index_code, is_category_proxy)
WHERE NOT EXISTS (
  SELECT 1 FROM investissement_benchmark_rules r
  WHERE r.match_asset_class IS NOT DISTINCT FROM v.match_asset_class
    AND r.match_region       IS NOT DISTINCT FROM v.match_region
    AND r.index_code = v.index_code
);
