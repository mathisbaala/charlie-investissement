-- qa-data-fixes-20260608.sql — corrections data trouvées en QA navigateur (vue CGP senior)
-- Appliqué live le 08/06/2026. Tracé via field_sources, idempotent.
-- Contexte : QA du screener trié Perf 3A → LVMH/Orange/BNP affichés comme OPCVM,
-- et perfs annualisées délirantes (Robeco EM +98%/an, ARDIAN +167%/an).

-- (1) Actions individuelles classées OPCVM → product_type='action' (les sort du screener fonds).
--     Signal fiable : asset_class_broad='action_individuelle' (LVMH, L'Oréal, Hermès, Orange…).
update investissement_funds
set product_type = 'action',
    field_sources = jsonb_set(coalesce(field_sources,'{}'::jsonb),'{product_type}','"reclassified-stock-as-action"')
where product_type='opcvm' and asset_class_broad='action_individuelle';

-- (2) Perf_3y/5y annualisée délirante sur fonds NON-leveragés (inflation systématique de la
--     perf_3y brute, ~2x ce que perf_1y implique). On assainit le visible : un fonds diversifié
--     ne fait pas >45%/an sur 3 ans ni >38%/an sur 5 ans. Les ETF 2x/3x sont préservés (nom).
update investissement_funds set performance_3y = null
where product_type in ('opcvm','etf') and performance_3y is not null
  and name !~* '\m(2x|3x|leveraged|daily|short)\M' and inv_annualize(performance_3y,3) > 45;
update investissement_funds set performance_5y = null
where product_type in ('opcvm','etf') and performance_5y is not null
  and name !~* '\m(2x|3x|leveraged|daily|short)\M' and inv_annualize(performance_5y,5) > 38;

-- (3) Fonds obligataires : un fonds oblig ne fait pas >15%/an sur 3 ans (>13%/an sur 5 ans).
update investissement_funds set performance_3y = null
where product_type in ('opcvm','etf') and asset_class_broad='obligation' and performance_3y is not null
  and inv_annualize(performance_3y,3) > 15;
update investissement_funds set performance_5y = null
where product_type in ('opcvm','etf') and asset_class_broad='obligation' and performance_5y is not null
  and inv_annualize(performance_5y,5) > 13;

-- LIMITE CONNUE : l'inflation perf_3y est diffuse (toutes sources, ~2x). Les fonds entre 20 et
-- 45%/an restent potentiellement gonflés mais non distinguables des vrais performers sans source
-- autoritaire (Morningstar/Quantalys = morts). Recompute completeness après : recompute-completeness-v2.sql
