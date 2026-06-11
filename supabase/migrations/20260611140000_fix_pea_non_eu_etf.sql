-- ============================================================================
-- Fix faux positifs éligibilité PEA — ETF hors-UE (réplication physique)
-- ----------------------------------------------------------------------------
-- Suite de 20260611130000. La règle ETF de pea-eligibility-fix.py marquait
-- PEA-éligible tout ETF actions domicilié UE (IE/LU = Irlande/Luxembourg, hubs
-- UCITS) — or le domicile ≠ les sous-jacents. Résultat : des ETF MSCI Korea,
-- Brazil, Japan, USA, World… (domiciliés IE/LU) marqués PEA à tort.
--
-- Critère PEA réel : ≥75 % d'actions UE/EEE. Un ETF à réplication physique sur
-- indice hors-EEE ne peut pas l'être. Les ETF SYNTHÉTIQUES PEA légitimes
-- (Amundi PEA S&P 500, iShares MSCI World Swap PEA…) sont toujours labellisés
-- « PEA » dans leur nom → protégés.
--
-- Démotion : ETF pea_eligible=TRUE sur région hors-EEE, SAUF si le nom contient
--   - « pea » (synthétiques PEA + « european »)
--   - un token d'indice/zone UE (région possiblement mal classée, ex. FTSE MIB
--     italien tagué « uk »).
-- Backup avant modification.
-- ============================================================================

CREATE TABLE IF NOT EXISTS investissement_funds_pea_etf_backup_20260611 AS
SELECT isin, name, region_normalized, benchmark_index, pea_eligible
FROM   investissement_funds
WHERE  pea_eligible IS TRUE AND product_type = 'etf'
  AND  region_normalized IN ('world','usa','emerging','asia','china','india','brazil','japan','uk','switzerland');

ALTER TABLE investissement_funds_pea_etf_backup_20260611 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET    pea_eligible = FALSE
WHERE  pea_eligible IS TRUE AND product_type = 'etf'
  AND  region_normalized IN ('world','usa','emerging','asia','china','india','brazil','japan','uk','switzerland')
  AND  name NOT ILIKE '%pea%'
  AND  name !~* '(europe|euro stoxx|eurostoxx|\meuro\M|\memu\M|stoxx|\mmib\M|\mcac\M|\mdax\M|ibex|\maex\M|eurozone|zone euro|italy|italie|spain|espagne|netherlands|nordic|finland|finlande|sweden|suède|belgium|belgique|portugal|poland|pologne)';
