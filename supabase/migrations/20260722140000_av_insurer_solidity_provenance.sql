-- ============================================================================
-- Solidité assureur — provenance PAR métrique (PPB, encours, notation)
-- ----------------------------------------------------------------------------
-- La migration `av_insurer_solidity` (20260717170000) a posé les colonnes de
-- solidité avec UNE seule traçabilité (sfcr_url / sfcr_annee / solidite_confidence),
-- calibrée pour la Solvabilité II. Or les trois autres métriques ne viennent PAS
-- du SFCR :
--   • PPB      → étude publique Good Value for Money / FranceTransactions (fin 2023) ;
--   • encours  → classements encours vie (GVfM / l'Argus / rapports annuels) ;
--   • notation → agences (S&P, Moody's, Fitch, AM Best), souvent au niveau groupe.
-- Les afficher toutes sous le seul « Rapport SFCR » serait une provenance fausse.
--
-- Cette migration rend chaque métrique auditable de façon autonome : année + URL
-- source propres. Purement additive, colonnes nullables, aucune RPC touchée.
-- L'UI (fiche assureur + fiche-contrat) datera chaque tuile à SA source.
-- ============================================================================

BEGIN;

ALTER TABLE public.investissement_av_insurer_profiles
  ADD COLUMN IF NOT EXISTS ppb_annee          integer,  -- millésime de la PPB (ex. 2023)
  ADD COLUMN IF NOT EXISTS ppb_source_url      text,     -- source publique de la PPB
  ADD COLUMN IF NOT EXISTS encours_annee       integer,  -- millésime de l'encours vie
  ADD COLUMN IF NOT EXISTS encours_source_url  text,     -- source publique de l'encours
  ADD COLUMN IF NOT EXISTS notation_source_url text;      -- source de la notation d'agence

COMMENT ON COLUMN public.investissement_av_insurer_profiles.ppb_annee IS
  'Millésime de la PPB (la PPB par assureur en libre accès est publiée avec un an de décalage).';
COMMENT ON COLUMN public.investissement_av_insurer_profiles.encours_annee IS
  'Millésime de l''encours vie (provisions techniques épargne/retraite).';

COMMIT;
