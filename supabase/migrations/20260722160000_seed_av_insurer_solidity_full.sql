-- ============================================================================
-- Seed « solidité assureur » — encours vie, notation d'agence, solvabilité (suite)
-- ----------------------------------------------------------------------------
-- Complète le socle de solidité posé le 21/07 (13 ratios de Solvabilité II).
-- Cette passe :
--   • remplit ENCOURS VIE et NOTATION D'AGENCE (colonnes vides pour tous) ;
--   • étend la SOLVABILITÉ II aux ~30 assureurs encore nuls, depuis le SFCR 2024
--     de chaque entité vie ;
--   • re-fiabilise 6 ratios jusque-là en confiance « presse » vers « sfcr » quand
--     le rapport de l'entité a été vérifié (AXA, Abeille, Apicil, Predica, AG2R…).
--
-- SOURÇAGE, PAR MÉTRIQUE (auditable, aucune valeur inventée) :
--   • solvabilite_2_pct : ratio de couverture du SCR au 31/12/2024, tiré du SFCR
--     de l'entité VIE (sfcr_url) → solidite_confidence = 'sfcr'. Quand seule une
--     étude tierce est disponible (Milliman pour le Luxembourg, communiqué de
--     résultats, Good Value for Money), la valeur est marquée 'presse' et sfcr_url
--     reste nul (pas de lien « Rapport SFCR » trompeur).
--   • notation / notation_agence / notation_annee / notation_source_url : note de
--     solidité financière (IFS), le plus souvent au niveau GROUPE (indiqué). Les
--     mutuelles françaises ne sont pas notées → laissé nul (normal).
--   • encours_vie_mds / encours_annee / encours_source_url : encours vie (provisions
--     techniques épargne/retraite), millésime le plus récent librement sourçable.
--
-- PIÈGES D'ENTITÉ écartés : « Suravenir » = vie (≠ Suravenir Assurances dommages) ;
-- « Cardif Assurance Vie » = entité vie (≠ groupe BNP Paribas Cardif) ; « Mutavie »
-- = porteur vie de la Macif ; La Banque Postale Life = porté par CNP (doublon
-- volontaire avec la fiche CNP). Les ratios groupe (AXA SE, Allianz SE, SGAM) sont
-- écartés au profit du ratio de l'entité vie.
--
-- Idempotente : UPDATE ciblé par `company`. Additive sur colonnes majoritairement
-- nulles. Ne touche PAS aux 7 ratios déjà vérifiés 'sfcr' (Generali, Spirica,
-- Suravenir, SwissLife, Cardif, CNP, Groupama) : seuls leurs encours/notation sont
-- ajoutés. Aucune RPC touchée.
-- ============================================================================

BEGIN;

-- ── Socle CGP français : ratio déjà 'sfcr', on ajoute encours + notation ──────────
UPDATE public.investissement_av_insurer_profiles SET
  notation = 'A+', notation_agence = 'AM Best', notation_annee = 2024,
  notation_source_url = 'https://www.generali.com/media/press-releases/all/2024/AM-Best-upgrades-Generali-FSR-rating-A-Outlook-stable',
  encours_vie_mds = 88.9, encours_annee = 2024,
  encours_source_url = 'https://www.generali.fr/sites/default/files-d8/2025-04/RSSF_Generali_Vie_2024.pdf'
WHERE company = 'Generali Vie';

UPDATE public.investissement_av_insurer_profiles SET
  notation = 'A', notation_agence = 'S&P', notation_annee = 2025,
  notation_source_url = 'https://www.ca-assurances.com/wp-content/uploads/CAA-credit-rating-by-SP-November-2025.pdf',
  encours_vie_mds = 14.8, encours_annee = 2024,
  encours_source_url = 'https://www.spirica.fr/wp-content/uploads/2025/04/SPIRICA-RN-SFCR-VDEF-pour-CA.pdf'
WHERE company = 'Spirica';

UPDATE public.investissement_av_insurer_profiles SET
  encours_vie_mds = 53.8, encours_annee = 2024,
  encours_source_url = 'https://placement.meilleurtaux.com/assurance-vie/actualites/2025-fevrier/collecte-brute-frolant-55-milliards-euros-2024-suravenir.html'
WHERE company = 'Suravenir';

UPDATE public.investissement_av_insurer_profiles SET
  notation = 'A+', notation_agence = 'S&P', notation_annee = 2026,
  notation_source_url = 'https://www.swisslife.com/en/home/media/rating.html',
  encours_vie_mds = 27.6, encours_annee = 2024,
  encours_source_url = 'https://www.swisslife.fr/content/dam/france/swisslife/SL_AP_Narrative_Report_PdfProof%20FR-34.pdf'
WHERE company = 'SwissLife France';

UPDATE public.investissement_av_insurer_profiles SET
  notation = 'A', notation_agence = 'S&P', notation_annee = 2025,
  notation_source_url = 'https://www.spglobal.com/ratings/en/regulatory/article/-/view/type/HTML/id/3468172',
  encours_vie_mds = 161.8, encours_annee = 2024,
  encours_source_url = 'https://www.bnpparibascardif.com/wp-content/uploads/sites/28/2025/04/Cardif-Assurance-Vie-SFCR-2024-in-french-1.pdf'
WHERE company = 'BNP Paribas Cardif';

UPDATE public.investissement_av_insurer_profiles SET
  notation = 'A', notation_agence = 'Fitch', notation_annee = 2025,
  notation_source_url = 'https://www.cnp.fr/cnp/content/download/11954/file/Fitch-Affirms-CNP-Assurances-IFS-Rating-at-A_01122025.pdf',
  encours_vie_mds = 367.7, encours_annee = 2024,
  encours_source_url = 'https://www.cnp.fr/en/the-cnp-assurances-group/who-we-are/what-we-do/cnp-assurances-in-numbers'
WHERE company = 'CNP Assurances';

UPDATE public.investissement_av_insurer_profiles SET
  notation = 'A+', notation_agence = 'Fitch', notation_annee = 2024,
  notation_source_url = 'https://www.groupama.com/app/uploads/2025/04/SFCR_GroupamaGanVie_2024.pdf',
  encours_vie_mds = 45.7, encours_annee = 2024,
  encours_source_url = 'https://www.groupama.com/app/uploads/2025/04/SFCR_GroupamaGanVie_2024.pdf'
WHERE company = 'Groupama Gan Vie';

-- ── Ratios re-fiabilisés 'presse' → 'sfcr' (+ encours + notation) ─────────────────
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 148, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.axa.fr/content/dam/axa-fr-convergence/transverse/informations_financieres/Version-edition-AFV.pdf',
  notation = 'AA', notation_agence = 'S&P', notation_annee = 2026,
  notation_source_url = 'https://www.axa.com/en/investor/financial-strength-ratings',
  encours_vie_mds = 140, encours_annee = 2024,
  encours_source_url = 'https://www.axa.fr/content/dam/axa-fr-convergence/transverse/informations_financieres/Version-edition-AFV.pdf'
WHERE company = 'AXA France';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 216, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.macif.fr/files/live/sites/maciffr/files/maciffr/LeGroupe/Panoramadugroupe/Publications/2025/SFCR_unique_2024_Aema_Groupe.pdf',
  notation = 'A2', notation_agence = 'Moody''s', notation_annee = 2024,
  notation_source_url = 'https://finance.yahoo.com/news/abeille-retraite-professionnelle-moody-assigns-115904619.html',
  encours_vie_mds = 83, encours_annee = 2024,
  encours_source_url = 'https://presse.abeille-assurances.fr/communique/225243/Abeille-Assurances-resultats-financiers-solides-en-2024-qui-marquent-premiers-effets-de-plan-strategique'
WHERE company = 'Abeille Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 218, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.groupe-apicil.com/wp-content/uploads/2025/04/SFCR_APICIL-Epargne_Exercice2024.pdf',
  encours_vie_mds = 20.2, encours_annee = 2021,
  encours_source_url = 'https://assurance-vie.eu/apicil'
WHERE company = 'APICIL';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 222.2, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.ca-assurances.com/wp-content/uploads/PREDICA-SFCR-2024-1.pdf',
  notation = 'A+', notation_agence = 'S&P', notation_annee = 2025,
  notation_source_url = 'https://www.ca-assurances.com/wp-content/uploads/CAA-credit-rating-by-SP-November-2025.pdf'
WHERE company = 'Predica';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 260, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://echanges.dila.gouv.fr/OPENDATA/AMF/107/2025/04/FC107577826_20250409.pdf',
  notation = 'A', notation_agence = 'S&P', notation_annee = 2024,
  notation_source_url = 'https://presse.ag2rlamondiale.fr/actualites/resultats-annuels-du-groupe-ag2r-la-mondiale-e8e9c-3a203.html',
  encours_vie_mds = 99, encours_annee = 2024,
  encours_source_url = 'https://presse.ag2rlamondiale.fr/actualites/resultats-annuels-du-groupe-ag2r-la-mondiale-e8e9c-3a203.html'
WHERE company = 'AG2R La Mondiale';

-- Allianz France : ratio 164 % (Good Value for Money, entité Allianz Vie) laissé en
-- 'presse' (pas de SFCR entité en accès direct) ; on ajoute encours + notation groupe.
UPDATE public.investissement_av_insurer_profiles SET
  notation = 'AA', notation_agence = 'S&P', notation_annee = 2025,
  notation_source_url = 'https://www.allianz.com/en/investor_relations/bonds/rating.html',
  encours_vie_mds = 25.8, encours_annee = 2024,
  encours_source_url = 'https://www.goodvalueformoney.eu/documentation/allianz-vie-composition-de-l-actif-general'
WHERE company = 'Allianz France';

-- ── Assureurs français jusque-là sans solvabilité (SFCR 2024 entité) ──────────────
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 261, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.acm.fr/fr/document/investisseurs/2025/SFCR-VIE-SA-2024.pdf',
  encours_vie_mds = 98.3, encours_annee = 2024,
  encours_source_url = 'https://www.acm.fr/fr/document/investisseurs/2025/SFCR-VIE-SA-2024.pdf'
WHERE company = 'ACM Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 293.1, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.assurances.groupebpce.com/app/uploads/2025/04/bpce-vie-rapport-sfcr-2024.pdf',
  encours_vie_mds = 103, encours_annee = 2024,
  encours_source_url = 'https://www.globenewswire.com/news-release/2025/02/05/3021460/0/fr/BPCE-Groupe-BPCE-R%C3%A9sultats-T4-24-2024.html'
WHERE company = 'BPCE Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 223.2, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.assurances.societegenerale.com/uploads/tx_bisgnews/Rapport_de_solvabilite_2024_03.pdf',
  notation = 'A-', notation_agence = 'S&P', notation_annee = 2023,
  notation_source_url = 'https://www.assurances.societegenerale.com/en/investor-journalist/about/our-entities/our-entities-france/sogecap/',
  encours_vie_mds = 146, encours_annee = 2024,
  encours_source_url = 'https://www.assurances.societegenerale.com/fileadmin/2025/Sogecap_Bonds/SOGECAP_Investor_Presentation_June_2025.pdf'
WHERE company = 'Sogécap';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 288, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.covea.com/sites/default/files/2025-04/sfcr_maaf_vie_2024.pdf',
  encours_vie_mds = 11.8, encours_annee = 2024,
  encours_source_url = 'https://www.covea.com/sites/default/files/2025-04/sfcr_maaf_vie_2024.pdf'
WHERE company = 'MAAF Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 287, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.covea.com/sites/default/files/2025-04/sfcr_mma_vie_sa_2024.pdf',
  encours_vie_mds = 21.4, encours_annee = 2024,
  encours_source_url = 'https://www.covea.com/sites/default/files/2025-04/sfcr_mma_vie_sa_2024.pdf'
WHERE company = 'MMA Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 227, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.macifvie.fr/wp-content/uploads/2025/04/SFCR_unique_2024_Aema_Groupe.pdf',
  notation = 'A2', notation_agence = 'Moody''s', notation_annee = 2024,
  notation_source_url = 'https://www.macif.fr/files/live/sites/maciffr/files/maciffr/LeGroupe/Panoramadugroupe/Publications/2024/moody-s-update-to-credit-analysis-macif-11Jul2024.pdf',
  encours_vie_mds = 24.7, encours_annee = 2024,
  encours_source_url = 'https://www.macifvie.fr/wp-content/uploads/2025/04/SFCR_unique_2024_Aema_Groupe.pdf'
WHERE company = 'Macif Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 169.4, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://entreprise.maif.fr/files/live/sites/entreprise-Maif/files/pdf/nos-rapports/rapports-solvabilite/2024/rapport-solvabilite-maif-vie-2024.pdf',
  encours_vie_mds = 11.5, encours_annee = 2024,
  encours_source_url = 'https://entreprise.maif.fr/files/live/sites/entreprise-Maif/files/pdf/nos-rapports/rapports-solvabilite/2024/rapport-solvabilite-maif-vie-2024.pdf'
WHERE company = 'Maif';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 274.9, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.macsf.fr/groupe/content/download/5165/file/RAPPORT_SFCR_MACSF_epargne_retraite_2024.pdf',
  encours_vie_mds = 30.2, encours_annee = 2024,
  encours_source_url = 'https://www.macsf.fr/groupe/content/download/5165/file/RAPPORT_SFCR_MACSF_epargne_retraite_2024.pdf'
WHERE company = 'MACSF';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 316, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.covea.com/sites/default/files/2025-04/sfcr_gmf_vie_2024.pdf',
  encours_vie_mds = 22.3, encours_annee = 2024,
  encours_source_url = 'https://www.covea.com/sites/default/files/2025-04/sfcr_gmf_vie_2024.pdf'
WHERE company = 'GMF Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 261, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.carac.fr/media/Rapport%20SFCR/SFCR_2024_groupe_carac.pdf',
  encours_vie_mds = 10.8, encours_annee = 2024,
  encours_source_url = 'https://www.carac.fr/media/Rapport%20SFCR/SFCR_2024_groupe_carac.pdf'
WHERE company = 'Carac';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 249.8, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.garance.com/app/uploads/2025/04/Rapport-sur-la-solvabilite-et-la-situation-financiere-GARANCE-2024-1.pdf',
  encours_vie_mds = 1.8, encours_annee = 2024,
  encours_source_url = 'https://www.garance.com/app/uploads/2025/04/Rapport-sur-la-solvabilite-et-la-situation-financiere-GARANCE-2024-1.pdf'
WHERE company = 'Garance';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 274, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.la-france-mutualiste.fr/sites/default/files/publication/file/2025-06/SFCR_SGAM%20MH_2024_VF.pdf',
  encours_vie_mds = 9.8, encours_annee = 2024,
  encours_source_url = 'https://www.la-france-mutualiste.fr/sites/default/files/publication/file/2025-06/SFCR_SGAM%20MH_2024_VF.pdf'
WHERE company = 'La France Mutualiste';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 225, sfcr_annee = 2025, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.conservateur.fr/app/uploads/sites/2/2026/04/Rapport-SFCR-2025-remis-2026-0426.pdf',
  encours_vie_mds = 12.2, encours_annee = 2025,
  encours_source_url = 'https://www.conservateur.fr/app/uploads/sites/2/2026/04/Rapport-SFCR-2025-remis-2026-0426.pdf'
WHERE company = 'Le Conservateur';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 207.6, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.monceauassurances.com/wp-content/uploads/2025/04/Rapport-SSF_Capma-Capmi_2024_FINAL.pdf',
  encours_vie_mds = 4.96, encours_annee = 2024,
  encours_source_url = 'https://www.monceauassurances.com/wp-content/uploads/2025/04/Rapport-SSF_Capma-Capmi_2024_FINAL.pdf'
WHERE company = 'Monceau Assurances';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 140, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.assurances.societegenerale.com/uploads/tx_bisgnews/Rapport_de_solvabilite_2024_01.pdf',
  encours_vie_mds = 9.1, encours_annee = 2024,
  encours_source_url = 'https://www.assurances.societegenerale.com/uploads/tx_bisgnews/Rapport_de_solvabilite_2024_01.pdf'
WHERE company = 'Oradéa Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 185, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.prepar-vie.fr/wp-content/uploads/2025/06/PREPAR-VIE_SFCR-2024.pdf',
  encours_vie_mds = 8.2, encours_annee = 2024,
  encours_source_url = 'https://www.prepar-vie.fr/wp-content/uploads/2025/06/PREPAR-VIE_SFCR-2024.pdf'
WHERE company = 'Prépar Vie';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 184, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.afi-esca.com/wp-content/uploads/2025/06/SFCR_AFI-ESCA_2024.pdf',
  encours_vie_mds = 1.58, encours_annee = 2024,
  encours_source_url = 'https://www.afi-esca.com/wp-content/uploads/2025/06/SFCR_AFI-ESCA_2024.pdf'
WHERE company = 'Afi Esca';

-- La Banque Postale Life : contrats vie portés par CNP Assurances (doublon assumé).
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 237, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.cnp.fr/cnp/content/download/12801/file/CNP-Assurances-SFCR-Groupe-2024-VF-Accessible.pdf',
  notation = 'A', notation_agence = 'S&P', notation_annee = 2025,
  notation_source_url = 'https://www.cnp.fr/en/the-cnp-assurances-group/investors/debts-and-credit-rating/financial-and-esg-ratings',
  encours_vie_mds = 275, encours_annee = 2024,
  encours_source_url = 'https://www.cnp.fr/cnp/content/download/12801/file/CNP-Assurances-SFCR-Groupe-2024-VF-Accessible.pdf'
WHERE company = 'La Banque Postale Life';

-- ── Assureurs luxembourgeois ──────────────────────────────────────────────────────
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 161, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://cardifluxvie.com/wp-content/uploads/sites/14/2025/07/EN_SFCR-2024.pdf',
  notation = 'A', notation_agence = 'S&P', notation_annee = 2025,
  notation_source_url = 'https://cardifluxvie.com/en/cardif-lux-vie/financial-information/',
  encours_vie_mds = 33.2, encours_annee = 2024,
  encours_source_url = 'https://cardifluxvie.com/resultats-2024-une-performance-soutenue-par-une-belle-dynamique-commerciale-et-des-partenariats-robustes/'
WHERE company = 'Cardif Lux Vie';

-- Sogelife : ratio de communiqué de résultats (pas de SFCR entité direct) → 'presse'.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 143, sfcr_annee = 2024, solidite_confidence = 'presse',
  encours_vie_mds = 14.4, encours_annee = 2024,
  encours_source_url = 'https://www.sogelife.com/en/news/news-details/news-details-view/news/results-2024-sogelife/'
WHERE company = 'Sogelife';

-- Wealins : ratio entité non publié → seul l'encours est renseigné.
UPDATE public.investissement_av_insurer_profiles SET
  encours_vie_mds = 20.2, encours_annee = 2025,
  encours_source_url = 'https://www.wealins.com/wealins-achieves-a-record-year-in-2025-and-reaffirms-its-ambition-to-be-the-leading-partner-in-wealth-insurance/'
WHERE company = 'Wealins';

-- Utmost Luxembourg : ratio entité non trouvé gratuitement → notation + encours.
UPDATE public.investissement_av_insurer_profiles SET
  notation = 'A+', notation_agence = 'Fitch', notation_annee = 2025,
  notation_source_url = 'https://www.utmostgroup.com/financials/credit-strength/',
  encours_vie_mds = 53.6, encours_annee = 2024,
  encours_source_url = 'https://www.milliman.com/en/insight/2024-sfcr-life-luxembourg'
WHERE company = 'Utmost Luxembourg S.A.';

-- Baloise / Generali Lux / OneLife : ratio via étude Milliman → 'presse'.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 147, sfcr_annee = 2024, solidite_confidence = 'presse',
  notation = 'A+', notation_agence = 'S&P', notation_annee = 2024,
  notation_source_url = 'https://www.baloise.com/dam/baloise-com/documents/de/anleihen-ratings/ratings/Baloise_rating-report-2024.pdf',
  encours_vie_mds = 12.0, encours_annee = 2024,
  encours_source_url = 'https://www.milliman.com/en/insight/2024-sfcr-life-luxembourg'
WHERE company = 'Baloise Life';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 135, sfcr_annee = 2024, solidite_confidence = 'presse',
  notation = 'A+', notation_agence = 'AM Best', notation_annee = 2024,
  notation_source_url = 'https://www.generali.com/media/press-releases/all/2024/AM-Best-upgrades-Generali-FSR-rating-A-Outlook-stable',
  encours_vie_mds = 6.8, encours_annee = 2024,
  encours_source_url = 'https://www.milliman.com/en/insight/2024-sfcr-life-luxembourg'
WHERE company = 'Generali Luxembourg';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 161, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.swisslife-global.com/content/dam/international_rel/id-global/documents/download/SFCR-SLLU_2024.pdf',
  notation = 'A+', notation_agence = 'S&P', notation_annee = 2025,
  notation_source_url = 'https://www.swisslife.com/content/dam/com_rel/dokumente/factsheet/Factsheet_SwissLife-Group_2025_EN.pdf',
  encours_vie_mds = 16.5, encours_annee = 2024,
  encours_source_url = 'https://www.swisslife-global.com/content/dam/international_rel/id-global/documents/download/SFCR-SLLU_2024.pdf'
WHERE company = 'Swiss Life Luxembourg';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 127, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.allianz.lu/content/dam/onemarketing/benelu/azlux/pdf/2024-ALL-SFCR.pdf',
  notation = 'AA', notation_agence = 'S&P', notation_annee = 2026,
  notation_source_url = 'https://www.allianz.com/en/investor_relations/bonds/rating.html',
  encours_vie_mds = 5.6, encours_annee = 2024,
  encours_source_url = 'https://www.allianz.lu/content/dam/onemarketing/benelu/azlux/pdf/2024-ALL-SFCR.pdf'
WHERE company = 'Allianz Life Luxembourg';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 132, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://axa-wealtheurope.lu/sites/axawe/files/2025-04/N09V-LU-01-20241231-CAA-222100WCM48LSUO2KP31-222100WCM48LSUO2KP31-AWE.pdf',
  notation = 'AA', notation_agence = 'S&P', notation_annee = 2026,
  notation_source_url = 'https://www.axa.com/en/investor/financial-strength-ratings',
  encours_vie_mds = 3.08, encours_annee = 2024,
  encours_source_url = 'https://axa-wealtheurope.lu/sites/axawe/files/2025-04/N09V-LU-01-20241231-CAA-222100WCM48LSUO2KP31-222100WCM48LSUO2KP31-AWE.pdf'
WHERE company = 'AXA Wealth Europe';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 231.6, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.vitislife.com/wp-content/uploads/2024/04/SFCR-2024-Solvency-and-Financial-Conditions-Report-2.pdf',
  encours_vie_mds = 3.55, encours_annee = 2024,
  encours_source_url = 'https://www.vitislife.com/wp-content/uploads/2024/04/SFCR-2024-Solvency-and-Financial-Conditions-Report-2.pdf'
WHERE company = 'Vitis Life';

UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 145, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.life.groupebpce.com/app/uploads/2025/04/sfcr-2024-bpce-life.pdf',
  notation = 'A+', notation_agence = 'Fitch', notation_annee = 2025,
  notation_source_url = 'https://www.assurances.groupebpce.com/app/uploads/2025/11/bpce-assurances-notation-de-solidite-financiere-fitch.pdf',
  encours_vie_mds = 7.87, encours_annee = 2024,
  encours_source_url = 'https://www.life.groupebpce.com/app/uploads/2025/04/sfcr-2024-bpce-life.pdf'
WHERE company = 'Natixis Life Luxembourg';

-- CALI Europe : encours non isolable → solvabilité + notation seulement.
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 152, sfcr_annee = 2024, solidite_confidence = 'sfcr',
  sfcr_url = 'https://www.cali-europe.com/sites/default/files/IMCE/CALIE%20-%20RN%20-%20SFCR%202024_EN.pdf',
  notation = 'A', notation_agence = 'S&P', notation_annee = 2025,
  notation_source_url = 'https://www.ca-assurances.com/wp-content/uploads/CAA-credit-rating-by-SP-November-2025.pdf'
WHERE company = 'CALI Europe';

-- Apicil / OneLife : ratio Milliman → 'presse' ; encours indicatif (source courtier).
UPDATE public.investissement_av_insurer_profiles SET
  solvabilite_2_pct = 140, sfcr_annee = 2024, solidite_confidence = 'presse',
  encours_vie_mds = 9.5, encours_annee = 2025,
  encours_source_url = 'https://assurancevieluxembourgeoise.eu/en/apicil-one-life/'
WHERE company = 'Apicil / OneLife';

COMMIT;
