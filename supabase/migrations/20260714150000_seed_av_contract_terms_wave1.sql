-- ============================================================================
-- Seed vague 2 — lot 1 : conditions de 2 contrats phares (curation manuelle)
-- ----------------------------------------------------------------------------
-- Données relevées le 2026-07-14 sur les pages officielles Linxea (millésime
-- 2025), confidence='curated'. Le scraper av-contract-terms.py étendra ensuite
-- la couverture depuis les DIC (confidence='scraped'). Idempotent (ON CONFLICT).
-- ============================================================================

BEGIN;

INSERT INTO public.investissement_av_contract_terms
  (key, company, contract, frais_entree_pct, frais_gestion_uc_pct, frais_arbitrage_pct,
   frais_arbitrage_note, fonds_euros_nom, fonds_euros_taux_pct, fonds_euros_annee,
   fonds_euros_bonus, fonds_euros_contrainte_uc, garantie_fonds_euros, univers_classes,
   gestion_sous_mandat, options_gestion, ticket_entree, versement_min, distributeur,
   service_extranet, source_url, as_of, confidence)
VALUES
  ('Spirica::Linxea Spirit', 'Spirica', 'Linxea Spirit',
   0, 0.50, 0,
   'gratuit en ligne (hors SCPI, SCI, ETF, FCPR, actions)',
   'Nouvelle Génération / Objectif Climat', 3.08, 2025,
   'jusqu''à +1,50 % net sur 2026-2027 (Nouvelle Génération, sous conditions)',
   'Nouvelle Génération accessible à 100 %', 'capital garanti à 98 %',
   ARRAY['fonds euros','ETF','SCPI','SCI','private equity','titres vifs','produits structurés','fonds datés'],
   true,
   ARRAY['gestion libre','gestion pilotée (OTEA, Yomoni)','gestion mixte','allocations stars'],
   '500 €', '100 € (libre et programmé)', 'Linxea',
   'souscription et gestion 100 % en ligne',
   'https://www.linxea.com/assurance-vie/linxea-spirit-2/', DATE '2025-12-31', 'curated'),

  ('Suravenir::LINXEA Avenir 2 2259', 'Suravenir', 'LINXEA Avenir 2 2259',
   0, 0.60, 0,
   'gratuit en ligne',
   'Suravenir Rendement 2 / Suravenir Opportunités 2', NULL, NULL,
   NULL, 'Opportunités 2 : 100 % sans condition ; Rendement 2 : 70 % max', NULL,
   ARRAY['fonds euros','fonds datés','SCPI','SCI','produits structurés','FCPR','ETF'],
   true,
   ARRAY['gestion libre','gestion pilotée','gestion mixte'],
   '100 €', '100 € (libre et programmé)', 'Linxea',
   'souscription et gestion 100 % en ligne',
   'https://www.linxea.com/assurance-vie/linxea-avenir-2/', DATE '2025-12-31', 'curated')
ON CONFLICT (key) DO UPDATE SET
  frais_entree_pct = EXCLUDED.frais_entree_pct, frais_gestion_uc_pct = EXCLUDED.frais_gestion_uc_pct,
  frais_arbitrage_pct = EXCLUDED.frais_arbitrage_pct, frais_arbitrage_note = EXCLUDED.frais_arbitrage_note,
  fonds_euros_nom = EXCLUDED.fonds_euros_nom, fonds_euros_taux_pct = EXCLUDED.fonds_euros_taux_pct,
  fonds_euros_annee = EXCLUDED.fonds_euros_annee, fonds_euros_bonus = EXCLUDED.fonds_euros_bonus,
  fonds_euros_contrainte_uc = EXCLUDED.fonds_euros_contrainte_uc, garantie_fonds_euros = EXCLUDED.garantie_fonds_euros,
  univers_classes = EXCLUDED.univers_classes, gestion_sous_mandat = EXCLUDED.gestion_sous_mandat,
  options_gestion = EXCLUDED.options_gestion, ticket_entree = EXCLUDED.ticket_entree,
  versement_min = EXCLUDED.versement_min, distributeur = EXCLUDED.distributeur,
  service_extranet = EXCLUDED.service_extranet, source_url = EXCLUDED.source_url,
  as_of = EXCLUDED.as_of, confidence = EXCLUDED.confidence, updated_at = now();

COMMIT;
