-- ============================================================================
-- Rétrocession CGP : ETF = 0 (fiabilisation)
-- ----------------------------------------------------------------------------
-- retrocession_cgp estime la part des frais courants rétrocédée au distributeur/
-- CGP. Un ETF (part cotée, gestion passive) NE VERSE PAS de rétrocession : la
-- valeur y est structurellement nulle. Or ~52 ETF portaient une rétro > 0 (héritée
-- d'un calcul opportuniste appliqué à tort), certaines même supérieures aux frais
-- courants (ratio moyen 1,87). On les remet à 0 : pour un CGP, « 0 % » est une
-- information utile (ce support ne le rémunère pas), à distinguer de NULL (inconnu).
--
-- Backup ciblé des lignes modifiées (RLS activée, pas d'accès anon) pour réversibilité.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS investissement_funds_retro_backup_20260724 AS
SELECT isin, retrocession_cgp
FROM investissement_funds
WHERE product_type = 'etf'
  AND retrocession_cgp IS NOT NULL
  AND retrocession_cgp <> 0;

ALTER TABLE investissement_funds_retro_backup_20260724 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON investissement_funds_retro_backup_20260724 FROM anon, authenticated;

UPDATE investissement_funds
SET retrocession_cgp = 0
WHERE product_type = 'etf'
  AND retrocession_cgp IS NOT NULL
  AND retrocession_cgp <> 0;

COMMIT;
