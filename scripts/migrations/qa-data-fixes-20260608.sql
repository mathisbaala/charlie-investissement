-- qa-data-fixes-20260608.sql — corrections data trouvées en QA navigateur (vue CGP senior)
-- Appliqué live le 08/06/2026. Tracé via field_sources, idempotent.
-- Contexte : QA des tris Perf 1A / Perf 3A → actions blue-chip affichées comme OPCVM,
-- et perfs délirantes (Robeco EM +98%/an, ARDIAN +167%/an, FIP/FIPS +148%/1an,
-- fonds "prudent/flexible" à +99%/1an).

-- (1) Actions individuelles classées OPCVM → product_type='action' (LVMH, L'Oréal, Hermès, Orange…).
update investissement_funds
set product_type = 'action',
    field_sources = jsonb_set(coalesce(field_sources,'{}'::jsonb),'{product_type}','"reclassified-stock-as-action"')
where product_type='opcvm' and asset_class_broad='action_individuelle';

-- (2) Caps perf par CLASSE D'ACTIF (précis, vs seuil aveugle) — un fonds ne dépasse pas la
--     borne plausible de sa catégorie. ETF 2x/3x préservés (nom). Inflation perf brute diffuse.
--   Actions/ETF : >100%/1an, >45%/an (3A), >38%/an (5A) = impossible pour un fonds non-leveragé
update investissement_funds set performance_1y = null
where product_type in ('opcvm','etf') and performance_1y > 100 and name !~* '\m(2x|3x|leveraged|daily|short)\M';
update investissement_funds set performance_3y = null
where product_type in ('opcvm','etf') and performance_3y is not null
  and name !~* '\m(2x|3x|leveraged|daily|short)\M' and inv_annualize(performance_3y,3) > 45;
update investissement_funds set performance_5y = null
where product_type in ('opcvm','etf') and performance_5y is not null
  and name !~* '\m(2x|3x|leveraged|daily|short)\M' and inv_annualize(performance_5y,5) > 38;
--   Diversifiés (équilibrés/prudents/flexibles) : >40%/1an, >25%/an (3A), >22%/an (5A)
update investissement_funds set performance_1y = null
where product_type in ('opcvm','etf') and asset_class_broad='diversifie' and performance_1y > 40;
update investissement_funds set performance_3y = null
where product_type in ('opcvm','etf') and asset_class_broad='diversifie' and performance_3y is not null
  and inv_annualize(performance_3y,3) > 25;
update investissement_funds set performance_5y = null
where product_type in ('opcvm','etf') and asset_class_broad='diversifie' and performance_5y is not null
  and inv_annualize(performance_5y,5) > 22;
--   Obligataires : >15%/an (3A), >13%/an (5A)
update investissement_funds set performance_3y = null
where product_type in ('opcvm','etf') and asset_class_broad='obligation' and performance_3y is not null
  and inv_annualize(performance_3y,3) > 15;
update investissement_funds set performance_5y = null
where product_type in ('opcvm','etf') and asset_class_broad='obligation' and performance_5y is not null
  and inv_annualize(performance_5y,5) > 13;
--   Monétaires : >10%/1an
update investissement_funds set performance_1y = null
where product_type in ('opcvm','etf') and asset_class_broad='monetaire' and performance_1y > 10;

-- (3) Perf AUTORITAIRE depuis les VL : compute-metrics.py recalcule perf/vol/sharpe pour les
--     ~7000 fonds avec historique NAV (≥2,75 ans). Lancé en arrière-plan le 08/06 (n'écrase pas
--     les fonds sans VL). C'est le fix de fond ; les caps ci-dessus traitent les fonds sans NAV.

-- LIMITE CONNUE : l'inflation perf sur les fonds SANS VL (FIP/FIPS/PE retail, certains scrapes)
-- reste partielle entre les bornes par catégorie — non distinguable des vrais performers sans
-- source autoritaire. Recompute completeness après : recompute-completeness-v2.sql

-- ════════════════════════════════════════════════════════════════════════════
-- POST-COMPUTE-METRICS (08/06) — à rejouer APRÈS compute-metrics.py (qui recalcule
-- perf/vol/sharpe depuis les VL pour ~8300 fonds et peut propager des glitches NAV
-- + écrase track_record_years avec la durée d'historique NAV au lieu de l'âge réel).
-- ════════════════════════════════════════════════════════════════════════════

-- (A) Re-caps perf (compute-metrics a réécrit la perf des fonds à VL → re-borner les glitches).
--     Idem que (2) ci-dessus : 1A>100, 3A>45%/an, 5A>38%/an, diversifié>40/25, oblig>15, mon>15.
--     (rejouer le bloc (2))

-- (B) Volatilité glitch NAV (>80% non-leveragé : ex. ETF Low Vol à 10000% = point VL corrompu).
update investissement_funds set volatility_1y=null, sharpe_1y=null
where product_type in ('opcvm','etf') and volatility_1y>80 and name !~* '\m(2x|3x|leveraged|daily|short)\M';
update investissement_funds set volatility_3y=null, sharpe_3y=null
where product_type in ('opcvm','etf') and volatility_3y>80 and name !~* '\m(2x|3x|leveraged|daily|short)\M';

-- (C) Sharpe artefacts : |valeur|>15, OU vol quasi-nulle (monétaires CHF : vol~0 → Sharpe -57).
update investissement_funds set sharpe_1y=null
where sharpe_1y is not null and (abs(sharpe_1y)>15 or (volatility_1y is not null and volatility_1y<0.5));
update investissement_funds set sharpe_3y=null
where sharpe_3y is not null and (abs(sharpe_3y)>15 or (volatility_3y is not null and volatility_3y<0.5));

-- (D) Restaurer track_record_years = âge réel depuis inception (compute-metrics l'a écrasé).
update investissement_funds
set track_record_years = round((current_date - inception_date)/365.25, 1)
where inception_date is not null and inception_date <= current_date and inception_date > '1900-01-01'
  and round((current_date - inception_date)/365.25,1) is distinct from track_record_years;

-- (E) Puis rejouer recompute-completeness-v2.sql.
