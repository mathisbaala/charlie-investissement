# 🍴 CGP Query Cookbook

> Recettes SQL prêtes à l'emploi pour CGP français — utiliser la vue `investissement_funds_cgp`.

Toutes les requêtes ci-dessous utilisent la vue `investissement_funds_cgp` qui exclut
les fonds dédiés/placeholders et expose les champs CGP-relevant uniquement.

---

## 1. Trouver un fonds par enveloppe fiscale

### PEA — Top 20 actions Europe les plus performantes
```sql
SELECT name, gestionnaire, performance_1y, performance_3y,
       volatility_1y, ter, sri, data_completeness
FROM investissement_funds_cgp
WHERE pea_eligible IS TRUE
  AND asset_class_broad = 'action'
  AND region_normalized IN ('france', 'europe', 'world')
  AND data_completeness >= 70
ORDER BY performance_3y DESC NULLS LAST
LIMIT 20;
```

### PER — Top 20 fonds diversifiés pour profil prudent
```sql
SELECT name, gestionnaire, performance_3y, volatility_3y, sharpe_3y,
       ter, sri
FROM investissement_funds_cgp
WHERE per_eligible IS TRUE
  AND asset_class_broad = 'diversifie'
  AND risk_score <= 4  -- profil prudent à équilibré
  AND data_completeness >= 70
ORDER BY sharpe_3y DESC NULLS LAST
LIMIT 20;
```

### AV Luxembourg — Top 30 ETF UCITS par AUM
```sql
SELECT name, gestionnaire, currency, aum_eur, ter,
       performance_3y, sharpe_3y, sri, hedged
FROM investissement_funds_cgp
WHERE av_lux_eligible IS TRUE
  AND product_type = 'etf'
ORDER BY aum_eur DESC NULLS LAST
LIMIT 30;
```

---

## 2. Recherche thématique

### Fonds ESG/ISR avec article 9 SFDR
```sql
SELECT name, gestionnaire, performance_3y, ter, sri, labels
FROM investissement_funds_cgp
WHERE labels @> '["Article9"]'::jsonb  -- contient le label
ORDER BY performance_3y DESC NULLS LAST
LIMIT 20;
```

### Fonds technologie monde
```sql
SELECT name, gestionnaire, region_normalized, performance_1y,
       performance_3y, volatility_1y, ter
FROM investissement_funds_cgp
WHERE sector = 'technologie'
  AND data_completeness >= 60
ORDER BY performance_1y DESC NULLS LAST
LIMIT 15;
```

### Fonds climat / transition énergétique
```sql
SELECT name, gestionnaire, sector, asset_class_broad,
       performance_1y, ter, sri
FROM investissement_funds_cgp
WHERE labels @> '["Climate"]'::jsonb
   OR sector IN ('climat', 'environnement')
ORDER BY data_completeness DESC, performance_1y DESC NULLS LAST
LIMIT 20;
```

---

## 3. Comparaison de gestionnaires

### Tous les fonds Amundi avec leur perf moyenne
```sql
SELECT gestionnaire, COUNT(*) as nb_fonds,
       ROUND(AVG(performance_1y)::numeric, 2) as perf_moy_1y,
       ROUND(AVG(ter)::numeric, 4) as ter_moyen
FROM investissement_funds_cgp
WHERE gestionnaire = 'Amundi'
  AND product_type IN ('etf', 'opcvm')
GROUP BY gestionnaire;
```

### Top 10 gestionnaires par AUM total
```sql
SELECT gestionnaire,
       COUNT(*) as nb_fonds,
       SUM(aum_eur) / 1e9 as aum_total_milliards_eur
FROM investissement_funds_cgp
WHERE gestionnaire IS NOT NULL
GROUP BY gestionnaire
ORDER BY aum_total_milliards_eur DESC NULLS LAST
LIMIT 10;
```

---

## 4. Filtres avancés multicritères

### Profil "équilibré dynamique" — diversifié monde, SRI 4-5, ESG
```sql
SELECT name, gestionnaire, performance_3y, volatility_3y, ter, labels
FROM investissement_funds_cgp
WHERE asset_class_broad = 'diversifie'
  AND region_normalized = 'world'
  AND risk_score BETWEEN 4 AND 5
  AND (labels @> '["ESG"]'::jsonb OR labels @> '["ISR"]'::jsonb)
  AND ter < 0.025  -- TER < 2.5%
ORDER BY sharpe_3y DESC NULLS LAST
LIMIT 15;
```

### ETF passifs S&P 500 — comparaison frais
```sql
SELECT name, gestionnaire, ter, aum_eur, performance_3y,
       hedged, currency, share_class_group_id
FROM investissement_funds_cgp
WHERE product_type = 'etf'
  AND management_style = 'passif'
  AND region_normalized = 'usa'
  AND (name ILIKE '%S&P%500%' OR name ILIKE '%SP500%')
ORDER BY ter ASC NULLS LAST
LIMIT 20;
```

---

## 5. Identification de classes de parts

### Regrouper les classes d'un même fonds
```sql
-- Récupère toutes les parts du fonds donné par ISIN
WITH target_group AS (
  SELECT share_class_group_id
  FROM investissement_funds_cgp
  WHERE isin = 'IE00B5BMR087'  -- ex: iShares Core S&P 500
)
SELECT isin, name, currency, hedged, aum_eur, ter
FROM investissement_funds_cgp
WHERE share_class_group_id = (SELECT share_class_group_id FROM target_group)
ORDER BY aum_eur DESC NULLS LAST;
```

### Lister les groupes ETF avec ≥3 classes de parts
```sql
SELECT share_class_group_id,
       MIN(name) as nom_fond,
       MIN(gestionnaire) as gestionnaire,
       COUNT(*) as nb_parts,
       ARRAY_AGG(DISTINCT currency) as devises,
       SUM(aum_eur) as aum_total
FROM investissement_funds_cgp
WHERE share_class_group_id IS NOT NULL
  AND product_type = 'etf'
GROUP BY share_class_group_id
HAVING COUNT(*) >= 3
ORDER BY aum_total DESC NULLS LAST
LIMIT 20;
```

---

## 6. Crypto

### Top cryptos avec sharpe positif
```sql
SELECT name, performance_1y, volatility_1y, sharpe_1y,
       max_drawdown_1y, sri
FROM investissement_funds_cgp
WHERE product_type = 'crypto'
  AND sharpe_1y > 0
ORDER BY sharpe_1y DESC
LIMIT 10;
```

---

## 7. SCPI

### Top SCPI par TDVM (performance_1y)
```sql
SELECT name, gestionnaire, performance_1y as tdvm,
       aum_eur, ter, inception_date
FROM investissement_funds_cgp
WHERE product_type = 'scpi'
ORDER BY performance_1y DESC NULLS LAST
LIMIT 20;
```

---

## 8. Audit qualité

### Fonds suspects (perf > 200%, vol > 100%)
```sql
SELECT isin, name, performance_1y, volatility_1y, product_type
FROM investissement_funds
WHERE (performance_1y > 200 OR performance_1y < -100
       OR volatility_1y > 100)
ORDER BY ABS(performance_1y) DESC NULLS LAST;
```

### Fonds avec field_sources tracé
```sql
SELECT isin, name, field_sources
FROM investissement_funds
WHERE field_sources @> '{"ter": "quantalys"}'
LIMIT 20;
```

---

## 9. Reporting CGP

### Synthèse par enveloppe (PEA / PER / AV Lux)
```sql
SELECT
  CASE WHEN pea_eligible THEN 'PEA' END as enveloppe,
  product_type,
  asset_class_broad,
  COUNT(*) as nb_fonds,
  ROUND(AVG(data_completeness)::numeric) as completeness_moy
FROM investissement_funds_cgp
WHERE pea_eligible IS TRUE
GROUP BY 1, 2, 3
ORDER BY 4 DESC;
```

### Couverture par champ
```sql
SELECT
  COUNT(*) FILTER (WHERE ter IS NOT NULL) * 100 / COUNT(*) as ter_pct,
  COUNT(*) FILTER (WHERE sri IS NOT NULL) * 100 / COUNT(*) as sri_pct,
  COUNT(*) FILTER (WHERE performance_1y IS NOT NULL) * 100 / COUNT(*) as perf1y_pct,
  COUNT(*) FILTER (WHERE volatility_1y IS NOT NULL) * 100 / COUNT(*) as vol1y_pct,
  COUNT(*) FILTER (WHERE asset_class_broad IS NOT NULL) * 100 / COUNT(*) as ac_pct,
  COUNT(*) FILTER (WHERE labels != '[]'::jsonb) * 100 / COUNT(*) as labels_pct
FROM investissement_funds_cgp;
```

---

## Conventions à retenir

- `data_completeness` : 0-100, **≥80 = exploitable** par un CGP en confiance
- `risk_score` (= COALESCE sri, srri) : 1 = très faible risque, 7 = très élevé
- `ter` : fraction (`0.012` = 1.2%)
- `performance_*` : pourcentage (`12.5` = 12.5%)
- `labels` : JSONB array, requête avec `@>` (contains)
- `field_sources` : JSONB object, traçabilité par champ
