-- ============================================================================
-- Seed frais d'enveloppe : contrats référencés à fort impact, sourcés (DIC/annexes officiels)
-- ----------------------------------------------------------------------------
-- Complète av_contract_terms pour des contrats référencés qui n'avaient aucune
-- grille de frais, à partir de documents OFFICIELS (DIC/KID, annexes frais). Ne
-- sont écrites QUE les valeurs réellement applicables (frais de gestion du contrat,
-- versement, arbitrage) ; les fourchettes composites PRIIPS et les plafonds
-- théoriques ne sont PAS retenus (ils surestiment le frais d'enveloppe réel).
-- Upsert FILL-ONLY (COALESCE) : ne jamais écraser une valeur curatée existante.
--
-- Contrats volontairement laissés vides (tail dur) : AV luxembourgeoises à frais
-- négociés non publiés (CNP Alyses Lux, Aster Horizon → seul le fonds euros est
-- nommé), comptes-titres PEA courtiers (pas de frais d'enveloppe au sens AV).
-- Données de référencement à nettoyer signalées séparément : « Suravenir *** Lux »
-- (noms de fonds euros pris pour des contrats), « Compte Libre Croissance LBP »
-- (contrat GMF mal attribué à La Banque Postale).
-- ============================================================================

INSERT INTO investissement_av_contract_terms
  (key, company, contract, frais_entree_pct, frais_gestion_uc_pct, frais_gestion_fonds_euros_pct, frais_arbitrage_pct, fonds_euros_nom, fonds_euros_taux_pct, fonds_euros_annee, source_url, as_of, confidence)
VALUES
  ('Allianz France::Allianz Wealth','Allianz France','Allianz Wealth', 4.50, 1.00, NULL, NULL, 'Allianz Wealth Euro', NULL, NULL, 'https://priips.allianz.fr/kd-priips/rest/pdf/KID_AZFR-AZWEALTH_20251212.pdf','2025-12-31','scraped'),
  ('Allianz France::Allianz Wealth Capitalisation','Allianz France','Allianz Wealth Capitalisation', 4.50, 1.00, NULL, NULL, 'Allianz Wealth Euro', NULL, NULL, 'https://priips.allianz.fr/kd-priips/rest/pdf/KID_AZFR-AZWEALTH_20251212.pdf','2025-12-31','scraped'),
  ('SwissLife France::GPH Patrimoine Partenaires Vie','SwissLife France','GPH Patrimoine Partenaires Vie', 4.50, 1.00, 0.65, 1.00, NULL, NULL, NULL, 'https://www.swisslife.fr/content/dam/france/annexes-frais/partenaires/Annexe%20Frais%20-%20GPH%20Patrimoine%20Partenaires%20Vie.pdf','2025-12-31','scraped'),
  ('Spirica::Aster Innovation','Spirica','Aster Innovation', NULL, 1.00, NULL, NULL, 'Fonds Euro Aster Nouvelle Génération', 3.08, 2024, 'https://www.sylvea.fr/sylvea/produits/4459/historique/2025/annexeFI.pdf','2025-12-31','scraped'),
  ('Spirica::Aster Innovation 2','Spirica','Aster Innovation 2', NULL, 1.00, NULL, NULL, 'Fonds Euro Aster Nouvelle Génération', 3.08, 2024, 'https://www.sylvea.fr/sylvea/produits/4459/historique/2025/annexeFI.pdf','2025-12-31','scraped'),
  ('Spirica::Aster Innovation Capi','Spirica','Aster Innovation Capi', NULL, 1.00, NULL, NULL, 'Fonds Euro Aster Nouvelle Génération', 3.08, 2024, 'https://www.sylvea.fr/sylvea/produits/4459/historique/2025/annexeFI.pdf','2025-12-31','scraped'),
  ('Spirica::Aster Innovation Capi 2','Spirica','Aster Innovation Capi 2', NULL, 1.00, NULL, NULL, 'Fonds Euro Aster Nouvelle Génération', 3.08, 2024, 'https://www.sylvea.fr/sylvea/produits/4459/historique/2025/annexeFI.pdf','2025-12-31','scraped'),
  ('Spirica::Aster Innovation Capi PM','Spirica','Aster Innovation Capi PM', NULL, 1.00, NULL, NULL, 'Fonds Euro Aster Nouvelle Génération', 3.08, 2024, 'https://www.sylvea.fr/sylvea/produits/4459/historique/2025/annexeFI.pdf','2025-12-31','scraped'),
  ('Spirica::Aster Innovation Capi 2 PM','Spirica','Aster Innovation Capi 2 PM', NULL, 1.00, NULL, NULL, 'Fonds Euro Aster Nouvelle Génération', 3.08, 2024, 'https://www.sylvea.fr/sylvea/produits/4459/historique/2025/annexeFI.pdf','2025-12-31','scraped'),
  ('Spirica::Octavie','Spirica','Octavie', 0.80, 1.00, NULL, 0.00, NULL, NULL, NULL, 'https://www.spirica.fr/wp-content/uploads/2022/05/Frais-transparence-Octavie-4.pdf','2025-12-31','scraped'),
  ('Spirica::Octavie 2','Spirica','Octavie 2', 0.80, 1.00, NULL, 0.00, NULL, NULL, NULL, 'https://www.spirica.fr/wp-content/uploads/2022/05/Frais-transparence-Octavie-4.pdf','2025-12-31','scraped'),
  ('Spirica::Amytis Patrimoine','Spirica','Amytis Patrimoine', NULL, NULL, NULL, NULL, 'Fonds Euro Nouvelle Génération', 3.13, 2024, 'https://www.spirica.fr/wp-content/uploads/2026/01/SPK_LOI_INDUSTRIE_VERTE_2024.pdf','2025-12-31','scraped'),
  ('Spirica::Amytis Retraite','Spirica','Amytis Retraite', NULL, NULL, NULL, NULL, 'Fonds Euro PER Nouvelle Génération', 3.15, 2024, 'https://www.spirica.fr/wp-content/uploads/2026/01/SPK_LOI_INDUSTRIE_VERTE_2024.pdf','2025-12-31','scraped'),
  ('Cardif Lux Vie::ASTER HORIZON','Cardif Lux Vie','ASTER HORIZON', NULL, NULL, NULL, NULL, 'Fonds Général', NULL, NULL, 'https://cardifluxvie.com/wp-content/uploads/sites/14/2026/02/KID-ASTER01_20251130_fr_FR_LU-CLV-LU-ALOWE-01.pdf','2025-12-31','scraped'),
  ('Cardif Lux Vie::ASTER HORIZON CAPITALISATION','Cardif Lux Vie','ASTER HORIZON CAPITALISATION', NULL, NULL, NULL, NULL, 'Fonds Général', NULL, NULL, 'https://cardifluxvie.com/wp-content/uploads/sites/14/2026/02/KID-ASTER01_20251130_fr_FR_LU-CLV-LU-ALOWE-01.pdf','2025-12-31','scraped'),
  ('CNP Luxembourg::CNP ALYSES LUX VIE','CNP Luxembourg','CNP ALYSES LUX VIE', NULL, NULL, NULL, NULL, 'CNP ALYSES EURO LUX', NULL, NULL, 'https://epr.amfinesoft.com/api/v1/download/CNPL/product/kid/CGV/lang/fr','2025-12-31','scraped'),
  ('CNP Luxembourg::CNP ALYSES LUX CAPI','CNP Luxembourg','CNP ALYSES LUX CAPI', NULL, NULL, NULL, NULL, 'CNP ALYSES EURO LUX', NULL, NULL, 'https://epr.amfinesoft.com/api/v1/download/CNPL/product/kid/CGC/lang/fr','2025-12-31','scraped')
ON CONFLICT (key) DO UPDATE SET
  frais_entree_pct              = COALESCE(investissement_av_contract_terms.frais_entree_pct, EXCLUDED.frais_entree_pct),
  frais_gestion_uc_pct          = COALESCE(investissement_av_contract_terms.frais_gestion_uc_pct, EXCLUDED.frais_gestion_uc_pct),
  frais_gestion_fonds_euros_pct = COALESCE(investissement_av_contract_terms.frais_gestion_fonds_euros_pct, EXCLUDED.frais_gestion_fonds_euros_pct),
  frais_arbitrage_pct           = COALESCE(investissement_av_contract_terms.frais_arbitrage_pct, EXCLUDED.frais_arbitrage_pct),
  fonds_euros_nom               = COALESCE(investissement_av_contract_terms.fonds_euros_nom, EXCLUDED.fonds_euros_nom),
  fonds_euros_taux_pct          = COALESCE(investissement_av_contract_terms.fonds_euros_taux_pct, EXCLUDED.fonds_euros_taux_pct),
  fonds_euros_annee             = COALESCE(investissement_av_contract_terms.fonds_euros_annee, EXCLUDED.fonds_euros_annee),
  source_url                    = COALESCE(investissement_av_contract_terms.source_url, EXCLUDED.source_url),
  as_of                         = COALESCE(investissement_av_contract_terms.as_of, EXCLUDED.as_of),
  confidence                    = COALESCE(investissement_av_contract_terms.confidence, EXCLUDED.confidence),
  updated_at                    = now();
