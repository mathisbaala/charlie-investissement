-- Réécriture éditoriale AG2R La Mondiale (profil assureur + contrat LMEP Europartner).
-- Objectif : phrases courtes, mots-clés, pas de point-virgule, majuscule initiale, vraie
-- valeur ajoutée. Corrige aussi plusieurs champs du seed vague 2 tronqués en plein mot
-- (frais_arbitrage_note, options_gestion, ticket_entree, service_extranet).

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Groupe mutualiste, référence française de la retraite et de la prévoyance collectives (Vivépargne, Multéo). En assurance-vie patrimoniale, il s''appuie sur son bras luxembourgeois, La Mondiale Europartner.',
  fonds_euros = 'Actif général La Mondiale',
  forces = ARRAY[
    'Solidité financière du groupe',
    'Expertise luxembourgeoise (FID, FAS, crédit lombard)',
    'Fonds euros multi-devises (EUR, USD, GBP, CHF)'
  ],
  limites = ARRAY[
    'Peu présent en assurance-vie individuelle directe',
    'Accès patrimonial : ticket d''entrée élevé (dès 100 000 €)'
  ],
  updated_at = now()
WHERE company = 'AG2R La Mondiale';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1 % max (150 à 300 € selon CG). Chez Meilleurtaux : 2 arbitrages gratuits par an, puis 50 €.',
  fonds_euros_nom = 'Actif général La Mondiale (EUR, USD, GBP, CHF)',
  fonds_euros_bonus = '+0,50 à 2,35 % en 2026 et 2027, sous condition d''UC',
  fonds_euros_contrainte_uc = '60 % d''UC minimum (fonds euros plafonné à 40 %)',
  garantie_fonds_euros = 'Brute de frais de gestion',
  options_gestion = ARRAY[
    'Gestion libre',
    'Gestion pilotée',
    'Gestion sous mandat',
    'Fonds interne dédié (FID)',
    'Fonds interne collectif (FIC)',
    'Fonds d''assurance spécialisé (FAS)'
  ],
  ticket_entree = '100 000 € (FID dès 125 000 €, FAS dès 250 000 €)',
  versement_min = '5 000 € complémentaire, 1 000 € par support',
  distributeur = 'Meilleurtaux Placement et CGP agréés',
  service_extranet = 'Espace Assuré en ligne, souscription et signature électronique'
WHERE key = 'AG2R La Mondiale::LMEP Europartner Luxembourg';
