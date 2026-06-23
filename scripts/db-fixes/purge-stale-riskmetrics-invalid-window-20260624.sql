-- Purge des métriques de risque PÉRIMÉES sur fenêtre INVALIDE ─────────────────
-- Contexte (24/06) : compute-metrics.py laissait survivre vol/sharpe/drawdown
-- d'un calcul antérieur quand la fenêtre devenait invalide (perf_3y/1y = None
-- → branche else ne purgeait QUE la perf). Résultat : des fonds de < ~2,75 ans
-- d'historique affichaient une vol_3y aberrante (ex. FR0014015LI2 vol_3y 169
-- alors que la série propre donne 1,8). La garde __insane masquait le symptôme.
--
-- Cause racine corrigée dans compute-metrics.py (les deux branches else purgent
-- désormais tout le bloc de la fenêtre). Ce script nettoie l'EXISTANT pour le
-- sous-ensemble SÛR : métrique déjà MASQUÉE par __insane (valeur impossible,
-- invisible en UI) ET fenêtre réellement invalide (n/span insuffisants). On ne
-- touche donc aucune valeur visible, et on ne purge que là où compute-metrics
-- n'aurait de toute façon JAMAIS dû écrire de métrique.
--
-- Hors périmètre (NON touchés ici) :
--   - fonds masqués dont la fenêtre est VALIDE mais la SÉRIE a un glitch réel
--     (spike ×80-100, multi-échelle) → réparation NAV ciblée, pas purge métrique ;
--   - détresse RÉELLE (Transition Evergreen, H2O) → légitimement masqués ;
--   - les ~3 300 fonds à valeur PLAUSIBLE (<60) sur fenêtre invalide → décision
--     produit séparée (le prochain run compute-metrics les purgera via le code
--     corrigé). Réversible via le backup ci-dessous.

-- Seuils alignés sur compute-metrics.py : MIN_POINTS_3Y=78, MIN_SPAN_3Y≈1005 ;
-- MIN_POINTS_1Y=26, MIN_SPAN_1Y=300.

CREATE TABLE IF NOT EXISTS investissement_funds_riskmetrics_backup_20260624 AS
WITH cov AS (
  SELECT pr.isin,
         count(*) FILTER (WHERE pr.price_date >= current_date-1095) AS n3y,
         (max(pr.price_date) FILTER (WHERE pr.price_date >= current_date-1095)
            - min(pr.price_date) FILTER (WHERE pr.price_date >= current_date-1095)) AS span3y,
         count(*) FILTER (WHERE pr.price_date >= current_date-365) AS n1y,
         (max(pr.price_date) FILTER (WHERE pr.price_date >= current_date-365)
            - min(pr.price_date) FILTER (WHERE pr.price_date >= current_date-365)) AS span1y
  FROM investissement_fund_prices pr WHERE pr.nav>0 GROUP BY pr.isin
)
SELECT f.isin, f.name, f.asset_class_broad,
       f.volatility_1y, f.volatility_3y, f.sharpe_1y, f.sharpe_3y,
       f.max_drawdown_1y, f.max_drawdown_3y,
       (coalesce(c.n3y,0)<78 OR coalesce(c.span3y,0)<1005) AS purge_3y,
       (coalesce(c.n1y,0)<26 OR coalesce(c.span1y,0)<300)  AS purge_1y,
       now() AS backed_up_at
FROM investissement_funds f
LEFT JOIN cov c ON c.isin=f.isin
WHERE f.product_type IN ('opcvm','etf')
  AND f.asset_class_broad IS DISTINCT FROM 'crypto'
  AND coalesce(f.name,'') !~* 'leverage|levier|inverse|\mbear\m|ultra|\m[2-3]x\m|\mx[2-3]\m|daily.*[2-3]'
  AND (
    ((f.volatility_3y>60 OR f.max_drawdown_3y<-90) AND (coalesce(c.n3y,0)<78 OR coalesce(c.span3y,0)<1005))
    OR
    (f.volatility_1y>60 AND (coalesce(c.n1y,0)<26 OR coalesce(c.span1y,0)<300))
  );

ALTER TABLE investissement_funds_riskmetrics_backup_20260624 ENABLE ROW LEVEL SECURITY;

-- Purge 3Y (vol + sharpe + drawdown) — RESTREINT au garbage déjà MASQUÉ par
-- __insane (valeur impossible) : la condition (vol_3y>60 OR dd_3y<-90) garantit
-- qu'on ne touche AUCUNE valeur plausible/visible (cas des ~3 300 à décider à
-- part). Le backup couvre le superset, donc le revert reste complet.
UPDATE investissement_funds f
SET volatility_3y=NULL, sharpe_3y=NULL, max_drawdown_3y=NULL
FROM investissement_funds_riskmetrics_backup_20260624 b
WHERE b.isin=f.isin AND b.purge_3y
  AND (f.volatility_3y>60 OR f.max_drawdown_3y<-90);

-- Purge 1Y (vol + sharpe + drawdown) — idem, restreint au masqué (vol_1y>60)
UPDATE investissement_funds f
SET volatility_1y=NULL, sharpe_1y=NULL, max_drawdown_1y=NULL
FROM investissement_funds_riskmetrics_backup_20260624 b
WHERE b.isin=f.isin AND b.purge_1y
  AND f.volatility_1y>60;

-- REVERT (si besoin) :
-- UPDATE investissement_funds f SET
--   volatility_1y=b.volatility_1y, volatility_3y=b.volatility_3y,
--   sharpe_1y=b.sharpe_1y, sharpe_3y=b.sharpe_3y,
--   max_drawdown_1y=b.max_drawdown_1y, max_drawdown_3y=b.max_drawdown_3y
-- FROM investissement_funds_riskmetrics_backup_20260624 b WHERE b.isin=f.isin;
