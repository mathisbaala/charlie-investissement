-- ============================================================================
-- Fix data-quality — « frais de gestion du fonds euros » aberrants
-- ----------------------------------------------------------------------------
-- Audit de plausibilité de investissement_av_contract_terms : 34 contrats
-- (majorité Spirica) portaient un frais_gestion_fonds_euros_pct de 2,0 à 2,3 %,
-- impossible pour un frais de gestion réel (norme 0,50 à 0,85 %).
--
-- CAUSE VÉRIFIÉE : ce chiffre n'est pas un frais, c'est la RÉDUCTION DE GARANTIE
-- en capital du fonds euros. Ex. fonds euros « Nouvelle Génération » de Spirica :
-- « capital garanti net de 2 % de frais de gestion » (garantie 98 %) — le vrai
-- frais de gestion du fonds est 0,70 % (source : DIC / analyses Linxea Spirit 2).
-- La clause de garantie a été captée dans le champ « frais de gestion fonds euros ».
--
-- CORRECTION : on NEUTRALISE la valeur aberrante (mise à NULL) plutôt que de
-- deviner un remplacement contrat par contrat. Un champ vide (l'UI affiche « — »)
-- est honnête ; un faux 2 % gonfle le coût lu par le CGP. Le vrai frais pourra être
-- re-sourcé DIC par DIC lors d'une passe dédiée.
--
-- DURABILITÉ : le scraper av-contract-terms.py plafonne désormais ce champ à 1,2 %
-- (même seuil) → il ne réintroduira plus la clause de garantie au prochain run.
--
-- Sans impact sur le « coût total » (calculé sur frais_gestion_uc_pct, pas le FE).
-- Idempotente : après exécution, aucune ligne ne dépasse 1,2 % (re-run = no-op).
-- ============================================================================

BEGIN;

UPDATE public.investissement_av_contract_terms
SET frais_gestion_fonds_euros_pct = NULL,
    updated_at = now()
WHERE frais_gestion_fonds_euros_pct >= 1.2;

COMMIT;
