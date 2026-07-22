-- ============================================================================
-- investissement_funds : domicile + politique de distribution (infos CGP)
-- ----------------------------------------------------------------------------
-- Deux attributs que regarde un CGP sur une fiche fonds et qui n'existaient pas :
--   • fund_domicile        — pays de domiciliation (fiscalité, reporting, PEA…).
--   • distribution_policy   — capitalisation vs distribution (client croissance vs
--                             revenus). Structurant pour l'adéquation client.
-- Tous deux DÉRIVÉS de données déjà en base (aucune source externe, aucune valeur
-- inventée) :
--   • domicile = code pays du PRÉFIXE ISIN (les 2 premières lettres = pays émetteur,
--     norme ISO 6166) → mappé en libellé FR pour les domiciles courants, sinon le
--     code brut. Ne s'applique qu'aux vrais ISIN (pas aux ID internes FE_/CRYPTO_).
--   • distribution = signaux EXPLICITES et non ambigus dans le nom ('Distribution',
--     'Capitalisation', 'Accumulation', suffixes « (D) »/« (C) »/« Dis »/« Acc »).
--     Volontairement CONSERVATEUR : on ne devine pas sur une simple lettre isolée —
--     mieux vaut NULL (non affiché) qu'un mauvais classement pour un CGP.
--
-- Migration additive et idempotente : colonnes nullable, UPDATE dérivé rejouable.
-- ============================================================================

BEGIN;

ALTER TABLE public.investissement_funds
  ADD COLUMN IF NOT EXISTS fund_domicile       text,
  ADD COLUMN IF NOT EXISTS distribution_policy text;

COMMENT ON COLUMN public.investissement_funds.fund_domicile IS
  'Pays de domiciliation, déduit du préfixe ISIN (ISO 6166). Libellé FR ou code pays.';
COMMENT ON COLUMN public.investissement_funds.distribution_policy IS
  'capitalisation | distribution, déduit du nom (signaux explicites seulement, sinon NULL).';

-- ── 1. Domicile depuis le préfixe ISIN (vrais ISIN uniquement) ───────────────
UPDATE public.investissement_funds
   SET fund_domicile = CASE substr(isin, 1, 2)
     WHEN 'FR' THEN 'France'
     WHEN 'LU' THEN 'Luxembourg'
     WHEN 'IE' THEN 'Irlande'
     WHEN 'DE' THEN 'Allemagne'
     WHEN 'GB' THEN 'Royaume-Uni'
     WHEN 'NL' THEN 'Pays-Bas'
     WHEN 'BE' THEN 'Belgique'
     WHEN 'CH' THEN 'Suisse'
     WHEN 'IT' THEN 'Italie'
     WHEN 'ES' THEN 'Espagne'
     WHEN 'AT' THEN 'Autriche'
     WHEN 'US' THEN 'États-Unis'
     WHEN 'JE' THEN 'Jersey'
     WHEN 'GG' THEN 'Guernesey'
     WHEN 'KY' THEN 'Îles Caïmans'
     ELSE substr(isin, 1, 2)
   END
 WHERE isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$';

-- ── 2. Politique de distribution depuis le nom (signaux explicites) ──────────
UPDATE public.investissement_funds
   SET distribution_policy = 'distribution'
 WHERE distribution_policy IS NULL
   AND name ~* '\m(distribution|distributing|\(d\)|dis\b|dist\b|revenus?)\M';

UPDATE public.investissement_funds
   SET distribution_policy = 'capitalisation'
 WHERE distribution_policy IS NULL
   AND name ~* '\m(capitalisation|capitalising|accumulation|accumulating|\(c\)|\(acc\)|acc\b)\M';

COMMIT;
