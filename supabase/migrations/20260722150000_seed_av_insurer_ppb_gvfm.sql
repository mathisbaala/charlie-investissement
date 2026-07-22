-- ============================================================================
-- Seed « PPB » — Provision pour Participation aux Bénéfices, par assureur vie
-- ----------------------------------------------------------------------------
-- Remplit ppb_pct (colonne posée le 17/07, vide pour TOUS les assureurs) avec la
-- réserve de rendement du fonds euros, en % des encours, MILLÉSIME FIN 2023.
--
-- SOURÇAGE (fait, auditable, aucune valeur inventée) :
--   • Étude annuelle Good Value for Money « réserves des fonds en euros », reprise
--     dans le tableau public FranceTransactions (48 assureurs, fin 2023). C'est le
--     dernier millésime PPB PAR ASSUREUR librement accessible : le détail fin 2024
--     de GVfM est derrière leur espace documentaire. La PPB par entité se publie
--     avec un an de décalage → 2023 est le point de vérité gratuit à ce jour.
--   • ppb_annee = 2023 et ppb_source_url tracent la provenance métrique par métrique
--     (indépendamment du SFCR de solvabilité, millésime 2024).
--
-- MAPPING d'entité (le tableau nomme l'entité juridique, la base nomme le partenaire) :
--   • ACM Vie      → « ACM VIE S.A. » (entité vie principale, pas la S.A.M.).
--   • AG2R La Mondiale → « LA MONDIALE » (socle vie du groupe).
--   • Macif Vie    → « MUTAVIE » (porteur vie historique de la Macif).
--   • Maif         → « MAIF VIE ».
--   • BNP Paribas Cardif → « CARDIF ASSURANCE VIE » (entité vie, pas le groupe).
-- NON remplis (aucune ligne dans le tableau) : APICIL, Afi Esca, Le Conservateur,
--   Monceau, La Banque Postale Life, Abeille Retraite Professionnelle, et les
--   contrats associatifs (Afer, Agipi, Asac Fapes) / distributeurs (Linxea) dont
--   la solidité est celle du porteur, pas de l'association. On ne remplit que ce
--   qu'on sait sourcer.
--
-- Idempotente : UPDATE ciblé par `company` (lignes existantes). Additive sur des
-- colonnes jusque-là nulles. Aucune RPC touchée.
-- ============================================================================

BEGIN;

-- src : réutilisé sur chaque ligne pour éviter la répétition d'URL.
-- https://www.francetransactions.com/ppb (reprise de l'étude GVfM, fin 2023).

UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 24.85, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'La France Mutualiste';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 22.41, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Garance';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 17.39, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'ACM Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 16.10, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Carac';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 16.04, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'AG2R La Mondiale';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 15.32, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'CNP Assurances';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 15.07, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'MMA Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 14.40, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'BNP Paribas Cardif';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 13.67, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'GMF Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 12.46, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Generali Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 12.25, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Sogécap';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 11.92, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'MAAF Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 11.86, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Prépar Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 11.07, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'SwissLife France';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 10.29, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Predica';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 9.30, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'AXA France';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 9.25, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Macif Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 8.94, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Allianz France';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 8.88, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'MACSF';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 8.10, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Groupama Gan Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 7.86, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Abeille Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 7.72, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Maif';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 6.73, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'BPCE Vie';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 5.69, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Suravenir';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 2.84, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Spirica';
UPDATE public.investissement_av_insurer_profiles SET ppb_pct = 0.63, ppb_annee = 2023, ppb_source_url = 'https://www.francetransactions.com/ppb' WHERE company = 'Oradéa Vie';

COMMIT;
