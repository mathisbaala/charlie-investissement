-- ============================================================================
-- Reclassification ETF mal classés en product_type='opcvm'
-- ----------------------------------------------------------------------------
-- Cause racine : amf-geco-full.py écrit toujours product_type='opcvm' (il lit
-- le champ prdFaml mais ne s'en sert pas — et de toute façon prdFaml='UCITS'
-- ≠ ETF, UCITS incluant les fonds classiques). Résultat : ~685 UCITS ETF
-- (Lyxor/Amundi/iShares/Xtrackers… cotés via GECO) stockés comme 'opcvm'.
--
-- Impact : ces ETF n'apparaissaient pas dans « Top ETF », pas de carte tracking
-- difference, stats biaisées, et faux positifs PEA (cf. 20260611150000).
--
-- Heuristique (le nom est le seul signal fiable) :
--   • « UCITS ETF » (ou « UCITS-ETF ») → ETF certain.
--   • « ETF » comme mot isolé → ETF, SAUF fonds-de-ETF / allocations / coquilles :
--       - selection/allocation/select/portfolio/multi-manager/profil
--         (ex. « LCL EQUILIBRE ETF SELECT », « R-co Selection ETF »)
--       - suffixe d'ombrelle « ETF [II] ICAV » / « ETF PLC »
--         (ex. « AMUNDI ETF ICAV », « UBS (IRL) ETF PLC »)
-- Backup avant modification.
-- ============================================================================

CREATE TABLE IF NOT EXISTS investissement_funds_ptype_backup_20260611 AS
SELECT isin, name, product_type
FROM   investissement_funds
WHERE  product_type = 'opcvm'
  AND  ( name ~* 'ucits[\s\-]?etf'
         OR ( name ~* '\metf\M'
              AND NOT ( name ~* '(s[ée]lection|allocation|\mselect\M|portfolio|multi[\s-]?manager|profil)'
                        OR name ~* 'etf\s+(ii\s+)?(icav|plc)\s*$' ) ) );

ALTER TABLE investissement_funds_ptype_backup_20260611 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET    product_type = 'etf'
WHERE  product_type = 'opcvm'
  AND  ( name ~* 'ucits[\s\-]?etf'
         OR ( name ~* '\metf\M'
              AND NOT ( name ~* '(s[ée]lection|allocation|\mselect\M|portfolio|multi[\s-]?manager|profil)'
                        OR name ~* 'etf\s+(ii\s+)?(icav|plc)\s*$' ) ) );
