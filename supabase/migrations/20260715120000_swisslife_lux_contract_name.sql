-- Swiss Life Luxembourg : rendre les ~1 240 fonds navigables par contrat — 2026-07-15
-- =============================================================================
-- Même bug que Generali Luxembourg (migration 20260710120000) : le catalogue
-- av-lux-swisslife-catalog.py écrivait contract_name = company_name
-- ("Swiss Life Luxembourg"). Or investissement_fund_insurers_mv construit la
-- colonne contracts[] avec FILTER (contract_name IS NOT NULL AND contract_name
-- <> company_name). Conséquence : l'assureur apparaît dans get_insurers_list
-- (1 163 fonds) mais AUCUN contrat dans get_contracts_list ni /assureurs —
-- impossible de filtrer le screener par ce contrat. Le scraper tournait pourtant
-- en CI avec status=success (le compteur ne couvre que l'upsert des fonds).
--
-- Correctif : nom de contrat distinct de la société, aligné sur la convention
-- Generali ("… Univers Global" = catalogue global, pas de per-contrat public).
-- Le scraper est mis à jour en parallèle (CONTRACT = 'Swiss Life Luxembourg
-- Univers Global') ; ici on renomme les lignes déjà présentes pour un effet
-- immédiat (sans attendre le prochain --apply ni le prune Tier 4).
UPDATE public.investissement_av_lux_eligibility
   SET contract_name = 'Swiss Life Luxembourg Univers Global'
 WHERE company_name  = 'Swiss Life Luxembourg'
   AND contract_name = 'Swiss Life Luxembourg';

-- Rafraîchir les matviews de référencement pour exposer le contrat renommé.
REFRESH MATERIALIZED VIEW investissement_fund_insurers_mv;
REFRESH MATERIALIZED VIEW investissement_contract_groups_mv;
