-- ============================================================================
-- Correction d'attribution : « Natixis Life Luxembourg::Liberalys* » → APICIL
-- ----------------------------------------------------------------------------
-- Problème : 7 contrats « Liberalys BP Large/Medium, Premium, Plus, + SCPI,
-- Core DNCA, Essentiel » étaient attribués à « Natixis Life Luxembourg » en base.
-- C'est FAUX : « Libéralys » est la marque d'INTENCIAL Patrimoine, contrat assuré
-- par APICIL Épargne. Ces 7 « contrats » sont en réalité des SÉLECTIONS de gestion
-- du contrat « Intencial Liberalys Vie ».
--
-- Preuves : (1) recoupement ISIN — 106 UC communes avec « APICIL::Intencial
-- Liberalys Vie » ; (2) tout le référencement « Natixis Life Luxembourg » se
-- limitait à ces Liberalys (aucun autre contrat) ; (3) opcvm360 utilise bien
-- « APICIL » comme insurerName ; (4) aucun produit « Liberalys » Natixis Life
-- n'existe. Cause racine : dict KNOWN_CONTRACTS codé en dur dans
-- scripts/scrapers/av-lux-opcvm360-catalog.py (étiquetage manuel erroné) —
-- CORRIGÉ dans le même commit (upsert désormais vers APICIL / mêmes noms).
--
-- Appliqué en prod via MCP le 17/07/2026 (ce fichier scelle la correction).
-- Idempotent : ne fait rien sur une base sans ces lignes (fresh DB).
-- ============================================================================

BEGIN;

-- 1) Éligibilité : réattribution APICIL + renommage unique par sélection.
UPDATE investissement_av_lux_eligibility e SET
  company_name  = 'APICIL',
  contract_name = 'Intencial Liberalys Vie (' || substring(e.contract_name from 'Liberalys (.*)') || ')'
WHERE e.company_name = 'Natixis Life Luxembourg' AND e.contract_name LIKE 'Liberalys %';

-- 2) Conditions du contrat : re-clé + héritage des conditions du contrat parent.
UPDATE investissement_av_contract_terms t SET
  key = 'APICIL::Intencial Liberalys Vie (' || substring(t.key from 'Liberalys (.*)') || ')'
WHERE t.key LIKE 'Natixis Life Luxembourg::Liberalys %';

UPDATE investissement_av_contract_terms t SET
  frais_entree_pct = s.frais_entree_pct,
  frais_gestion_uc_pct = s.frais_gestion_uc_pct,
  frais_gestion_fonds_euros_pct = s.frais_gestion_fonds_euros_pct,
  frais_arbitrage_pct = s.frais_arbitrage_pct,
  frais_arbitrage_note = s.frais_arbitrage_note,
  fonds_euros_nom = s.fonds_euros_nom,
  fonds_euros_taux_pct = s.fonds_euros_taux_pct,
  fonds_euros_annee = s.fonds_euros_annee,
  gestion_sous_mandat = s.gestion_sous_mandat,
  ticket_entree = s.ticket_entree,
  versement_min = s.versement_min,
  distributeur = 'INTENCIAL Patrimoine (APICIL Épargne)',
  source_url = s.source_url,
  as_of = s.as_of,
  confidence = 'curated',
  updated_at = now()
FROM investissement_av_contract_terms s
WHERE s.key = 'APICIL::Intencial Liberalys Vie'
  AND t.key LIKE 'APICIL::Intencial Liberalys Vie (%)';

-- 3) Profil assureur fantôme + historique fonds euros orphelin.
DELETE FROM investissement_av_insurer_profiles     WHERE company = 'Natixis Life Luxembourg';
DELETE FROM investissement_av_fonds_euros_history   WHERE company = 'Natixis Life Luxembourg';

COMMIT;

-- 4) Rafraîchir les matviews de la marketplace (fund_insurers → contract_groups → insurers_list).
SELECT inv_refresh_fund_insurers_mv();
