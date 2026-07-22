-- ============================================================================
-- Seed « solidité assureur » — ratio de Solvabilité II, socle CGP français
-- ----------------------------------------------------------------------------
-- Les colonnes de solidité (solvabilite_2_pct, notation, ppb_pct, encours_vie_mds…)
-- ont été AJOUTÉES le 17/07 (migration av_insurer_solidity) mais JAMAIS remplies :
-- le bloc « Solidité financière » des fiches /assureurs/compagnie et
-- /assureurs/contrat ne s'affiche donc pour aucun assureur. Cette migration
-- amorce le remplissage avec la métrique la plus fiable et la plus lisible par un
-- CGP : le RATIO DE COUVERTURE DU SCR (Solvabilité II) 2024, par ENTITÉ VIE.
--
-- SOURÇAGE (fait, auditable, aucune valeur inventée) :
--   • Chiffres tirés des rapports SFCR 2024 de chaque entité vie (millésime au
--     31/12/2024), sourcés dans sfcr_url. Un ratio de solvabilité se publie de
--     deux façons (avec / sans correction pour volatilité) → on retient la valeur
--     mise en avant dans le SFCR de l'entité, et solidite_confidence trace la
--     provenance : 'sfcr' (chiffre du rapport) ou 'presse' (repli agrégé, arrondi).
--   • Piège d'entité écarté : « Suravenir » = assureur VIE (≠ « Suravenir
--     Assurances », filiale dommages à 157 % — hors sujet). Le 208 % de Cardif est
--     celui de « Cardif Assurance Vie » (entité vie sous BNP Paribas Cardif), pas
--     du groupe (158 %).
--
-- NON couvert ici (volontairement) : PPB, notation d'agence, encours vie. Ces
-- métriques demandent une source homogène (Good Value for Money) pour éviter les
-- écarts de base de calcul entre agrégateurs — passe suivante. On ne remplit que
-- ce qu'on sait sourcer proprement ; l'UI n'affiche que les champs non nuls.
--
-- Idempotente : UPDATE ciblé par `company` (les lignes existent déjà, seed 14/07).
-- Purement additive sur des colonnes jusque-là nulles. Aucune RPC touchée.
-- ============================================================================

BEGIN;

-- Generali Vie — SFCR 2024 : couverture SCR 160 % (avec volatility adjustment).
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 160,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.generali.fr/sites/default/files-d8/2025-04/RSSF_Generali_Vie_2024.pdf',
  solidite_confidence = 'sfcr'
WHERE company = 'Generali Vie';

-- Spirica — SFCR 2024 : couverture SCR 152 %.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 152,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.spirica.fr/wp-content/uploads/2025/04/SPIRICA-RN-SFCR-VDEF-pour-CA.pdf',
  solidite_confidence = 'sfcr'
WHERE company = 'Spirica';

-- Suravenir (VIE) — SFCR 2024 : SCR couvert à 264 % par les fonds propres éligibles
-- (284 % en 2023). NE PAS confondre avec Suravenir Assurances (dommages, 157 %).
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 264,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.suravenir.fr/wp-content/uploads/pdf/SFCR_2024.pdf',
  solidite_confidence = 'sfcr'
WHERE company = 'Suravenir';

-- Swiss Life Assurance et Patrimoine — SFCR 2024 : 147,7 % (171,2 % en 2023).
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 147.7,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.swisslife.fr/content/dam/france/swisslife/SL_AP_Narrative_Report_PdfProof%20FR-34.pdf',
  solidite_confidence = 'sfcr'
WHERE company = 'SwissLife France';

-- BNP Paribas Cardif — entité vie « Cardif Assurance Vie », SFCR 2024 : 208 %
-- (le groupe BNP Paribas Cardif est à 158 % — non retenu ici, moins pertinent CGP).
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 208,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.bnpparibascardif.com/wp-content/uploads/sites/28/2025/04/Cardif-Assurance-Vie-SFCR-2024-in-french-1.pdf',
  solidite_confidence = 'sfcr'
WHERE company = 'BNP Paribas Cardif';

-- ── 2e rang CGP (chiffres agrégés/presse, à re-fiabiliser via Good Value for Money) ──

-- AXA France Vie — 2024 : 147,6 % (156,4 % en 2023). Entité vie du groupe (offre
-- CGP via AXA Thema). Source agrégée (GVfM) → confidence 'presse'.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 147.6,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.goodvalueformoney.eu/documentation/axa-france-vie-ratios-de-solvabilite',
  solidite_confidence = 'presse'
WHERE company = 'AXA France';

-- CNP Assurances — SFCR groupe 2024 : taux de couverture du SCR 237 %
-- (au 31/12/2024, en baisse de 16 pts). Chiffre groupe = pertinent pour CNP.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 237,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.cnp.fr/cnp/content/download/12801/file/CNP-Assurances-SFCR-Groupe-2024-VF-Accessible.pdf',
  solidite_confidence = 'sfcr'
WHERE company = 'CNP Assurances';

-- Abeille Vie (Aéma Groupe) — 2024 : ~216 % (SFCR unique Aéma / presse).
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 216,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.abeille-assurances.fr/notre-entreprise/nous-connaitre/rapports-annuels.html',
  solidite_confidence = 'presse'
WHERE company = 'Abeille Vie';

-- APICIL Épargne (entité vie FR) — 2024 : ~200 % (agrégé presse).
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 200,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.groupe-apicil.com/wp-content/uploads/2025/04/SFCR_APICIL-Epargne_Exercice2024.pdf',
  solidite_confidence = 'presse'
WHERE company = 'APICIL';

-- Groupama Gan Vie — SFCR 2024 : taux de couverture du SCR 275 % (mesures
-- transitoires incluses), au 31/12/2024.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 275,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.groupama.com/app/uploads/2025/04/SFCR_GroupamaGanVie_2024.pdf',
  solidite_confidence = 'sfcr'
WHERE company = 'Groupama Gan Vie';

-- ── Complément GVfM (méthodo homogène « 70 % PPB », 2024) ────────────────────
-- Assureurs présents dans l'historique fonds euros mais sans ratio jusqu'ici.
-- Source homogène Good Value for Money → confidence 'presse'.

-- Predica (Crédit Agricole Assurances) — GVfM 2024 : 222,2 %.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 222.2,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.goodvalueformoney.eu/documentation/predica-ratios-de-solvabilite',
  solidite_confidence = 'presse'
WHERE company = 'Predica';

-- Allianz Vie (France) — GVfM 2024 : 164,0 %.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 164,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.goodvalueformoney.eu/documentation/allianz-vie-ratios-de-solvabilite',
  solidite_confidence = 'presse'
WHERE company = 'Allianz France';

-- AG2R La Mondiale (entité La Mondiale) — GVfM 2024 : 260,0 %.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct   = 260,
  sfcr_annee          = 2024,
  sfcr_url            = 'https://www.goodvalueformoney.eu/documentation/la-mondiale-ratios-de-solvabilite',
  solidite_confidence = 'presse'
WHERE company = 'AG2R La Mondiale';

COMMIT;
