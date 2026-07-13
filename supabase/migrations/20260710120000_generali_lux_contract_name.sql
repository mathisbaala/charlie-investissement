-- Generali Luxembourg : rendre les 716 fonds navigables par contrat — 2026-07-10
-- =============================================================================
-- Le catalogue av-lux-generali-catalog.py écrivait contract_name = company_name
-- ("Generali Luxembourg"). Or investissement_fund_insurers_mv construit la
-- colonne contracts[] avec FILTER (contract_name IS NOT NULL AND contract_name
-- <> company_name) (migration 20260611200000). Conséquence : les ~716 UC de
-- Generali Luxembourg sont bien RÉFÉRENCÉES (get_insurers_list les compte) mais
-- AUCUN contrat n'apparaît sous cet assureur dans /assureurs ni dans
-- get_contracts_list — l'utilisateur ne peut pas filtrer le screener par ce
-- contrat.
--
-- Correctif : donner au contrat un nom distinct de la société, comme le font
-- déjà Baloise Life ("Baloise Life Luxembourg") et AXA Wealth Europe
-- ("AXA Wealth Europe Luxembourg"). Le scraper est mis à jour en parallèle
-- (CONTRACT = 'Generali Luxembourg Univers Global') ; ici on aligne les lignes
-- déjà présentes pour que le correctif prenne effet immédiatement (sans attendre
-- le prochain --apply ni le prune Tier 4 des lignes orphelines).
UPDATE public.investissement_av_lux_eligibility
   SET contract_name = 'Generali Luxembourg Univers Global'
 WHERE company_name  = 'Generali Luxembourg'
   AND contract_name = 'Generali Luxembourg';

-- Rafraîchir les matviews de référencement pour exposer le contrat renommé.
REFRESH MATERIALIZED VIEW investissement_fund_insurers_mv;
REFRESH MATERIALIZED VIEW investissement_contract_groups_mv;
