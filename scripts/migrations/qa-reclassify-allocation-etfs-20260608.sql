-- QA (point de vue CGP) — ISSUE-002, 2026-06-08
-- Symptôme : un fonds équilibré (Vanguard LifeStrategy 60%, iShares Conservative
-- Portfolio…) s'affichait en catégorie "Actions" avec une perf 3A de +37 %/an
-- (157 % cumulé) — impossible pour un 60/40. Cause : ces ETF d'allocation
-- multi-actifs étaient classés asset_class_broad='action', donc (a) la fiche
-- affichait "Actions", (b) la similarité les comparait à des actions, (c) le cap
-- de perf utilisait le seuil actions (45 %/an) au lieu du seuil diversifié (25 %/an).
--
-- Réversible via investissement_funds_classif_backup_20260608 (classif) et
-- investissement_funds_perf_backup_20260608 (perfs). RLS prod désactivé.

-- 1) Reclasser les familles d'ETF d'allocation (garde-fou volatilité < 13 % pour
--    exclure les vrais fonds actions nommés "Growth Portfolio" type AB).
UPDATE investissement_funds
SET category_normalized='Multi-Actifs', asset_class_broad='diversifie', asset_class='diversifie'
WHERE product_type IN ('opcvm','etf') AND asset_class_broad='action'
  AND volatility_1y IS NOT NULL AND volatility_1y < 13
  AND (name ~* 'lifestrateg' OR name ~* '(conservative|moderate) portfolio'
       OR name ~* 'ishares growth portfolio' OR name ~* 'xtrackers portfolio');
-- → 16 fonds (LifeStrategy 20/40/60/80, iShares Conservative/Moderate/Growth, Xtrackers Portfolio/Income)

-- 2) Annuler les perfs 3A aberrantes désormais identifiables (>25 %/an = impossible
--    pour un équilibré ; ex. LifeStrategy 60 % A/D à 37 %/an, 40 % A à 26 % vs 40 % D à 2,7 %).
UPDATE investissement_funds
SET performance_3y = NULL
WHERE product_type IN ('opcvm','etf') AND asset_class_broad='diversifie'
  AND inv_annualize_pt(performance_3y, 3, product_type) > 25;
-- → 3 perfs nullées
