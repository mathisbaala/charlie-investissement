-- QA (point de vue CGP) — ISSUE-003, 2026-06-08
-- Symptôme : l'accueil ("Top Perf 3A") et le screener trié perf remontaient des
-- fonds impossibles — MSCI Europe index, fonds dividende/value/régionaux à
-- +35 à +44 %/an annualisé sur 3 ans avec une volatilité de 12-18 % (Sharpe 3A
-- implicite 2,5-4, impossible pour du long-only retail). Inflation résiduelle
-- diffuse de perf_3y.
--
-- Discriminant first-principles : cohérence perf/volatilité. Un fonds long-only
-- ne tient pas un Sharpe 3 ans > 2. On annule perf_3y quand l'annualisé > 25 %/an
-- ET (annualisé / volatilité_1y) > 2,0.
--
-- Calibration : les vrais gagnants à forte volatilité sont préservés car leur
-- ratio est bas — or/métaux précieux (~45 %/an, vol 42-48, ratio ~1,0), levier 2x
-- (49 %/an, vol 34, ratio 1,4), blockchain (vol 38), Korea (vol 39), métavers
-- (vol 26), Euro Stoxx Banks (43 %/an, vol 24, ratio 1,83 — les banques zone euro
-- ont réellement fait ~40 %/an 2022-2025). Le premier fonds inflaté commençait à
-- ratio 2,06 → le seuil 2,0 sépare proprement légitimes (≤1,83) et inflatés.
--
-- ~254 fonds. Réversible via investissement_funds_perf_backup_20260608.

UPDATE investissement_funds
SET performance_3y = NULL
WHERE product_type IN ('opcvm','etf')
  AND performance_3y IS NOT NULL AND volatility_1y > 0
  AND inv_annualize_pt(performance_3y, 3, product_type) > 25
  AND inv_annualize_pt(performance_3y, 3, product_type) / volatility_1y > 2.0;

-- Limite assumée : l'inflation perf_3y sous le seuil (annualisé 15-25 %/an, vol
-- cohérente) n'est pas détectable par ce filtre et reste sans source autoritaire.
