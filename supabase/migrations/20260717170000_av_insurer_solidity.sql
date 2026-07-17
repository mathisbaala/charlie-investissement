-- ============================================================================
-- Levier 3 — « Solidité assureur » : axe chiffré, sourçable, durable (SFCR)
-- ----------------------------------------------------------------------------
-- La spec CGP (§3.2 de docs/mapping-assureurs-contrats-cgp.md) prévoit 4 attributs
-- assureur qui n'existaient pas encore en colonne : ratio Solvabilité II, notation
-- financière, PPB (provision pour participation aux bénéfices = réserve de
-- rendement futur du fonds euros), et encours vie. Ce sont des FAITS CHIFFRÉS et
-- AUDITABLES : chaque assureur publie chaque année son rapport SFCR (« Solvabilité
-- et Situation Financière ») — source officielle, stable, réutilisable.
--
-- On ajoute ces colonnes à investissement_av_insurer_profiles (nullable → aucun
-- impact sur l'existant), + une table d'HISTORIQUE des taux de fonds euros
-- (multi-année) car un seul millésime ne dit pas la trajectoire, or c'est LE chiffre
-- que regarde un CGP. Toutes deux traçables (source_url + as_of/année).
--
-- Migration PUREMENT ADDITIVE et réversible. RLS + grants alignés sur le durcissement
-- anti-scraping (l'app lit en service_role, qui bypass RLS).
-- ============================================================================

BEGIN;

-- ── 1. Solidité assureur sur le profil ──────────────────────────────────────
ALTER TABLE public.investissement_av_insurer_profiles
  ADD COLUMN IF NOT EXISTS solvabilite_2_pct numeric,   -- ratio de couverture du SCR, en % (ex. 210)
  ADD COLUMN IF NOT EXISTS notation          text,      -- note de crédit (ex. « A+ »)
  ADD COLUMN IF NOT EXISTS notation_agence   text,      -- agence (S&P, Fitch, Moody's, AM Best)
  ADD COLUMN IF NOT EXISTS notation_annee    integer,
  ADD COLUMN IF NOT EXISTS ppb_pct           numeric,   -- PPB en % des provisions math. (réserve fonds euros)
  ADD COLUMN IF NOT EXISTS encours_vie_mds   numeric,   -- encours vie en milliards d'euros
  ADD COLUMN IF NOT EXISTS sfcr_annee        integer,   -- millésime du rapport SFCR source
  ADD COLUMN IF NOT EXISTS sfcr_url          text,      -- lien vers le rapport SFCR (auditabilité)
  ADD COLUMN IF NOT EXISTS solidite_confidence text
    CHECK (solidite_confidence IN ('sfcr','presse','estime'));  -- provenance du chiffre

COMMENT ON COLUMN public.investissement_av_insurer_profiles.solvabilite_2_pct IS
  'Ratio de couverture du SCR (Solvabilité II), en %. Source SFCR annuel.';
COMMENT ON COLUMN public.investissement_av_insurer_profiles.ppb_pct IS
  'Provision pour participation aux bénéfices, en % des provisions mathématiques. Capacité de rendement futur du fonds euros.';

-- ── 2. Historique multi-année des taux de fonds euros ───────────────────────
-- Keyé (company, fonds_euros_nom, annee). Un fonds euros peut servir plusieurs
-- contrats : on porte le taux au niveau du fonds euros nommé, la fiche-contrat le
-- rattache via investissement_av_contract_terms.fonds_euros_nom.
CREATE TABLE IF NOT EXISTS public.investissement_av_fonds_euros_history (
  company          text NOT NULL,
  fonds_euros_nom  text NOT NULL,           -- '' = fonds euros « générique » de l'assureur
  annee            integer NOT NULL,
  taux_pct         numeric NOT NULL,        -- taux net de frais de gestion, brut de PS/fiscalité
  net_de_frais     boolean DEFAULT true,
  bonus_note       text,                    -- ex. « +0,50 pt si ≥40 % UC »
  source_url       text,
  as_of            date,
  confidence       text NOT NULL DEFAULT 'presse'
    CHECK (confidence IN ('assureur','presse','estime')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company, fonds_euros_nom, annee)
);

ALTER TABLE public.investissement_av_fonds_euros_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investissement_av_fonds_euros_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.investissement_av_fonds_euros_history TO service_role;

CREATE INDEX IF NOT EXISTS i_av_fe_history_company
  ON public.investissement_av_fonds_euros_history (company);

COMMIT;
