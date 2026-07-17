-- Passe éditoriale complète du contenu AV (profils assureurs + conditions de contrat).
-- Réécriture : phrases courtes, zéro point-virgule, mots-clés, majuscule initiale,
-- nombres au format français (montants « 1 000 € », pourcentages « 4,60 % »),
-- suppression des méta-infos de sourcing internes, réparation des valeurs tronquées
-- en plein mot dans le seed (vagues 1 et 2). Généré par passe multi-agents 17/07/2026.

-- ===== Profils assureurs (investissement_av_insurer_profiles) =====
-- Réécriture des 41 profils assureurs (table public.investissement_av_insurer_profiles)
-- Champs modifiés : positionnement, fonds_euros, forces, limites, updated_at
-- Ne touche pas à : company, kind, groupe, lux, source
-- À appliquer manuellement — aucun UPDATE exécuté en base par l'auteur.

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Ancienne filiale française d''Aviva, désormais dans Aéma Groupe. Dispose d''un large stock d''encours et d''un réseau courtage historique via le contrat Abeille Épargne Plurielle.',
  forces = ARRAY['Base installée importante','Réseau courtage historique','Adossement à Aéma Groupe'],
  limites = ARRAY['Modernisation de l''offre encore en cours'],
  updated_at = now()
WHERE company = 'Abeille Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bancassureur du groupe Crédit Mutuel, filiale Assurances du Crédit Mutuel. Il distribue son assurance-vie principalement via les réseaux Crédit Mutuel et CIC.',
  forces = ARRAY['Adossement au groupe Crédit Mutuel','Solidité financière du bancassureur'],
  limites = ARRAY['Distribution centrée sur le réseau bancaire','Peu présent sur le canal CGP'],
  updated_at = now()
WHERE company = 'ACM Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Marque dédiée de BNP Paribas Cardif au canal courtage et CGP, anciennement Antin Épargne Pension. Les contrats, comme Panthéa distribué par Nortia, sont assurés par Cardif Assurance Vie.',
  fonds_euros = 'Actif général AEP, autour de 2,75 % en 2024 (indicatif)',
  forces = ARRAY['Adossement à BNP Paribas Cardif','Contrats patrimoniaux distribués via Nortia'],
  limites = ARRAY['Marque peu visible en direct','Accès via plateforme grossiste'],
  updated_at = now()
WHERE company = 'AEP';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Grande association d''épargnants qui porte un contrat multisupport de référence en France. Le contrat est assuré par Abeille Assurances.',
  forces = ARRAY['Large communauté d''adhérents','Frais négociés au bénéfice des adhérents'],
  limites = ARRAY['Offre associative moins ouverte en architecture','Univers de supports plus encadré'],
  updated_at = now()
WHERE company = 'Afer';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Groupe mutualiste, référence française de la retraite et de la prévoyance collectives, avec les gammes Vivépargne et Multéo. En assurance-vie patrimoniale, il s''appuie sur son bras luxembourgeois La Mondiale Europartner.',
  fonds_euros = 'Actif général La Mondiale',
  forces = ARRAY['Solidité financière du groupe','Expertise luxembourgeoise (FID, FAS, crédit lombard)','Fonds euros multi-devises (EUR, USD, GBP, CHF)'],
  limites = ARRAY['Peu présent en assurance-vie individuelle directe','Ticket d''entrée patrimonial élevé (dès 100 000 €)'],
  updated_at = now()
WHERE company = 'AG2R La Mondiale';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Association d''épargne adossée à AXA, avec les gammes CLER et Cliquet. Les contrats sont assurés par AXA.',
  forces = ARRAY['Cadre associatif structuré','Adossement à AXA'],
  limites = ARRAY['Univers de supports plus restreint','Offre peu ouverte au canal CGP'],
  updated_at = now()
WHERE company = 'Agipi';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur généraliste de premier plan, adossé au groupe Allianz. Il propose une offre patrimoniale dédiée aux CGP sous la marque Allianz Wealth.',
  forces = ARRAY['Solidité financière du groupe Allianz','Offre patrimoniale dédiée aux CGP'],
  limites = ARRAY['Positionnement multi-canal peu spécialisé','Moins central sur le courtage pur'],
  updated_at = now()
WHERE company = 'Allianz France';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Groupe mutualiste de protection sociale intégré verticalement en assurance-vie. Il réunit la plateforme de distribution Intencial et l''assureur luxembourgeois OneLife.',
  forces = ARRAY['Chaîne intégrée plateforme et assureur','Accès au Luxembourg via OneLife','Dynamique de développement'],
  limites = ARRAY['Part de marché encore en construction'],
  updated_at = now()
WHERE company = 'APICIL';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bras luxembourgeois du groupe Apicil, porté par OneLife. Il propose le ticket d''entrée parmi les plus bas du Luxembourg et une souscription digitalisée, distribué via Intencial.',
  forces = ARRAY['Ticket d''entrée bas pour le Luxembourg (dès 50 000 €)','Plateforme digitale','Distribution via Intencial'],
  limites = ARRAY['Offre luxembourgeoise plus récente'],
  updated_at = now()
WHERE company = 'Apicil / OneLife';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Compartiment luxembourgeois du groupe Apicil, opéré par OneLife. Il prolonge l''offre France sur le canal CGP via la plateforme Intencial.',
  forces = ARRAY['Intégration avec la plateforme Intencial','Adossement au groupe Apicil'],
  limites = ARRAY['Périmètre encore en construction','Offre luxembourgeoise récente'],
  updated_at = now()
WHERE company = 'APICIL Luxembourg';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur généraliste majeur du groupe AXA. Il adresse les CGP via son entité grossiste dédiée AXA Thema.',
  forces = ARRAY['Marque et solidité du groupe AXA','Entité grossiste dédiée aux CGP'],
  limites = ARRAY['Accès aux CGP via une entité tierce','Fonds euros classique peu compétitif'],
  updated_at = now()
WHERE company = 'AXA France';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bras luxembourgeois du groupe AXA en assurance-vie. Il complète l''offre France pour la clientèle patrimoniale et internationale.',
  forces = ARRAY['Solidité du groupe AXA','Cadre luxembourgeois (FID, FAS)'],
  limites = ARRAY['Ticket d''entrée élevé','Cible patrimoniale haut de gamme'],
  updated_at = now()
WHERE company = 'AXA Wealth Europe';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bras assurantiel wholesale du groupe AXA dédié aux CGP, anciennement AXA Thema. Il assure et distribue le contrat Coralis Sélection via l''extranet AXA Wealth Digital, distinct d''AXA France et d''AXA Wealth Europe.',
  forces = ARRAY['Marque et solidité du groupe AXA','Plateforme CGP dédiée (ex-AXA Thema)'],
  limites = ARRAY['Fonds euros classique jugé peu compétitif','Accès via une entité dédiée'],
  updated_at = now()
WHERE company = 'AXA Wealth Services';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie luxembourgeois du groupe suisse Bâloise. Il est accessible et bien référencé sur le canal CGP.',
  forces = ARRAY['Ticket d''entrée accessible (dès 100 000 €)','Adossement au groupe Bâloise','Cadre luxembourgeois protecteur'],
  limites = ARRAY['Acteur de taille moyenne au Luxembourg'],
  updated_at = now()
WHERE company = 'Baloise Life';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bras assurance-vie du groupe BNP Paribas, avec une forte puissance de bilan. Il est présent en multi-canal via les gammes Cardif Elite, Multiplacements Privilège et Nova Stratégie.',
  fonds_euros = 'Fonds euros général, autour de 2,75 % en 2025 (indicatif)',
  forces = ARRAY['Solidité financière du groupe BNP Paribas','Gamme large et multi-canal'],
  limites = ARRAY['Positionnement moins spécialisé CGP que Generali'],
  updated_at = now()
WHERE company = 'BNP Paribas Cardif';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Mutuelle d''épargne patrimoniale de long terme. Elle propose des contrats d''assurance-vie et de retraite à ses adhérents.',
  forces = ARRAY['Cadre mutualiste','Gestion prudente et de long terme'],
  limites = ARRAY['Univers de supports restreint','Peu présent sur le canal CGP'],
  updated_at = now()
WHERE company = 'Carac';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Leader de l''assurance-vie luxembourgeoise, adossé au bilan bancaire de BNP Paribas. Il offre un bon compromis entre sécurité et rendement pour la clientèle patrimoniale.',
  forces = ARRAY['Solidité du groupe BNP Paribas','Cadre luxembourgeois (FID, FAS)','Position de leader au Luxembourg'],
  limites = ARRAY['Ticket d''entrée élevé'],
  updated_at = now()
WHERE company = 'Cardif Lux Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bancassureur français de premier plan, adossé à la Caisse des Dépôts et à La Banque Postale. Il est présent sur le courtage via des contrats comme Lucya CNP.',
  forces = ARRAY['Poids de marché majeur','Adossement à la Caisse des Dépôts','Présence en courtage'],
  limites = ARRAY['Moins central sur le canal CGP pur'],
  updated_at = now()
WHERE company = 'CNP Assurances';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Filiale luxembourgeoise à 100 % de La Banque Postale, distincte de CNP Assurances France. Sa gamme Alysés est accessible aux CGP dès 125 000 €, sous le ticket luxembourgeois historique.',
  forces = ARRAY['Triangle de sécurité et super-privilège luxembourgeois','Gamme Alysés accessible dès 125 000 €','Plus de 300 unités de compte'],
  limites = ARRAY['Taux de frais et de rendement non publiés','Offre récente (plateforme Alysés lancée en 2023)'],
  updated_at = now()
WHERE company = 'CNP Luxembourg';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bras luxembourgeois du groupe Generali, avec la gamme Espace Lux. Il prolonge l''offre France pour la clientèle patrimoniale.',
  forces = ARRAY['Continuité avec l''offre France','Adossement au groupe Generali','Cadre luxembourgeois (FID, FAS)'],
  limites = ARRAY['Ticket d''entrée élevé'],
  updated_at = now()
WHERE company = 'Generali Luxembourg';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Leader historique du courtage et référence du canal CGP en France. Il dispose d''un univers de supports très large via Himalia, Xaélidia et son PER, avec Espace Lux au Luxembourg.',
  fonds_euros = 'Fonds euros de 1,90 % à 3,40 % selon le quota d''unités de compte (indicatif 2025)',
  forces = ARRAY['Profondeur de l''offre','Gamme PER complète','Forte notoriété sur le canal CGP'],
  limites = ARRAY['Frais de gestion élevés en direct (environ 1 %)'],
  updated_at = now()
WHERE company = 'Generali Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie mutualiste du groupe Covéa, sous la marque GMF. Il distribue son assurance-vie principalement via son réseau propre.',
  forces = ARRAY['Solidité mutualiste du groupe Covéa','Marque grand public reconnue'],
  limites = ARRAY['Distribution centrée sur le réseau propre','Moins central sur le canal CGP'],
  updated_at = now()
WHERE company = 'GMF Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie du groupe mutualiste Groupama, présent via les réseaux Gan et Groupama. Il propose une offre patrimoniale sous la marque Gan Patrimoine.',
  forces = ARRAY['Maillage réseau dense (Gan et Groupama)','Solidité du groupe mutualiste'],
  limites = ARRAY['Moins central sur le canal CGP'],
  updated_at = now()
WHERE company = 'Groupama Gan Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie du groupe public La Banque Postale. Il distribue son offre principalement via le réseau bancaire.',
  forces = ARRAY['Adossement au groupe public La Banque Postale','Solidité financière'],
  limites = ARRAY['Distribution centrée sur le réseau bancaire','Moins central sur le canal CGP'],
  updated_at = now()
WHERE company = 'La Banque Postale Life';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Mutuelle d''épargne spécialisée en retraite mutualiste et assurance-vie. Elle sert une clientèle fidèle, historiquement liée au monde combattant.',
  forces = ARRAY['Cadre mutualiste','Expertise de la retraite mutualiste'],
  limites = ARRAY['Univers de supports restreint','Peu présent sur le canal CGP'],
  updated_at = now()
WHERE company = 'La France Mutualiste';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Courtier en ligne spécialisé dans l''assurance-vie à frais réduits. Il distribue des contrats portés par Suravenir, Spirica et Apicil, l''assureur variant selon le contrat.',
  forces = ARRAY['Frais réduits','Souscription 100 % en ligne','Choix entre plusieurs assureurs porteurs'],
  limites = ARRAY['Distributeur, non porteur de risque','Pas d''accompagnement conseil personnalisé'],
  updated_at = now()
WHERE company = 'Linxea';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie mutualiste du groupe Covéa, sous la marque MAAF. Il distribue son assurance-vie principalement via son réseau propre.',
  forces = ARRAY['Solidité mutualiste du groupe Covéa','Marque grand public reconnue'],
  limites = ARRAY['Distribution centrée sur le réseau propre','Moins central sur le canal CGP'],
  updated_at = now()
WHERE company = 'MAAF Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie mutualiste du groupe Macif, réuni au sein d''Aéma Groupe. Il cible l''épargne grand public via son réseau propre.',
  forces = ARRAY['Base mutualiste large','Adossement à Aéma Groupe'],
  limites = ARRAY['Distribution surtout directe','Moins central sur le canal CGP'],
  updated_at = now()
WHERE company = 'Macif Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Mutuelle dédiée aux professionnels de santé et à leurs familles. Elle porte le contrat multisupport de référence RES.',
  forces = ARRAY['Forte fidélité de la cible santé','Contrat RES reconnu','Solidité mutualiste'],
  limites = ARRAY['Cible professionnelle spécifique','Peu présent sur le canal CGP'],
  updated_at = now()
WHERE company = 'MACSF';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur mutualiste engagé, connu pour son positionnement responsable. Il porte le contrat AV Responsable et Solidaire, à forte coloration ISR.',
  forces = ARRAY['Positionnement ISR et solidaire affirmé','Solidité mutualiste'],
  limites = ARRAY['Distribution surtout directe','Univers de supports orienté responsable'],
  updated_at = now()
WHERE company = 'Maif';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie mutualiste du groupe Covéa, sous la marque MMA. Il distribue son assurance-vie principalement via son réseau d''agents.',
  forces = ARRAY['Solidité mutualiste du groupe Covéa','Réseau d''agents dense'],
  limites = ARRAY['Distribution centrée sur le réseau propre','Moins central sur le canal CGP'],
  updated_at = now()
WHERE company = 'MMA Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie luxembourgeois du groupe BPCE, via Natixis. Il propose une offre patrimoniale complémentaire au Luxembourg.',
  forces = ARRAY['Adossement au groupe BPCE','Cadre luxembourgeois (FID, FAS)'],
  limites = ARRAY['Ticket d''entrée élevé','Acteur complémentaire au Luxembourg'],
  updated_at = now()
WHERE company = 'Natixis Life Luxembourg';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie de Société Générale Assurances dédié au courtage. Son activité est aujourd''hui en repli.',
  forces = ARRAY['Adossement à Société Générale Assurances','Gamme dédiée au courtage'],
  limites = ARRAY['Activité en repli','Développement commercial ralenti'],
  updated_at = now()
WHERE company = 'Oradéa Vie';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bancassureur du groupe Crédit Agricole, l''un des premiers assureurs-vie français. Il distribue son offre via les réseaux Crédit Agricole et LCL.',
  forces = ARRAY['Puissance des réseaux Crédit Agricole et LCL','Poids de marché majeur','Solidité financière'],
  limites = ARRAY['Distribution centrée sur le réseau bancaire','Peu présent sur le canal CGP'],
  updated_at = now()
WHERE company = 'Predica';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie du groupe Crédit Agricole Assurances, champion de l''architecture ouverte (SCPI, SCI, titres vifs, private equity). Il est souvent distribué via UAF Life Patrimoine, avec les contrats Netlife et Nouvelle Génération.',
  fonds_euros = 'Fonds euros Nouvelle Génération, autour de 3,08 % en 2025 (indicatif)',
  forces = ARRAY['Large univers non coté et immobilier','Frais compétitifs','Adossement à Crédit Agricole Assurances'],
  limites = ARRAY['Distribution dépendante des plateformes partenaires'],
  updated_at = now()
WHERE company = 'Spirica';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie du groupe Crédit Mutuel Arkéa, en forte croissance en 2025. Il pousse activement sur les CGP et les courtiers en ligne.',
  fonds_euros = 'Fonds euros de 2,10 % à 3,00 % selon le mode de gestion (indicatif 2025)',
  forces = ARRAY['Solvabilité élevée','Forte dynamique de collecte','Adossement à Crédit Mutuel Arkéa'],
  limites = ARRAY['Image historiquement associée au 100 % en ligne'],
  updated_at = now()
WHERE company = 'Suravenir';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Bras luxembourgeois de Suravenir, adossé à Crédit Mutuel Arkéa. Il prolonge l''offre France pour la clientèle patrimoniale.',
  forces = ARRAY['Continuité avec l''offre Suravenir France','Adossement à Crédit Mutuel Arkéa','Cadre luxembourgeois'],
  limites = ARRAY['Offre luxembourgeoise plus récente'],
  updated_at = now()
WHERE company = 'Suravenir Luxembourg';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie haut de gamme du groupe Swiss Life, positionné sur les CGP et la banque privée. Il propose les contrats Strategic Premium, Placement Privilège et un PER, avec une gestion sous mandat reconnue.',
  fonds_euros = 'Fonds euros de 1,70 % à 3,05 %, avec un bonus d''environ 0,20 point en gestion privée (indicatif 2025)',
  forces = ARRAY['Qualité de la gestion','Gestion sous mandat reconnue','Positionnement banque privée'],
  limites = ARRAY['Positionnement premium','Tickets d''entrée plus élevés'],
  updated_at = now()
WHERE company = 'SwissLife France';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Référence luxembourgeoise de l''assurance-vie pour clientèle très fortunée et family offices, anciennement Lombard International. Elle est présente dans plus de 30 pays et offre un large choix de banques dépositaires.',
  forces = ARRAY['Référence très haut de gamme (HNWI, family office)','Multidevise et international','Large choix de dépositaires'],
  limites = ARRAY['Cible patrimoniale très élevée','Ticket d''entrée important'],
  updated_at = now()
WHERE company = 'Utmost Luxembourg S.A.';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie luxembourgeois indépendant, souple dans la structuration des contrats. Il complète l''offre du marché pour la clientèle patrimoniale.',
  forces = ARRAY['Souplesse de structuration des contrats','Cadre luxembourgeois protecteur'],
  limites = ARRAY['Notoriété confidentielle','Acteur de taille modeste'],
  updated_at = now()
WHERE company = 'Vitis Life';

UPDATE public.investissement_av_insurer_profiles SET
  positionnement = 'Assureur-vie luxembourgeois du groupe Foyer, gérant plus de 10 milliards d''euros d''actifs. Il s''adresse à une clientèle exigeante et internationale.',
  forces = ARRAY['Ticket d''entrée accessible pour le Luxembourg (dès 125 000 €)','Clientèle internationale','Adossement au groupe Foyer'],
  limites = ARRAY['Notoriété plus confidentielle en France'],
  updated_at = now()
WHERE company = 'Wealins';

-- ===== Conditions de contrat (investissement_av_contract_terms) =====

-- --- part_00.sql ---
UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '20 000 €',
  versement_min = '150 €',
  distributeur = 'CO Conseils / CGP via Abeille Vie',
  options_gestion = ARRAY['Gestion libre','Gestion évolutive','Gestion sous mandat']
WHERE key = 'Abeille Vie::Abeille Capitalisation Plurielle Horizons';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_nom = 'Abeille Euro (Abeille Actif Garanti)',
  fonds_euros_bonus = 'Jusqu''à +2,40 % si ≥ 30 % UC (offre 2025), taux boosté 4,80 % en 2024 et 4,90 % en 2025',
  fonds_euros_contrainte_uc = 'Minimum 30 % UC pour accéder au fonds euros',
  frais_arbitrage_note = 'Arbitrages libres et illimités',
  garantie_fonds_euros = 'Capital garanti hors frais de gestion',
  ticket_entree = '1 500 €',
  versement_min = '750 €',
  distributeur = 'Abeille Assurances (direct) / courtiers partenaires',
  service_extranet = 'Espace client Abeille Assurances',
  options_gestion = ARRAY['Gestion libre','Gestion évolutive','Gestion sous mandat','Investissement progressif','Sécurisation des plus-values','Arbitrage programmé','Réallocation automatique','Garantie plancher décès incluse']
WHERE key = 'Abeille Vie::Abeille Epargne Active';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '750 €',
  versement_min = '150 €',
  distributeur = 'Abeille Assurances / CGP / PERLIB',
  options_gestion = ARRAY['Gestion libre','Gestion sous mandat','Gestion évolutive horizon retraite']
WHERE key = 'Abeille Vie::Abeille Retraite Plurielle';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '500 €',
  versement_min = '500 €',
  distributeur = 'Abeille Assurances / Abeille Vie',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée horizon','Gestion sous mandat']
WHERE key = 'Abeille Vie::Abeille Retraite Plurielle Entreprise';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti',
  ticket_entree = '750 €',
  versement_min = '150 €/mois ou 750 € par versement libre',
  distributeur = 'Abeille Assurances (réseau direct + courtiers)',
  options_gestion = ARRAY['Gestion libre','Gestion profilée sécuritaire','Gestion profilée prudente','Gestion profilée équilibrée','Arbitrage libre']
WHERE key = 'Abeille Vie::Abeille Stratégie IFC';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Bonus fidélité +10 % sur les participations aux bénéfices après 8 ans de détention, renouvelable',
  fonds_euros_contrainte_uc = 'Allocation fonds euros limitée à 20 % du contrat',
  frais_arbitrage_note = 'Arbitrages gratuits en ligne',
  garantie_fonds_euros = 'Capital garanti net de frais de versement',
  ticket_entree = '100 €',
  versement_min = '50 €',
  distributeur = 'AFER (Association Française d''Épargne et de Retraite)',
  options_gestion = ARRAY['Gestion libre']
WHERE key = 'Abeille Vie::Afer Génération';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrages illimités et gratuits (à la demande et automatiques)',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '100 €',
  versement_min = '100 €',
  distributeur = 'Afer (association) via Abeille Vie — réseau courtiers, agents, Abeille',
  options_gestion = ARRAY['Gestion libre','Gestion sous mandat Ofi Invest (prudent/équilibré/dynamique)']
WHERE key = 'Abeille Vie::Afer multisupport';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrages gratuits et sans restriction',
  garantie_fonds_euros = 'Capital garanti',
  ticket_entree = '750 €',
  versement_min = '150 €',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée horizon retraite','Gestion sous mandat']
WHERE key = 'Abeille Vie::Afer retraite individuelle';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+1,50 % sans condition UC, ou +2 % avec minimum 30 % UC (offre Abeille Bonus 2027)',
  fonds_euros_contrainte_uc = '100 % fonds euros jusqu''à 30 000 €, au-delà minimum 30 % UC',
  frais_arbitrage_note = 'Gratuit et illimité en gestion libre, 0,10 % max sur les ETF',
  garantie_fonds_euros = 'Nette de frais de gestion',
  ticket_entree = '500 €',
  versement_min = '500 € (libre), dès 50 €/mois programmé',
  distributeur = 'Lucya (ex-assurancevie.com)',
  service_extranet = 'Souscription et gestion 100 % en ligne',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion horizon','Sécurisation des plus-values','Investissement progressif','Rééquilibrage automatique']
WHERE key = 'Abeille Vie::Lucya Abeille';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrages illimités et gratuits',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '500 €',
  versement_min = '500 €',
  distributeur = 'Lucya (assurancevie.com)',
  options_gestion = ARRAY['Gestion libre','Gestion évolutive','Gestion déléguée (+0,20 %/an, 3 orientations)']
WHERE key = 'Abeille Vie::Lucya Abeille PER';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrages gratuits et illimités',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '1 500 €',
  versement_min = '150 €',
  distributeur = 'Predictis (agent général Abeille Vie)',
  options_gestion = ARRAY['Gestion libre','Gestion évolutive','Gestion sous mandat','Écrêtage des plus-values','Plan d''investissement progressif','Arbitrage annuel des intérêts','Plan d''arbitrages programmés','Plan de sécurisation progressive','Rééquilibrage automatique trimestriel','Plan de rachats programmés']
WHERE key = 'Abeille Vie::Premium Epargne Active';

UPDATE public.investissement_av_contract_terms SET
  distributeur = 'Predictis (CGP)',
  options_gestion = ARRAY['Gestion libre','Gestion évolutive (horizon retraite)','Gestion sous mandat']
WHERE key = 'Abeille Vie::Premium Retraite Active';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '1 500 €',
  versement_min = '150 €',
  distributeur = 'UFF (Union Financière de France)',
  options_gestion = ARRAY['Gestion libre','Gestion sous mandat (Ofi Invest AM)']
WHERE key = 'Abeille Vie::UFF Patrimonial Vie';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrages gratuits',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '1 000 €',
  versement_min = '1 000 €',
  distributeur = 'Réseau CGP Abeille Vie',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Arbitrage programmé','Rééquilibrage automatique']
WHERE key = 'Abeille Vie::VIP Capitalisation Active';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Bonus conditionnel jusqu''à +2,40 % selon diversification UC, taux max 4,80 % (2024) ou 4,90 % (2025)',
  frais_arbitrage_note = 'Arbitrages gratuits et illimités',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion (hors prélèvements sociaux et coût des garanties optionnelles)',
  ticket_entree = '1 000 €',
  versement_min = '100 €',
  distributeur = 'Réseau agents généraux Abeille Assurances',
  options_gestion = ARRAY['Gestion libre','Gestion sous mandat ISR (Ofi Invest AM ou Rothschild & Co AM)','Gestion évolutive à horizon']
WHERE key = 'Abeille Vie::VIP Epargne Active';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '0,25 % pour un arbitrage maintenant ou augmentant la part UC, 0,50 % pour un arbitrage augmentant la part fonds euros',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = 'Non communiqué',
  versement_min = 'Non communiqué',
  distributeur = 'Crédit Mutuel, CIC',
  service_extranet = 'Espace client ACM',
  options_gestion = ARRAY['Gestion libre','Gestion guidée','Pack UC','Mandat d''arbitrage']
WHERE key = 'ACM Vie::Options Vie';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_contrainte_uc = 'Taux boosté jusqu''à 3,25 % selon part UC',
  frais_arbitrage_note = 'Entre 0,25 % et 0,50 % selon l''opération',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '50 €',
  versement_min = '50 €',
  distributeur = 'Crédit Mutuel, CIC',
  options_gestion = ARRAY['Gestion pilotée horizon retraite','Gestion libre']
WHERE key = 'ACM Vie::PER Assurance Retraite';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '2,85 % avec 25 % UC, 3,10 % avec 50 % UC',
  fonds_euros_contrainte_uc = 'Bonus de taux selon part UC (25 % ou 50 %)',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '15 €',
  versement_min = '15 €',
  distributeur = 'Crédit Mutuel'
WHERE key = 'ACM Vie::Plan Assurance Jeune';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+0,25 % si ≥ 25 % UC, +0,50 % si ≥ 50 % UC (formule Essentielle)',
  fonds_euros_contrainte_uc = 'Bonus conditionné à la part d''UC',
  frais_arbitrage_note = '0,25 % par arbitrage en gestion libre',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '50 € (Essentiel), 15 000 € (Avantage), 100 000 € (Privilège)',
  versement_min = '15 € (versement complémentaire Essentiel)',
  distributeur = 'Crédit Mutuel / CIC',
  options_gestion = ARRAY['Gestion libre','Gestion profilée','Gestion pilotée','Mandat de gestion']
WHERE key = 'ACM Vie::Plan Assurance Vie';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+1,50 % (≥ 45 % UC) ou +1,30 % (≥ 35 % UC) pour versements ≥ 50 000 € (barème 2026-2027), +2 % servi en 2023 et 2024',
  fonds_euros_contrainte_uc = 'Bonus soumis à un quota minimal d''UC (35 % à 45 % selon palier) et versement ≥ 50 000 €, plafond ~250 000 € par fonds euros',
  frais_arbitrage_note = '1 % max (0 arbitrage gratuit/an), 0,30 % max sur ETF et titres vifs, +3 % de pénalités sur SCPI arbitrée sortante avant 3 ans',
  garantie_fonds_euros = 'Fonds euros classique à capital garanti (net de frais de gestion), second fonds euros « Euro Private Strategies » sous conditions',
  ticket_entree = '15 000 €',
  versement_min = '15 000 € (versement initial), 150 €/mois (programmé), anciennes versions dès 5 000 €',
  distributeur = 'Nortia (groupe DLPK)',
  service_extranet = 'Extranet Nortia : souscription, suivi, versements et arbitrages en ligne',
  options_gestion = ARRAY['Gestion libre','Gestion sous mandat (multi-gestionnaire)','Écrêtage / sécurisation des plus-values','Stop-loss relatif','Rééquilibrage automatique','Investissement progressif','Transferts programmés']
WHERE key = 'AEP::Panthéa';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrage gratuit en ligne',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '1 000 €',
  versement_min = '100 €',
  distributeur = 'AFER Vie / Abeille Assurances',
  options_gestion = ARRAY['Gestion libre']
WHERE key = 'Afer::Afer Génération';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrages gratuits et illimités (sur demande et automatiques)',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '100 €',
  versement_min = '100 €',
  distributeur = 'Afer (association) / Abeille Assurances',
  options_gestion = ARRAY['Gestion libre','Gestion guidée (mandat prudent, équilibré, dynamique — Ofi Invest AM)']
WHERE key = 'Afer::Afer Multisupport';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '2 arbitrages gratuits par an, puis 1 % du montant arbitré',
  ticket_entree = '15 000 €',
  versement_min = '2 000 €',
  distributeur = 'AFI ESCA Luxembourg / CGP partenaires',
  options_gestion = ARRAY['Gestion libre','Gestion sous mandat DOM Finance (3 profils)']
WHERE key = 'AFI ESCA Luxembourg::Cap Quality';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrages libres et gratuits',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '500 €',
  versement_min = '50 €',
  distributeur = 'CGP / réseau Afi Esca',
  options_gestion = ARRAY['Gestion libre','Gestion profilée','Gestion pilotée','Gestion mixte']
WHERE key = 'Afi Esca::Sélection Premium';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Participation aux bénéfices majorée +25 % si UC > 60 %, +50 % si UC > 80 %',
  fonds_euros_contrainte_uc = 'Max 40 % en fonds euros (minimum 60 % UC depuis juin 2020)',
  frais_arbitrage_note = '1 % (min 150 €, max 300 €), gratuit via Althos',
  garantie_fonds_euros = 'Capital garanti net de frais, réassuré en 4 devises (EUR/USD/GBP/CHF)',
  ticket_entree = '100 000 €',
  versement_min = '5 000 €',
  distributeur = 'La Mondiale Europartner (AG2R La Mondiale) — contrat luxembourgeois CGP',
  options_gestion = ARRAY['Gestion libre','Gestion personnalisée FID','FAS mono-ligne','FAS conseillée','Profils de gestion','Garantie décès']
WHERE key = 'AG2R La Mondiale::Life Mobility Evolution (MTP)';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+0,50 à 2,35 % en 2026 et 2027, sous condition d''UC',
  fonds_euros_contrainte_uc = '60 % d''UC minimum (fonds euros plafonné à 40 %)',
  frais_arbitrage_note = '1 % max (150 à 300 €), 2 arbitrages gratuits par an puis 50 € chez Meilleurtaux',
  garantie_fonds_euros = 'Brute de frais de gestion',
  ticket_entree = '100 000 € (FID dès 125 000 €, FAS dès 250 000 €)',
  versement_min = '5 000 € complémentaire, 1 000 € par support',
  distributeur = 'Meilleurtaux Placement et CGP agréés',
  service_extranet = 'Espace Assuré en ligne, souscription et signature électronique',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion sous mandat','Fonds interne dédié (FID)','Fonds interne collectif (FIC)','Fonds d''assurance spécialisé (FAS)']
WHERE key = 'AG2R La Mondiale::LMEP Europartner Luxembourg';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Bonus de rendement conditionnel selon part UC (jusqu''à 3 % avec minimum 45 % UC)',
  fonds_euros_contrainte_uc = 'Bonus conditionnel nécessite minimum 45 % en UC',
  frais_arbitrage_note = '0,80 % du montant transféré (minimum 12 €), 1 arbitrage gratuit par an',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '1 000 €',
  versement_min = '300 € (avec versements programmés minimum 100 €/mois)',
  distributeur = 'Agipi (association de prévoyance, assureur AXA)',
  service_extranet = 'Gestion en ligne',
  options_gestion = ARRAY['Gestion libre','Gestion déléguée','Gestion déléguée ESG (> 70 % ISR)','40 mandats de gestion']
WHERE key = 'Agipi::Agipi CLER';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+0,50 % si ≥ 20 % UC, +0,80 % si ≥ 20 % Allianz Fonds Croissance, total jusqu''à +1,30 % (offre janv-avr 2025)',
  fonds_euros_contrainte_uc = '30 % minimum en UC, revenus fonds euros réinvestis automatiquement en UC pendant 5 ans minimum, retrait anticipé = perte des produits',
  frais_arbitrage_note = '1 arbitrage gratuit/an civil, puis 0,85 % (max 5 000 €)',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '30 000 €',
  versement_min = '1 500 €',
  distributeur = 'Allianz (réseau agents)',
  options_gestion = ARRAY['Gestion libre','Gestion profilée','Gestion pilotée (+0,25 %/an)']
WHERE key = 'Allianz France::Allianz Vie Fidélité';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1,50 % plafonné à 5 000 € par arbitrage vers le fonds euros',
  garantie_fonds_euros = 'Capital garanti',
  distributeur = 'Allianz France (réseau agences / gestion privée)'
WHERE key = 'Allianz France::Allianz Wealth';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrage gratuit',
  ticket_entree = '30 000 €',
  versement_min = '30 000 €',
  distributeur = 'Allianz France',
  options_gestion = ARRAY['Allianz Protect Invest']
WHERE key = 'Allianz France::Allianz4Life';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+1,50 % de bonification sur 2026 et 2027 pour toute nouvelle adhésion ou versement avant le 31/03/2026 (sans contrainte UC)',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = 'Non communiqué',
  versement_min = 'Non communiqué',
  distributeur = 'Asac-Fapès (association loi 1901)',
  options_gestion = ARRAY['Arbitrage automatique de la participation aux bénéfices du fonds euros vers UC (Garantie de Fidélité)']
WHERE key = 'Allianz France::Asac Épargne Fidélité';

UPDATE public.investissement_av_contract_terms SET
  distributeur = 'ASAC-Fapès',
  options_gestion = ARRAY['Gestion profilée']
WHERE key = 'Allianz France::ASAC Vie Génération';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+0,50 % si ≥ 20 % UC, +0,80 % si ≥ 20 % Allianz Fonds Croissance',
  fonds_euros_contrainte_uc = 'Bonus UC optionnel',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '30 000 €',
  versement_min = '30 000 €',
  distributeur = 'Allianz Banque / réseau banque privée Allianz',
  options_gestion = ARRAY['Gestion libre','Gestion sous mandat']
WHERE key = 'Allianz France::Banque Privée Sélection Vie Allianz';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrages gratuits, 4 premiers arbitrages/an gratuits puis 0,50 % max UC vers fonds euros',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '500 €',
  versement_min = '500 €',
  distributeur = 'ASAC-Fapès (association d''épargnants)',
  options_gestion = ARRAY['Gestion libre','Gestion profilée (prudent/équilibré/offensif)']
WHERE key = 'Allianz France::Epargne Retraite 2 Plus';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+1 % en 2024 et 2025 sur versements fonds euros entre le 01/07/2024 et le 31/12/2025 (prorata temporis), bonus +1,50 % valable jusqu''au 30/06/2026',
  fonds_euros_contrainte_uc = '30 % minimum en UC sur les nouveaux contrats',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '30 000 €',
  versement_min = '5 000 € (ou 100 €/mois en versements programmés)',
  distributeur = 'GAIPARE (association)',
  options_gestion = ARRAY['Gestion libre','Gestion profilée (5 profils, +0,30 % frais)','Gestion pilotée','Arbitrage programmé']
WHERE key = 'Allianz France::GAIPARE Fidelissimo';

UPDATE public.investissement_av_contract_terms SET
  distributeur = 'CGP / courtiers France'
WHERE key = 'Allianz Life Luxembourg::Global Invest Evolution France';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1 % max (plancher 80 €) par arbitrage, 1er arbitrage annuel gratuit',
  ticket_entree = '100 000 € (fonds externes/FIC), 250 000 € (FID/FAS)',
  versement_min = '10 000 € (complémentaire)',
  distributeur = 'Althos, expert-invest, assurancevieluxembourg',
  service_extranet = 'Outils de suivi en ligne (application mobile)',
  options_gestion = ARRAY['Gestion libre','Gestion déléguée','Sécurisation des plus-values','Stop-loss','Investissement progressif']
WHERE key = 'Apicil / OneLife::OneLife Wealth Luxembourg';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = 'Arbitrage gratuit (contrat luxembourgeois open architecture)',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '300 000 €',
  versement_min = '125 000 €',
  distributeur = 'WSI Conseil (CGP indépendant, Paris), open architecture multi-distributeurs',
  options_gestion = ARRAY['Gestion libre','Gestion déléguée (WSI Conseil)','Fonds internes dédiés (FID)','Fonds d''assurance spécialisés (FAS)']
WHERE key = 'APICIL Luxembourg::APICIL Luxembourg AV';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Jusqu''à +1,40 % pour ≥ 70 % UC (base 1,45 % + 0,50/1,10/1,40 % selon paliers 50/60/70 % UC)',
  fonds_euros_contrainte_uc = '50 % max de fonds euros par opération',
  frais_arbitrage_note = 'Gratuit en ligne (hors arbitrage vers fonds euros), puis 15 € + 0,10 % max',
  garantie_fonds_euros = 'Nette de frais',
  ticket_entree = '1 000 € (500 € avec versements programmés)',
  versement_min = '150 € (libre) / 50 € (programmé mensuel)',
  distributeur = 'Meilleurtaux Placement',
  service_extranet = 'Souscription et gestion en ligne',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion horizon retraite']
WHERE key = 'APICIL::meilleurtaux PER';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais',
  distributeur = 'Asac Fapes (association)',
  options_gestion = ARRAY['Garantie de Fidélité (arbitrage automatique de la participation aux bénéfices vers UC)']
WHERE key = 'Asac Fapes::Asac Épargne Fidélité';

-- --- part_01.sql ---
-- Réécriture éditoriale des champs texte — investissement_av_contract_terms
-- Tranche OFFSET 40 LIMIT 40. NE PAS APPLIQUER automatiquement.

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Garantie partielle, 80 % du capital chaque année',
  ticket_entree = '500 €',
  versement_min = '100 €'
WHERE key = 'Asac Fapes::Asac-Fapes PER';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Netissima jusqu''à 4,60 % sous conditions, accessible à 100 % jusqu''au 31/12/2026',
  fonds_euros_contrainte_uc = 'Eurossima plafonné à 15 000 € sans contrainte UC, allocation Netissima requise au-delà',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '500 €',
  versement_min = '500 €',
  service_extranet = 'Gestion 100 % en ligne',
  options_gestion = ARRAY['Don solidaire annuel'],
  univers_classes = ARRAY['Fonds euros','OPCVM ISR']
WHERE key = 'Asac Fapes::Solid''R Vie';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Bonus conditionnel selon part UC. Taux 2024 de 2,10 % à 3,10 %, taux 2025 annoncé de 2,35 % à 4,35 %',
  fonds_euros_contrainte_uc = 'Minimum 40 % en UC (versements < 2 000 000 €), minimum 50 % (versements ≥ 2 000 000 €)',
  frais_arbitrage_note = 'Arbitrages programmés gratuits en gestion libre (rééquilibrage automatique, sécurisation)',
  garantie_fonds_euros = 'Capital garanti (fonds euros classique)',
  ticket_entree = '300 000 €',
  versement_min = '50 000 € (versements complémentaires)',
  distributeur = 'AXA Gestion Privée (réseau propre AXA)'
WHERE key = 'AXA France::AMADEO EVOLUTION CAPITALISATION';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Majoration de +2,00 % sur nouveaux versements 2026 ou +0,50 % sur encours au 01/01/2026, sous condition de 45 % minimum en UC',
  fonds_euros_contrainte_uc = 'Minimum 40 % en UC (versements < 2 000 000 €), minimum 50 % (versements ≥ 2 000 000 €)',
  frais_arbitrage_note = 'Arbitrage gratuit',
  garantie_fonds_euros = 'Capital garanti',
  ticket_entree = '300 000 €',
  versement_min = '50 000 €',
  distributeur = 'AXA Wealth Management / AXA Gestion Privée',
  options_gestion = ARRAY['Gestion libre','Architecture ouverte (mandats Architas)','Architecture fermée (Architas et JP Morgan AM)','Gestion conseillée','Gestion sous mandat personnalisée','Gestion de fonds dédiés']
WHERE key = 'AXA France::AMADEO EVOLUTION VIE';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+1 % avec ≥ 45 % d''encours en UC en gestion libre, +2 % en gestion pilotée avec ≥ 45 % UC. Taux 2024 jusqu''à 3,10 %, taux 2025 entre 2,35 % et 4,35 % selon profil UC',
  fonds_euros_contrainte_uc = 'Minimum 45 % d''encours en unités de compte pour le bonus de rendement',
  frais_arbitrage_note = '0,60 % avec plancher de 70 €',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion (fonds euros classique)',
  ticket_entree = '300 000 €',
  versement_min = '50 000 € (versements complémentaires)',
  distributeur = 'AXA (gestion privée / réseau AXA direct)'
WHERE key = 'AXA France::AMADEO EXCELLENCE CAPITALISATION';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Jusqu''à +2 % conditionné : +1 % si UC ≥ 45 %, +2 % en gestion pilotée avec minimum 45 % UC',
  fonds_euros_contrainte_uc = 'Minimum 40 % en UC (versements < 2 M€), minimum 50 % (≥ 2 M€)',
  frais_arbitrage_note = '0,60 % (minimum 70 €)',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '300 000 €',
  versement_min = '50 000 € (versements complémentaires)',
  distributeur = 'AXA France (réseau agents généraux AXA)',
  service_extranet = 'Pas de souscription en ligne'
WHERE key = 'AXA France::AMADEO EXCELLENCE VIE';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '0,80 % par arbitrage, arbitrages gratuits possibles selon options',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '1 000 €',
  versement_min = '1 000 €'
WHERE key = 'AXA France::ARPEGES';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+1 % si UC ≥ 45 %, +2 % en gestion pilotée avec UC ≥ 45 %',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  distributeur = 'AXA France (contrat collectif entreprise, article 82 CGI)'
WHERE key = 'AXA France::ARTICLE 82';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '0,80 % du montant arbitré',
  garantie_fonds_euros = 'Capital garanti (fonds euros classique), garantie à l''échéance pour l''eurocroissance',
  ticket_entree = '1 000 €',
  versement_min = '1 000 €'
WHERE key = 'AXA France::CLEF';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Jusqu''à +2 % selon part UC (≥ 45 % UC) et mode de gestion, maximum 4,25 % en 2025',
  fonds_euros_contrainte_uc = '45 % UC minimum pour accéder au bonus',
  frais_arbitrage_note = '0,80 % du montant arbitré (minimum 30 €) vers fonds euros, 0,40 % vers UC',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '1 000 €',
  versement_min = '1 000 €',
  distributeur = 'Réseau AXA (commerciaux salariés AXA France)'
WHERE key = 'AXA France::EXCELIUM VIE';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '0,80 % par arbitrage en gestion libre',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '100 €',
  versement_min = '100 €'
WHERE key = 'AXA France::FAR PER';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = '+0,50 % si ≥ 45 % UC ou gestion pilotée (versements avant 01/01/2026)',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '480 €',
  versement_min = '480 €',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée (Sérénité, Équilibre)'],
  univers_classes = ARRAY['Fonds euros','OPCVM','UC']
WHERE key = 'AXA France::FIGURES LIBRES';

UPDATE public.investissement_av_contract_terms SET
  distributeur = 'AXA Pro / agents généraux AXA',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée'],
  univers_classes = ARRAY['Fonds euros','OPCVM']
WHERE key = 'AXA France::IFC SUR MESURE';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '1 000 €',
  versement_min = '1 000 €'
WHERE key = 'AXA France::MILLENIUM';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '914 €',
  versement_min = '914 €',
  distributeur = 'AXA France (réseau agents)'
WHERE key = 'AXA France::NOVIAL';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '300 000 €',
  versement_min = '300 000 €',
  distributeur = 'AXA France (réseau propre, CGP)'
WHERE key = 'AXA France::PAM EXCELLENCE CAPITALISATION';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Non éligible aux dispositifs Euro+ et Eurocroissance+ 2025/2026',
  fonds_euros_contrainte_uc = 'Non confirmée pour ce contrat',
  frais_arbitrage_note = '0,60 % avec un minimum de 70 €',
  garantie_fonds_euros = 'Capital garanti (fonds euros classique AXA France Vie)',
  ticket_entree = '300 000 € (versement initial minimum)',
  versement_min = '50 000 € (versements complémentaires), versements programmés dès 300 €/mois',
  distributeur = 'AXA France (réseau Gestion Privée AXA et CGP partenaires AXA Thema)',
  service_extranet = 'Espace client AXA'
WHERE key = 'AXA France::PAM EXCELLENCE VIE';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1 arbitrage gratuit par an, puis 1 %. Changement de mode de gestion 1 %',
  garantie_fonds_euros = 'Capital garanti',
  ticket_entree = '600 €',
  versement_min = '45 €',
  distributeur = 'Conseiller AXA / réseau AXA (souscription via conseiller financier)',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée (profils Prudent, Équilibre, Dynamique avec sécurisation progressive)'],
  univers_classes = ARRAY['Fonds euros','Unités de compte','Fonds ISR/ESG']
WHERE key = 'AXA France::PER AMADEO';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1 arbitrage gratuit par an',
  garantie_fonds_euros = 'Capital garanti',
  ticket_entree = '600 €',
  versement_min = '150 €',
  distributeur = 'AXA France (réseau direct, ANPERE Retraite)'
WHERE key = 'AXA France::PER MA RETRAITE';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1 arbitrage gratuit par an',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '600 €',
  versement_min = '45 €',
  distributeur = 'AXA France (entreprises)'
WHERE key = 'AXA France::PERECO ASSURANTIEL';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_nom = 'Pas de fonds euros (structure compte-titres)',
  frais_arbitrage_note = '1 arbitrage gratuit par an, puis 1 % par opération',
  garantie_fonds_euros = 'Aucune garantie en capital (structure compte-titres, pas d''assurance vie)',
  ticket_entree = 'Non communiqué',
  versement_min = 'Non communiqué',
  distributeur = 'AXA Épargne Entreprise (collectif entreprise)'
WHERE key = 'AXA France::PERECO COMPTE TITRE';

UPDATE public.investissement_av_contract_terms SET
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = 'Selon accord entreprise',
  versement_min = 'Selon accord entreprise',
  distributeur = 'AXA France (réseau agents, entreprises)',
  options_gestion = ARRAY['Gestion par horizon équilibre','Gestion libre','Gestion pilotée prudent','Gestion pilotée équilibre','Gestion pilotée dynamique']
WHERE key = 'AXA France::PERO';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_nom = 'Privilège Euro',
  fonds_euros_bonus = 'Jusqu''à +2 % via Euro+ si ≥ 45 % UC ou gestion pilotée (taux maximum 4,25 % en 2025)',
  fonds_euros_contrainte_uc = '45 % UC minimum pour accéder au bonus Euro+',
  frais_arbitrage_note = '4 arbitrages gratuits par an, puis 0,80 % au-delà',
  garantie_fonds_euros = 'Capital garanti net de frais',
  ticket_entree = '1 000 €',
  versement_min = '1 000 €'
WHERE key = 'AXA France::PRIVILEGE';

UPDATE public.investissement_av_contract_terms SET
  distributeur = 'AXA Pro (réseau agents AXA, CGP partenaires)'
WHERE key = 'AXA France::SOLERE IFC';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_nom = 'Fonds Euro Retraite Collective',
  garantie_fonds_euros = 'Capital garanti net de frais',
  distributeur = 'AXA France (entreprises, PERCOL)',
  service_extranet = 'capretraite-entreprises.fr'
WHERE key = 'AXA France::SOLERE PER';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_contrainte_uc = 'Investissement plafonné à 45 % de l''encours total du contrat',
  frais_arbitrage_note = '1 arbitrage gratuit par an, puis 0,50 % (minimum 100 €, maximum 300 €)',
  garantie_fonds_euros = 'Capital garanti net de frais, réassuré 100 % par AXA France Vie',
  ticket_entree = '300 000 €',
  versement_min = '50 000 € (complémentaire)',
  distributeur = 'AXA Wealth Europe (direct / via CGP agréés)',
  service_extranet = 'Espace client en ligne'
WHERE key = 'AXA Wealth Europe::AXA Wealth Europe Luxembourg';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_nom = 'Coralis Euro Long Terme (gamme : Coralis Opportunité, Coralis Euro Patrimoine)',
  frais_arbitrage_note = 'Arbitrage en gestion libre 1,50 % max (minimum 68 €), entre types de gestion 1,50 % max, investissement progressif 1 % max, écrêtage et stop-loss 0,50 % max, remise de titres 0,30 %',
  garantie_fonds_euros = 'Garantie en capital au moins égale aux versements nets de frais (effet cliquet sur le fonds euros)',
  ticket_entree = '25 000 € (gestion libre ou mandat collectif), 250 000 € en gestion sous mandat personnalisée',
  versement_min = '25 000 € initial, complémentaires dès 500 € (minimum 150 €/support), programmés dès 150 €',
  distributeur = 'AXA Wealth Services (ex-AXA Thema), via CGP',
  service_extranet = 'AXA Wealth Digital (plateforme de gestion de contrats pour les CGP)'
WHERE key = 'AXA Wealth Services::Coralis Sélection';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1 arbitrage gratuit par an, puis 0,50 % (plafond 250 €)',
  ticket_entree = '250 000 € contractuel (100 000 € selon distributeurs), FID dès 500 000 €',
  versement_min = '25 000 € (complémentaire)',
  distributeur = 'Via CGP indépendants (Swissquote, Althos, Haussmann Patrimoine)',
  service_extranet = 'Gestion en ligne via eSolife'
WHERE key = 'Baloise Life::Baloise Life Luxembourg';

UPDATE public.investissement_av_contract_terms SET
  ticket_entree = '1 000 €',
  versement_min = '1 000 €',
  distributeur = 'Birdee (Gambit Financial Solutions)',
  options_gestion = ARRAY['Gestion sous mandat robo-advisor','14 profils ESG/ISR'],
  univers_classes = ARRAY['ETF']
WHERE key = 'BNP Paribas Cardif::Birdee Vie (Assurance Vie)';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1,00 % maximum du montant arbitré',
  garantie_fonds_euros = 'Garantie en capital à tout moment égale aux sommes versées nettes de frais sur versements (garantie totale)',
  versement_min = 'Versement unique (contrat à prime unique)',
  distributeur = 'Réseau CGP / partenaires Cardif (code AEP, Assurance Épargne Pension)'
WHERE key = 'BNP Paribas Cardif::Cardif Edition Premium Capi Personnes Morales (Capitalisation pers. morale IS)';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1,00 % maximum du montant arbitré',
  garantie_fonds_euros = '100 % des sommes versées nettes de frais sur versements, garantie en capital totale à tout moment',
  distributeur = 'Réseau partenaires BNP Paribas Cardif'
WHERE key = 'BNP Paribas Cardif::Cardif Edition Premium Capitalisation (Capitalisation pers. physique)';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '1,00 % maximum du montant arbitré',
  garantie_fonds_euros = 'Capital garanti à tout moment égal aux sommes versées nettes de frais sur versements',
  distributeur = 'CGPI / courtiers / gestion privée (réseau Cardif CGPI)'
WHERE key = 'BNP Paribas Cardif::Cardif Edition Premium Vie (Assurance Vie)';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Taux bonifié jusqu''à 4,55 % sur versements selon opérations commerciales annuelles',
  fonds_euros_contrainte_uc = '30 % à 45 % d''UC minimum selon le palier de bonification visé',
  frais_arbitrage_note = '1 % du montant désinvesti maximum (certains distributeurs plafonnent à 75 €)',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion',
  ticket_entree = '15 000 € (versement initial minimum)',
  versement_min = '5 000 € (versements libres), 100 €/mois (périodiques)',
  distributeur = 'CGP indépendants partenaires BNP Paribas Cardif',
  service_extranet = 'Gestion en ligne (espace client Cardif)'
WHERE key = 'BNP Paribas Cardif::Cardif Elite (Assurance Vie)';

UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = '4 options automatiques gratuites (stop-loss, optimisation plus-values, arbitrage progressif, répartition constante)',
  garantie_fonds_euros = 'Capital garanti',
  ticket_entree = '15 000 €',
  versement_min = '5 000 €',
  distributeur = 'BNP Paribas Cardif (réseau CGP et banque privée)',
  service_extranet = 'Espace client en ligne',
  options_gestion = ARRAY['Stop-loss','Optimisation plus-values','Arbitrage progressif','Répartition constante'],
  univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Titres vifs','Fonds labellisés ISR']
WHERE key = 'BNP Paribas Cardif::Cardif Elite Capitalisation (Capitalisation pers. physique)';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_nom = 'Fonds en euros BNP Paribas Cardif (Cardif Sécurité)',
  fonds_euros_bonus = 'Bonus possible : jusqu''à 3,95 % si ≥ 30 % UC, jusqu''à 4,25 % si ≥ 45 % UC (versements). Taux moyen Cardif 2025 : 2,92 %',
  fonds_euros_contrainte_uc = 'Pas de contrainte minimale UC. En PEA assurance, aucun fonds euros accessible (univers limité aux UC zone euro)',
  frais_arbitrage_note = '1 % max du montant arbitré, changement de mode de gestion 1 % max. Options automatiques gratuites (stop-loss, sécurisation des plus-values, arbitrage progressif)',
  garantie_fonds_euros = 'Capital garanti net de frais de gestion, participation aux bénéfices selon conditions de marché. Garantie FGAP jusqu''à 70 000 €',
  ticket_entree = '15 000 € (versement initial minimum)',
  versement_min = '5 000 € (versements libres complémentaires), 100 €/mois (versements programmés)',
  distributeur = 'BNP Paribas Cardif (réseau CGP/courtiers partenaires)'
WHERE key = 'BNP Paribas Cardif::Cardif Elite Capitalisation (Plan d''Epargne en Actions)';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Bonus jusqu''à 4,55 % sur versements (selon conditions de l''offre commerciale)',
  fonds_euros_contrainte_uc = 'Version standard (avec fonds euros) : versement initial de 250 000 €. Version 100 % UC accessible dès 50 000 à 100 000 €',
  frais_arbitrage_note = '1 % max du montant arbitré. 4 services d''arbitrage automatiques gratuits (optimisation des plus-values, stop-loss absolu et relatif, arbitrage progressif)',
  garantie_fonds_euros = 'Garantie en capital partielle ou totale des sommes versées nettes de frais sur versements et après déduction des frais de gestion annuels',
  ticket_entree = '250 000 € (version avec fonds euros), 50 000 à 100 000 € (version 100 % UC)',
  versement_min = '5 000 € (versements libres), 1 000 €/mois (versements programmés)',
  distributeur = 'CGP / courtiers partenaires Cardif (contrat réservé aux réseaux professionnels)',
  service_extranet = 'Espace partenaires Cardif'
WHERE key = 'BNP Paribas Cardif::Cardif Elite Capitalisation Personnes Morales (UC) (Capitalisation pers. morale IS)';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Bonus sur nouveaux versements jusqu''à 4,55 % selon conditions',
  fonds_euros_contrainte_uc = 'Non mentionnée pour la version PM avec fonds euros (prime unique 250 000 €). La version PM 100 % UC exclut le fonds euros',
  frais_arbitrage_note = '1 % max sur arbitrage manuel. Quatre automatismes sans frais (stop-loss absolu et relatif, optimisation des plus-values, arbitrage progressif)',
  garantie_fonds_euros = 'Capital net de frais de gestion garanti à tout moment, avec participation aux bénéfices',
  ticket_entree = '250 000 € (prime unique) pour la version PM avec fonds euros, 50 000 € pour la version PM 100 % UC',
  versement_min = '5 000 € (versements libres), 1 000 €/mois (versements programmés) pour la version 100 % UC',
  distributeur = 'BNP Paribas Cardif (réseau CGP/courtiers, extranet Finagora)',
  service_extranet = 'Finagora (extranet partenaires CGP)'
WHERE key = 'BNP Paribas Cardif::Cardif Elite Capitalisation PM (UC) (Capitalisation pers. morale IS)';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_nom = 'Fonds général Retraite Cardif',
  frais_arbitrage_note = '0 % à 1 % maximum selon les modalités',
  garantie_fonds_euros = 'Capital garanti',
  ticket_entree = '1 500 €',
  versement_min = '100 €',
  distributeur = 'BNP Paribas Cardif (réseau conseiller)',
  options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion déléguée','Gestion à horizon retraite'],
  univers_classes = ARRAY['Fonds euros','UC OPC','Immobilier (SCPI/SCI/OPCI)','Private equity','Fonds structurés','ETF','Fonds ISR']
WHERE key = 'BNP Paribas Cardif::Cardif Elite Retraite (Plan Epargne Retraite)';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_bonus = 'Taux bonifiés jusqu''à 4,55 % sur versements selon conditions, politique reconduite en 2026',
  fonds_euros_contrainte_uc = 'Minimum 25 % en UC requis, allocation 100 % fonds euros non autorisée (hors Eurocroissance)',
  frais_arbitrage_note = '1 % maximum du montant arbitré',
  garantie_fonds_euros = 'Garantie en capital à tout moment égale aux sommes versées nettes de frais sur versements',
  ticket_entree = '5 000 €',
  versement_min = '150 €/mois (versements programmés) ou 2 500 € (versements libres ultérieurs)',
  distributeur = 'Réseau CGPI / courtiers partenaires BNP Paribas Cardif',
  service_extranet = 'www.cardif.fr (espace client en ligne)'
WHERE key = 'BNP Paribas Cardif::Cardif Essentiel';

UPDATE public.investissement_av_contract_terms SET
  fonds_euros_contrainte_uc = 'Part UC minimale de 25 % depuis 2019 pour accéder au fonds euros à 100 %',
  frais_arbitrage_note = '1 % maximum du montant arbitré',
  garantie_fonds_euros = 'Capital garanti à tout moment égal aux sommes versées nettes de frais sur versements',
  ticket_entree = '5 000 €',
  versement_min = 'Versements complémentaires libres dès 2 500 €, versements programmés dès 150 €/mois',
  distributeur = 'Réseau CGPI / CGP partenaires BNP Paribas Cardif (canal intermédiaire uniquement)'
WHERE key = 'BNP Paribas Cardif::Cardif Essentiel Capitalisation';

-- --- part_02.sql ---
-- Réécriture éditoriale investissement_av_contract_terms (OFFSET 80 LIMIT 40)
-- Nettoyage uniquement, aucun chiffre inventé. QUE les champs modifiés.

-- BNP Paribas Cardif::Cardif Essentiel Retraite
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti à tout moment (effet cliquet annuel). Garantie décès complémentaire avant 75 ans' WHERE key = 'BNP Paribas Cardif::Cardif Essentiel Retraite';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Libres 1 000 €, programmés 100 €/mois' WHERE key = 'BNP Paribas Cardif::Cardif Essentiel Retraite';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Cardif (réseau CGP/UFEP), Linxea' WHERE key = 'BNP Paribas Cardif::Cardif Essentiel Retraite';
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Oui (gestion en ligne)' WHERE key = 'BNP Paribas Cardif::Cardif Essentiel Retraite';

-- BNP Paribas Cardif::Cardif Multi Plus 2
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % max du montant arbitré' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 2';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Versement libre complémentaire 750 €' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 2';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Cardif (réseau CGP/agents)' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 2';

-- BNP Paribas Cardif::Cardif Multi Plus 2 PEP
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1,00 % maximum du montant arbitré' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 2 PEP';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti à tout moment (sommes versées nettes de frais). Participation aux bénéfices techniques et financiers' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 2 PEP';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Cardif (distribution directe/réseau CGP)' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 2 PEP';

-- BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonus conditionnel historique jusqu''à 5 % en 2023 (base 3 % + bonus UC)' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Non précisée pour la version Capitalisation' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % max du montant arbitré, gratuits en ligne' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Libre 750 €, programmé 75 €/mois' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation';
UPDATE public.investissement_av_contract_terms SET distributeur = 'BNP Paribas Cardif (réseau CGPI/partenaires)' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation';
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Espace en ligne Cardif, Service One (avance sur contrat à partir de 8 500 €, jusqu''à 60 % de la valeur de rachat)' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation';

-- BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation Pea
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % du montant arbitré' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation Pea';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation Pea';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '1 500 €' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation Pea';
UPDATE public.investissement_av_contract_terms SET versement_min = '750 €' WHERE key = 'BNP Paribas Cardif::Cardif Multi Plus 3 Capitalisation Pea';

-- BNP Paribas Cardif::Cardif Strategie
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,80 % maximum du montant arbitré' WHERE key = 'BNP Paribas Cardif::Cardif Strategie';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti à 100 % (sommes versées nettes de frais sur versements)' WHERE key = 'BNP Paribas Cardif::Cardif Strategie';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Réseau partenaires CGP/courtiers/gestion privée BNP Paribas Cardif' WHERE key = 'BNP Paribas Cardif::Cardif Strategie';

-- BNP Paribas Cardif::Echiquier Club
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais' WHERE key = 'BNP Paribas Cardif::Echiquier Club';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '50 000 €' WHERE key = 'BNP Paribas Cardif::Echiquier Club';
UPDATE public.investissement_av_contract_terms SET versement_min = '50 000 €' WHERE key = 'BNP Paribas Cardif::Echiquier Club';

-- BNP Paribas Cardif::Labelia Vie (Assurance Vie)
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % max (proportionnels ou forfaitaires), changement de mode de gestion 1 % max, SCPI +3 % de pénalités en cas d''arbitrage' WHERE key = 'BNP Paribas Cardif::Labelia Vie (Assurance Vie)';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion. Taux brut 2025 : 3,18 %' WHERE key = 'BNP Paribas Cardif::Labelia Vie (Assurance Vie)';
UPDATE public.investissement_av_contract_terms SET distributeur = 'CGPI (distribution exclusive via le réseau CGPI et partenaires)' WHERE key = 'BNP Paribas Cardif::Labelia Vie (Assurance Vie)';

-- BNP Paribas Cardif::Lucya Cardif (Assurance Vie)
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonus 2026-2027 sur versements ≥ 10 000 € : +1,30 % (≥ 35 % UC), +1,50 % (≥ 45 % UC), +2,00 % (≥ 60 % UC), du 1er avril au 31 décembre 2026, plafond 5 M€ cumulé tous contrats Cardif' WHERE key = 'BNP Paribas Cardif::Lucya Cardif (Assurance Vie)';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Pas de quota UC en gestion libre. Avec bonus : 35 % à 60 % min en UC selon le palier' WHERE key = 'BNP Paribas Cardif::Lucya Cardif (Assurance Vie)';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages illimités et gratuits. Frais de transaction 0,10 % max (plafonnés à 50 €) sur ETF et actions' WHERE key = 'BNP Paribas Cardif::Lucya Cardif (Assurance Vie)';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti à 100 % (net de frais de gestion) sur le Fonds général. Fonds Euro Private Strategies garanti à 97 %' WHERE key = 'BNP Paribas Cardif::Lucya Cardif (Assurance Vie)';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Libre 500 €, programmé 50 €/mois' WHERE key = 'BNP Paribas Cardif::Lucya Cardif (Assurance Vie)';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Lucya/Assurancevie.com (contrat exclusif)' WHERE key = 'BNP Paribas Cardif::Lucya Cardif (Assurance Vie)';
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Espace client Lucya (souscription et gestion 100 % en ligne)' WHERE key = 'BNP Paribas Cardif::Lucya Cardif (Assurance Vie)';

-- BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Jusqu''à +1,80 % net annuel (offre 2026/2027) : versement min 5 000 €, allocation min 40 % en UC jusqu''au 31/12/2026 et 31/12/2027, bonus = 80 % du rendement du fonds euros plafonné à 1,80 %' WHERE key = 'BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = '40 % min en UC pour le bonus (hors bonus, aucune contrainte)' WHERE key = 'BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages gratuits et illimités. Frais de transaction 0,10 % max sur ETF et titres vifs' WHERE key = 'BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion' WHERE key = 'BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 € (1 000 € pour la gestion déléguée Lucya)' WHERE key = 'BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Libre 500 €, programmé 50 €/mois' WHERE key = 'BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Lucya/Assurancevie.com (exclusivité)' WHERE key = 'BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)';
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Espace client en ligne Lucya/Assurancevie.com (souscription 100 % digitale, signature électronique)' WHERE key = 'BNP Paribas Cardif::Lucya Cardif PER (Plan Epargne Retraite)';

-- BNP Paribas Cardif::Multistratégie 3 Capitalisation
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,80 % du montant arbitré (toutes directions)' WHERE key = 'BNP Paribas Cardif::Multistratégie 3 Capitalisation';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti à tout moment (fonds général Cardif Assurance Vie)' WHERE key = 'BNP Paribas Cardif::Multistratégie 3 Capitalisation';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Libre 750 €, programmé 75 €/mois' WHERE key = 'BNP Paribas Cardif::Multistratégie 3 Capitalisation';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Réseau AEP/partenaires Cardif (CGP, courtiers indépendants)' WHERE key = 'BNP Paribas Cardif::Multistratégie 3 Capitalisation';

-- BNP Paribas Cardif::Multistratégie 3 Capitalisation PEA
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion' WHERE key = 'BNP Paribas Cardif::Multistratégie 3 Capitalisation PEA';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '1 500 €' WHERE key = 'BNP Paribas Cardif::Multistratégie 3 Capitalisation PEA';
UPDATE public.investissement_av_contract_terms SET versement_min = '75 €' WHERE key = 'BNP Paribas Cardif::Multistratégie 3 Capitalisation PEA';

-- BNP Paribas Cardif::Triptis Patrimoine
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Minimum 30 % en UC' WHERE key = 'BNP Paribas Cardif::Triptis Patrimoine';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % max sur compartiment classique, 1,75 % max sur compartiment personnalisé (≥ 250 000 €)' WHERE key = 'BNP Paribas Cardif::Triptis Patrimoine';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais sur versements, revalorisation annuelle par participation aux bénéfices' WHERE key = 'BNP Paribas Cardif::Triptis Patrimoine';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '75 000 € (classique), 250 000 € (personnalisé)' WHERE key = 'BNP Paribas Cardif::Triptis Patrimoine';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Versement libre 10 000 €' WHERE key = 'BNP Paribas Cardif::Triptis Patrimoine';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Neuflize OBC/CGP partenaires BNP Paribas Cardif' WHERE key = 'BNP Paribas Cardif::Triptis Patrimoine';

-- BPCE Vie::Fonds des mandats d’arbitrages
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0 % vers UC, 1 % vers fonds euros. Frais de gestion fonds euros selon encours : 0,40 % (≥ 120 000 €) à 0,75 % (< 15 000 €) sur Horizeo 2' WHERE key = 'BPCE Vie::Fonds des mandats d’arbitrages';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '100 € (Horizeo 2), 1 500 € (Quintessa 2)' WHERE key = 'BPCE Vie::Fonds des mandats d’arbitrages';
UPDATE public.investissement_av_contract_terms SET versement_min = '100 €' WHERE key = 'BPCE Vie::Fonds des mandats d’arbitrages';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Banque Populaire/Caisse d''Épargne (réseau BPCE)' WHERE key = 'BPCE Vie::Fonds des mandats d’arbitrages';

-- BPCE Vie::Horizeo 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Taux majoré possible au-delà de 120 000 € (jusqu''à 2,50 % en 2024)' WHERE key = 'BPCE Vie::Horizeo 2';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,50 % du montant arbitré (0 % vers UC selon contrat)' WHERE key = 'BPCE Vie::Horizeo 2';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion' WHERE key = 'BPCE Vie::Horizeo 2';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '100 €' WHERE key = 'BPCE Vie::Horizeo 2';
UPDATE public.investissement_av_contract_terms SET versement_min = '100 €' WHERE key = 'BPCE Vie::Horizeo 2';

-- BPCE Vie::Millevie Avenir Climat
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais' WHERE key = 'BPCE Vie::Millevie Avenir Climat';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '100 €' WHERE key = 'BPCE Vie::Millevie Avenir Climat';
UPDATE public.investissement_av_contract_terms SET versement_min = '100 €' WHERE key = 'BPCE Vie::Millevie Avenir Climat';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Caisse d''Épargne, Crédit Coopératif, Banque BCP (réseau BPCE)' WHERE key = 'BPCE Vie::Millevie Avenir Climat';
UPDATE public.investissement_av_contract_terms SET options_gestion = ARRAY['Sécurisation progressive','Gestion libre'] WHERE key = 'BPCE Vie::Millevie Avenir Climat';
UPDATE public.investissement_av_contract_terms SET univers_classes = ARRAY['Fonds euros','UC labellisées Greenfin/ISR/Finansol'] WHERE key = 'BPCE Vie::Millevie Avenir Climat';

-- BPCE Vie::Millevie Essentielle 2
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % vers fonds euros, 0 % vers UC' WHERE key = 'BPCE Vie::Millevie Essentielle 2';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion' WHERE key = 'BPCE Vie::Millevie Essentielle 2';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 €' WHERE key = 'BPCE Vie::Millevie Essentielle 2';
UPDATE public.investissement_av_contract_terms SET versement_min = '100 €' WHERE key = 'BPCE Vie::Millevie Essentielle 2';

-- BPCE Vie::Millevie Infinie 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonus de taux selon quote-part UC : jusqu''à 4,38 % en 2024' WHERE key = 'BPCE Vie::Millevie Infinie 2';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % par arbitrage, pas d''arbitrage gratuit' WHERE key = 'BPCE Vie::Millevie Infinie 2';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion' WHERE key = 'BPCE Vie::Millevie Infinie 2';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '100 000 €' WHERE key = 'BPCE Vie::Millevie Infinie 2';
UPDATE public.investissement_av_contract_terms SET versement_min = '100 000 €' WHERE key = 'BPCE Vie::Millevie Infinie 2';

-- BPCE Vie::Millevie Initiale 2
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 arbitrage gratuit par an' WHERE key = 'BPCE Vie::Millevie Initiale 2';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais sur fonds euros' WHERE key = 'BPCE Vie::Millevie Initiale 2';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 €' WHERE key = 'BPCE Vie::Millevie Initiale 2';
UPDATE public.investissement_av_contract_terms SET versement_min = '500 €' WHERE key = 'BPCE Vie::Millevie Initiale 2';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Caisse d''Épargne/Crédit Coopératif' WHERE key = 'BPCE Vie::Millevie Initiale 2';

-- BPCE Vie::Millevie PER
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0 % en gestion libre UC vers UC, 1 % vers fonds euros' WHERE key = 'BPCE Vie::Millevie PER';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais' WHERE key = 'BPCE Vie::Millevie PER';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 €' WHERE key = 'BPCE Vie::Millevie PER';
UPDATE public.investissement_av_contract_terms SET versement_min = '30 €' WHERE key = 'BPCE Vie::Millevie PER';

-- BPCE Vie::Millevie Premium 2
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0 % vers UC, 1 % vers fonds euros' WHERE key = 'BPCE Vie::Millevie Premium 2';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais' WHERE key = 'BPCE Vie::Millevie Premium 2';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '15 000 €' WHERE key = 'BPCE Vie::Millevie Premium 2';
UPDATE public.investissement_av_contract_terms SET versement_min = '75 €' WHERE key = 'BPCE Vie::Millevie Premium 2';

-- BPCE Vie::Plan Epargne Avenir Climat
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais (sécurisation progressive)' WHERE key = 'BPCE Vie::Plan Epargne Avenir Climat';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '100 €' WHERE key = 'BPCE Vie::Plan Epargne Avenir Climat';
UPDATE public.investissement_av_contract_terms SET versement_min = '50 €' WHERE key = 'BPCE Vie::Plan Epargne Avenir Climat';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Banques Populaires, Caisses d''Épargne' WHERE key = 'BPCE Vie::Plan Epargne Avenir Climat';

-- BPCE Vie::Plan Epargne Enfant
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion' WHERE key = 'BPCE Vie::Plan Epargne Enfant';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '50 €' WHERE key = 'BPCE Vie::Plan Epargne Enfant';
UPDATE public.investissement_av_contract_terms SET versement_min = '50 €' WHERE key = 'BPCE Vie::Plan Epargne Enfant';

-- BPCE Vie::Plan Epargne Retraite
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 €' WHERE key = 'BPCE Vie::Plan Epargne Retraite';
UPDATE public.investissement_av_contract_terms SET versement_min = '100 €' WHERE key = 'BPCE Vie::Plan Epargne Retraite';

-- BPCE Vie::Quintessa 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '2,50 % en 2025 avec bonus conditionnel' WHERE key = 'BPCE Vie::Quintessa 2';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0 % vers UC, 1 % vers fonds euros' WHERE key = 'BPCE Vie::Quintessa 2';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais' WHERE key = 'BPCE Vie::Quintessa 2';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '1 500 €' WHERE key = 'BPCE Vie::Quintessa 2';
UPDATE public.investissement_av_contract_terms SET versement_min = '1 500 €' WHERE key = 'BPCE Vie::Quintessa 2';

-- CALI Europe::CALIE Life Patrimony 2+ (F)
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages gratuits' WHERE key = 'CALI Europe::CALIE Life Patrimony 2+ (F)';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti' WHERE key = 'CALI Europe::CALIE Life Patrimony 2+ (F)';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '300 000 €' WHERE key = 'CALI Europe::CALIE Life Patrimony 2+ (F)';
UPDATE public.investissement_av_contract_terms SET versement_min = '300 000 €' WHERE key = 'CALI Europe::CALIE Life Patrimony 2+ (F)';
UPDATE public.investissement_av_contract_terms SET options_gestion = ARRAY['Retraits partiels','Investissement progressif','Arbitrage sécurisation (prise de bénéfices vers Euro2)','Garanties décès (plancher, cliquet, pourcentage, montant fixe)'] WHERE key = 'CALI Europe::CALIE Life Patrimony 2+ (F)';

-- Carac::Carac Épargne Patrimoine
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonus 2026 : +1 % à +1,5 % sur versements 2026 (rendement potentiel jusqu''à 5 %)' WHERE key = 'Carac::Carac Épargne Patrimoine';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Aucune contrainte UC depuis 2025 (accès fonds euros 100 %)' WHERE key = 'Carac::Carac Épargne Patrimoine';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % à la demande (12 gratuits/an, min 30 €), arbitrages automatiques gratuits sauf sécurisation plus-values 1 %' WHERE key = 'Carac::Carac Épargne Patrimoine';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais' WHERE key = 'Carac::Carac Épargne Patrimoine';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 €' WHERE key = 'Carac::Carac Épargne Patrimoine';
UPDATE public.investissement_av_contract_terms SET versement_min = '500 €' WHERE key = 'Carac::Carac Épargne Patrimoine';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Carac (mutuelle d''épargne, vente directe)' WHERE key = 'Carac::Carac Épargne Patrimoine';
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Oui' WHERE key = 'Carac::Carac Épargne Patrimoine';

-- Carac::Carac Profiléo
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Taux 2025 : 3,55 % (+ bonus 1 % possible)' WHERE key = 'Carac::Carac Profiléo';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Minimum 25 % en UC, maximum 75 % en fonds euros' WHERE key = 'Carac::Carac Profiléo';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1er arbitrage gratuit par an, puis 1 % (min 30 €)' WHERE key = 'Carac::Carac Profiléo';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion' WHERE key = 'Carac::Carac Profiléo';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '200 €' WHERE key = 'Carac::Carac Profiléo';
UPDATE public.investissement_av_contract_terms SET versement_min = '200 €' WHERE key = 'Carac::Carac Profiléo';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Carac (vente directe)' WHERE key = 'Carac::Carac Profiléo';
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Gestion 100 % en ligne' WHERE key = 'Carac::Carac Profiléo';

-- Cardif Lux Vie::ASTER HORIZON
UPDATE public.investissement_av_contract_terms SET ticket_entree = '250 000 €' WHERE key = 'Cardif Lux Vie::ASTER HORIZON';
UPDATE public.investissement_av_contract_terms SET versement_min = '250 000 €' WHERE key = 'Cardif Lux Vie::ASTER HORIZON';
UPDATE public.investissement_av_contract_terms SET distributeur = 'CGP partenaires BNP Paribas Cardif (réseau exclusif)' WHERE key = 'Cardif Lux Vie::ASTER HORIZON';

-- Cardif Lux Vie::CAP SECURE France
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti brut de frais de gestion' WHERE key = 'Cardif Lux Vie::CAP SECURE France';
UPDATE public.investissement_av_contract_terms SET distributeur = 'CGP indépendants (Laplace, Haussmann Patrimoine, Euodia)' WHERE key = 'Cardif Lux Vie::CAP SECURE France';

-- Cardif Lux Vie::Cardif Elite Lux
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Participation aux bénéfices annuelle (1,97 % en 2025, taux garanti 0,42 %)' WHERE key = 'Cardif Lux Vie::Cardif Elite Lux';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = '50 % min en UC (accès au Fonds général limité à 50 %)' WHERE key = 'Cardif Lux Vie::Cardif Elite Lux';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,50 % du montant arbitré, plafonné à 500 € par opération' WHERE key = 'Cardif Lux Vie::Cardif Elite Lux';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Brute de prélèvements sociaux, nette de frais de gestion' WHERE key = 'Cardif Lux Vie::Cardif Elite Lux';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '250 000 €' WHERE key = 'Cardif Lux Vie::Cardif Elite Lux';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Complémentaire 25 000 €, FID/FAS 10 000 €' WHERE key = 'Cardif Lux Vie::Cardif Elite Lux';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Réseau CGP/partenaires Cardif (BGL BNP Paribas)' WHERE key = 'Cardif Lux Vie::Cardif Elite Lux';
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Gestion en ligne via e-Club Cardif Lux Vie' WHERE key = 'Cardif Lux Vie::Cardif Elite Lux';

-- Cardif Lux Vie::CARDIF PRIVATE INSURANCE ITALIA
UPDATE public.investissement_av_contract_terms SET distributeur = 'Réseau BNP Paribas Italie/partenaires CGP italiens' WHERE key = 'Cardif Lux Vie::CARDIF PRIVATE INSURANCE ITALIA';

-- Cardif Lux Vie::OPTILIFE² FRANCE
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti brut, hors prélèvements sociaux' WHERE key = 'Cardif Lux Vie::OPTILIFE² FRANCE';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '250 000 €' WHERE key = 'Cardif Lux Vie::OPTILIFE² FRANCE';
UPDATE public.investissement_av_contract_terms SET versement_min = '250 000 €' WHERE key = 'Cardif Lux Vie::OPTILIFE² FRANCE';
UPDATE public.investissement_av_contract_terms SET distributeur = 'BGL BNP Paribas (Luxembourg)' WHERE key = 'Cardif Lux Vie::OPTILIFE² FRANCE';

-- Cardif Lux Vie::OPTISAVE+
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,5 % plafonné à 800 €' WHERE key = 'Cardif Lux Vie::OPTISAVE+';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti' WHERE key = 'Cardif Lux Vie::OPTISAVE+';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '250 000 €' WHERE key = 'Cardif Lux Vie::OPTISAVE+';
UPDATE public.investissement_av_contract_terms SET versement_min = '50 €' WHERE key = 'Cardif Lux Vie::OPTISAVE+';
UPDATE public.investissement_av_contract_terms SET distributeur = 'CGP/réseaux partenaires BNP Paribas Cardif Luxembourg' WHERE key = 'Cardif Lux Vie::OPTISAVE+';

-- Cardif Lux Vie::PERSPECTIVE RMM VIE
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti' WHERE key = 'Cardif Lux Vie::PERSPECTIVE RMM VIE';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '250 000 €' WHERE key = 'Cardif Lux Vie::PERSPECTIVE RMM VIE';
UPDATE public.investissement_av_contract_terms SET versement_min = '250 000 €' WHERE key = 'Cardif Lux Vie::PERSPECTIVE RMM VIE';
UPDATE public.investissement_av_contract_terms SET distributeur = 'CGP/banque privée' WHERE key = 'Cardif Lux Vie::PERSPECTIVE RMM VIE';

-- CNP Assurances::EasyVie
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages gratuits et illimités (hors options automatiques). Frais de gestion UC dégressifs : 0,85 % (< 200 000 €), 0,75 % (200-500 000 €), 0,65 % (> 500 000 €). Frais de gestion fonds euros : 0,75 %/0,70 %/0,60 %' WHERE key = 'CNP Assurances::EasyVie';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais' WHERE key = 'CNP Assurances::EasyVie';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '1 000 €' WHERE key = 'CNP Assurances::EasyVie';
UPDATE public.investissement_av_contract_terms SET versement_min = '50 €' WHERE key = 'CNP Assurances::EasyVie';
UPDATE public.investissement_av_contract_terms SET distributeur = 'EasyBourse (filiale La Banque Postale)' WHERE key = 'CNP Assurances::EasyVie';

-- CNP Assurances::Lucya CNP
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '+2,20 % net si ≥ 40 % UC, +2,70 % net si ≥ 60 % UC, versements ≥ 5 000 € du 02/04 au 31/08/2026' WHERE key = 'CNP Assurances::Lucya CNP';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = '40 % UC min pour +2,20 %, 60 % UC min pour +2,70 %' WHERE key = 'CNP Assurances::Lucya CNP';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Gratuit (0 %) à l''initiative du souscripteur, options automatiques incluses' WHERE key = 'CNP Assurances::Lucya CNP';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti à 100 % (net de frais de gestion)' WHERE key = 'CNP Assurances::Lucya CNP';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 €' WHERE key = 'CNP Assurances::Lucya CNP';
UPDATE public.investissement_av_contract_terms SET versement_min = 'Libre 500 €, programmé 50 €/mois' WHERE key = 'CNP Assurances::Lucya CNP';
UPDATE public.investissement_av_contract_terms SET distributeur = 'Lucya (anciennement Assurancevie.com)' WHERE key = 'CNP Assurances::Lucya CNP';
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Souscription et gestion 100 % en ligne via espace client Lucya' WHERE key = 'CNP Assurances::Lucya CNP';

-- CNP Assurances::Nuances 3D
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Taux boosté selon part UC : 2,46 % (30 % UC), 2,67 % (40 % UC), 2,87 % (50 %+ UC), max 4,67 % en campagne versement unique' WHERE key = 'CNP Assurances::Nuances 3D';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Minimum 30 % en UC pour le bonus de taux' WHERE key = 'CNP Assurances::Nuances 3D';
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,80 % du montant arbitré' WHERE key = 'CNP Assurances::Nuances 3D';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion' WHERE key = 'CNP Assurances::Nuances 3D';
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 €' WHERE key = 'CNP Assurances::Nuances 3D';
UPDATE public.investissement_av_contract_terms SET versement_min = '30 €' WHERE key = 'CNP Assurances::Nuances 3D';

-- CNP Assurances::Nuances Capi
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Taux garanti 0,05 % + participation aux bénéfices' WHERE key = 'CNP Assurances::Nuances Capi';

-- --- part_03.sql ---
-- Réécriture propre des libellés fiche CGP — investissement_av_contract_terms
-- Rows 121-160 (OFFSET 120 LIMIT 40). Aucun UPDATE appliqué en base.

-- CNP Assurances::Nuances Plus
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Assur Euro', fonds_euros_bonus = 'Jusqu''à 4,74 % avec bonus selon la part UC (ex. 2,94 % à 50 % UC)', fonds_euros_contrainte_uc = 'Bonus selon la proportion UC', frais_arbitrage_note = '1 arbitrage gratuit par an, puis 0,80 % par arbitrage', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '25 000 €', versement_min = '5 000 €', distributeur = 'Caisse d''Épargne', options_gestion = ARRAY['Dimension Liberté (gestion libre)','Dimension Horizon (gestion pilotée par profil)','Dimension Garantie (protection du capital hybride)'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'CNP Assurances::Nuances Plus';

-- CNP Assurances::Nuances Privilège
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros CNP Nuances Privilège', fonds_euros_bonus = '2,76 % à 30 % UC, 2,99 % à 40 % UC, 3,22 % à 50 % UC (max 5,02 %)', fonds_euros_contrainte_uc = 'Bonus activé dès 30 % UC', frais_arbitrage_note = '1 arbitrage gratuit par an, puis gratuit en ligne', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '150 000 €', versement_min = '150 000 €', distributeur = 'Caisse d''Épargne', options_gestion = ARRAY['Gestion libre','Gestion sous mandat Prudent','Gestion sous mandat Équilibré','Gestion sous mandat Vitalité','Gestion sous mandat Audacieux'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'CNP Assurances::Nuances Privilège';

-- CNP Luxembourg::ASTER ONE LUX
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros CNP Luxembourg (réassuré CNP Assurances)', frais_arbitrage_note = '40 € par arbitrage', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 000 €', versement_min = '500 000 €', distributeur = 'CNP Luxembourg (CGP partenaires)', options_gestion = ARRAY['Gestion libre','Gestion conseillée (FAS)','Mandat de gestion (FID)','Mandat de gestion (FIC)'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Private equity','Produits structurés','FID','FIC','FAS'] WHERE key = 'CNP Luxembourg::ASTER ONE LUX';

-- CNP Luxembourg::ASTER ONE LUX CAPI
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros à capital garanti (réassuré CNP Assurances)', frais_arbitrage_note = '1er arbitrage gratuit par an, puis 1 % (max 100 €)', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '500 000 €', versement_min = '10 000 €', distributeur = 'CGP partenaires CNP Luxembourg (co-branding ASTER)', options_gestion = ARRAY['Gestion libre','Gestion conseillée (FAS)','Gestion sous mandat (FID)','Gestion sous mandat (FIC)'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Private equity','FID','FAS','FIC'] WHERE key = 'CNP Luxembourg::ASTER ONE LUX CAPI';

-- CNP Luxembourg::CNP ALYSES LUX VIE
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'CNP Alysés Euro Lux', frais_arbitrage_note = '3 arbitrages gratuits par an, puis 1 % au-delà', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '125 000 €', versement_min = '125 000 €', distributeur = 'CGP (réseau CNP Alysés)', options_gestion = ARRAY['Stop-loss relatif','Stop-loss absolu','Prise de bénéfices','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','Produits structurés','Private equity'] WHERE key = 'CNP Luxembourg::CNP ALYSES LUX VIE';

-- CNP Luxembourg::CNP Alysés Lux Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'CNP Alysés Euro Lux (variante CNP Alysés Euro Lux LibRT3G pour la formule Lib''RT 3G)', fonds_euros_bonus = 'Formule Lib''RT 3G : le support CNP Alysés Euro Lux LibRT3G sert 80 % à 110 % du taux de participation aux bénéfices de référence, selon le taux moyen annuel d''UC constaté au 31/12', fonds_euros_contrainte_uc = 'Bonus conditionné à un taux minimum d''UC (formule Lib''RT 3G), rendement croissant avec la part UC', garantie_fonds_euros = 'Capital garanti au moins égal aux versements nets de frais, réassuré par CNP Assurances', ticket_entree = '125 000 €', distributeur = 'CGP indépendants (plateforme CNP Alysés)', service_extranet = 'Plateforme CNP Alysés (espace partenaire CGP)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat (pilotée / personnalisée)','Formule Lib''RT 3G (fonds euros bonifié)'], univers_classes = ARRAY['Fonds euros','Fonds externes','Titres vifs'] WHERE key = 'CNP Luxembourg::CNP Alysés Lux Vie';

-- CNP Luxembourg::CNP ONE LUX
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros CNP Luxembourg', fonds_euros_contrainte_uc = 'Accès au fonds euros plafonné à 50 % du contrat', frais_arbitrage_note = '40 € par arbitrage (forfait), 1 arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion, réassuré 100 % CNP Assurances', ticket_entree = '500 000 €', versement_min = '10 000 €', distributeur = 'CGP indépendants et cabinets de gestion de patrimoine', options_gestion = ARRAY['Gestion libre','Gestion conseillée (FAS)','Gestion sous mandat (FID)','Gestion collective (FIC)'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Private equity','Private debt','Immobilier','Titres vifs','FID','FIC','FAS'] WHERE key = 'CNP Luxembourg::CNP ONE LUX';

-- Garance::Activ' Retraite
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Activ'' Retraite', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '0 €', versement_min = '0 €', distributeur = 'Garance (vente directe)', service_extranet = 'Capital garanti', options_gestion = ARRAY['Gestion pilotée','Gestion libre'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Garance::Activ'' Retraite';

-- Garance::Celebea Retraite
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Garance Celebea Retraite', fonds_euros_contrainte_uc = '30 % UC minimum', frais_arbitrage_note = 'Arbitrages gratuits, sans restriction', garantie_fonds_euros = 'Capital garanti net de frais d''entrée et de rachats partiels', ticket_entree = '100 €', versement_min = '20 €', distributeur = 'Garance (CGP et courtiers partenaires)', options_gestion = ARRAY['Gestion libre','Gestion profilée'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','SCI','FCPR','Produits structurés'] WHERE key = 'Garance::Celebea Retraite';

-- Garance::Celebea Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Garance', fonds_euros_contrainte_uc = '30 % UC minimum', frais_arbitrage_note = '1 arbitrage offert par année civile, puis 0,50 % du montant arbitré', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '450 €', versement_min = '150 €', distributeur = 'Garance (distribution directe)', options_gestion = ARRAY['Gestion libre','Gestion pilotée Garance Smart Life (5 profils, 3 orientations : Active, Passive, ESG)'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','ISR'] WHERE key = 'Garance::Celebea Vie';

-- Garance::Garance Épargne
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Garance Épargne (fonds euros)', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '50 €', versement_min = '20 €', distributeur = 'Garance (direct, en ligne ou sur rendez-vous)', options_gestion = ARRAY['Gestion pilotée','Gestion libre','Orientation ESG','Orientation passive','Orientation active','Gestion par horizon'], univers_classes = ARRAY['Fonds euros','OPCVM','OPCI'] WHERE key = 'Garance::Garance Épargne';

-- Garance::Garance Vivacité
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Garance Vivacité', fonds_euros_contrainte_uc = '30 % UC minimum pour le taux boosté', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '50 €', versement_min = '20 €', distributeur = 'Garance (vente directe en ligne)', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF'] WHERE key = 'Garance::Garance Vivacité';

-- Generali Luxembourg::Generali Luxembourg Univers Global
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Général de Generali Luxembourg', fonds_euros_bonus = '+1,10 % sur 2026 et 2027 pour nouveau versement avec min 60 % UC', fonds_euros_contrainte_uc = 'Bonus conditionné à min 60 % UC, accès au fonds euros conditionné à min 50 % UC', frais_arbitrage_note = '0,50 % max par arbitrage (1 gratuit par an, puis plafonné à 125 €)', garantie_fonds_euros = 'Capital garanti, effet cliquet annuel, net de frais de gestion', ticket_entree = '250 000 € (via Altaprofits), 500 000 € hors distributeur', versement_min = '20 000 € en complémentaire, 10 000 € min par support', distributeur = 'Altaprofits (principal en ligne), via CGP/CGPI', service_extranet = 'Espace client en ligne (espaceclient.generali.lu)', options_gestion = ARRAY['Gestion libre','Gestion déléguée (FID)','Fonds d''Assurance Spécialisé (FAS)','Fonds Internes Collectifs (FIC)'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','Private equity','Produits structurés'] WHERE key = 'Generali Luxembourg::Generali Luxembourg Univers Global';

-- Generali Vie::e-Xaélidia
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Generali Vie (AGGV)', fonds_euros_bonus = 'Bonus conditionnel sur AGGV : 2,09 % dès 30 % UC, 2,66 % dès 40 % UC, 3,23 % dès 50 % UC, 3,40 % dès 60 % UC. Euro Innovalia (2,25 %) accessible dès 40 % UC', fonds_euros_contrainte_uc = 'AGGV accessible sans contrainte UC (taux de base 1,90 %), bonus dès 30 % UC. Euro Innovalia : 40 % UC min. Elixence : 50 % UC min', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '3 000 €', versement_min = '75 € / mois (versements programmés)', distributeur = 'Generali Patrimoine (réseau CGP/CGPI)', service_extranet = 'Espace client en ligne (monespace.generali.fr) : consultation, virements, arbitrages, rachats partiels, alertes', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','SCPI','ETF'] WHERE key = 'Generali Vie::e-Xaélidia';

-- Generali Vie::Himalia
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Generali Vie, Elixence, Euro Innovalia', fonds_euros_bonus = 'Actif Général 1,90 % à 3,40 % selon la quote-part UC, Elixence 2,50 % (min 50 % UC)', fonds_euros_contrainte_uc = 'Elixence 50 % UC min, Euro Innovalia 40 % UC min, Actif Général plancher 1,90 % sans contrainte', frais_arbitrage_note = '1 % du montant arbitré, min 15 € en ligne / 30 € par courrier, 1er arbitrage annuel gratuit', garantie_fonds_euros = 'Nette de frais de gestion, brute de prélèvements sociaux', ticket_entree = '5 000 € (réduit à 1 000 € avec versements programmés)', versement_min = '2 000 € en versement libre, 75 € / mois programmé', distributeur = 'Generali Patrimoine (réseau CGP)', service_extranet = 'Gestion et arbitrages en ligne (espace Generali Patrimoine)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Dynamisation des plus-values','Limitation des pertes','Investissement progressif','Transferts programmés'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Titres vifs'] WHERE key = 'Generali Vie::Himalia';

-- Generali Vie::meilleurtaux Allocation Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Netissima', fonds_euros_bonus = '+1,50 % net de frais pour versements jusqu''au 31/12/2026, visant 4,50 % en 2026 et 2027', fonds_euros_contrainte_uc = '30 % UC minimum à l''investissement et au 31/12/2026 et 2027 pour le bonus', frais_arbitrage_note = 'Arbitrages à la demande gratuits. Options automatiques (sécurisation, stop-loss) : 0,50 % de la somme transférée', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '300 € en complémentaire, 50 € / mois programmé', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client Meilleurtaux Placement (app.placement.meilleurtaux.com)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Mandat d''arbitrage','Sécurisation des plus-values','Stop-loss','Investissement progressif'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés'] WHERE key = 'Generali Vie::meilleurtaux Allocation Vie';

-- Generali Vie::MonFinancier Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Netissima', fonds_euros_bonus = '+1,50 % pour les versements jusqu''au 31/12/2026 avec ≥ 30 % en UC, applicable aux PB 2026 et 2027 (cible ~4,50 % net de frais de gestion)', fonds_euros_contrainte_uc = '30 % minimum en UC non garanties en capital par versement pour accéder à Netissima', frais_arbitrage_note = 'Arbitrages libres gratuits. Options automatiques (sécurisation des plus-values, limitation des pertes) : 0,50 % du montant transféré', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '450 € en complémentaire, 75 € / mois programmé', distributeur = 'MonFinancier.com (désormais Meilleurtaux Placement)', service_extranet = 'sylvea.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Generali Vie::MonFinancier Vie';

-- GMF Vie::Multéo
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général GMF', fonds_euros_bonus = '2,70 % avec ≥ 20 % UC, 2,90 % avec ≥ 40 % UC (base 2,50 % en 2025)', fonds_euros_contrainte_uc = 'Pas de contrainte UC pour l''accès au fonds euros', frais_arbitrage_note = '1 % du montant, minimum 20 €, 1 arbitrage offert par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'GMF (vente directe, réseau agents)', service_extranet = 'Espace client GMF en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée (4 profils : Sécurité, Équilibre, Dynamique, Offensif)'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'GMF Vie::Multéo';

-- Groupama Gan Vie::Chromatys
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Chromatys', fonds_euros_bonus = 'Jusqu''à 4 % avec bonus si > 30 % UC en gestion déléguée', fonds_euros_contrainte_uc = 'Taux de base 2 %, taux majoré 2,80 % si part UC > 30 %', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 €', versement_min = '300 € (ou 30 € / mois programmé)', distributeur = 'Gan Assurances (réseau agents)', options_gestion = ARRAY['Sérénité','Modérée','Équilibrée','Équilibrée Durable','Dynamique','Offensive'], univers_classes = ARRAY['Fonds euros','OPCVM','OPCI'] WHERE key = 'Groupama Gan Vie::Chromatys';

-- Groupama Gan Vie::Chromatys Evolution
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Groupama Gan Vie', fonds_euros_bonus = 'Jusqu''à 4 % avec bonus en gestion déléguée. Taux de base 2,39 % en 2025, 2,80 % si UC > 30 %', fonds_euros_contrainte_uc = 'Taux majoré si UC > 30 %', frais_arbitrage_note = 'Arbitrage gratuit', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 €', versement_min = '300 € (ou 30 € / mois programmé)', distributeur = 'Gan Assurances (réseau agences)', options_gestion = ARRAY['Gestion libre','Gestion déléguée (6 profils : Sérénité, Modérée, Équilibrée, Équilibrée Durable, Dynamique, Offensive)','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','OPCVM','OPCI'] WHERE key = 'Groupama Gan Vie::Chromatys Evolution';

-- Groupama Gan Vie::Gan Capitalisation Exception
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Groupama Gan Vie', fonds_euros_bonus = '+2 % de bonus en gestion déléguée (max 4 % en 2025), taux libre ≥ 30 % UC = 2,80 %', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Gan Assurances (réseau agents)', options_gestion = ARRAY['Gestion libre','Gestion déléguée Sérénité','Gestion déléguée Équilibre','Gestion déléguée Dynamique','Gestion déléguée Modérée','Gestion déléguée durable','Gestion déléguée thématique'], univers_classes = ARRAY['Fonds euros','OPCVM','Unités de compte'] WHERE key = 'Groupama Gan Vie::Gan Capitalisation Exception';

-- Groupama Gan Vie::Gan Nouvelle Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Groupama Gan Vie', fonds_euros_bonus = 'Jusqu''à 3,50 % en gestion déléguée, 2,80 % si UC ≥ 30 % en gestion libre', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 €', versement_min = '30 €', distributeur = 'Gan Assurances (agents), Gan Patrimoine (conseillers)', options_gestion = ARRAY['Gestion libre','Gestion déléguée','Rachat partiel programmé'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','ETF'] WHERE key = 'Groupama Gan Vie::Gan Nouvelle Vie';

-- Groupama Gan Vie::Gan Patrimoine Capitalisation
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros Gan Patrimoine Capitalisation', fonds_euros_bonus = '3,50 % avec bonus en gestion déléguée (2024), offre 4 % avec bonus +2 % sur nouveaux versements janvier-avril 2025', frais_arbitrage_note = '1 arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '10 000 €', versement_min = '1 500 €', distributeur = 'Gan Patrimoine (réseau CGP)', service_extranet = 'Capital garanti', options_gestion = ARRAY['Gestion déléguée','Profils'], univers_classes = ARRAY['Fonds euros','OPCVM','Multigestion'] WHERE key = 'Groupama Gan Vie::Gan Patrimoine Capitalisation';

-- Groupama Gan Vie::Gan Patrimoine Evolution
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Gan Patrimoine Evolution', fonds_euros_bonus = '+1,50 % en gestion déléguée (taux total 3,50 %)', fonds_euros_contrainte_uc = 'Max 20 % fonds euros en gestion 100 % fonds euros', frais_arbitrage_note = '1 arbitrage gratuit par an, puis 1 % du montant arbitré (max 500 €)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '300 €', versement_min = '30 € (versements programmés)', distributeur = 'Gan Patrimoine (réseau agents Groupama Gan Vie)', service_extranet = 'ganpatrimoine.fr', options_gestion = ARRAY['Sécurisation des plus-values','Investissement progressif','Limitation des pertes','Rachat partiel programmé','Versements programmés','Garantie plancher décès'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Groupama Gan Vie::Gan Patrimoine Evolution';

-- Groupama Gan Vie::Gan Patrimoine Objectif Retraite
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Gan Objectif Retraite', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 €', versement_min = '50 €', distributeur = 'Gan Patrimoine (réseau agents)', options_gestion = ARRAY['Gestion libre','Gestion pilotée prudente','Gestion pilotée équilibrée','Gestion pilotée dynamique','Gestion à horizon'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Groupama Gan Vie::Gan Patrimoine Objectif Retraite';

-- Groupama Gan Vie::Gan Patrimoine Stratégies
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Gan Patrimoine Stratégies', fonds_euros_bonus = '+1,50 % en gestion déléguée (taux total 3,50 % en 2024), +0,80 % si UC > 30 % en gestion libre', fonds_euros_contrainte_uc = 'Bonus conditionné à une part UC', frais_arbitrage_note = '1 arbitrage offert par an, puis 1 % du montant arbitré', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '5 000 €', versement_min = '5 000 €', distributeur = 'Gan Patrimoine', options_gestion = ARRAY['Sécurisation des plus-values','Investissement progressif','Rachat partiel programmé','Rente dépendance','Garantie plancher décès'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Groupama Gan Vie::Gan Patrimoine Stratégies';

-- Groupama Gan Vie::Gan Patrimoine Stratégies Vie
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1er arbitrage gratuit par an, puis 1 % (minimum 450 €)', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '5 000 €', versement_min = '150 €', distributeur = 'Gan Patrimoine (réseau CGP Groupama)', options_gestion = ARRAY['Sécurisation des plus-values','Rente dépendance','Garantie plancher décès','Rachat partiel programmé','Investissement progressif','6 profils de gestion (Sérénité à Offensive)'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Groupama Gan Vie::Gan Patrimoine Stratégies Vie';

-- Groupama Gan Vie::Gan Performance Retraite
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais', distributeur = 'Gan (réseau agences)', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Groupama Gan Vie::Gan Performance Retraite';

-- Groupama Gan Vie::Gan Prévoyance Perspectives Epargne
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Jusqu''à 3,50 % en gestion déléguée, 2,80 % si UC ≥ 30 %', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '200 €', versement_min = '50 €', distributeur = 'Gan Prévoyance (réseau agents)', options_gestion = ARRAY['Gestion libre','Gestion déléguée 10 profils dont 5 durables'], univers_classes = ARRAY['Fonds euros','OPCVM actions','OPCVM obligations','Diversifiés'] WHERE key = 'Groupama Gan Vie::Gan Prévoyance Perspectives Epargne';

-- Groupama Gan Vie::Groupama Capitalisation
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Groupama Capitalisation', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Groupama Gan Vie (réseau agents Groupama)', options_gestion = ARRAY['Gestion libre','Gestion déléguée Tranquillité','Gestion déléguée Sérénité','Gestion déléguée Modéré','Gestion déléguée Équilibré','Gestion déléguée Dynamique','Gestion déléguée Offensif'], univers_classes = ARRAY['Fonds euros','OPCVM','Produits structurés','SCPI'] WHERE key = 'Groupama Gan Vie::Groupama Capitalisation';

-- Groupama Gan Vie::Groupama Modulation
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Groupama Euros', fonds_euros_bonus = '2,80 % si ≥ 30 % UC, 3,50 % en gestion pilotée', fonds_euros_contrainte_uc = '≥ 30 % UC pour le bonus 2,80 %, gestion pilotée pour 3,50 %', frais_arbitrage_note = 'Arbitrages gratuits illimités', garantie_fonds_euros = 'Capital garanti à 100 %', ticket_entree = '300 €', versement_min = '150 €', distributeur = 'Groupama (réseau agents)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion profilée'], univers_classes = ARRAY['Fonds euros','OPCVM','OPCI','FCPR'] WHERE key = 'Groupama Gan Vie::Groupama Modulation';

-- Groupama Gan Vie::Groupama Nouvelle Vie
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % du montant arbitré, 1er arbitrage parfois gratuit', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '300 €', versement_min = '30 €', distributeur = 'Ma Nouvelle Vie (Groupama Gan Vie)', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM','OPCI'] WHERE key = 'Groupama Gan Vie::Groupama Nouvelle Vie';

-- Groupama Gan Vie::Groupama Premium
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Groupama Euros', fonds_euros_bonus = 'Jusqu''à 3,50 % en gestion libre si > 30 % UC, jusqu''à 4 % en gestion déléguée avec bonus PB', fonds_euros_contrainte_uc = 'Taux bonifié à 2,80 % si part UC > 30 %', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti net de frais, effet cliquet', ticket_entree = '75 000 €', versement_min = '75 000 €', distributeur = 'Groupama (réseau agences)', options_gestion = ARRAY['Gestion libre','Gestion déléguée / pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM','OPCI'] WHERE key = 'Groupama Gan Vie::Groupama Premium';

-- La Banque Postale Life::Compte Libre Croissance LBP
UPDATE public.investissement_av_contract_terms SET distributeur = 'La Banque Postale', univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'La Banque Postale Life::Compte Libre Croissance LBP';

-- La France Mutualiste::Actépargne2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Actépargne2', frais_arbitrage_note = '4 arbitrages gratuits par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '300 €', versement_min = '300 €', distributeur = 'La France Mutualiste (vente directe)', options_gestion = ARRAY['Gestion libre','Gestion profilée (5 profils)','Écrêtage des plus-values','Lissage des investissements','Dynamisation de l''épargne'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'La France Mutualiste::Actépargne2';

-- La France Mutualiste::Meilleurtaux Essentiel Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros La France Mutualiste', fonds_euros_bonus = '+1,50 % en 2026 et 2027 avec min 30 % UC et min 15 000 € investis', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '300 €', versement_min = '150 €', distributeur = 'Meilleurtaux Placement', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Fonds horizon'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','EMTN','FCPR','Produits structurés'] WHERE key = 'La France Mutualiste::Meilleurtaux Essentiel Vie';

-- Le Conservateur::Conservateur Épargne Retraite
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Le Conservateur Retraite', fonds_euros_contrainte_uc = 'Taux conditionnel selon la part UC : base 1,10 % + bonus (50 % UC → 3,50 %, 60 % → 3,75 %, 70 % → 4 %) et bonus d''encours si ≥ 150 000 € (max 4,25 % en 2025)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '100 €', versement_min = '100 €', distributeur = 'Le Conservateur (vente directe)', options_gestion = ARRAY['Gestion libre','Gestion pilotée prudent','Gestion pilotée équilibré','Gestion pilotée dynamique'], univers_classes = ARRAY['Fonds euros','OPCVM','Obligations'] WHERE key = 'Le Conservateur::Conservateur Épargne Retraite';

-- Le Conservateur::Conservateur Hélios Patrimoine
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Hélios Patrimoine', fonds_euros_bonus = 'Jusqu''à 4,25 % selon la part UC (seuil 150 000 €) : base 1,10 % + bonification progressive selon part UC et encours', frais_arbitrage_note = '1er arbitrage gratuit par an, puis 1,50 % du montant arbitré', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Le Conservateur', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Le Conservateur::Conservateur Hélios Patrimoine';

-- Le Conservateur::Conservateur Privilège
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Le Conservateur', fonds_euros_bonus = 'Jusqu''à 4,25 % selon la part UC et l''encours (bonus progressif)', garantie_fonds_euros = 'Capital garanti', distributeur = 'Le Conservateur (réseau direct mutualiste)', univers_classes = ARRAY['Fonds euros','Actions','Obligations','Fonds mixtes','Fonds monétaires'] WHERE key = 'Le Conservateur::Conservateur Privilège';

-- Linxea::Linxea Avenir 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2 / Suravenir Opportunités 2', fonds_euros_bonus = 'Objectif 4,50 % net en 2026 et 2027 sur Suravenir Opportunités 2, avec bonus +1,50 % conditionné à ≥ 50 % du versement en UC (gestion libre ou pilotée)', fonds_euros_contrainte_uc = 'Suravenir Opportunités 2 : accès conditionné à ≥ 50 % du versement en UC. Suravenir Rendement 2 : pas de contrainte UC (2,10 % net 2025, garanti à 99,4 %)', frais_arbitrage_note = 'Arbitrages gratuits en gestion libre. Frais de transaction de 0,10 % à l''achat et à la vente sur ETF/trackers', garantie_fonds_euros = 'Suravenir Opportunités 2 : capital garanti à 97 % (net de frais de gestion). Suravenir Rendement 2 : capital garanti à 99,4 %', ticket_entree = '100 €', versement_min = '25 € / mois (programmés), 100 € (versements libres)', distributeur = 'Linxea (courtier en ligne)', service_extranet = 'Espace client Linxea (arbitrages, versements, rachats en ligne)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Linxea::Linxea Avenir 2';

-- --- part_04.sql ---
-- Réécriture éditoriale — investissement_av_contract_terms — OFFSET 160 LIMIT 40
-- Aucun UPDATE appliqué en base (fichier de préparation uniquement).

-- Linxea::Linxea Avenir Capitalisation 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Rendement 2 : max 70 % du contrat (30 % UC obligatoire). Opportunités 2 : accessible à 100 %', frais_arbitrage_note = '0 % en ligne (hors SCPI, SCI, ETF), 0,1 % sur ETF', garantie_fonds_euros = 'Capital garanti net de frais de gestion (Rendement 2 : 99,4 %, Opportunités 2 : 97 %)', ticket_entree = '300 000 €', versement_min = '25 €' WHERE key = 'Linxea::Linxea Avenir Capitalisation 2';

-- Linxea::Linxea PER
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0 % en ligne (hors SCPI, SCI, ETF, FCPR). 1 arbitrage gratuit/an vers fonds euros, puis 15 € + 0,10 %', garantie_fonds_euros = 'Capital garanti à tout moment par l''assureur (Apicil Épargne Retraite)', ticket_entree = '1 000 €', versement_min = '150 €' WHERE key = 'Linxea::Linxea PER';

-- Linxea::Linxea Spirit 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération (Spirica), Fonds Euro Objectif Climat (Spirica, Article 9 SFDR)', fonds_euros_bonus = '+1,50 % net (ou +1,10 % si UC < 30 %) en 2026 et 2027 sur le Fonds Euro Nouvelle Génération, sous condition de versement ≥ 100 000 € entre le 08/01/2026 et le 31/12/2026', fonds_euros_contrainte_uc = 'Aucune contrainte pour accéder au fonds euros (jusqu''à 100 %, plafond 5 M€). Bonus soumis à 30 % minimum en UC', frais_arbitrage_note = 'Gratuits en ligne. Papier : 15 € (2 gratuits/an)', garantie_fonds_euros = 'Capital garanti à 98 % annuellement (effet cliquet), net des frais de gestion de 2 %. TMG 2026 : 0 %', ticket_entree = '500 €', versement_min = '100 € (versements libres), 100 €/mois (versements programmés)', distributeur = 'Linxea (courtier en ligne direct)', service_extranet = 'Espace client en ligne linxea.com (arbitrages, rachats, versements, suivi)' WHERE key = 'Linxea::Linxea Spirit 2';

-- Linxea::Linxea Suravenir PER
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Retraite (actif général Suravenir)', fonds_euros_contrainte_uc = 'Aucune contrainte UC (100 % fonds euros possible)', frais_arbitrage_note = 'Gratuit en ligne (0 % sur tous les arbitrages en ligne)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 € (ou 50 € en cas de transfert entrant)', versement_min = '100 €/mois programmé, 1 000 € en versements libres', service_extranet = 'Souscription et gestion en ligne sur espaceclient.linxea.com' WHERE key = 'Linxea::Linxea Suravenir PER';

-- Linxea::Linxea Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '+1,50 % net en 2026 et 2027 si au moins 30 % en UC (en 2024, +0,50 % si ≥ 50 % en UC)', fonds_euros_contrainte_uc = 'Accessible à 100 % sans contrainte jusqu''au 31/12/2026. Hors offre promotionnelle, bonus déclenché à partir de 30 % à 50 % en UC selon barème', frais_arbitrage_note = 'Gratuit en ligne (0 %). Automatique ou hors ligne : 0,50 % max', garantie_fonds_euros = 'Capital garanti à 99,25 % avec effet cliquet (intérêts définitivement acquis chaque année). Eurossima : garantie 100 %', ticket_entree = '300 €', versement_min = '300 € (libre), 50 €/mois (programmé)', distributeur = 'Linxea (courtier en ligne)', service_extranet = 'Espace client Linxea en ligne (rachat en 72 h, arbitrage en ligne)' WHERE key = 'Linxea::Linxea Vie';

-- Linxea::Linxea Zen
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Apicil Euro Garanti, EuroFlex', frais_arbitrage_note = '0 % en ligne, 0,15 % sur transactions ETF. Gestion pilotée OTEA : +0,2 %/an', garantie_fonds_euros = 'Capital garanti à 99,4 % net de frais (Euro Garanti), 98,4 % (EuroFlex)', ticket_entree = '500 €', versement_min = '50 €', service_extranet = 'linxea.com', options_gestion = ARRAY['Gestion libre','Gestion pilotée OTEA Capital (Défensif, Équilibré, Dynamique, Agressif)'] WHERE key = 'Linxea::Linxea Zen';

-- MAAF Vie::PER Winalto Retraite
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '2,90 % avec 20 % UC, 3,10 % avec 40 % UC (2024)', fonds_euros_contrainte_uc = 'Bonus conditionné à la détention d''UC (20 % ou 40 %)', frais_arbitrage_note = '1 arbitrage gratuit/an, puis 0,50 %. 3 % sur arrérages', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '300 €', versement_min = '300 €', distributeur = 'MAAF (réseau agences)', options_gestion = ARRAY['Gestion libre','Gestion profilée','Gestion à horizon (4 profils)'] WHERE key = 'MAAF Vie::PER Winalto Retraite';

-- MAAF Vie::Winalto
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros MAAF Vie Winalto', fonds_euros_bonus = '2024 : 2,90 % avec 20 % UC, 3,10 % avec 40 % UC. 2025 : 2,50 % base, 2,70 % avec 20 % UC, 2,90 % avec 40 % UC', fonds_euros_contrainte_uc = 'Bonus conditionnel selon part UC', frais_arbitrage_note = '0,50 % (min 15 €, max 150 €). 1er arbitrage annuel gratuit, arbitrages automatiques gratuits', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 €', versement_min = '50 €/mois en versements programmés', distributeur = 'MAAF (réseau agences et en ligne)', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Rééquilibrage automatique annuel gratuit','Dynamisation des intérêts du fonds euros','Allocation constante'] WHERE key = 'MAAF Vie::Winalto';

-- MAAF Vie::Winalto Pro
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros Winalto', fonds_euros_bonus = 'Jusqu''à +0,40 % selon allocation UC (2,90 % avec 20 % UC, 3,10 % avec 40 % UC)', fonds_euros_contrainte_uc = 'Bonus conditionnel selon part UC, taux de base sans condition', frais_arbitrage_note = '0,50 % du montant arbitré (min 15 €)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '300 €', versement_min = '300 €', distributeur = 'MAAF (réseau agences)', service_extranet = 'Espace client maaf.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion profilée','Gestion à horizon','Rééquilibrage automatique','Dynamisation des intérêts','Sécurisation des plus-values','Allocation constante'] WHERE key = 'MAAF Vie::Winalto Pro';

-- Macif Vie::Macif Épargne Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euros Macif Épargne Vie', fonds_euros_bonus = '+0,20 % si part UC ≥ 20 % (taux porté à 2,90 % en 2025)', fonds_euros_contrainte_uc = '20 % UC minimum pour bénéficier du bonus', frais_arbitrage_note = '1 arbitrage gratuit/an, puis 0,50 % par arbitrage', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '50 €', versement_min = '50 €', distributeur = 'Macif', service_extranet = 'Espace Assurance Vie macif.fr', options_gestion = ARRAY['Sécurisation des plus-values','Investissement progressif','Gestion pilotée ISR','Gestion pilotée Solidaire'] WHERE key = 'Macif Vie::Macif Épargne Vie';

-- MACSF::RES Multisupport
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros RES', frais_arbitrage_note = '12 arbitrages gratuits/an vers UC (puis 0,2 %), 2 % vers fonds euros. Entrée : 1 % UC, 0,6 % versements programmés, 3 % vers fonds euros', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '200 €', versement_min = '30 €', distributeur = 'MACSF (direct, réservé aux professionnels de santé et du secteur médico-social)', options_gestion = ARRAY['Gestion libre','Gestion pilotée Sérénité','Gestion pilotée Équilibre','Gestion pilotée Dynamique'], univers_classes = ARRAY['Fonds euros','OPCVM','Fonds actions','Fonds diversifiés','Fonds obligataires convertibles','Actifs non cotés','Métaux précieux','Monétaire'] WHERE key = 'MACSF::RES Multisupport';

-- Maif::Assurance Vie Responsable et Solidaire
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Responsable et Solidaire', frais_arbitrage_note = '1 arbitrage gratuit/an en gestion libre, puis 15 €. Gratuit en gestion profilée ou déléguée', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '30 €', versement_min = '30 €', distributeur = 'MAIF (direct)', options_gestion = ARRAY['Gestion libre','Gestion profilée','Gestion déléguée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI','Private equity'] WHERE key = 'Maif::Assurance Vie Responsable et Solidaire';

-- MMA Vie::MMA Multisupports
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'MMA Euro', fonds_euros_bonus = '2024 : jusqu''à +1,00 % (3,25 % max) si ≥ 40 % UC. 2025 : 2,20 % base, jusqu''à 3,00 % avec bonus', fonds_euros_contrainte_uc = 'Bonus conditionnel à la part en UC (20 % ou 40 % minimum)', frais_arbitrage_note = '1 arbitrage offert/an, 0,50 % au-delà', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '100 €', versement_min = '100 €', distributeur = 'MMA (réseau agents)', options_gestion = ARRAY['Gestion libre','Gestion profilée','Gestion pilotée automatisée'] WHERE key = 'MMA Vie::MMA Multisupports';

-- Monceau Assurances::Monceau Épargne
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Monceau Épargne', frais_arbitrage_note = '2 arbitrages gratuits/an en gestion libre', garantie_fonds_euros = 'Capital garanti net de frais de versement et de gestion', ticket_entree = '1 500 €', versement_min = '1 500 €', distributeur = 'Monceau Assurances (vente directe)', options_gestion = ARRAY['Gestion libre','Gestion pilotée (mandat d''arbitrage)','Investissement progressif'] WHERE key = 'Monceau Assurances::Monceau Épargne';

-- Monceau Assurances::Monceau Multifonds
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de souscription et de gestion', ticket_entree = '1 500 €', versement_min = '1 500 €', distributeur = 'Monceau Assurances (vente directe)' WHERE key = 'Monceau Assurances::Monceau Multifonds';

-- Natixis Life Luxembourg::Liberalys + SCPI
UPDATE public.investissement_av_contract_terms SET distributeur = 'Réseau BPCE (Banque Populaire, Caisse d''Épargne)', univers_classes = ARRAY['Fonds euros','OPCVM','FIC','FID','FAS','SCPI'] WHERE key = 'Natixis Life Luxembourg::Liberalys + SCPI';

-- Natixis Life Luxembourg::Liberalys BP Large
UPDATE public.investissement_av_contract_terms SET distributeur = 'Banque Populaire (réseau BPCE)', options_gestion = ARRAY['Gestion libre','Gestion mandatée','Gestion discrétionnaire'], univers_classes = ARRAY['Fonds euros','OPCVM','Private equity','Produits structurés'] WHERE key = 'Natixis Life Luxembourg::Liberalys BP Large';

-- Natixis Life Luxembourg::Liberalys BP Medium
UPDATE public.investissement_av_contract_terms SET distributeur = 'Banque Populaire (réseau BPCE)', univers_classes = ARRAY['Fonds euros','OPCVM','FIC','FID','FAS'] WHERE key = 'Natixis Life Luxembourg::Liberalys BP Medium';

-- Natixis Life Luxembourg::Liberalys Core DNCA
UPDATE public.investissement_av_contract_terms SET ticket_entree = '250 000 €', versement_min = '5 000 €', distributeur = 'DNCA Finance / CGP partenaires', options_gestion = ARRAY['Gestion pilotée DNCA'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Private equity','SCPI','Produits structurés'] WHERE key = 'Natixis Life Luxembourg::Liberalys Core DNCA';

-- Natixis Life Luxembourg::Liberalys Essentiel
UPDATE public.investissement_av_contract_terms SET options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','OPCVM','FIC','FID'] WHERE key = 'Natixis Life Luxembourg::Liberalys Essentiel';

-- Natixis Life Luxembourg::Liberalys Plus
UPDATE public.investissement_av_contract_terms SET distributeur = 'Banque Populaire (réseau BPCE)', univers_classes = ARRAY['Fonds euros','OPCVM','FIC','FID','FAS'] WHERE key = 'Natixis Life Luxembourg::Liberalys Plus';

-- Natixis Life Luxembourg::Liberalys Premium
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '75 000 €', versement_min = '5 000 €', distributeur = 'CGP / réseau BPCE (segment premium)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat','Fonds interne dédié (FID)','Fonds d''assurance spécialisé (FAS)'], univers_classes = ARRAY['Fonds euros','OPCVM','FIC','FID','FAS','Private equity'] WHERE key = 'Natixis Life Luxembourg::Liberalys Premium';

-- Oradéa Vie::MS EXCELLENCE CAPITALISATION
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Oradéa Vie', frais_arbitrage_note = '0,50 % par arbitrage', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '150 000 €', versement_min = '75 €', distributeur = 'Oradéa Vie (Société Générale Assurances)', options_gestion = ARRAY['Investissement progressif','Sécurisation des gains','Limitation des pertes','Allocation constante','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','Produits structurés','Fonds dédiés'] WHERE key = 'Oradéa Vie::MS EXCELLENCE CAPITALISATION';

-- Oradéa Vie::MULTISUPPORT EXCELLENCE
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Support Sécurité en euros Oradéa Vie', fonds_euros_bonus = 'Bonus 2025-2026 selon part UC : +0,50 % si 0-15 % UC, +1,00 % si 15-50 % UC, +1,50 % si ≥ 50 % UC', frais_arbitrage_note = '0,50 % du montant arbitré, +0,50 % sur supports immobiliers', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '50 000 €', versement_min = '50 000 €', distributeur = 'Conseillers en gestion de patrimoine (CGP)', options_gestion = ARRAY['Gestion libre','Gestion excellence (déléguée CGP)','Investissement progressif','Protection des gains','Limitation des pertes','Allocation constante','Dynamisation des rendements'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','Produits structurés'] WHERE key = 'Oradéa Vie::MULTISUPPORT EXCELLENCE';

-- Oradéa Vie::ORADEA CAPITALISATION
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Oradéa Vie - Fonds Euro (support Euro Sécurité)', fonds_euros_bonus = '+0,5 % à +2 % selon quote-part UC (2026-2027)', frais_arbitrage_note = '0,50 % par arbitrage, +0,50 % pour l''immobilier hors SCPI', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 000 €', versement_min = '500 000 €', distributeur = 'Oradéa Vie (réseau CGP partenaires, via UNEP Partenaires)', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF / trackers','SCPI','SCI','OPCI','Produits structurés'] WHERE key = 'Oradéa Vie::ORADEA CAPITALISATION';

-- Oradéa Vie::ORADEA CAPITALISATION +
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Sécurité Euros Oradéa Vie', fonds_euros_bonus = '+0,50 % à +2,00 % selon allocation UC minimale (15 % à 50 %)', fonds_euros_contrainte_uc = 'Bonus conditionnel selon part UC (paliers 15 %, 25 %, 40 %, 50 %)', frais_arbitrage_note = '0,50 % par arbitrage, +0,50 % pour SCPI et immobilier non coté', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 000 €', versement_min = '75 €', distributeur = 'Oradéa Vie (Société Générale Assurances), réseau CGP', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','Produits structurés','Fonds dédiés'] WHERE key = 'Oradéa Vie::ORADEA CAPITALISATION +';

-- Oradéa Vie::ORADEA CAPITALISATION + EVOLUTION
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Support Sécurité en euros', frais_arbitrage_note = '0,50 % du montant arbitré (min 75 € par support)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 000 €', versement_min = '500 000 €', distributeur = 'CGP partenaires Oradéa Vie (Société Générale)', options_gestion = ARRAY['Gestion libre','Investissement progressif','Allocation constante','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI'] WHERE key = 'Oradéa Vie::ORADEA CAPITALISATION + EVOLUTION';

-- Oradéa Vie::ORADEA CAPITALISATION OPPORTUNITES
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 000 €', versement_min = '500 000 €', distributeur = 'CGP partenaires Société Générale / Crédit du Nord', options_gestion = ARRAY['Gestion sous mandat Excellence (max 1,30 % de frais additionnels)'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF'] WHERE key = 'Oradéa Vie::ORADEA CAPITALISATION OPPORTUNITES';

-- Oradéa Vie::ORADEA EPARGNE HANDICAP
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Oradéa Vie', frais_arbitrage_note = '1 arbitrage gratuit/an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 200 €', versement_min = '1 200 €', distributeur = 'Oradéa Vie (Société Générale Assurances), réseau bancaire SG et CGP partenaires', univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI'] WHERE key = 'Oradéa Vie::ORADEA EPARGNE HANDICAP';

-- Oradéa Vie::ORADEA MULTISUPPORT
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Sécurité Euros', fonds_euros_bonus = '+0,50 % à +2,00 % selon allocation UC (15 % → +1 %, 35 % → +1,5 %, 50 % → +2 %) et apport min 75 000 €, valable jusqu''en 2027', fonds_euros_contrainte_uc = '15 % minimum en UC pour bénéficier du bonus', frais_arbitrage_note = '1 arbitrage gratuit/an, puis 1 % par opération', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 200 €', versement_min = '1 200 €', distributeur = 'Oradéa Vie (groupe Société Générale), réseau CGP', options_gestion = ARRAY['Allocation dynamique','Allocation constante','Investissement progressif','Prise de bénéfices','Limitation des pertes','7 profils de gestion pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','Obligations','Actions'] WHERE key = 'Oradéa Vie::ORADEA MULTISUPPORT';

-- Oradéa Vie::Oradéa Vie (gamme courtage)
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Support Sécurité Euros', fonds_euros_bonus = '+0,50 % à +2,00 % selon montant et part UC (versements 2025)', fonds_euros_contrainte_uc = 'Bonus conditionné à une part minimale en UC (15 % à 50 %)', frais_arbitrage_note = '1 arbitrage gratuit/an, puis 1 % du montant arbitré', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 200 €', versement_min = '75 €/mois (ou 250 €/trimestre)', distributeur = 'Réseau CGP et courtiers (Primonial, UNEP, Crystal), via intermédiaires', service_extranet = 'Gestion en ligne (souscription et gestion digitalisées)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','Produits structurés','Private equity'] WHERE key = 'Oradéa Vie::Oradéa Vie (gamme courtage)';

-- Predica::Anae
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Anae Euro', fonds_euros_bonus = 'Jusqu''à 3,75 % selon part UC (paliers 30 %, 40 %, 50 %). 2025 : base 2,70 %, jusqu''à 3,50 % selon UC. Nouveau contrat 2025 avec PAB préférentielle jusqu''à 4,60 %', fonds_euros_contrainte_uc = 'Bonus conditionné à la part UC (30 %, 40 %, 50 %)', frais_arbitrage_note = '0,50 % du montant arbitré (arbitrage en ligne)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '10 000 €', versement_min = '1 500 €', distributeur = 'Crédit Agricole (Banque Privée)', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Dynamisation des performances','Investissement progressif','Sécurisation de la plus-value','Stop-loss relatif','Stop-win'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','OPCI'] WHERE key = 'Predica::Anae';

-- Predica::Carissime
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Crédit Agricole', univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','SCI'] WHERE key = 'Predica::Carissime';

-- Predica::Eloquence Capitalisation
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Predica', frais_arbitrage_note = 'Arbitrages automatiques gratuits (stop-loss, investissement progressif, sécurisation des plus-values)', garantie_fonds_euros = 'Capital garanti net de frais en cas de rachat total durant les 10 premières années', ticket_entree = '10 000 €', versement_min = '10 000 €', distributeur = 'Crédit Agricole Banque Privée', options_gestion = ARRAY['Stop-loss relatif','Investissement progressif','Sécurisation de la plus-value'], univers_classes = ARRAY['Fonds euros','OPCVM','Obligations','Actions','Immobilier','Monétaire','International'] WHERE key = 'Predica::Eloquence Capitalisation';

-- Predica::Floriagri
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti', ticket_entree = '1 000 €', versement_min = '40 €', distributeur = 'Crédit Agricole', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','SCI','OPCI'] WHERE key = 'Predica::Floriagri';

-- Predica::Floriane 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Euro', fonds_euros_bonus = '2,95 % si UC ≥ 30 %, 3,15 % si UC ≥ 40 %, 3,35 % si UC ≥ 50 % (taux 2024 jusqu''à 3,60 %)', fonds_euros_contrainte_uc = 'Bonus conditionné à une part d''UC minimale en encours', frais_arbitrage_note = '0,50 % du montant arbitré', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '40 000 €', versement_min = '40 000 €', distributeur = 'Crédit Agricole (réseau agences)', service_extranet = 'Gestion en ligne disponible', options_gestion = ARRAY['Gestion libre','Gestion déléguée (sous mandat)'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','OPCI','ETF'] WHERE key = 'Predica::Floriane 2';

-- Predica::LCL Acuity Evolution
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Acuity FG 0.60', fonds_euros_bonus = '+0,40 % si ≥ 30 % UC (3,10 %), +0,60 % si ≥ 40 % UC (3,30 %), +0,80 % si ≥ 50 % UC (3,50 %)', fonds_euros_contrainte_uc = '30 %, 40 % ou 50 % minimum en UC selon le palier', frais_arbitrage_note = '0,50 % du montant arbitré (min 40 €). Gratuit entre supports du mandat d''arbitrage', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 500 € (versements libres et rachats partiels min)', distributeur = 'LCL (Banque Privée)', service_extranet = 'Gestion en ligne via espace client LCL', options_gestion = ARRAY['Gestion libre','Gestion sous mandat (mandat d''arbitrage)','Service conseil','Investissement progressif','Sécurisation des plus-values','Stop-loss','Stop-win','Dynamisation des performances'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','Private equity'] WHERE key = 'Predica::LCL Acuity Evolution';

-- Predica::LCL Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros LCL Vie', fonds_euros_bonus = '2,95 % (30 % UC min), 3,15 % (40 % UC), 3,35 % (50 % UC et plus)', fonds_euros_contrainte_uc = 'Gestion 100 % fonds euros limitée à 20 % max du contrat', frais_arbitrage_note = '0,70 % du montant arbitré', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '50 €', versement_min = '15 €', distributeur = 'LCL', service_extranet = 'Gestion en ligne 100 % possible', options_gestion = ARRAY['Mandat d''arbitrage','Gestion libre','Gestion en ligne'], univers_classes = ARRAY['Fonds euros','Eurocroissance','OPCVM','SCPI','OPCI'] WHERE key = 'Predica::LCL Vie';

-- Predica::LCL Vie Jeunes
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti', ticket_entree = '50 €', versement_min = '15 €', distributeur = 'LCL', options_gestion = ARRAY['Optimisation des performances','Revalorisation des versements programmés','Pause des versements'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI'] WHERE key = 'Predica::LCL Vie Jeunes';

-- Predica::Lionvie Atout PEP
UPDATE public.investissement_av_contract_terms SET ticket_entree = '1 500 €', versement_min = '1 500 €', distributeur = 'LCL', univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Predica::Lionvie Atout PEP';

-- --- part_05.sql ---
-- Predica::Oriance
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 €', versement_min = '50 €' WHERE key = 'Predica::Oriance';

-- Predica::Predissime 9 S2
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '2,95 % si UC ≥ 30 % (2025). 2024 : base 2,40 %, jusqu''à 3,20 % si UC ≥ 50 %', fonds_euros_contrainte_uc = 'Bonus si UC ≥ 30 %', frais_arbitrage_note = '1 arbitrage offert par année civile, 1,00 % au-delà', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '40 €', versement_min = '20 €' WHERE key = 'Predica::Predissime 9 S2';

-- Predica::Vers L'Avenir
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Minimum 100 €', garantie_fonds_euros = 'Capital garanti net de frais (rachat total ou décès dans les 10 premières années)', ticket_entree = '20 €', versement_min = '20 €' WHERE key = 'Predica::Vers L''Avenir';

-- Prépar Vie::BRED ASSURANCE VIE
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 arbitrage gratuit par an, 0 % au-delà', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '230 €', versement_min = '45 €', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Arbitrages automatiques trimestriels'] WHERE key = 'Prépar Vie::BRED ASSURANCE VIE';

-- Prépar Vie::BRED ASSURANCE VIE PATRIMOINE
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion', versement_min = '20 €', options_gestion = ARRAY['Gestion libre','Gestion déléguée (pilotée)'] WHERE key = 'Prépar Vie::BRED ASSURANCE VIE PATRIMOINE';

-- Prépar Vie::EGECLIC-VIE
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'EG-VIE Multisupports (fonds euros)', frais_arbitrage_note = 'Gratuit 1 fois par an (si ≥ 12 mois depuis le dernier arbitrage), 0,50 % sinon', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '600 €', versement_min = '76 €', distributeur = 'EDF / ENGIE (salariés et retraités, conjoints et descendants)', options_gestion = ARRAY['Versements programmés'] WHERE key = 'Prépar Vie::EGECLIC-VIE';

-- Prépar Vie::EPYO CAPI Personne Physique
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Prépar Vie', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'BRED Banque Populaire, CGP (Laplace Groupe, UNEP Partenaires)' WHERE key = 'Prépar Vie::EPYO CAPI Personne Physique';

-- Prépar Vie::EPYO VIE
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti à tout moment, égal aux montants versés nets de frais', ticket_entree = '0 €', versement_min = '0 €', distributeur = 'Laplace Groupe (CGP)' WHERE key = 'Prépar Vie::EPYO VIE';

-- Prépar Vie::TALENCE CONTRAT DE CAPITALISATION PM
UPDATE public.investissement_av_contract_terms SET distributeur = 'Talence Gestion' WHERE key = 'Prépar Vie::TALENCE CONTRAT DE CAPITALISATION PM';

-- Prépar Vie::TALENCE EPARGNE VIE II
UPDATE public.investissement_av_contract_terms SET distributeur = 'Talence Gestion' WHERE key = 'Prépar Vie::TALENCE EPARGNE VIE II';

-- Prépar Vie::TREVOLIA PLACEMENT
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti', distributeur = 'Mutualia', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Mandat d''arbitrage'] WHERE key = 'Prépar Vie::TREVOLIA PLACEMENT';

-- Prépar Vie::UNEP EVOLUTION
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Prépar Vie', fonds_euros_bonus = '+1,10 % si UC ≥ 30 %, +1,50 % si UC ≥ 50 % (versements reçus jusqu''au 13/12/2026)', fonds_euros_contrainte_uc = 'Bonus conditionné à une allocation UC / Fonds Croissance ≥ 30 % ou ≥ 50 %', frais_arbitrage_note = '2 arbitrages gratuits par an calendaire, puis 0,50 % au-delà', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '50 000 €', versement_min = '50 000 €', distributeur = 'UNEP (Union Nationale des Entreprises Paysagistes) via Alptis', service_extranet = 'Oui', options_gestion = ARRAY['Gestion libre','Gestion conseillée ISR & Solidaire (Sanso, cible 80 % actions)','Gestion conseillée Thématique (Erasmus, 40-75 % actions)'] WHERE key = 'Prépar Vie::UNEP EVOLUTION';

-- Prépar Vie::UNEP EVOLUTION CAPI 2 Personne Morale IR
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro UNEP / Prépar Vie', fonds_euros_bonus = 'Jusqu''à +2 % selon la part investie en UC (taux max 5,10 %)', fonds_euros_contrainte_uc = 'Bonus selon allocation UC', frais_arbitrage_note = '2 arbitrages offerts par an, 0,50 % au-delà', garantie_fonds_euros = 'Capital garanti net de frais, effet cliquet annuel', ticket_entree = '50 000 €', versement_min = '50 000 €', distributeur = 'UNEP Partenaires / CGP', options_gestion = ARRAY['Gestion libre','Gestion pilotée ISR & Solidaire','Gestion pilotée Profil Thématique','Fonds croissance PREPAR AVENIR II'] WHERE key = 'Prépar Vie::UNEP EVOLUTION CAPI 2 Personne Morale IR';

-- Prépar Vie::UNEP EVOLUTION CAPI 2 Personne Physique
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Prépar Vie', fonds_euros_bonus = '+1,10 % si UC ≥ 30 %, +1,50 % si UC ≥ 50 % (2026-2027 sur versements nets)', fonds_euros_contrainte_uc = 'Bonus conditionné à une allocation UC ≥ 30 % ou ≥ 50 %', frais_arbitrage_note = '2 arbitrages gratuits par année civile, puis 0,50 % des sommes arbitrées', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '10 000 €', versement_min = '1 500 €', distributeur = 'UNEP (association) via réseau BRED / BPCE', options_gestion = ARRAY['Gestion libre','Gestion déléguée Sanso','Gestion déléguée Erasmus','Mandat Profil ISR Solidaire','Mandat Profil Thématique'] WHERE key = 'Prépar Vie::UNEP EVOLUTION CAPI 2 Personne Physique';

-- Prépar Vie::VALVIE INVEST PATRIMOINE II
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = '35 % UC min pour versements ≤ 200 000 €, 50 % UC pour 200 000 € à 1 000 000 €, 65 % UC au-delà d''1 000 000 €', frais_arbitrage_note = '2 arbitrages gratuits par an, puis 0,50 % des sommes arbitrées', garantie_fonds_euros = 'Capital garanti', ticket_entree = '150 000 €', versement_min = '1 500 €', distributeur = 'BRED Banque Populaire, SBE (Société de Bourse Étoile)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat Promepar AM (Scheme 1 : Modéré / Diversifié / Offensif)','Gestion sous mandat Promepar AM (Scheme 2 : 35 % UC ou 50 % UC)','4 options d''arbitrage automatique sans frais','Garantie plancher décès'] WHERE key = 'Prépar Vie::VALVIE INVEST PATRIMOINE II';

-- Prépar Vie::VALVIE IV Individuel
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Sans capital garanti (eurocroissance)', ticket_entree = '15 000 €', versement_min = '15 000 €', distributeur = 'BRED Banque Populaire', options_gestion = ARRAY['Gestion pilotée'] WHERE key = 'Prépar Vie::VALVIE IV Individuel';

-- Prépar Vie::VIP II CAPITALISATION Personne Physique
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '2 arbitrages gratuits par an, puis 0,50 % pour les montants ≤ 150 000 € et 0,40 % pour les montants de 150 000 € à 300 000 €', garantie_fonds_euros = 'Capital garanti, au moins égal aux sommes versées', distributeur = 'Prépar Vie (BNP Paribas Cardif)' WHERE key = 'Prépar Vie::VIP II CAPITALISATION Personne Physique';

-- Sogécap::EBENE
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Sogécap', fonds_euros_bonus = 'Jusqu''à +0,55 % selon la part UC (15 % / 35 % / 50 %). Taux max 3,60 % en 2024, 4,65 % en 2025', fonds_euros_contrainte_uc = '15 % minimum en UC pour bénéficier du bonus', frais_arbitrage_note = 'Plafonné à 75 €', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '150 000 €', versement_min = '1 500 €', distributeur = 'Société Générale', options_gestion = ARRAY['Gestion libre','Gestion sous mandat SG Gestion','Versements programmés','Arbitrages en ligne'] WHERE key = 'Sogécap::EBENE';

-- Sogécap::EBENE CAPITALISATION
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros Sogécap (Sécurité en Euros)', frais_arbitrage_note = '0,50 % des montants échangés, plafonné à 75 € par opération, +0,50 % sur les supports immobiliers', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '150 000 €', versement_min = '1 500 €', distributeur = 'Société Générale (Private Banking)', service_extranet = 'Non', options_gestion = ARRAY['Gestion libre','Gestion sous mandat GSM Evolution'] WHERE key = 'Sogécap::EBENE CAPITALISATION';

-- Sogécap::PER Acacia
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Support Sécurité en euros', fonds_euros_bonus = 'Bonus conditionnel : +1,00 % dès 15 % UC, +2,25 % dès 50 % UC (taux max 5,50 % en 2025)', frais_arbitrage_note = '0,50 % plafonné à 75 € par arbitrage, gratuit en gestion Horizon Retraite', garantie_fonds_euros = 'Capital garanti', ticket_entree = '150 €', versement_min = '50 €', distributeur = 'Société Générale / BFCOI', options_gestion = ARRAY['Gestion Horizon Retraite Prudent','Gestion Horizon Retraite Équilibré','Gestion Horizon Retraite Dynamique','Gestion libre'] WHERE key = 'Sogécap::PER Acacia';

-- Sogécap::SEQUOIA
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Séquoia Sécurité en Euros', fonds_euros_bonus = '+100 à +200 pb selon la part UC (15 % UC = +100 pb, 50 % UC = +200 pb). Taux max 4,65 % en 2025', fonds_euros_contrainte_uc = 'Bonus conditionnel selon la part UC investie', frais_arbitrage_note = '0,50 % du montant arbitré, plafonné à 75 € par opération', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '7 600 €', versement_min = '7 600 €', distributeur = 'Société Générale', service_extranet = 'sogecap.fr', options_gestion = ARRAY['Gestion libre','Sécurisation des gains','Alertes gains / pertes'] WHERE key = 'Sogécap::SEQUOIA';

-- Sogécap::SG GESTION PRIVEE CAPITALISATION PM
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Sécurité', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '150 000 €', versement_min = '150 000 €', distributeur = 'Société Générale Gestion Privée (Banque Privée)', service_extranet = 'assurances.societegenerale.com', options_gestion = ARRAY['Gestion libre','Gestion sous mandat'] WHERE key = 'Sogécap::SG GESTION PRIVEE CAPITALISATION PM';

-- Sogécap::SG GESTION PRIVEE VIE EVOLUTION
UPDATE public.investissement_av_contract_terms SET ticket_entree = '15 000 €', versement_min = '15 000 €', distributeur = 'Société Générale Banque Privée', options_gestion = ARRAY['Gestion pilotée','Gestion libre'] WHERE key = 'Sogécap::SG GESTION PRIVEE VIE EVOLUTION';

-- Sogécap::SGGP CAPI EVOLUTION
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais', distributeur = 'Société Générale (réseau bancaire)' WHERE key = 'Sogécap::SGGP CAPI EVOLUTION';

-- Sogécap::SOCIÉTÉ GÉNÉRALE ASSURANCES VIE
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Sécurité en euros Sogécap', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Société Générale (réseau bancaire)' WHERE key = 'Sogécap::SOCIÉTÉ GÉNÉRALE ASSURANCES VIE';

-- Sogécap::SOGECAPI MULTISUPPORT PM II
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Support en Euros Sécurité', fonds_euros_bonus = '+2 % selon allocation UC (min 15 % UC)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 000 €', versement_min = '500 000 €', distributeur = 'Société Générale (réseau bancaire)' WHERE key = 'Sogécap::SOGECAPI MULTISUPPORT PM II';

-- Sogécap::SOGECAPI PATRIMOINE
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Support Sécurité en euros', fonds_euros_bonus = '+100 pb sur versements ≥ 15 % UC pour 2025 et 2026', frais_arbitrage_note = '0,50 % limité à 75 € par opération (automatique : 1 % limité à 150 €)', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '7 600 €', versement_min = '1 500 €', distributeur = 'Société Générale', options_gestion = ARRAY['Gestion libre','Alliage Gestion (min. 30 000 €)','Gestion sous mandat (min. 100 000 €)'] WHERE key = 'Sogécap::SOGECAPI PATRIMOINE';

-- Sogécap::SOGEVIE FORMULE ERABLE ESSENTIEL
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euros Erable', fonds_euros_bonus = '+1 % si 35-50 % UC, +1,5 % si 35-50 % UC, +2 % si UC > 50 % (conditionnels)', fonds_euros_contrainte_uc = 'Bonus conditionnel selon la part UC détenue (seuils 35 %, 50 %)', frais_arbitrage_note = '0,50 % plafonné à 75 €', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '150 €', versement_min = '25 €', distributeur = 'Société Générale (bancassurance)', options_gestion = ARRAY['Gestion libre (Initiative+ < 15 000 €, Intégrale+ ≥ 15 000 €)','Gestion sous mandat Alliage Gestion (dès 7 500 €)','Gestion Junior+ (mineurs)'] WHERE key = 'Sogécap::SOGEVIE FORMULE ERABLE ESSENTIEL';

-- Sogelife::Sogelife Personal Multisupports
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Sogelife', fonds_euros_bonus = 'Jusqu''à 5,40 % avec bonus de fidélité selon la part UC investie', frais_arbitrage_note = '1er arbitrage par an gratuit, au-delà 0,10 % plafonné à 300 €', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 000 €', versement_min = '300 000 €', distributeur = 'Sogelife (filiale Société Générale) / réseau CGP', service_extranet = 'MySogelife.com', options_gestion = ARRAY['Gestion libre','Gestion discrétionnaire (FID)','Fonds internes dédiés (FID / FIC / FAS)'] WHERE key = 'Sogelife::Sogelife Personal Multisupports';

-- Sogelife::Sogelife Private Selection
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Jusqu''à 5,4 % avec bonus de fidélité (50 % min en UC)', frais_arbitrage_note = '0,10 % max', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 000 €', versement_min = '300 000 €', distributeur = 'Société Générale Private Banking', options_gestion = ARRAY['Gestion libre','Gestion déléguée (Lazard Frères, LFDE, DNCA)'] WHERE key = 'Sogelife::Sogelife Private Selection';

-- Sogelife::Sogelife Target FR Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Jusqu''à 5,4 % avec bonus de fidélité', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '300 000 €', versement_min = '300 000 €', distributeur = 'Sogelife / réseau SG / CGP', options_gestion = ARRAY['Gestion libre','Mandat de gestion'] WHERE key = 'Sogelife::Sogelife Target FR Vie';

-- Spirica::Advanced by Athymis
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Spirica', frais_arbitrage_note = '0 %, minimum 25 € par arbitrage', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '10 000 €', versement_min = '5 000 €', distributeur = 'Athymis Gestion (CGP)', options_gestion = ARRAY['Gestion libre','Investissement progressif','Sécurisation des plus-values','Allocation constante','Limitation des pertes'] WHERE key = 'Spirica::Advanced by Athymis';

-- Spirica::AFV Différence 1
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'AFV Différence I', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = 'Non communiqué', distributeur = 'AFV (réseau partenaire Spirica)' WHERE key = 'Spirica::AFV Différence 1';

-- Spirica::Alpha Solis
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération / Euro Général Spirica', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 500 €', versement_min = '1 500 €', distributeur = 'Spirica (CGP)' WHERE key = 'Spirica::Alpha Solis';

-- Spirica::Alyss
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Support en euros (ex-Fonds Euro Alyss / Actif général Spirica, transféré de Predica à Spirica)', frais_arbitrage_note = '1 % des sommes transférées, minimum 40 €', garantie_fonds_euros = 'Capital garanti à 100 % (contrat classique)', ticket_entree = '8 000 €', versement_min = '1 500 € (versements suivants), 50 € par mois en programmés', distributeur = 'UAF Life Patrimoine (plateforme CGP de Spirica, groupe Crédit Agricole Assurances)', options_gestion = ARRAY['Gestion libre'] WHERE key = 'Spirica::Alyss';

-- Spirica::Amplea Capi PM
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica / Ampléa Dynamique / Ampléa Différé', frais_arbitrage_note = 'Arbitrages gratuits sans restriction', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '5 000 €', versement_min = '5 000 €', distributeur = 'CD Partenaires', options_gestion = ARRAY['Investissement progressif','Sécurisation des plus-values','Allocation constante','Limitation des pertes','Gestion pilotée'] WHERE key = 'Spirica::Amplea Capi PM';

-- Spirica::Amplea Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica / Amplea Dynamique / Amplea Différé', frais_arbitrage_note = 'Arbitrages gratuits et illimités en ligne', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '5 000 €', versement_min = '5 000 €', distributeur = 'CD Partenaires / Alpheys', options_gestion = ARRAY['Investissement progressif','Sécurisation des plus-values','Allocation constante','Limitation des pertes (stop-loss)'] WHERE key = 'Spirica::Amplea Vie';

-- Spirica::Amytis Essentiel
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'CGP (distribution exclusive via conseillers en gestion de patrimoine partenaires Spirica)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion conseillée','Gestion sous mandat','Rééquilibrage automatique','Sécurisation des plus-values'] WHERE key = 'Spirica::Amytis Essentiel';

-- Spirica::Amytis Patrimoine
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', fonds_euros_contrainte_uc = 'Minimum 25 % en UC pour accéder au Fonds Euro Nouvelle Génération', garantie_fonds_euros = 'Capital garanti net de frais de gestion (sous réserve de la contrainte UC)', distributeur = 'Amytis (cabinet CGP partenaire Spirica)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion sous mandat'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','Produits structurés'] WHERE key = 'Spirica::Amytis Patrimoine';

-- Spirica::Amytis Retraite
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro PER Nouvelle Génération', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Amytis (cabinet CGP)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion pilotée à horizon'] WHERE key = 'Spirica::Amytis Retraite';

-- --- part_06.sql ---
-- Spirica::Arborescence Opportunité
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euros Spirica', frais_arbitrage_note = '1 arbitrage gratuit par an, 50 € min, 300 € max', garantie_fonds_euros = 'Capital garanti', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'UAF Life Patrimoine', service_extranet = 'Consultation, virements, arbitrages, rachats partiels, alertes', options_gestion = ARRAY['Gestion pilotée','Arbitrages automatiques'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','OPCI','Gestion pilotée'] WHERE key = 'Spirica::Arborescence Opportunité';

-- Spirica::Arborescence Opportunité 2
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 arbitrage gratuit par an', ticket_entree = '1 000 €', options_gestion = ARRAY['Stop-loss relatif','Sécurisation des plus-values','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['UC','SCPI','OPCI','SCI','Titres vifs'] WHERE key = 'Spirica::Arborescence Opportunité 2';

-- Spirica::Asac Fapes PER
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro PER Nouvelle Génération', frais_arbitrage_note = 'Gratuits en ligne et automatiques (illimités), 15 € max par opération sur papier', garantie_fonds_euros = 'Capital garanti à 100 % (effet cliquet annuel)', ticket_entree = '500 €', versement_min = '100 € libre, 50 €/mois ou 100 €/trimestre en programmés', distributeur = 'ASAC-FAPES (association)', service_extranet = 'Espace adhérent en ligne (gestion et arbitrages)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Sécurisation des plus-values','Stop-loss'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs'] WHERE key = 'Spirica::Asac Fapes PER';

-- Spirica::Asac Neo Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Euro Nouvelle Génération / Euro Objectif Climat', fonds_euros_bonus = '+1,10 % sur nouveaux versements ≥ 100 000 € sur le Fonds Euro Nouvelle Génération (sans contrainte UC), reconduit 2026-2027. Fonds Euro Objectif Climat : 3,26 % en 2025 (100 % capitalisation)', fonds_euros_contrainte_uc = 'Fonds Euro Nouvelle Génération : sans contrainte UC pour les versements en bonus (25 % UC min historique supprimé selon conditions 2025-2026)', frais_arbitrage_note = 'Gratuits en ligne (illimités) et automatiques, 2 gratuits/an par courrier puis 15 € forfait', garantie_fonds_euros = 'Euro Nouvelle Génération : 98 % du capital net de frais (annuelle). Euro Objectif Climat : 100 % du capital', ticket_entree = '500 €', versement_min = '100 € libre, dès 100 €/mois en programmés', distributeur = 'ASAC-Fapès (association)', service_extranet = 'Gestion 100 % en ligne (souscription, arbitrages, rachats instantanés)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Fonds datés'] WHERE key = 'Spirica::Asac Neo Vie';

-- Spirica::Aster Innovation
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', fonds_euros_bonus = 'Offres bonus ponctuelles par avenant sur le Fonds Euro Nouvelle Génération (contribution variable, sous conditions)', garantie_fonds_euros = 'Capital garanti net de frais de gestion, TMG 0 % brut en 2025', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','ETF','SCPI'] WHERE key = 'Spirica::Aster Innovation';

-- Spirica::Aster Quintessence
UPDATE public.investissement_av_contract_terms SET ticket_entree = '500 000 €', versement_min = '500 000 €', distributeur = 'Crédit Agricole (Predica)', univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Spirica::Aster Quintessence';

-- Spirica::BforBankVie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Euro Allocation Long Terme 2', fonds_euros_contrainte_uc = '100 % fonds euros possible depuis juillet 2023 (sans obligation UC)', frais_arbitrage_note = 'Arbitrages illimités et gratuits', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'BforBank', options_gestion = ARRAY['Protection automatique des gains','Limitation des pertes','Investissement progressif'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','OPCI'] WHERE key = 'Spirica::BforBankVie';

-- Spirica::Cerenis Gestion Privée Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération Spirica', garantie_fonds_euros = 'Capital garanti à 98 % (hors frais de gestion)', distributeur = 'Cerenis (gestion privée)', options_gestion = ARRAY['Gestion libre','Gestion conseillée','Gestion sous mandat','Gestion à horizon'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI','Produits structurés','Obligations datées','Titres vifs'] WHERE key = 'Spirica::Cerenis Gestion Privée Vie';

-- Spirica::Delubac Quintet Capitalisation
UPDATE public.investissement_av_contract_terms SET ticket_entree = '15 000 €', versement_min = '15 000 €', distributeur = 'Banque Delubac & Cie', univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Spirica::Delubac Quintet Capitalisation';

-- Spirica::Diversalys
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Général Spirica', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Spirica (réseau CGP)', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI','Produits structurés','Private equity'] WHERE key = 'Spirica::Diversalys';

-- Spirica::DNCA Cap Retraite – PER Individuel
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro PER Nouvelle Génération', garantie_fonds_euros = 'Capital garanti à 97,7 % (garantie minorée)', ticket_entree = '500 €', versement_min = '50 €', distributeur = 'UAF Life Patrimoine', options_gestion = ARRAY['Gestion pilotée DNCA Prudent','Gestion pilotée DNCA Équilibré','Gestion pilotée DNCA Dynamique','Gestion libre'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','Private equity','EMTN','Titres vifs'] WHERE key = 'Spirica::DNCA Cap Retraite – PER Individuel';

-- Spirica::EnVie Patrimoine
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Spirica (distribution directe)', options_gestion = ARRAY['Gestion libre','Gestion conseillée','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','Private equity'] WHERE key = 'Spirica::EnVie Patrimoine';

-- Spirica::Epargne Evolution
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica', fonds_euros_contrainte_uc = '25 % minimum en UC requis pour chaque versement sur le fonds euros', frais_arbitrage_note = 'Arbitrages gratuits, sans restriction, en ligne', garantie_fonds_euros = 'Capital garanti à 98 % (Actif Général Spirica)', ticket_entree = '500 €', versement_min = '500 €', distributeur = 'ePatrimoine (groupe Patrimea)', service_extranet = 'Gestion 100 % en ligne', options_gestion = ARRAY['Gestion libre','Investissement progressif','Stop-loss','Sécurisation des plus-values','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','Titres vifs'] WHERE key = 'Spirica::Epargne Evolution';

-- Spirica::Eres La Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération / Fonds Euro Objectif Climat', fonds_euros_bonus = 'Offre bonus 2026-2027 : +1,10 % (versement ≥ 100 000 €, sans contrainte UC) ou +1,50 % (versement ≥ 100 000 € avec ≥ 30 % UC), sur le Fonds Euro Nouvelle Génération', fonds_euros_contrainte_uc = 'Aucune contrainte UC pour l''accès au fonds euros, bonus majoré (+1,50 %) conditionné à ≥ 30 % UC', frais_arbitrage_note = '0,50 % maximum', garantie_fonds_euros = 'Capital garanti annuellement net de frais de gestion (97,70 % min après frais 2,30 % max)', ticket_entree = '500 € (25 € min par support)', versement_min = '500 € libre, 150 €/mois ou 150 €/trimestre ou 250 €/semestre ou 500 €/an en programmés', distributeur = 'Eres Assurances (courtier, ORIAS 15002233), réservé salariés/CGP', service_extranet = 'Espace client Spirica', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif'], univers_classes = ARRAY['Fonds euros','SCPI','OPCI','Private equity','Produits structurés'] WHERE key = 'Spirica::Eres La Vie';

-- Spirica::Eurolis
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Spirica + Fonds euros dynamique Eurolis', frais_arbitrage_note = '2 arbitrages gratuits/an, puis 0,60 % (15 € min)', garantie_fonds_euros = 'Capital garanti net de frais de gestion (effet cliquet)', ticket_entree = '5 000 €', versement_min = '5 000 €', distributeur = 'Orelis Finance', options_gestion = ARRAY['Investissement progressif','Sécurisation des plus-values','Répartition constante','Rachats partiels programmés','Garantie plancher décès'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI'] WHERE key = 'Spirica::Eurolis';

-- Spirica::Fidessio Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Spirica (actif général)', frais_arbitrage_note = '0 % en ligne, 0,50 % sur papier (30 € min)', garantie_fonds_euros = 'Capital garanti net de frais', distributeur = 'Fidessio', univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Spirica::Fidessio Vie';

-- Spirica::FuturPERFECT
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Général Spirica', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Cplussur', options_gestion = ARRAY['Rééquilibrage automatique','Investissement progressif','Protection des gains','Stop-loss'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','Private equity','Produits structurés'] WHERE key = 'Spirica::FuturPERFECT';

-- Spirica::Goodlife
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euros Objectif Climat', frais_arbitrage_note = 'Gratuit en ligne, 15 € max sur papier', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'Goodvest', options_gestion = ARRAY['Basique','Essentiel','Impact 360°','Économie réelle'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','FCPR'] WHERE key = 'Spirica::Goodlife';

-- Spirica::Indexa Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Euro Nouvelle Génération', frais_arbitrage_note = 'Aucun frais d''arbitrage', garantie_fonds_euros = 'Pas de garantie en capital (contrat 100 % UC)', ticket_entree = '500 €', versement_min = '500 €', distributeur = 'Indexa Capital', options_gestion = ARRAY['Gestion sous mandat (10 profils de risque)'], univers_classes = ARRAY['ETF','OPCVM'] WHERE key = 'Spirica::Indexa Vie';

-- Spirica::Innorescence
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'UAF Life Patrimoine', options_gestion = ARRAY['Gestion sous mandat robo-advisor AAA'], univers_classes = ARRAY['Fonds euros','ETF'] WHERE key = 'Spirica::Innorescence';

-- Spirica::Kerria Privilèges
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Quota UC minimum (25-50 % selon conditions négociées avec le CGP)', garantie_fonds_euros = 'Capital garanti net de frais', distributeur = 'Réseau CGP / CGPI (non commercialisé en direct)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion conseillée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI','Produits structurés','Titres vifs','Private equity'] WHERE key = 'Spirica::Kerria Privilèges';

-- Spirica::La Médicale PERennité
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération Spirica', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti à 98 % net de frais de gestion', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'La Médicale (Crédit Agricole Assurances)', options_gestion = ARRAY['Investissement progressif','Sécurisation des gains','Limitation des pertes relatives','Gestion pilotée','Gestion à l''horizon'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','SCI','ETF','Unités de compte'] WHERE key = 'Spirica::La Médicale PERennité';

-- Spirica::La Médicale Premium
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euros Spirica (Actif Général)', frais_arbitrage_note = '1 arbitrage offert par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'La Médicale de France (professionnels de santé)', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Sécurisation des plus-values','Investissement progressif','Rééquilibrage automatique','Stop-loss relatif'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','OPCI'] WHERE key = 'Spirica::La Médicale Premium';

-- Spirica::La Médicale Sélect
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Général', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'La Médicale (professionnels de santé)', options_gestion = ARRAY['Investissement progressif','Sécurisation des plus-values','Stop-loss relatif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','Produits structurés'] WHERE key = 'Spirica::La Médicale Sélect';

-- Spirica::La Médicale Sérénité
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', frais_arbitrage_note = '0,60 % (50 € min, 200 € max), gratuit en ligne', garantie_fonds_euros = 'Capital garanti à 98 % net de frais (garantie annuelle)', ticket_entree = '500 €', versement_min = '500 €', distributeur = 'La Médicale', options_gestion = ARRAY['Investissement progressif','Sécurisation des plus-values','Stop-loss','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','SCI','OPCI','FCPR'] WHERE key = 'Spirica::La Médicale Sérénité';

-- Spirica::Linxea Spirit
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Nouvelle Génération / Objectif Climat', fonds_euros_bonus = 'Jusqu''à +1,50 % net sur 2026-2027 (Nouvelle Génération, sous conditions)', fonds_euros_contrainte_uc = 'Nouvelle Génération accessible à 100 %', frais_arbitrage_note = 'Gratuit en ligne (hors SCPI, SCI, ETF, FCPR, actions)', garantie_fonds_euros = 'Capital garanti à 98 %', ticket_entree = '500 €', versement_min = '100 € (libre et programmé)', distributeur = 'Linxea', service_extranet = 'Souscription et gestion 100 % en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée (OTEA, Yomoni)','Gestion mixte','Allocations stars'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','Private equity','Titres vifs','Produits structurés','Fonds datés'] WHERE key = 'Spirica::Linxea Spirit';

-- Spirica::Linxea Spirit 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération / Fonds Euro Objectif Climat', fonds_euros_bonus = 'Bonification jusqu''à 1,50 % selon quote-part UC', frais_arbitrage_note = '0 % en ligne (hors SCPI, SCI, ETF, FCPR, actions)', garantie_fonds_euros = 'Capital garanti à 98 % net de frais de gestion', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'Linxea', service_extranet = 'Gestion 100 % en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée OTEA Capital','Gestion pilotée Yomoni','Gestion mixte'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','ETC','Actions','SCPI','SCI','Private equity','Produits structurés','Fonds à échéance'] WHERE key = 'Spirica::Linxea Spirit 2';

-- Spirica::Linxea Spirit Capitalisation 2 PM
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Nouvelle Génération / Fonds Objectif Climat', frais_arbitrage_note = 'Arbitrage en ligne gratuit (0 %), hors SCPI, SCI, ETF, FCPR et actions en direct', garantie_fonds_euros = 'Capital garanti', ticket_entree = '50 000 €', versement_min = '100 €', distributeur = 'Linxea', service_extranet = 'Consultation en ligne, souscription sur papier et gestion non en ligne pour personnes morales', options_gestion = ARRAY['Gestion libre','Gestion pilotée OTEA Capital (0,20 %/an)','Gestion pilotée Yomoni ETF (0,70 %/an)','Gestion mixte'], univers_classes = ARRAY['Fonds euros','ETF','OPCVM','SCPI','SCI','Private equity','Produits structurés','Fonds datés','Actions','ETC'] WHERE key = 'Spirica::Linxea Spirit Capitalisation 2 PM';

-- Spirica::Linxea Spirit PER
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro PER Nouvelle Génération', frais_arbitrage_note = '0 % en ligne', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'Linxea', options_gestion = ARRAY['Gestion libre','Gestion pilotée horizon retraite','Gestion pilotée Otea Capital','Gestion pilotée Yomoni'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','Actions directes','Private equity','Produits structurés'] WHERE key = 'Spirica::Linxea Spirit PER';

-- Spirica::Livret Patrimoine Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Primonial EuroDynamic', frais_arbitrage_note = '1 % par arbitrage, pas d''arbitrage gratuit', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Primonial', options_gestion = ARRAY['Arbitrages','Rachats partiels','Alertes','Virements'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','OPCI','SCI','Obligations','Actions'] WHERE key = 'Spirica::Livret Patrimoine Vie';

-- Spirica::Meilleurtaux Liberté PER
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro PER Nouvelle Génération Spirica', fonds_euros_bonus = '150 € offerts pour tout premier versement ≥ 3 000 € avec min 30 % en UC ou gestion pilotée (code ETEPER, jusqu''au 31/07/2026, versé sur le fonds euros)', fonds_euros_contrainte_uc = 'Accessible jusqu''à 100 %', frais_arbitrage_note = '0 % en ligne, 2 gratuits/an par courrier puis 15 € forfait par arbitrage', garantie_fonds_euros = 'Capital garanti à 98 % net de frais de gestion annuels (2 %)', ticket_entree = '500 €', versement_min = '100 € libre en gestion libre, 100 €/mois en programmés, 50 € min par support', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client en ligne (arbitrages et versements)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion à horizon retraite','Sécurisation des plus-values','Stop-loss','Investissement progressif'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés'] WHERE key = 'Spirica::Meilleurtaux Liberté PER';

-- Spirica::meilleurtaux Liberté Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération Spirica', fonds_euros_bonus = '+1,10 % (sans contrainte UC) ou +1,50 % (si ≥ 30 % en UC en gestion libre) sur la part fonds euros, pour tout versement ≥ 100 000 € avant le 31/12/2026', fonds_euros_contrainte_uc = 'Aucune contrainte UC pour accéder au Fonds Euro Nouvelle Génération (100 % accessible), la contrainte de 30 % UC ne s''applique qu''au bonus majoré (+1,50 %)', frais_arbitrage_note = '0 % sur internet (illimité), 15 € par opération papier avec 2 gratuits/an. ETF ±0,10 % par mouvement', garantie_fonds_euros = 'Capital garanti à 98 % net des frais de gestion (2 %/an, effet cliquet)', ticket_entree = '500 €', versement_min = '100 € libre, 100 €/mois en programmés', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client (arbitrages en ligne gratuits)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Sécurisation des plus-values','Stop-loss','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés','Fonds datés'] WHERE key = 'Spirica::meilleurtaux Liberté Vie';

-- Spirica::Meilleurtaux Liberté Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', fonds_euros_bonus = 'Bonus +1,10 % ou +1,50 % sur versements 2026 (min 100 000 €, dont min 30 % UC pour le taux supérieur)', fonds_euros_contrainte_uc = 'Pas de contrainte UC minimale pour l''accès au fonds euros standard, 30 % UC min pour bonus maximum', frais_arbitrage_note = 'Arbitrages en ligne gratuits, 2/an gratuits par courrier puis 15 € par arbitrage, spread 0,06 % sur ETF et titres vifs', garantie_fonds_euros = 'Capital garanti à 98 % net de frais de gestion (2 % max/an déduits de la garantie)', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée (profils Prudent/Équilibre/Dynamique/Audacieux)','Gestion mixte','Rachats programmés','Rachat partiel instantané jusqu''à 60 % de l''encours'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés','Fonds datés','FCPR','Fonds diversifiés'] WHERE key = 'Spirica::Meilleurtaux Liberté Vie';

-- Spirica::Mesplacementsliberté
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica / Euro Nouvelle Génération Spirica', frais_arbitrage_note = 'Gratuits en ligne, 2 gratuits/an par courrier puis 15 € forfait', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '50 €', distributeur = 'Finance Sélection (mes-placements.fr)', options_gestion = ARRAY['Limitation des pertes','Allocation constante','Sécurisation des plus-values','Investissement progressif'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','Titres vifs','Private equity'] WHERE key = 'Spirica::Mesplacementsliberté';

-- Spirica::Meyon Life
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Euro Nouvelle Génération Spirica', fonds_euros_bonus = '+1,10 % (versement min 100 000 €, sans contrainte UC, jusqu''au 28/02/2026) ou +1,50 % (versement min 100 000 € avec 30 % UC min, jusqu''au 28/02/2026)', fonds_euros_contrainte_uc = 'Actif Général Spirica FG 0.7 : 25 % UC jusqu''à 100 000 €, 35 % entre 1-2 M€, 50 % entre 2-4 M€. Euro Nouvelle Génération : sans contrainte UC', frais_arbitrage_note = 'Arbitrages gratuits, sans restriction', garantie_fonds_euros = '98 % pour Euro Nouvelle Génération (net de frais de gestion 2 % max), 100 % pour Actif Général Spirica FG 0.7', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Meyon (application digitale)', service_extranet = 'Application mobile Meyon (souscription et gestion 100 % digitale)', options_gestion = ARRAY['Gestion libre','Gestion conseillée','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','Private equity','Produits structurés'] WHERE key = 'Spirica::Meyon Life';

-- Spirica::MustEpargne
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Général', garantie_fonds_euros = 'Capital garanti', distributeur = 'Must (CGP, contrat fermé)', univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Spirica::MustEpargne';

-- Spirica::Nektarea
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', garantie_fonds_euros = 'Capital garanti à 98 % annuellement net de frais de gestion (frais 2 %)', ticket_entree = '450 €', versement_min = '450 €', distributeur = 'Nektarea', univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Immobilier','Private equity'] WHERE key = 'Spirica::Nektarea';

-- Spirica::Nélia Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'EuroSélection #2.1 (gamme EuroActifs)', fonds_euros_bonus = 'Bonus Spirica +1,10 % à +1,50 % sur le Fonds Euro Nouvelle Génération (2026-2027)', fonds_euros_contrainte_uc = '40 % minimum en UC obligatoire (fonds euros limité à 60 % max du contrat)', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti à 98 % annuellement', ticket_entree = '1 500 €', versement_min = '100 €/mois ou 250 €/trimestre en programmés', distributeur = 'Nortia (réseau CGP exclusivement)', service_extranet = 'Souscription et gestion 100 % en ligne via l''extranet Nortia', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','SCPI','SCI'] WHERE key = 'Spirica::Nélia Vie';

-- Spirica::Netlife
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica', fonds_euros_contrainte_uc = '25 % minimum en UC obligatoires jusqu''à 100 000 € (depuis le 1er septembre 2016)', frais_arbitrage_note = 'Gratuits en ligne, 50 € + 0,80 % du montant arbitré par courrier (50 € min, 300 € max)', garantie_fonds_euros = 'Capital garanti net des frais de gestion', ticket_entree = '1 000 €', versement_min = '500 € (complémentaires), 150 €/mois (programmés)', distributeur = 'UAF Life Patrimoine', service_extranet = 'Gestion 100 % en ligne (arbitrages, versements, rachats)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Sécurisation des plus-values','Stop-loss','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI'] WHERE key = 'Spirica::Netlife';

-- Spirica::Netlife 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération Spirica, Fonds Euro Objectif Climat', fonds_euros_bonus = '+1,10 % pour versements ≥ 100 000 € sans contrainte UC, +1,50 % avec min 30 % UC (bonus 2026)', fonds_euros_contrainte_uc = 'Aucune contrainte UC pour 100 % fonds euros (jusqu''à 5 M€)', frais_arbitrage_note = 'Gratuit en ligne et arbitrages automatiques, 0,80 % par courrier (50 € min, 300 € max)', garantie_fonds_euros = 'Capital garanti à 98 % net de frais de gestion (2 %)', ticket_entree = '1 000 €', versement_min = '500 € libre, 150 €/mois programmé, 50 € min par support', distributeur = 'Epargnissimo (contrat fermé à la souscription depuis le 15 avril 2026)', service_extranet = 'Souscription et gestion 100 % en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss relatif','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés'] WHERE key = 'Spirica::Netlife 2';

-- --- part_07.sql ---
-- AV contract terms polish — part 07 (OFFSET 280 LIMIT 40)
-- Rewrites only. No UPDATE applied in DB.

-- Spirica::Octavie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica' WHERE key = 'Spirica::Octavie';

-- Spirica::Octavie 3
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = '25 % minimum en UC à chaque versement. EuroSélection #2.1 limité à 60 % maximum par versement.', frais_arbitrage_note = '0,80 % maximum selon la grille Octavie 4', garantie_fonds_euros = 'Capital garanti net de frais de gestion (TMG 0 % brut de frais)', ticket_entree = '100 000 € (versement libre initial), 500 € en versements programmés', versement_min = '5 000 € (versement libre complémentaire), 500 € (versements programmés), 1 500 € par support UC', distributeur = 'UAF Life Patrimoine (plateforme CGP Spirica / Crédit Agricole)', service_extranet = 'Sylvéa (extranet UAF Life Patrimoine, souscription digitale jusqu''à la signature électronique)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','SCI','Produits structurés','Private equity','Fonds datés'] WHERE key = 'Spirica::Octavie 3';

-- Spirica::Octavie 4
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération Spirica', fonds_euros_bonus = 'Bonus +1,10 % à +1,50 % en 2026-2027 sur la part versée en fonds euros (sous conditions)', fonds_euros_contrainte_uc = 'Aucune contrainte UC (ancien seuil 25 % levé depuis juillet 2023). Accessible à 100 % dans la limite de 5 M€ tous contrats confondus', garantie_fonds_euros = 'Capital garanti à 98 % (net des frais de gestion maximaux du fonds)', distributeur = 'UAF Life Patrimoine (filiale à 100 % de Spirica / Crédit Agricole Assurances)', service_extranet = 'Espace client spirica.fr (Mon Compte Spirica)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés','Fonds datés'] WHERE key = 'Spirica::Octavie 4';

-- Spirica::Patrimoine Privé
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Fonds euros plafonné à 5 000 000 € par adhérent (tous contrats Spirica confondus). Un investissement minimal en UC par versement peut être exigé.', distributeur = 'Conseillers en gestion de patrimoine (plateforme Sylvéa)', options_gestion = ARRAY['Gestion libre','Gestion pilotée (profils)'], univers_classes = ARRAY['Fonds euros','OPCVM','SICAV','Actions','Obligations','Diversifiés'] WHERE key = 'Spirica::Patrimoine Privé';

-- Spirica::Patrimoines Opportunités Capitalisation
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Réseau CGP / Primonial', univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','Produits structurés'] WHERE key = 'Spirica::Patrimoines Opportunités Capitalisation';

-- Spirica::PerformanceVie
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Institut du Patrimoine (CGP)', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI'] WHERE key = 'Spirica::PerformanceVie';

-- Spirica::Private Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica (FG 0,7), EuroSélection #2.1, EuroSélection Différé 2', fonds_euros_contrainte_uc = 'Minimum UC sur versements : 25 % jusqu''à 100 000 €, 35 % de 1 M€ à 2 M€, 50 % de 2 M€ à 4 M€. EuroSélection #2.1 plafonné à 60 % (40 % UC minimum)', frais_arbitrage_note = 'Arbitrages gratuits et sans restriction en ligne, 1 % (minimum 45 €) hors ligne', garantie_fonds_euros = 'Actif Général : 100 % du capital. EuroSélection #2.1 : 98 % de la valeur atteinte l''année précédente (garantie partielle)', ticket_entree = '7 500 €', versement_min = '7 500 €', distributeur = 'Nortia (réseau CGP), Haussmann Patrimoine', service_extranet = 'Consultation et transactions en ligne via l''espace client Spirica', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés','Fonds datés'] WHERE key = 'Spirica::Private Vie';

-- Spirica::Private Vie 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica (FG 0,7), EuroSélection #2.1', fonds_euros_contrainte_uc = '25 % UC minimum jusqu''à 1 M€, 35 % entre 1 M€ et 2 M€, 50 % entre 2 M€ et 4 M€. EuroSélection #2.1 plafonné à 60 % par versement (40 % UC obligatoire)', frais_arbitrage_note = '1 % par arbitrage, minimum 45 €', garantie_fonds_euros = 'Actif Général : capital garanti à 100 %. EuroSélection #2.1 : garantie à 98 % de la valeur atteinte l''année précédente', ticket_entree = '7 500 €', versement_min = '7 500 € (versement initial)', distributeur = 'Nortia SA (réseau CGP/CIF), Euodia', service_extranet = 'Gestion en ligne (espace client web), souscription en ligne non disponible (rendez-vous conseiller requis)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Spirica::Private Vie 2';

-- Spirica::Privilège Saint Honoré
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Euro Privilège Saint-Honoré', fonds_euros_bonus = 'Euro Privilège Saint-Honoré 2 (Dynamique) à 2,50 % en 2024', garantie_fonds_euros = 'Capital garanti (TMG 0 % brut de frais de gestion pour 2025)', ticket_entree = '1 000 €', distributeur = 'EDRAC (Edmond de Rothschild Assurances et Conseils France)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','SCI','Private equity','Produits structurés'] WHERE key = 'Spirica::Privilège Saint Honoré';

-- Spirica::Shiva Patrimoine
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Général Spirica', frais_arbitrage_note = 'Premier arbitrage gratuit, puis 0,80 % (minimum 50 €, maximum 300 €) sur les sommes transférées', garantie_fonds_euros = 'Capital garanti à 100 % (actif général traditionnel)', ticket_entree = '30 000 € (versement initial)', versement_min = '5 000 € (versement complémentaire libre), programmés : 160 €/mois, 400 €/trimestre, 720 €/semestre, 1 200 €/an', distributeur = 'UAF Life Patrimoine (réseau CGP, filiale Spirica / Crédit Agricole Assurances)', service_extranet = 'Portail UAF Life Patrimoine (uaflife-patrimoine.fr)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Spirica::Shiva Patrimoine';

-- Spirica::Spirica Capi
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', frais_arbitrage_note = '0,50 % par arbitrage, minimum 15 €', garantie_fonds_euros = 'Capital garanti à 97,7 % (net de frais de gestion)', ticket_entree = '50 000 €', versement_min = '500 €', distributeur = 'UAF Life Patrimoine', options_gestion = ARRAY['Rééquilibrage automatique','Sécurisation des plus-values','Stop-loss','Stop-loss relatif'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','OPCI','ETF','Private equity','Fonds diversifiés','Produits structurés'] WHERE key = 'Spirica::Spirica Capi';

-- Spirica::Spirica Capi 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', fonds_euros_bonus = '+1,10 % en 2025 et 2026 sur versements initiaux et libres complémentaires (jusqu''à +1,50 % chez certains distributeurs)', fonds_euros_contrainte_uc = '75 % maximum en fonds euros par versement (25 % minimum en UC)', frais_arbitrage_note = '0,80 % maximum par opération (minimum 50 €, maximum 300 €), arbitrages gratuits en gestion pilotée et en investissement progressif', garantie_fonds_euros = 'Capital garanti à 97,7 % (net de frais de gestion), garantie annuelle à effet de cliquet', ticket_entree = '50 000 € (personnes morales à l''IS), 1 000 € pour les personnes physiques selon distributeur', versement_min = '500 € (versements programmés), 150 €/mois minimum selon conditions', distributeur = 'Réseau CGP UAF Life Patrimoine (CO Conseils, Fortuna Conseil, etc.)', service_extranet = 'Espace client Spirica en ligne (consultation et opérations)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés','Fonds datés'] WHERE key = 'Spirica::Spirica Capi 2';

-- Spirica::Spirica Essentiel
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'Réseau CGP partenaires Spirica', options_gestion = ARRAY['Gestion libre','Gestion profilée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI','Produits structurés','Private equity'] WHERE key = 'Spirica::Spirica Essentiel';

-- Spirica::Spirica Initial
UPDATE public.investissement_av_contract_terms SET options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion horizon','Gestion sous mandat'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI','Produits structurés','Private equity'] WHERE key = 'Spirica::Spirica Initial';

-- Spirica::Spirica Opportunité 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', frais_arbitrage_note = '0,50 % maximum (proportionnel), aucun arbitrage gratuit par an', garantie_fonds_euros = 'Garantie partielle, capital garanti annuellement net de frais de gestion (environ 97,7 % brut)', ticket_entree = '1 000 €', versement_min = '1 000 € (versement initial), versements complémentaires libres dès 750 €', distributeur = 'Réseaux CGP/CGPI indépendants', service_extranet = 'Espace client spirica.fr', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés','Fonds datés'] WHERE key = 'Spirica::Spirica Opportunité 2';

-- Spirica::Spirica Opportunités
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération, Fonds Euro Objectif Climat, Fonds Euro Général', frais_arbitrage_note = 'Arbitrages en ligne', garantie_fonds_euros = 'Capital garanti (Fonds Euro Général et Fonds Euro Nouvelle Génération). Fonds Euro Objectif Climat : garantie selon conditions contractuelles', ticket_entree = '1 000 € (versement initial)', versement_min = '150 € (versements programmés), 750 € (versements complémentaires libres)', distributeur = 'Réseau CGP via UAF Life Patrimoine (ex-LifeSide Patrimoine), contrat fermé à la commercialisation', service_extranet = 'Sylvéa (plateforme Spirica, code produit 1101)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','Private equity','Produits structurés'] WHERE key = 'Spirica::Spirica Opportunités';

-- Spirica::Spirica Perspective 8
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro UAF Nouvelle Génération', frais_arbitrage_note = 'Aucun arbitrage gratuit par an, 0,80 % du montant transféré (minimum 50 €)', garantie_fonds_euros = 'Capital garanti à 97,7 % net de frais de gestion annuels (2,30 % maximum), TMG 0 % brut de frais pour 2025', ticket_entree = '50 000 €', distributeur = 'UAF Life Patrimoine', service_extranet = 'Espace client Spirica (accès via CGP / UAF Life Patrimoine)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','SCI','Private equity','Fonds datés'] WHERE key = 'Spirica::Spirica Perspective 8';

-- Spirica::Spirimmo
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica', frais_arbitrage_note = 'Gratuits en ligne', garantie_fonds_euros = 'Capital garanti', ticket_entree = '50 000 €', versement_min = '1 500 €', distributeur = 'Barclays / Spirica', options_gestion = ARRAY['Investissement progressif','Garantie plancher décès','Sécurisation des plus-values','Allocation constante'], univers_classes = ARRAY['Fonds euros','SCPI','OPCVM'] WHERE key = 'Spirica::Spirimmo';

-- Spirica::Version Absolue
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', frais_arbitrage_note = '0,80 % maximum par arbitrage, minimum 50 €, arbitrages automatiques gratuits selon options souscrites', garantie_fonds_euros = 'Capital garanti à 97,7 % net de frais de gestion annuels de 2,3 %', ticket_entree = '1 000 €', versement_min = '500 €', distributeur = 'UAF Life Patrimoine (réseau CGP partenaires)', service_extranet = 'Espace en ligne pour arbitrages, versements et rachats', options_gestion = ARRAY['Réallocations automatiques','Profils pilotés'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs'] WHERE key = 'Spirica::Version Absolue';

-- Spirica::Version Absolue 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', fonds_euros_bonus = 'Offres bonus ciblées en 2026 (modalités non détaillées)', fonds_euros_contrainte_uc = '25 % minimum d''UC sur chaque versement vers le fonds euros', frais_arbitrage_note = '1 arbitrage gratuit par an, puis 0,80 % (minimum 50 €)', garantie_fonds_euros = 'Capital garanti à 97,7 % (garantie partielle Spirica)', ticket_entree = '1 000 €', versement_min = '500 € (versements complémentaires), 150 €/mois (versements programmés)', distributeur = 'UAF Life Patrimoine', service_extranet = 'Espace client en ligne via spirica.fr ou distributeur', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés','Fonds datés'] WHERE key = 'Spirica::Version Absolue 2';

-- Spirica::Version Essentielle
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Nouvelle Génération', fonds_euros_bonus = 'Offres bonus ponctuelles disponibles par avenant sur le Fonds Euro Nouvelle Génération', fonds_euros_contrainte_uc = 'Pas de seuil minimum UC (l''assureur se réserve la possibilité d''en instaurer un)', frais_arbitrage_note = '0,80 % maximum par opération, minimum 50 € en gestion libre. Arbitrages gratuits en gestion pilotée', garantie_fonds_euros = 'Capital garanti à 100 % sur Fonds Euro Général. Fonds Euro Nouvelle Génération : garantie partielle (97,70 % net de frais de gestion)', ticket_entree = '1 000 € (versement initial minimum)', versement_min = '150 € par support minimum (versements complémentaires)', distributeur = 'YCAP', service_extranet = 'Sylvéa (plateforme Spirica, produits 1134, 8813, 1113)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés'] WHERE key = 'Spirica::Version Essentielle';

-- Spirica::YCAP Essentiel
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Spirica', garantie_fonds_euros = 'Capital garanti net de frais', distributeur = 'YCAP Finance', univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI'] WHERE key = 'Spirica::YCAP Essentiel';

-- Spirica::Yomoni Retraite +
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro PER Nouvelle Génération', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Yomoni', options_gestion = ARRAY['Gestion pilotée ETF','Gestion pilotée multi-actifs','Gestion libre','Profil prudent','Profil équilibré','Profil dynamique','Désensibilisation progressive'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','Private equity'] WHERE key = 'Spirica::Yomoni Retraite +';

-- Suravenir::APRIL PERIN AVENIR
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euros Retraite Suravenir', frais_arbitrage_note = '0 % hors immobilier', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'APRIL', options_gestion = ARRAY['Gestion horizon','Gestion libre','Gestion sous mandat'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::APRIL PERIN AVENIR';

-- Suravenir::Armada Capi 4047
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général de Suravenir', fonds_euros_bonus = 'Taux bonifié jusqu''à 3,10 % selon la part d''UC dans l''encours', fonds_euros_contrainte_uc = 'Quota UC requis pour bénéficier du taux bonifié', frais_arbitrage_note = '5 arbitrages gratuits par an', garantie_fonds_euros = 'Pas de garantie en capital au moins égale aux montants nets investis (rendement décidé par l''assureur)', ticket_entree = '1 000 €', versement_min = '1 000 € (versement initial), versements complémentaires : 3 000 € (ponctuel), 150 € (programmé)', distributeur = 'La Financière d''Orion (Finorion), réseau CGP exclusif', service_extranet = 'Espace client Prévi-Direct (previ-direct.com)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Armada Capi 4047';

-- Suravenir::Armada Capi 4049
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général de Suravenir', fonds_euros_bonus = '2,90 % si encours ≥ 50 % UC, 3,10 % si encours ≥ 70 % UC (taux 2024)', fonds_euros_contrainte_uc = 'Bonus progressif à partir de 50 % UC (pas de minimum obligatoire, grille de taux distinguant gestion libre / ≥ 50 % UC / ≥ 70 % UC)', frais_arbitrage_note = '5 arbitrages gratuits par an (0 % de la somme arbitrée)', garantie_fonds_euros = 'Garantie en capital au moins égale aux montants nets investis (nette de frais de gestion)', ticket_entree = '1 000 €', versement_min = '1 000 € (versement initial), versements complémentaires : 3 000 € (ponctuel), 150 € (programmé)', distributeur = 'La Financière d''Orion (Finorion), réseau CGPI exclusif', service_extranet = 'Espace client Prévi-Direct (previ-direct.com)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Armada Capi 4049';

-- Suravenir::Armada Capi PM 4033
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général de Suravenir', fonds_euros_bonus = 'Pas de bonus UC pour ce contrat', fonds_euros_contrainte_uc = 'Aucun quota UC requis pour le taux de base 2,20 %', frais_arbitrage_note = '0,80 % de la somme arbitrée, minimum 40 €, avec 5 arbitrages gratuits par an', garantie_fonds_euros = 'Garantie en capital au moins égale aux montants nets investis (nette des frais de gestion annuels)', ticket_entree = '10 000 €', versement_min = 'Non précisé', distributeur = 'La Financière d''Orion (Finorion), réseau CGP exclusif', service_extranet = 'Extranet partenaires Prévi-Direct / espace client Finorion (previ-direct.com)', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage','Stop-loss','Sécurisation des plus-values','Investissement progressif','Rééquilibrage automatique','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Armada Capi PM 4033';

-- Suravenir::Armada Capi PM Opportunités 4048
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général de Suravenir', fonds_euros_bonus = 'Taux bonifié potentiel via opérations commerciales Suravenir (jusqu''à 4,20 % net en 2024 pour les souscriptions nouvelles avec ≥ 70 % UC)', frais_arbitrage_note = '0,80 % par arbitrage (taux maximal), aucun arbitrage gratuit', garantie_fonds_euros = 'Garantie en capital au moins égale aux montants nets investis. Pénalité de rachat sur fonds euros : 3 % les 2 premières années, 2 % les 2 années suivantes', ticket_entree = '50 000 €', versement_min = '50 000 € (versement initial minimum)', distributeur = 'La Financière d''Orion (Finorion)', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Armada Capi PM Opportunités 4048';

-- Suravenir::Armada PEA 4037
UPDATE public.investissement_av_contract_terms SET distributeur = 'Finorion / La Financière d''Orion', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['OPCVM','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::Armada PEA 4037';

-- Suravenir::Armada Vie 3200
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général de Suravenir', fonds_euros_bonus = 'Jusqu''à 3,10 % selon la part d''UC (taux de base 2,40 % en gestion libre, 2,70 % à 3,10 % en gestion sous mandat)', fonds_euros_contrainte_uc = 'Bonus conditionné à la proportion d''UC dans le contrat (taux maximum 3,10 %)', frais_arbitrage_note = '5 arbitrages gratuits par an', garantie_fonds_euros = 'Garantie en capital', ticket_entree = '1 000 € à 5 000 € selon la source', versement_min = '150 € (versements programmés), 3 000 € (versements complémentaires libres)', distributeur = 'Finorion / La Financière d''Orion (réseau CGPI exclusif)', service_extranet = 'Prévi-Direct (previ-direct.com)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Stop-loss','Sécurisation des plus-values','Investissement progressif','Rééquilibrage','Dynamisation des plus-values fonds euros'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Armada Vie 3200';

-- Suravenir::Armada Vie 3204
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général de Suravenir', fonds_euros_bonus = '2,70 % à 3,10 % en gestion sous mandat, 2,40 % à 3,10 % en gestion libre selon conditions UC (paliers à 50 % et 70 % d''UC)', fonds_euros_contrainte_uc = 'Quota UC pour obtenir les taux bonifiés (3,00 % à 3,10 %)', frais_arbitrage_note = 'Gestion sous mandat d''arbitrage facturée 0,75 % supplémentaire par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 500 € à 5 000 € selon la source', distributeur = 'La Financière d''Orion (réseau Finorion), contrat exclusif CGP', service_extranet = 'Espace client Finorion via previ-direct.com', univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Armada Vie 3204';

-- Suravenir::Assurance-VieAcqua
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = 'Non précisé', versement_min = 'Non précisé', distributeur = 'assurancevie.com (reprise du contrat Oney en mars 2022, non commercialisé à la souscription)', options_gestion = ARRAY['Gestion libre','Gestion profilée','Sécurisation automatique des plus-values','Lissage des investissements','Dynamisation de l''épargne'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI'] WHERE key = 'Suravenir::Assurance-VieAcqua';

-- Suravenir::Avantages Capitalisation 2234
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général de Suravenir', fonds_euros_bonus = '3,00 % si encours UC ≥ 50 %, 3,20 % si encours UC ≥ 70 % (gestion libre). Mandat d''arbitrage sans bonus : 2,80 %', fonds_euros_contrainte_uc = 'Pas de contrainte minimale UC pour accéder au fonds euros, bonus de rendement si encours ≥ 50 % ou ≥ 70 % en UC', garantie_fonds_euros = 'Garantie en capital au moins égale aux montants nets investis (hors frais de gestion annuels)', ticket_entree = 'Non précisé', versement_min = 'Non précisé', distributeur = 'Banque Privée Européenne (BPE)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI','Produits structurés'] WHERE key = 'Suravenir::Avantages Capitalisation 2234';

-- Suravenir::Avantages Capitalisation 2251
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Banque Privée Européenne', options_gestion = ARRAY['Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI'] WHERE key = 'Suravenir::Avantages Capitalisation 2251';

-- Suravenir::Avantages Capitalisation PM 2252
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = 'Bonus selon le taux d''UC en portefeuille', frais_arbitrage_note = 'Arbitrages libres et illimités', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Louvre Banque Privée (ex-BPE)', options_gestion = ARRAY['Arbitrages programmés','Gestion sous mandat (4 profils dont 1 ESG)'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI'] WHERE key = 'Suravenir::Avantages Capitalisation PM 2252';

-- Suravenir::Avantages Capitalisation PM 4034
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Général Suravenir', fonds_euros_bonus = 'Jusqu''à 3,20 % si condition UC remplie', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'Crédit Mutuel Arkéa / Banque Privée Européenne (Louvre Banque Privée)', options_gestion = ARRAY['Mandat de gestion Conviction','Arbitrage libre'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Private equity','Infrastructure','Dette privée'] WHERE key = 'Suravenir::Avantages Capitalisation PM 4034';

-- Suravenir::BPE Vie 2232
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros BPE Vie', frais_arbitrage_note = '0,60 %, minimum 15 €, gratuit du fonds euros vers UC', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '100 000 €', versement_min = '100 000 €', distributeur = 'BPE (Louvre Banque Privée / La Banque Postale)', options_gestion = ARRAY['Dynamisation des plus-values','Sécurisation des plus-values','Gestion déléguée'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','SCI'] WHERE key = 'Suravenir::BPE Vie 2232';

-- Suravenir::BPE Vie 2250
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,60 % du montant arbitré, minimum 15 €, gratuit pour le basculement du fonds euros vers UC', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '100 000 €', versement_min = '100 000 €', distributeur = 'BPE (Louvre Banque Privée)', options_gestion = ARRAY['Gestion déléguée','Dynamisation des plus-values','Sécurisation des plus-values'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','SCI'] WHERE key = 'Suravenir::BPE Vie 2250';

-- Suravenir::Capi Vie Plus PM Opportunités 4038
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 arbitrage gratuit par an, gratuit dans le cadre des options d''arbitrages programmés', ticket_entree = '100 000 € (notice n°4038), 50 000 € selon le tableau de frais 2023/2024 (version n°4052)', versement_min = '50 000 € par versement libre (notice n°4038), 10 000 € minimum par support alimenté', distributeur = 'Vie Plus (réseau CGPI)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Capi Vie Plus PM Opportunités 4038';

-- --- part_08.sql ---
-- Réécriture texte investissement_av_contract_terms — OFFSET 320 LIMIT 40
-- Nettoyage rédactionnel uniquement, aucun UPDATE appliqué en base.

-- Suravenir::Capi Vie Plus PM Opportunités 4052
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,80 % des montants arbitrés (+ 0,10 % ETF)', ticket_entree = '50 000 € minimum (10 000 € par compartiment en gestion libre ou mandat)', versement_min = '50 000 € (versements libres), 10 000 € par support. Plafond 5 000 000 €', distributeur = 'Vie Plus (Suravenir), exclusivement via CGP', service_extranet = 'Espace personnel Vie Plus, documents dématérialisés', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Produits structurés'] WHERE key = 'Suravenir::Capi Vie Plus PM Opportunités 4052';

-- Suravenir::Capieurope PEA 3176
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages libres sans frais', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['UC actions éligibles PEA','OPCVM éligibles PEA','ETF éligibles PEA'] WHERE key = 'Suravenir::Capieurope PEA 3176';

-- Suravenir::Capieurope PEA PME 3175
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros PEA PME Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (personnes physiques)', fonds_euros_contrainte_uc = 'Bonus conditionné à la part UC', frais_arbitrage_note = 'Arbitrages libres et illimités', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '500 €', distributeur = 'Primonial', options_gestion = ARRAY['Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','UC OPCVM','ETF','Valeurs éligibles PEA PME'] WHERE key = 'Suravenir::Capieurope PEA PME 3175';

-- Suravenir::Capitalisation Vie Plus 4041
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = 'Jusqu''à 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = '30 % minimum en UC', garantie_fonds_euros = 'Capital garanti', ticket_entree = '10 000 €', versement_min = '750 €', distributeur = 'Vie Plus', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','Private equity'] WHERE key = 'Suravenir::Capitalisation Vie Plus 4041';

-- Suravenir::Capitalisation Vie Plus 4050
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %. Mandat d''arbitrage : 2,80 % (bonus aux mêmes conditions)', fonds_euros_contrainte_uc = 'Bonus si 50 % ou 70 % de l''encours en UC. Sans condition : 2,50 % (gestion libre) ou 2,80 % (mandat)', frais_arbitrage_note = '0,80 % (minimum 40 €), 5 arbitrages gratuits par an, + 0,10 % sur ETF', garantie_fonds_euros = 'Capital garanti net de frais de versement et de gestion', ticket_entree = '10 000 € (5 000 € par compartiment si gestion libre + mandat)', versement_min = '5 000 € (versements libres), 750 €/mois, 1 500 €/trimestre, 3 000 €/semestre ou 6 000 €/an (programmés)', distributeur = 'Vie Plus (réseau CGP Suravenir)', service_extranet = 'oriadys.suravenir.fr (espace partenaires)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Capitalisation Vie Plus 4050';

-- Suravenir::Capitalisation Vie Plus PM 4042
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = 'Aucune bonification UC pour cette génération (4042)', fonds_euros_contrainte_uc = 'Conditions du fonds euros détaillées auprès du conseiller', frais_arbitrage_note = '0,80 % des montants arbitrés (minimum 40 €), 1 arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti à hauteur des sommes versées nettes de frais de versement, diminuées des frais annuels de gestion', ticket_entree = '10 000 € (10 000 € par compartiment gestion libre, 5 000 € pour l''ouverture du compartiment mandat)', versement_min = 'Versements libres : 5 000 € (1 000 € par support en gestion libre). Programmés : 750 €/mois', distributeur = 'Vie Plus (Suravenir / Crédit Mutuel Arkéa), exclusivement via CGP', service_extranet = 'Espace personnel Vie Plus, documents dématérialisés', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage','Investissement progressif','Sécurisation des plus-values','Stop-loss relatif','Rééquilibrage automatique','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Capitalisation Vie Plus PM 4042';

-- Suravenir::Capitalisation Vie Plus PM 4051
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %. Mandat d''arbitrage : 2,80 %', fonds_euros_contrainte_uc = '30 % minimum en UC à chaque versement sur le fonds euros', frais_arbitrage_note = 'Minimum 40 €, 1 arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '10 000 €', versement_min = 'Programmés : 750 €/mois, 1 500 €/trimestre, 3 000 €/semestre ou 6 000 €/an', distributeur = 'Vie Plus (réseau CGP Primonial)', service_extranet = 'Espace client Previ Direct (previ-direct.com), espace partenaires Oriadys (oriadys.vieplus.fr)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Mandat d''arbitrage','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','Private equity'] WHERE key = 'Suravenir::Capitalisation Vie Plus PM 4051';

-- Suravenir::Chabrières Vie 3196
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %. Mandat d''arbitrage : 2,80 %', fonds_euros_contrainte_uc = 'Aucune condition UC en gestion libre. Bonus si UC ≥ 50 % ou ≥ 70 % de l''encours', frais_arbitrage_note = '0,80 % de la somme arbitrée (minimum 40 €), 5 arbitrages gratuits par an', garantie_fonds_euros = 'Capital garanti au moins égal aux montants nets investis', ticket_entree = '10 000 €', distributeur = 'Banque Chabrières (Groupe Les Mousquetaires)', service_extranet = 'espaceclient.suravenir.fr', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Chabrières Vie 3196';

-- Suravenir::Climb Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = 'Jusqu''à 3,00 % si UC ≥ 50 %, jusqu''à 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = 'Taux bonifiés conditionnés à 50 % ou 70 % d''UC dans l''encours', frais_arbitrage_note = 'Arbitrages gratuits, 5 gratuits par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '500 € (versement initial)', distributeur = 'Vie Plus (Suravenir / Crédit Mutuel Arkéa)', service_extranet = 'Espace client Suravenir (espaceclient.suravenir.fr)', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','SCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Climb Vie';

-- Suravenir::COLBR LIFE
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2', fonds_euros_contrainte_uc = '30 % minimum en UC sur chaque versement', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Colbr', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Gestion profilée Shake','Gestion profilée Escalate','Gestion profilée Balance','Gestion profilée Care'], univers_classes = ARRAY['Fonds euros','ETF'] WHERE key = 'Suravenir::COLBR LIFE';

-- Suravenir::Cristalliance Avenir 2201
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '2,80 % si UC ≥ 50 %, 3,00 % si UC ≥ 70 %', fonds_euros_contrainte_uc = 'Aucun quota UC obligatoire en gestion libre. Bonifications si UC ≥ 50 % ou ≥ 70 % de l''encours', frais_arbitrage_note = '1 % des montants arbitrés (minimum 50 €), 1 arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti au moins égal aux montants nets investis', ticket_entree = '50 €', versement_min = '50 €', distributeur = 'Stellium Courtage', service_extranet = 'previ-direct.com (espace client Stellium Courtage)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion profilée','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','OPCI','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Cristalliance Avenir 2201';

-- Suravenir::Cristalliance Avenir Capi 2224
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre et mandat). Mandat sans bonus : 2,80 %', fonds_euros_contrainte_uc = 'Aucune contrainte UC minimale. Bonus si encours ≥ 50 % ou ≥ 70 % en UC', frais_arbitrage_note = '1 % des montants arbitrés (minimum 50 €), 1 arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti au moins égal aux montants nets investis (hors frais de gestion)', ticket_entree = '50 €', versement_min = '50 € (versement initial)', distributeur = 'Stellium Courtage (Toulouse)', service_extranet = 'previ-direct.com (espace client Stellium Courtage)', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Cristalliance Avenir Capi 2224';

-- Suravenir::Cristalliance Avenir Capi PM 2225
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 % par arbitrage (minimum 50 €), aucun arbitrage gratuit', ticket_entree = '100 000 €', distributeur = 'Stellium Courtage', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['ETF','SCPI','SCI','OPCI','Produits structurés','Private equity'] WHERE key = 'Suravenir::Cristalliance Avenir Capi PM 2225';

-- Suravenir::Cristalliance Capi Patrim 2238
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre et mandat)', fonds_euros_contrainte_uc = 'Aucune contrainte UC obligatoire. Bonification à partir de 50 % d''UC dans l''encours', frais_arbitrage_note = '1 % de la somme arbitrée (minimum 50 €), 5 arbitrages gratuits par an', garantie_fonds_euros = 'Capital garanti', ticket_entree = '50 000 €', versement_min = '50 000 € (versement initial)', distributeur = 'Stellium Courtage', service_extranet = 'Espace client Suravenir (espaceclient.suravenir.fr)', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Cristalliance Capi Patrim 2238';

-- Suravenir::Croissance Avenir 2178
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2, Suravenir Opportunités 2', fonds_euros_bonus = 'Suravenir Opportunités 2 : +2 % net si UC ≥ 50 % (objectif 4,50 % non garanti). Suravenir Rendement 2 : 2,10 % net (gestion libre), 2,50 % net en mandat', fonds_euros_contrainte_uc = 'Suravenir Rendement 2 : 30 % UC minimum. Suravenir Opportunités 2 : aucune contrainte au taux de base, 50 % UC minimum pour le bonus de +2 %', frais_arbitrage_note = 'Arbitrages gratuits en ligne. 0,10 % signalés sur ETF/trackers', garantie_fonds_euros = 'Suravenir Rendement 2 : garantie 99,4 % net de frais. Suravenir Opportunités 2 : garantie partielle 97 % par an', ticket_entree = '100 € (gestion libre), 1 000 € (gestion pilotée)', versement_min = '100 € (versement libre), 50 €/mois (programmé)', distributeur = 'Epargnissimo', service_extranet = 'Espace client Epargnissimo, gestion 100 % en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Investissement progressif'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Croissance Avenir 2178';

-- Suravenir::Croissance Avenir Capitalisation 2179
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2, Suravenir Opportunités 2', fonds_euros_bonus = 'Suravenir Opportunités 2 : +2,00 % net (objectif 4,50 % net), sans condition UC', fonds_euros_contrainte_uc = 'Suravenir Opportunités 2 : 30 % minimum en UC non garanties. Suravenir Rendement 2 : pas de condition UC', frais_arbitrage_note = 'Arbitrages gratuits et illimités, y compris programmés', garantie_fonds_euros = 'Suravenir Rendement 2 : garantie 99,4 % par an. Suravenir Opportunités 2 : garantie partielle 97 % par an', ticket_entree = '100 € (gestion libre), 1 000 € (gestion pilotée Carmignac ou Lazard Frères Gestion)', versement_min = '100 € (versement libre), 50 € (versement programmé)', distributeur = 'Epargnissimo', service_extranet = 'Espace client epargnissimo.fr (suivi, arbitrages, rachats en ligne)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Croissance Avenir Capitalisation 2179';

-- Suravenir::Digital Capi Prime 2266
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2, Suravenir Opportunités 2', fonds_euros_bonus = 'Suravenir Opportunités 2 : 3,00 % net sans condition UC. Suravenir Rendement 2 : 2,10 % (gestion libre) ou 2,50 % (mandat)', fonds_euros_contrainte_uc = 'Suravenir Rendement 2 : 30 % minimum en UC. Suravenir Opportunités 2 : aucune condition UC', frais_arbitrage_note = 'Arbitrage gratuit, + 0,10 % par opération sur ETF', garantie_fonds_euros = 'Suravenir Rendement 2 : 99,4 % du capital brut de frais. Suravenir Opportunités 2 : 97 % du capital brut de frais', ticket_entree = '100 € (gestion libre), 300 € (gestion pilotée)', versement_min = '25 € (versements libres complémentaires), 25 €/mois (programmés)', distributeur = 'Altaprofits', service_extranet = 'Espace client Altaprofits, gestion en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Digital Capi Prime 2266';

-- Suravenir::Digital Vie Prime 2265
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2, Suravenir Opportunités 2', fonds_euros_contrainte_uc = 'Aucune contrainte UC obligatoire', frais_arbitrage_note = 'Arbitrages illimités gratuits (à la demande et automatiques), + 0,10 % sur ETF', garantie_fonds_euros = 'Capital garanti net de frais de gestion : 99,4 % (Rendement 2), 97 % (Opportunités 2)', ticket_entree = '100 €', versement_min = '100 €', distributeur = 'Altaprofits', service_extranet = 'altaprofits.com', options_gestion = ARRAY['Gestion libre','Gestion pilotée (10 profils Lazard Frères Gestion + Amundi)','Arbitrage automatique','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','ETF','OPCVM','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::Digital Vie Prime 2265';

-- Suravenir::E Sélience 2180
UPDATE public.investissement_av_contract_terms SET distributeur = 'CGP Entrepreneurs', univers_classes = ARRAY['Fonds euros','UC'] WHERE key = 'Suravenir::E Sélience 2180';

-- Suravenir::E Sélience Capi 2181
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_contrainte_uc = 'Taux bonifié 2,83 % si UC ≥ 50 %, 3,03 % si UC ≥ 70 %', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '2 000 €', versement_min = '2 000 € (versement initial)', distributeur = 'CGP Entrepreneurs', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','FCPR','Produits structurés'] WHERE key = 'Suravenir::E Sélience Capi 2181';

-- Suravenir::e-novation Vie Plus 3197
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement', fonds_euros_contrainte_uc = '30 % minimum en UC pour accéder au fonds euros', frais_arbitrage_note = 'Arbitrages en ligne illimités et gratuits', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Vie Plus', options_gestion = ARRAY['Gestion pilotée Yomoni (obligatoire à la souscription)','Gestion libre (possible après souscription)'], univers_classes = ARRAY['Fonds euros','ETF','OPCVM'] WHERE key = 'Suravenir::e-novation Vie Plus 3197';

-- Suravenir::Ethic Vie 2196
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement, Suravenir Opportunités 2', fonds_euros_bonus = 'Jusqu''à 4,50 % sur Opportunités 2 selon la part UC', fonds_euros_contrainte_uc = '30 % minimum en UC pour Suravenir Rendement, 50 % minimum pour Suravenir Opportunités 2', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti net de frais de gestion (Rendement 99,4 %/an, Opportunités 97 %/an)', ticket_entree = '500 €', versement_min = '500 €', distributeur = 'Patrimea', options_gestion = ARRAY['Limitation des pertes','Dynamisation des plus-values','Sécurisation des plus-values','Investissement progressif','Allocation constante'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::Ethic Vie 2196';

-- Suravenir::Ethic Vie 2253
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2', fonds_euros_bonus = '3,50 % (30-50 % UC), 4,00 % (50-70 % UC), 4,50 % (> 70 % UC), taux nets 2025', fonds_euros_contrainte_uc = 'Aucune contrainte UC sur Suravenir Opportunités 2 (accès 100 % en gestion libre). Suravenir Rendement 2 : 30 % UC minimum par versement', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Suravenir Rendement 2 : capital garanti à 100 % net de frais (effet cliquet annuel). Suravenir Opportunités 2 : garantie partielle', ticket_entree = '500 € (versement initial)', versement_min = '100 € (versements libres), 50 €/mois (programmés)', distributeur = 'Patrimea (Meilleurtaux Placement)', service_extranet = 'Espace client ethicvie.com / placement.meilleurtaux.com', options_gestion = ARRAY['Gestion libre','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','Produits structurés'] WHERE key = 'Suravenir::Ethic Vie 2253';

-- Suravenir::Ethic Vie 2264
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2 (principal), Suravenir Rendement 2 (fermé aux versements)', fonds_euros_bonus = 'Suravenir Opportunités 2 : 3,00 % (< 30 % UC), 3,50 % (30-50 %), 4,00 % (50-70 %), 4,50 % (> 70 %), taux nets', fonds_euros_contrainte_uc = 'Suravenir Opportunités 2 : 30 % UC minimum pour accès (frais de gestion 3 %, capital garanti 97 %). Suravenir Rendement 2 : 30 % UC minimum par versement', frais_arbitrage_note = 'Arbitrages gratuits et illimités en ligne', garantie_fonds_euros = 'Suravenir Rendement 2 : 99,4 % (frais 0,6 %). Suravenir Opportunités 2 : 97 % (frais 3 %)', ticket_entree = '500 €', versement_min = '100 € (25 € par support), programmés dès 50 €/mois', distributeur = 'Patrimea (Meilleurtaux Placement)', service_extranet = 'Espace client en ligne (gestion, arbitrages, versements)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::Ethic Vie 2264';

-- Suravenir::Excelcius Capi 2242
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %. Mandat d''arbitrage : 2,80 %', fonds_euros_contrainte_uc = 'Aucune contrainte UC minimale. Bonus conditionnés à UC ≥ 50 % ou ≥ 70 % de l''encours', frais_arbitrage_note = '0,80 % du montant arbitré (minimum 15 €, maximum 200 €). Gestion pilotée : + 0,50 %', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '20 000 €', versement_min = '1 000 € (versements libres complémentaires)', distributeur = 'Arkéa Banque Privée (Crédit Mutuel Arkéa)', service_extranet = 'Espace client Suravenir (espaceclient.suravenir.fr)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion sous mandat'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','Private equity'] WHERE key = 'Suravenir::Excelcius Capi 2242';

-- Suravenir::EXCELCIUS CAPI 2279
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre et mandat). Mandat d''arbitrage : 2,80 %', fonds_euros_contrainte_uc = 'Bonus conditionné à UC ≥ 50 % (3,00 %) ou ≥ 70 % (3,20 %). Sans condition : 2,50 % (gestion libre) ou 2,80 % (mandat)', frais_arbitrage_note = '0,50 % de la somme arbitrée (minimum 0 €)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '5 000 €', distributeur = 'Arkéa Banque Privée (Crédit Mutuel Arkéa)', service_extranet = 'Espace client Suravenir (consultations, arbitrages, rachats)', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage','Sécurisation des plus-values','Stop-loss relatif','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Fonds datés'] WHERE key = 'Suravenir::EXCELCIUS CAPI 2279';

-- Suravenir::Excelcius Capi PM 2243
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre). Mandat d''arbitrage : 2,80 %', fonds_euros_contrainte_uc = '60 % minimum d''UC à la souscription (contrat personnes morales)', frais_arbitrage_note = '0,50 % de la somme arbitrée (minimum 0 €), aucun arbitrage gratuit', garantie_fonds_euros = 'Pas de garantie en capital au moins égale aux montants nets investis selon le DIC PRIIPs 11/2025', ticket_entree = '50 000 € à la souscription (maximum 2 000 000 €), 10 000 € par compartiment en mandat, 1 000 € par support', versement_min = '50 000 € (souscription)', distributeur = 'Arkéa Banque Privée (Federal Finance), réseau exclusif, hors courtage en ligne', service_extranet = 'espaceclient.suravenir.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Rééquilibrage automatique','Investissement progressif','Sécurisation des plus-values','Stop-loss','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Excelcius Capi PM 2243';

-- Suravenir::EXCELCIUS CAPI PM 2280
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre et mandat)', fonds_euros_contrainte_uc = 'Pas de quota UC obligatoire en gestion libre. Bonus si UC ≥ 50 % ou ≥ 70 %', frais_arbitrage_note = '0,60 % du montant arbitré (minimum 15 €), aucun arbitrage gratuit. Rachat sans frais (hors ETF) dès la 4e année', garantie_fonds_euros = 'Pas de garantie en capital au moins égale aux montants nets investis selon le DIC (rendement décidé par l''assureur)', ticket_entree = '20 000 € (indicatif, variante E9 60/40 à 40 000 €)', versement_min = '1 000 € (versements libres, indicatif)', distributeur = 'Arkéa Banque Privée (Federal Finance)', service_extranet = 'arkeabanqueprivee.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::EXCELCIUS CAPI PM 2280';

-- Suravenir::Excelcius Vie 2241
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre). Mandat d''arbitrage : 2,80 %', fonds_euros_contrainte_uc = 'Bonus conditionnel : UC ≥ 50 % (3,00 %) ou ≥ 70 % (3,20 %) en gestion libre. Mandat d''arbitrage : 2,80 % sans quota UC', frais_arbitrage_note = '0,80 % par opération (minimum 15 €, maximum 200 €). Gestion pilotée : + 0,50 %/an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '20 000 €', distributeur = 'Arkéa Banque Privée (Crédit Mutuel Arkéa)', service_extranet = 'Gestion 100 % en ligne (consultation, versements, arbitrages, rachats)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::Excelcius Vie 2241';

-- Suravenir::EXCELCIUS VIE 2278
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre)', fonds_euros_contrainte_uc = 'Bonus conditionné à UC ≥ 50 % ou ≥ 70 % de l''encours', frais_arbitrage_note = '0,50 % de la somme arbitrée (minimum 0 €). Mandat d''arbitrage : + 0,50 %/an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '5 000 € (versement initial)', versement_min = '1 000 € (versement libre)', distributeur = 'Arkéa Banque Privée (Crédit Mutuel Arkéa)', service_extranet = 'Gestion en ligne disponible', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Mandat d''arbitrage','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::EXCELCIUS VIE 2278';

-- Suravenir::Feodus Assurance Vie 3195
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement', fonds_euros_contrainte_uc = '30 % minimum en UC', frais_arbitrage_note = 'Arbitrages gratuits en ligne', garantie_fonds_euros = 'Capital garanti', distributeur = 'Feodus Finance', univers_classes = ARRAY['Fonds euros','UC OPCVM','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::Feodus Assurance Vie 3195';

-- Suravenir::Feodus Capitalisation 4044
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre). Mandat d''arbitrage : 2,80 %, mêmes paliers de bonus', frais_arbitrage_note = '0,80 % de la somme arbitrée (minimum 40 €), 5 arbitrages gratuits par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '10 000 € (versement initial)', versement_min = '10 000 € (versement initial)', distributeur = 'Feodus Finance', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCI','Private equity','Fonds datés'] WHERE key = 'Suravenir::Feodus Capitalisation 4044';

-- Suravenir::Feodus PEA Assurance 3194
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti', distributeur = 'Feodus Finance', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','UC actions éligibles PEA','OPCVM éligibles PEA','ETF éligibles PEA'] WHERE key = 'Suravenir::Feodus PEA Assurance 3194';

-- Suravenir::Fid'Essor Stratégie Patrimoine 3183
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre et mandat). Mandat sans condition : 2,80 %', fonds_euros_contrainte_uc = 'Bonus conditionnel : 50 % ou 70 % d''UC dans l''encours total', frais_arbitrage_note = '0,80 % de la somme arbitrée (minimum 40 €), 5 arbitrages gratuits par an', garantie_fonds_euros = 'Capital garanti', ticket_entree = '50 € (version L4/3205) ou 500 € (version F2)', versement_min = '50 € (version L4/3205) ou 500 € (version F2)', distributeur = 'Vie Plus (Suravenir / Crédit Mutuel Arkéa)', service_extranet = 'espaceclient.suravenir.fr', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Fid''Essor Stratégie Patrimoine 3183';

-- Suravenir::Fid'Essor Stratégie Patrimoine 3205
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 % (gestion libre et mandat). Mandat sans condition : 2,80 %', fonds_euros_contrainte_uc = 'Bonus conditionné à 50 % ou 70 % d''UC. Taux de base 2,50 % sans contrainte UC', frais_arbitrage_note = '0,80 % (minimum 40 €), 5 arbitrages gratuits par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '50 €', versement_min = '50 €', distributeur = 'Vie Plus (Suravenir / Crédit Mutuel Arkéa), exclusivement via CGPI', service_extranet = 'Espace client Suravenir (intra.suravenir.fr)', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage','Sécurisation des plus-values','Stop-loss relatif','Investissement progressif','Rééquilibrage automatique','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Fid''Essor Stratégie Patrimoine 3205';

-- Suravenir::Fid'Essor Stratégie Retraite 3184
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = 'Bonus conditionné à 50 % ou 70 % d''UC dans l''encours', frais_arbitrage_note = '0,80 % de la somme arbitrée (minimum 40 €), 5 arbitrages gratuits par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '500 €', distributeur = 'Vie Plus / Finorion (réseau CGP)', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Fid''Essor Stratégie Retraite 3184';

-- Suravenir::Fid'Essor Stratégie Retraite 3206
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = 'Bonus conditionné : 50 % UC (3,00 %), 70 % UC (3,20 %)', frais_arbitrage_note = '0,80 % de la somme arbitrée (minimum 40 €), 5 arbitrages gratuits par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '500 €', distributeur = 'Fid''Essor (réseau CGP) via Vie Plus (Suravenir)', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Fid''Essor Stratégie Retraite 3206';

-- Suravenir::FOCUS VIE
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2', fonds_euros_contrainte_uc = 'Non spécifiée dans la documentation publique de Focus Vie', frais_arbitrage_note = 'Arbitrages gratuits (0 %, minimum 0 €)', garantie_fonds_euros = 'Garantie 97 % brute de frais annuels de gestion', ticket_entree = '10 000 €', versement_min = '10 000 € (versement initial)', distributeur = 'Sapians (multi family-office digital, Paris)', service_extranet = 'Plateforme 100 % digitale Sapians (souscription et suivi en ligne)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat (mandat d''arbitrage Suravenir)'], univers_classes = ARRAY['Fonds euros','ETF','Private equity','Fonds datés'] WHERE key = 'Suravenir::FOCUS VIE';

-- Suravenir::FORTUNEO PER
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Suravenir', frais_arbitrage_note = '0 € en gestion libre', garantie_fonds_euros = 'Capital garanti diminué des frais annuels de gestion (0,70 %)', ticket_entree = '100 €', versement_min = '50 €', distributeur = 'Fortuneo', options_gestion = ARRAY['Gestion libre','Gestion à horizon (allocation automatique vers la retraite)'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','Diversifiés','Obligataires','Fonds à échéance'] WHERE key = 'Suravenir::FORTUNEO PER';

-- Suravenir::Fortuneo Vie 2135
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2, Suravenir Opportunités 2', fonds_euros_bonus = 'Suravenir Opportunités 2 : +0,5 % (30-50 % UC), +1 % (50-70 % UC), +1,5 % (> 70 % UC), jusqu''à 4,5 % net selon la part UC', fonds_euros_contrainte_uc = 'Suravenir Rendement 2 : 30 % minimum en UC par versement. Suravenir Opportunités 2 : accessible à 100 % sans contrainte UC', frais_arbitrage_note = 'Arbitrages illimités et gratuits (sur demande et automatiques), + 0,1 % sur ETF', garantie_fonds_euros = 'Suravenir Rendement 2 : capital garanti à 99,4 % net de frais par an. Suravenir Opportunités 2 : capital garanti à 97 % net de frais', ticket_entree = '100 €', versement_min = '100 €', distributeur = 'Fortuneo (banque en ligne, Crédit Mutuel Arkéa)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat (Arkéa Moderate, DNCA Balanced, AllianzGI Dynamic)','Arbitrage automatique'], univers_classes = ARRAY['Fonds euros','UC diversifiés','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::Fortuneo Vie 2135';

-- --- part_09.sql ---
-- Suravenir::Grisbee Vie 2226
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Taux 2,50 % en gestion sous mandat (Carmignac). Suravenir Opportunités 2 à 3,00 % net 2025 sous condition de 50 % UC minimum par versement.', fonds_euros_contrainte_uc = 'Suravenir Rendement, 30 % UC minimum par versement. Suravenir Opportunités, 50 % UC minimum par versement.', frais_arbitrage_note = 'Arbitrage gratuit (0 %). ETF, 0,10 % à l''achat et à la vente. Frais sur arrérages de rentes, 3 %.', distributeur = 'Grisbee Gestion Privée (courtier, ORIAS 16004389, Versailles)', service_extranet = 'Espace client Grisbee en ligne (souscription et gestion 100 % digitale)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Grisbee Vie 2226';

-- Suravenir::Habeo Patrimoine 3203
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '3,00 % si UC ≥ 50 % de l''encours, 3,20 % si UC ≥ 70 %. En mandat d''arbitrage, 2,80 % de base (avant bonus).', fonds_euros_contrainte_uc = 'Bonus conditionné à la part UC dans l''encours (≥ 50 % ou ≥ 70 %).', frais_arbitrage_note = '0,80 % entre compartiments (gestion libre ↔ mandat).', garantie_fonds_euros = 'Capital garanti net de frais de gestion (à hauteur de la valeur de rachat).', ticket_entree = '500 €', versement_min = 'Versements libres, 1 000 € minimum. Versements programmés, 100 €/mois (ou 300 €/trimestre, 600 €/semestre, 1 000 €/an).', distributeur = 'Magnacarta (groupement de cabinets CGP), via Vie Plus (Suravenir, Crédit Mutuel Arkéa)', service_extranet = 'Consultation et transactions en ligne (espace client Vie Plus)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','Fonds datés'] WHERE key = 'Suravenir::Habeo Patrimoine 3203';

-- Suravenir::HEDIOS CAPI SOCIETE
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages gratuits (0 %).', ticket_entree = '10 000 €', distributeur = 'Hedios Patrimoine', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['Produits structurés'] WHERE key = 'Suravenir::HEDIOS CAPI SOCIETE';

-- Suravenir::Hedios Life 2216
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement / Suravenir Opportunités', fonds_euros_bonus = 'Jusqu''à 4 % avec bonus de performance selon la part UC (Suravenir Opportunités).', fonds_euros_contrainte_uc = 'Bonus conditionné à une part en UC.', frais_arbitrage_note = 'Arbitrages gratuits et illimités.', garantie_fonds_euros = 'Capital garanti net de frais de gestion.', ticket_entree = '1 000 €', versement_min = '100 €', distributeur = 'Hedios Patrimoine', service_extranet = 'Gestion 100 % en ligne', options_gestion = ARRAY['Versements programmés','Rachats programmés'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','Certificat or','Certificats métaux précieux'] WHERE key = 'Suravenir::Hedios Life 2216';

-- Suravenir::Hedios Life 2256
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Opportunités 2, bonus selon la proportion UC, 3,10 % (30-50 % UC), 3,60 % (50-70 % UC), 4,00 % (> 70 % UC). Suravenir Rendement 2, 2,50 % net en mandat d''arbitrage.', fonds_euros_contrainte_uc = 'Suravenir Opportunités 2, 50 % UC minimum par versement. Suravenir Rendement 2, 30 % UC minimum par versement.', frais_arbitrage_note = 'Arbitrages gratuits et illimités. ETF, 0,10 % des montants investis. Gestion pilotée, +0,25 %/an.', garantie_fonds_euros = 'Capital garanti net de frais de gestion.', ticket_entree = '1 000 €', versement_min = '100 €/mois (versements programmés), 1 000 € (versements ponctuels)', distributeur = 'Hedios Patrimoine', service_extranet = 'Gestion 100 % en ligne (espace client Hedios)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','Produits structurés'] WHERE key = 'Suravenir::Hedios Life 2256';

-- Suravenir::Hedios Life Capi 2217
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement / Suravenir Opportunités', frais_arbitrage_note = 'Arbitrages illimités et gratuits.', garantie_fonds_euros = 'Capital garanti net de frais.', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Hedios', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Rééquilibrage automatique','Sécurisation des plus-values','Investissement progressif','Stop-loss'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','Obligations','Actions','Diversifiés'] WHERE key = 'Suravenir::Hedios Life Capi 2217';

-- Suravenir::HOMUNITY VIE
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Opportunités 2, taux bonifié selon la part UC en encours, 3,00 % (< 30 % UC), 3,50 % (30-50 % UC), 4,00 % (50-70 % UC), 4,50 % (> 70 % UC). Suravenir Rendement 2, 2,50 % en gestion pilotée.', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, 50 % UC minimum par versement.', frais_arbitrage_note = 'Arbitrages gratuits et illimités (0 %).', garantie_fonds_euros = 'Suravenir Rendement 2, capital garanti à 99,4 % par an (net de frais). Suravenir Opportunités 2, garantie à 97 % par an.', ticket_entree = '5 000 €', versement_min = '100 € (versements libres), 50 € (versements programmés)', distributeur = 'Homunity (plateforme digitale, distribution exclusive en ligne)', service_extranet = 'app.homunity.com (espace client 100 % digital)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','OPCI','Private equity','Fonds datés'] WHERE key = 'Suravenir::HOMUNITY VIE';

-- Suravenir::LINXEA Avenir 2 2259
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Suravenir Opportunités 2, 100 % sans condition. Suravenir Rendement 2, 70 % maximum.', frais_arbitrage_note = 'Gratuit en ligne.', ticket_entree = '100 €', versement_min = '100 € (libre et programmé)', distributeur = 'Linxea', service_extranet = 'Souscription et gestion 100 % en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion mixte'], univers_classes = ARRAY['Fonds euros','Fonds datés','SCPI','SCI','Produits structurés','FCPR','ETF'] WHERE key = 'Suravenir::LINXEA Avenir 2 2259';

-- Suravenir::LINXEA Avenir 2214
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2 / Suravenir Rendement 2', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 70 % maximum du contrat (30 % minimum en UC). Suravenir Opportunités 2, 100 % sans contrainte UC.', frais_arbitrage_note = 'Arbitrages gratuits et illimités en ligne.', garantie_fonds_euros = 'Suravenir Opportunités 2, garantie à 97 % du capital net de frais. Suravenir Rendement 2, garantie à 100 % du capital net de frais.', ticket_entree = '100 €', versement_min = '25 €', distributeur = 'Linxea', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée OTEA Capital (5 profils, Défensif à Offensif)','Gestion mixte'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds labellisés ISR'] WHERE key = 'Suravenir::LINXEA Avenir 2214';

-- Suravenir::LINXEA AVENIR CAPI PM
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Rendement 2, 2,50 % via mandat d''arbitrage (gestion pilotée) contre 2,10 % en gestion libre. Suravenir Opportunités 2, 3,00 % sans condition de taux.', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 70 % maximum (30 % minimum en UC). Suravenir Opportunités 2, 100 % sans contrainte UC.', frais_arbitrage_note = 'Arbitrage en ligne gratuit (0 %), hors SCPI, SCI, ETF et FCPR (ETF, 0,10 %).', garantie_fonds_euros = 'Suravenir Rendement 2, capital garanti à 99,4 % brut de frais de gestion. Suravenir Opportunités 2, capital garanti à 97 %.', ticket_entree = '50 000 € (contrat PM, souscription papier uniquement, après étude d''éligibilité)', versement_min = '100 € (versement libre), 25 €/mois (versement programmé)', distributeur = 'Linxea', service_extranet = 'Espace client en ligne Linxea (arbitrages en ligne)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion mixte','Investissement progressif'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::LINXEA AVENIR CAPI PM';

-- Suravenir::LINXEA Avenir Capi PM 2261
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '+1,50 % net en 2026 et 2027 sur Opportunités 2 pour versements entre janvier et avril 2026 avec ≥ 40 % du versement en UC. Taux boosté maximum 4,50 %.', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 70 % maximum du contrat (30 % minimum en UC). Suravenir Opportunités 2, 100 % en versement, quota UC de 50 % requis pour les taux bonifiés.', frais_arbitrage_note = 'Arbitrage en ligne gratuit (0 %). Frais de transaction ETF, 0,10 % à l''achat et à la vente.', garantie_fonds_euros = 'Suravenir Rendement 2, capital garanti à 99,4 % (net de frais de gestion). Suravenir Opportunités 2, capital garanti à 97 %.', ticket_entree = '100 €', versement_min = '25 €/mois (versements programmés), 100 € par versement libre', distributeur = 'Linxea', service_extranet = 'Espace client Linxea (linxea.com), arbitrages en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Stop-loss','Sécurisation des plus-values','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::LINXEA Avenir Capi PM 2261';

-- Suravenir::LINXEA Avenir Capitalisation 2 2261
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2 / Suravenir Opportunités 2', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, jusqu''à 70 % (30 % UC minimum). Suravenir Opportunités 2, 100 % sans contrainte UC.', frais_arbitrage_note = 'Arbitrage en ligne gratuit. Frais de 0,10 % sur les arbitrages ETF.', garantie_fonds_euros = 'Suravenir Rendement 2, garantie à 99,4 % du capital. Suravenir Opportunités 2, garantie à 97 % du capital.', ticket_entree = '100 €', versement_min = '100 €', distributeur = 'Linxea', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée OTEA Capital (5 profils)','Gestion mixte'], univers_classes = ARRAY['Fonds euros','ETF','OPCVM','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::LINXEA Avenir Capitalisation 2 2261';

-- Suravenir::LINXEA Avenir Capitalisation 2215
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2 / Suravenir Rendement 2', fonds_euros_bonus = '+2 % sous condition de 50 % UC sur Suravenir Opportunités 2 (offre 2025-2026).', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, aucune contrainte UC.', frais_arbitrage_note = 'Arbitrage gratuit en ligne. 0,10 % par transaction sur ETF.', garantie_fonds_euros = 'Suravenir Rendement 2, garanti à 99,4 %. Suravenir Opportunités 2, garanti à 97 %.', ticket_entree = '100 €', versement_min = '100 €', distributeur = 'Linxea', service_extranet = 'Espace Suravenir Prévi-Direct en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée OTEA Capital (5 profils, +0,20 %/an)','Gestion mixte'], univers_classes = ARRAY['Fonds euros','ETF','OPCVM','SCPI','SCI','FCPR/private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::LINXEA Avenir Capitalisation 2215';

-- Suravenir::LINXEA Avenir PEA 2190
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0 % en ligne.', garantie_fonds_euros = '99,4 % du capital garanti net de frais.', ticket_entree = '100 €', versement_min = '25 €', distributeur = 'Linxea', options_gestion = ARRAY['Gestion libre','Gestion pilotée OTEA Capital','Gestion mixte'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','ETC','SCPI','SCI','Private equity','Produits structurés','Fonds à échéance'] WHERE key = 'Suravenir::LINXEA Avenir PEA 2190';

-- Suravenir::LINXEA Avenir PEA PME 2188
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0 % sur tous les arbitrages.', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'Linxea', univers_classes = ARRAY['OPCVM','ETF','Fonds PME-ETI'] WHERE key = 'Suravenir::LINXEA Avenir PEA PME 2188';

-- Suravenir::Meilleurtaux capitalisation
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Opportunités 2, 3,00 % net 2025 (frais de gestion 3 % maximum/an, taux net servi).', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, 100 % sans contrainte UC.', frais_arbitrage_note = 'Arbitrages gratuits (0 %), à la demande et automatiques. ETF en gestion libre, 0,10 %. Frais d''entrée spécifiques sur SCPI.', garantie_fonds_euros = 'Suravenir Rendement 2, garantie partielle à 99,4 % par an. Suravenir Opportunités 2, garantie partielle à 97 % par an.', ticket_entree = '500 €', versement_min = '50 € (versements complémentaires), 50 €/mois (versements programmés)', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client Meilleurtaux Placement (placement.meilleurtaux.com)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Meilleurtaux capitalisation';

-- Suravenir::Meilleurtaux Capitalisation 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2 / Suravenir Rendement 2', fonds_euros_contrainte_uc = 'Suravenir Opportunités 2, 100 % sans contrainte UC (promotionnellement), normalement 50 % UC minimum par versement. Suravenir Rendement 2, 30 % UC minimum par versement.', frais_arbitrage_note = 'Arbitrages libres gratuits (0 %). Options automatiques (sécurisation des plus-values, rééquilibrage, stop-loss relatif), maximum 0,50 % du montant transféré.', garantie_fonds_euros = 'Garantie partielle. Suravenir Opportunités 2, 97 % du capital net investi par an (frais de gestion maximum 3 %). Suravenir Rendement 2, 99,4 %.', ticket_entree = '500 €', versement_min = '50 € (versements complémentaires libres), 50 €/mois (versements programmés)', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client Meilleurtaux Placement (app.placement.meilleurtaux.com)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Meilleurtaux Capitalisation 2';

-- Suravenir::meilleurtaux Capitalisation 2221
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2 / Suravenir Rendement 2', fonds_euros_contrainte_uc = 'Suravenir Opportunités 2, 100 % sans contrainte UC (en gestion libre). Suravenir Rendement 2, 30 % UC minimum obligatoire. Taux 2025, Opportunités 2 à 3,00 %.', frais_arbitrage_note = 'Arbitrages gratuits (0 %) en gestion libre. Frais de 0,10 % à l''achat et à la vente sur ETF.', garantie_fonds_euros = 'Garantie partielle. Suravenir Opportunités 2, 97 % du capital par an (frais de gestion maximum 3 %/an). Suravenir Rendement 2, 99,4 % du capital.', ticket_entree = '500 €', versement_min = '50 € (versement libre complémentaire), 25 € minimum par support', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client en ligne et application mobile Meilleurtaux Placement', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::meilleurtaux Capitalisation 2221';

-- Suravenir::meilleurtaux Capitalisation 2247
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2 / Suravenir Rendement 2', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, 50 % UC minimum (offre commerciale temporaire, accessible à 100 % fonds euros).', frais_arbitrage_note = 'Arbitrages libres et automatiques gratuits.', garantie_fonds_euros = 'Suravenir Opportunités 2, garantie 97 % du capital net investi annuellement. Suravenir Rendement 2, garantie 99,4 % du capital net investi annuellement.', ticket_entree = '500 €', versement_min = '50 €', distributeur = 'Meilleurtaux Placement (ORIAS 07 031 613)', service_extranet = 'Espace client en ligne et application mobile', options_gestion = ARRAY['Gestion libre','Gestion pilotée BlackRock 100 % ETF (profils Prudent / Équilibre / Dynamique)'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Infrastructure','Dette privée','Produits structurés','Titres vifs'] WHERE key = 'Suravenir::meilleurtaux Capitalisation 2247';

-- Suravenir::meilleurtaux Capitalisation 2271
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Opportunités 2, 3,00 % net 2025 (gestion libre). Suravenir Rendement 2, 2,10 % net 2025 (gestion libre), 2,50 % en mandat d''arbitrage.', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum. Suravenir Opportunités 2, aucune contrainte UC (100 % autorisé en fonds euros).', frais_arbitrage_note = 'Arbitrages gratuits et illimités entre supports (gestion libre et entre compartiments). ETF, 0,10 % à chaque mouvement.', garantie_fonds_euros = 'Suravenir Rendement 2, capital garanti net de frais de gestion (99,4 % annuellement). Suravenir Opportunités 2, garantie partielle à 97 % par an.', ticket_entree = '100 € (versement initial minimum global), 300 € minimum sur le compartiment mandat d''arbitrage', versement_min = '50 € (versements libres), 25 €/mois en versements programmés', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace personnel sur placement.meilleurtaux.com (documents dématérialisés, suivi du contrat)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::meilleurtaux Capitalisation 2271';

-- Suravenir::meilleurtaux PEA Capi 2218
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages illimités et gratuits, minimum 25 € par mouvement.', garantie_fonds_euros = 'Capital garanti net de frais de gestion.', ticket_entree = '100 €', versement_min = '50 €', distributeur = 'Meilleurtaux Placement', options_gestion = ARRAY['Gestion profilée M Étoilée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Trackers'] WHERE key = 'Suravenir::meilleurtaux PEA Capi 2218';

-- Suravenir::Meilleurtaux Placement Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Opportunités 2 / Suravenir Rendement 2', fonds_euros_contrainte_uc = 'Suravenir Opportunités 2, 50 % UC minimum par versement (conditions promotionnelles à 100 % possibles). Suravenir Rendement 2, 30 % UC minimum par versement.', frais_arbitrage_note = '0 % de frais d''arbitrage. Frais de gestion fonds euros, 0,60 %/an pour Suravenir Rendement 2 et 3 % maximum/an pour Suravenir Opportunités 2 (inclus dans le taux net servi).', garantie_fonds_euros = 'Garantie partielle. Suravenir Opportunités 2, 97 % du capital. Suravenir Rendement 2, 99,4 %.', ticket_entree = '500 €', versement_min = '50 €', distributeur = 'Meilleurtaux Placement (ORIAS 07 031 613)', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée (3 profils, 100 % ETF, conseil BlackRock)','Multi-compartiment (libre et pilotée)'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Infrastructure','Dette privée','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Meilleurtaux Placement Vie';

-- Suravenir::Meilleurtaux Placement Vie 2
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Gestion sous mandat ETF (BlackRock), taux Suravenir Rendement 2 porté à 2,50 % (contre 2,10 % en libre). Pas de bonus UC classique.', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, au moins 30 % UC par versement. Suravenir Opportunités 2, 100 % sans contrainte UC (condition temporaire 2025-2026).', frais_arbitrage_note = 'Arbitrage gratuit en gestion libre et automatique. Exception, 0,10 % sur les montants investis et désinvestis en ETF (achat et vente).', garantie_fonds_euros = 'Garantie partielle. Suravenir Rendement 2, 99,4 %/an (effet cliquet). Suravenir Opportunités 2, 97 %/an.', ticket_entree = '500 €', versement_min = '50 € (versement libre complémentaire), 50 €/mois (versements programmés)', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client Meilleurtaux Placement (en ligne)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Sécurisation des plus-values','Stop-loss','Rééquilibrage','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Meilleurtaux Placement Vie 2';

-- Suravenir::meilleurtaux Placement Vie 2220
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonus de rendement ponctuel en début d''année (+1 % à +1,50 % sous conditions de quota UC ou de montant versé sur Opportunités 2).', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, actuellement accessible à 100 % sans contrainte UC (offre limitée).', frais_arbitrage_note = 'Arbitrages gratuits à la demande et automatiques. Exception, 0,10 % des montants investis et désinvestis sur ETF en gestion libre.', garantie_fonds_euros = 'Suravenir Rendement 2, garantie 99,4 % du capital net investi par an. Suravenir Opportunités 2, garantie 97 % du capital net investi par an.', ticket_entree = '500 € (versement initial minimum)', versement_min = '50 € (versements complémentaires et programmés)', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client en ligne (gestion du contrat, versements, arbitrages)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::meilleurtaux Placement Vie 2220';

-- Suravenir::meilleurtaux Placement Vie 2246
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2 / Suravenir Opportunités 2', fonds_euros_bonus = 'Offre promotionnelle ponctuelle, prime de 200 € à la souscription (versement ≥ 5 000 €, 30 % en UC ou gestion responsable, période avril-août 2026).', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, aucune contrainte UC (accessible à 100 % en fonds euros en gestion libre).', frais_arbitrage_note = 'Arbitrages gratuits (0 %) au sein du compartiment gestion libre et entre compartiments. ETF, 0,10 % des montants investis et désinvestis.', garantie_fonds_euros = 'Suravenir Rendement 2, capital garanti à 99,4 % net de frais par an. Suravenir Opportunités 2, capital garanti à 97 % net de frais par an.', ticket_entree = '500 € (versement initial minimum)', versement_min = '50 € (versements libres complémentaires), 25 €/mois en versements programmés', distributeur = 'Meilleurtaux Placement (anciennement MeilleurPlacement)', service_extranet = 'Espace client en ligne sur placement.meilleurtaux.com', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::meilleurtaux Placement Vie 2246';

-- Suravenir::meilleurtaux Placement Vie 2270
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, 50 % UC minimum par versement (accès temporaire à 100 % fonds euros sans condition UC).', frais_arbitrage_note = 'Arbitrages gratuits et illimités (0 %). ETF en gestion libre, 0,10 % à l''achat et à la vente.', garantie_fonds_euros = 'Partielle. Suravenir Rendement 2, 99,4 % par an. Suravenir Opportunités 2, 97 % par an.', ticket_entree = '500 €', versement_min = '50 € (versements complémentaires et programmés)', distributeur = 'Meilleurtaux Placement', service_extranet = 'Espace client Meilleurtaux Placement (en ligne)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI','SCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::meilleurtaux Placement Vie 2270';

-- Suravenir::mes-placements PEA 2191
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0 % dans le cadre fiscal PEA.', ticket_entree = '100 €', versement_min = '50 €', distributeur = 'Meilleurtaux Placement (mes-placements.fr)', service_extranet = 'previ-direct.com', options_gestion = ARRAY['Gestion libre','Gestion profilée M Étoilée'], univers_classes = ARRAY['OPCVM','ETF','Fonds euros'] WHERE key = 'Suravenir::mes-placements PEA 2191';

-- Suravenir::mes-placements retraite 2227
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 1 (fonds principal) / Suravenir Opportunités 1 (alternatif)', fonds_euros_contrainte_uc = '30 % UC minimum de chaque versement pour accéder à Suravenir Rendement 1. 50 % UC minimum pour Suravenir Opportunités 1.', frais_arbitrage_note = 'Arbitrages gratuits et illimités (0 % sans limite).', garantie_fonds_euros = 'Garantie en capital (100 % des provisions mathématiques nettes de frais de gestion).', ticket_entree = '100 € (versement libre), 50 €/mois (programmé), minimum 25 € par support', versement_min = '50 € (programmé mensuel) ou 100 € (libre)', distributeur = 'Meilleurtaux Placement (anciennement Finance Sélection / mes-placements.fr)', service_extranet = 'Espace client en ligne via placement.meilleurtaux.com', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Sécurisation des plus-values','Stop-loss','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::mes-placements retraite 2227';

-- Suravenir::mes-placements retraite capi 2228
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement 2 / Suravenir Opportunités 2', fonds_euros_bonus = 'Suravenir Opportunités 2, 3,00 % net 2025 (contre 2,10 % pour Rendement 2). En 2024, Rendement 2 à 2,20 %, Opportunités 2 à 2,50 %.', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, 50 % UC minimum par versement.', frais_arbitrage_note = 'Arbitrages gratuits, sans restriction ni limite.', garantie_fonds_euros = 'Suravenir Rendement 2, garantie partielle 99,4 % par an (frais 0,60 %). Suravenir Opportunités 2, garantie partielle 97 % par an.', ticket_entree = '100 € (versement libre minimum), 50 €/mois en programmé', versement_min = '25 € par support', distributeur = 'Meilleurtaux Placement (Finance Sélection)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::mes-placements retraite capi 2228';

-- Suravenir::mes-placementsavenir 2244
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages illimités et gratuits.', garantie_fonds_euros = 'Capital garanti.', versement_min = '100 €', distributeur = 'Meilleurtaux Placement (mes-placements.com)', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée Primonial'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','FCPR','Titres vifs','Produits structurés'] WHERE key = 'Suravenir::mes-placementsavenir 2244';

-- Suravenir::mes-placementsavenir capi 2245
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Opportunités 2, 3,00 % net 2025 (base), bonus jusqu''à +2 points si ≥ 50 % UC, potentiel 5 % net.', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, 50 % UC minimum par versement (hors période promotionnelle).', frais_arbitrage_note = 'Gratuits et illimités (0 %).', garantie_fonds_euros = 'Garantie partielle. Suravenir Rendement 2, 99,4 % du capital net investi/an. Suravenir Opportunités 2, 97 %/an.', ticket_entree = '500 €', versement_min = '500 € (versement libre), 50 €/mois (versements programmés)', distributeur = 'mes-placements.fr (Finance Sélection), devenu Meilleurtaux Placement', service_extranet = 'Espace client Suravenir (espaceclient.suravenir.fr)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::mes-placementsavenir capi 2245';

-- Suravenir::Mon Projet Retraite Vie 2182
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = '50 % UC minimum pour accéder à Suravenir Opportunités. 30 % UC minimum pour Suravenir Rendement.', frais_arbitrage_note = '2 arbitrages gratuits par an, puis 0,50 %.', garantie_fonds_euros = 'Capital garanti net de frais.', ticket_entree = '100 €', versement_min = '30 €', distributeur = 'Conseils Patrimoine Services', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion conseillée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::Mon Projet Retraite Vie 2182';

-- Suravenir::moncapital avenir 3182
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Suravenir Rendement / Suravenir Opportunités', fonds_euros_contrainte_uc = 'Accès à Suravenir Opportunités, 25 % minimum en unités de compte.', frais_arbitrage_note = 'Arbitrages individuels et automatiques gratuits.', garantie_fonds_euros = 'Capital garanti net de frais (Rendement). 97 % garanti (Opportunités, 25 % UC minimum requis).', ticket_entree = '100 €', versement_min = '100 €', distributeur = 'moncapital.fr (courtier en ligne)', options_gestion = ARRAY['Espace communautaire allocation','Versements programmés'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Suravenir::moncapital avenir 3182';

-- Suravenir::Myrialis Vie 2132
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,80 % par arbitrage.', garantie_fonds_euros = 'Capital garanti.', ticket_entree = '1 500 €', versement_min = '1 500 €', distributeur = 'BPE - Banque Privée Européenne / Louvre Banque Privée', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Gestion pilotée'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','Fonds diversifiés'] WHERE key = 'Suravenir::Myrialis Vie 2132';

-- Suravenir::NaviG'Options 2229
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros NaviG''Options', fonds_euros_bonus = '2,50 % en gestion déléguée (mandat d''arbitrage) contre 2,20 % en gestion libre.', fonds_euros_contrainte_uc = '30 % UC minimum non garantis en capital à chaque versement sur le fonds euros.', frais_arbitrage_note = 'Gratuit en gestion déléguée (mandat d''arbitrage). En gestion libre, 0,50 % à 0,80 % (minimum 40 €).', garantie_fonds_euros = 'Capital garanti net de frais de gestion.', ticket_entree = '300 €', versement_min = '300 €', distributeur = 'Crédit Mutuel Arkéa (Crédit Mutuel de Bretagne, Crédit Mutuel du Sud-Ouest), réseau bancaire exclusif', service_extranet = 'Espace client Crédit Mutuel Arkéa', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::NaviG''Options 2229';

-- Suravenir::NaviG'Patrimoine 2248
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonification conditionnelle sur l''encours existant, 3,00 % si UC ≥ 50 % du contrat, 3,20 % si UC ≥ 70 %. Mandat d''arbitrage, 2,80 % (contre 2,50 % en gestion libre).', fonds_euros_contrainte_uc = '30 % UC minimum par versement en gestion libre pour accéder au fonds euros.', frais_arbitrage_note = 'Arbitrages UC ↔ UC gratuits et illimités. 0,50 % sur les arbitrages vers le fonds euros et sur les options programmées (sécurisation, stop-loss).', garantie_fonds_euros = 'Garantie en capital nette de frais de gestion.', ticket_entree = '25 000 €', versement_min = '2 500 €', distributeur = 'Crédit Mutuel Arkéa (CMSO, CMB, CM Massif Central)', service_extranet = 'Gestion en ligne (espace client Crédit Mutuel)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::NaviG''Patrimoine 2248';

-- Suravenir::NEXITY LIFE
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonus +1,50 % sur Suravenir Rendement 2 en 2026 (versement ≥ 100 000 €, ≥ 40 % UC, offre valable jusqu''au 31/03/2026). Suravenir Opportunités 2, taux bonifiés selon l''encours.', fonds_euros_contrainte_uc = 'Suravenir Rendement 2, 30 % UC minimum par versement. Suravenir Opportunités 2, 100 % sans contrainte UC (taux bonifié selon la part UC détenue).', frais_arbitrage_note = 'Arbitrages gratuits et sans restriction. ETF, 0,10 % des montants investis et désinvestis.', garantie_fonds_euros = 'Suravenir Rendement 2, capital garanti à 100 %. Suravenir Opportunités 2, garantie partielle à 97 % du capital par année.', ticket_entree = '100 €', versement_min = '100 €', distributeur = 'Nexity (plateforme Pierre-Papier-Immo de Nexity)', service_extranet = 'Gestion 100 % en ligne via la plateforme Pierre-Papier-Immo de Nexity', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::NEXITY LIFE';

-- Suravenir::Panorama Patrimoine Vie Plus 3173
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général Suravenir', fonds_euros_bonus = '+0,50 point si UC ≥ 50 % (3,00 %), +0,70 point si UC ≥ 70 % (3,20 %). Mandat d''arbitrage, taux majoré (2024, 3,20 %). Taux 2024 gestion libre sans condition, 2,80 %.', fonds_euros_contrainte_uc = 'Bonus conditionné à la part UC en encours, ≥ 50 % pour +0,50 point, ≥ 70 % pour +0,70 point.', frais_arbitrage_note = '0,80 % de la somme arbitrée, minimum forfaitaire 40 €. 1 arbitrage gratuit par an. Mandat d''arbitrage, +0,80 % de frais de gestion annuels.', garantie_fonds_euros = 'Capital garanti net de frais de gestion (fonds en euros Actif général Suravenir).', ticket_entree = '50 €', versement_min = '50 €', distributeur = 'Interfin Courtage', options_gestion = ARRAY['Gestion libre','Gestion sous mandat (mandat d''arbitrage)'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Panorama Patrimoine Vie Plus 3173';

-- Suravenir::Patrimoine Options 2149
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrage non gratuit, conditions tarifaires non publiées.', garantie_fonds_euros = 'Capital garanti.', ticket_entree = '100 000 €', distributeur = 'Crédit Mutuel de Bretagne', service_extranet = 'Espace client en ligne', options_gestion = ARRAY['Stop-loss relatif','Protection des plus-values'], univers_classes = ARRAY['Fonds euros','Unités de compte','OPCI'] WHERE key = 'Suravenir::Patrimoine Options 2149';

-- Suravenir::Patrimoine Options Capitalisation 2153
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros patrimonial Suravenir (NaviG''Patrimoine / Patrimoine Vie Plus)', garantie_fonds_euros = 'Capital garanti net de frais de gestion.', ticket_entree = '100 000 €', versement_min = '100 000 €', distributeur = 'Crédit Mutuel de Bretagne / réseau Arkéa', options_gestion = ARRAY['Stop-loss relatif','Sécurisation des plus-values','Mandat d''arbitrage'], univers_classes = ARRAY['Fonds euros','Actions','Obligations','Immobilier','OPCI'] WHERE key = 'Suravenir::Patrimoine Options Capitalisation 2153';

-- --- part_10.sql ---
-- Réécriture propre (charte) — investissement_av_contract_terms — OFFSET 400 LIMIT 40
-- Aucun UPDATE appliqué en base : à relire avant exécution.

-- Suravenir::Patrimoine Options Capitalisation PM 2194
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = 'Bonus conditionné au taux d''UC en encours', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '100 000 €', versement_min = '100 000 €', options_gestion = ARRAY['Stop-loss relatif','Sécurisation des plus-values','Avance sur contrat'], univers_classes = ARRAY['Fonds euros','OPCVM','OPCI'] WHERE key = 'Suravenir::Patrimoine Options Capitalisation PM 2194';

-- Suravenir::Patrimoine Vie Plus 3202
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '+3,00 % si UC ≥ 50 %, +3,20 % si UC ≥ 70 % (sur l''encours total), 2,80 % en mandat d''arbitrage', fonds_euros_contrainte_uc = 'Bonus conditionné à ≥ 50 % ou ≥ 70 % d''UC en encours, minimum 30 % d''UC', frais_arbitrage_note = '0,80 % (min. 40 €), 1 arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '500 € initial, 1 000 € versement libre, 100 €/mois programmé', distributeur = 'Vie Plus (Suravenir / Crédit Mutuel Arkéa), via CGP partenaires', service_extranet = 'Consultation et transactions en ligne (site Vie Plus)', univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Patrimoine Vie Plus 3202';

-- Suravenir::Patrimoine Vie Plus CSF 3172
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = 'Bonification selon la part d''UC dans le contrat', frais_arbitrage_note = '0,80 % (min. 40 €), 1 arbitrage gratuit par an, arbitrages programmés gratuits', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '100 €', distributeur = 'CSF', options_gestion = ARRAY['Gestion libre','Mandat d''arbitrage','Arbitrages programmés','Versements programmés'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI'] WHERE key = 'Suravenir::Patrimoine Vie Plus CSF 3172';

-- Suravenir::Patrimoine Vie Plus Multiprojet
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '2,80 % en mandat d''arbitrage, 3,00 % si UC ≥ 50 %, 3,20 % si UC ≥ 70 %', fonds_euros_contrainte_uc = 'Maximum 70 % en fonds euros (minimum 30 % en UC)', frais_arbitrage_note = 'Arbitrages en ligne gratuits, frais contractuels max 0,80 % (min. 40 €)', garantie_fonds_euros = 'Capital garanti par l''assureur (hors défaillance)', ticket_entree = '500 € versement initial', versement_min = '100 €/mois programmé, 1 000 € versement libre', distributeur = 'Vie Plus (réseau CGP / courtiers)', service_extranet = 'Consultation et transactions en ligne (espace client Vie Plus)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage','Dynamisation fonds euros'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés','Fonds datés'] WHERE key = 'Suravenir::Patrimoine Vie Plus Multiprojet';

-- Suravenir::PEA PME Vie Plus 3192
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,80 % de la somme arbitrée (min. 40 €)', ticket_entree = '2 000 €', versement_min = '1 000 €', distributeur = 'Vie Plus / Oceanic Finance', options_gestion = ARRAY['Multigestionnaires','Multi-supports'], univers_classes = ARRAY['OPCVM','Actions','Obligations'] WHERE key = 'Suravenir::PEA PME Vie Plus 3192';

-- Suravenir::PEA Vie Plus 3191
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '2 000 €', versement_min = '1 000 €', distributeur = 'Alter Finances (CGP Bordeaux)', options_gestion = ARRAY['Sécurisation des plus-values','Limitation des moins-values','Investissement progressif','Conservation de la répartition'], univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'Suravenir::PEA Vie Plus 3191';

-- Suravenir::Pertinence Retraite
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Jusqu''à ~4,5 % net selon la part investie en UC (bonus croissant avec le quota UC)', fonds_euros_contrainte_uc = 'Accès et bonus conditionnés à un quota minimum d''UC, bonus maximal pour allocations fortement investies en UC', frais_arbitrage_note = 'Arbitrages en ligne gratuits et illimités, arbitrages automatiques gratuits', garantie_fonds_euros = 'Capital garanti sur le fonds euros', ticket_entree = '1 000 €', versement_min = '150 € versement libre, 100 €/mois programmé', distributeur = 'Vie Plus (Suravenir, Crédit Mutuel Arkéa)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion à horizon retraite','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::Pertinence Retraite';

-- Suravenir::PERTINENCE RETRAITE
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages en ligne illimités et gratuits', garantie_fonds_euros = 'Capital garanti', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'CGP, Arkéa Banque Privée', options_gestion = ARRAY['Gestion libre','Gestion sous mandat','Gestion à horizon'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI','Private equity'] WHERE key = 'Suravenir::PERTINENCE RETRAITE';

-- Suravenir::Préfon-Vie Responsable 3199
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = '30 % minimum en UC sur chaque versement', frais_arbitrage_note = 'Arbitrages gratuits', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Préfon Distribution', options_gestion = ARRAY['Gestion libre','Gestion sous mandat (Arkéa AM)'], univers_classes = ARRAY['Fonds euros','OPCVM','SCPI','SCI'] WHERE key = 'Suravenir::Préfon-Vie Responsable 3199';

-- Suravenir::Primonial Capi PM 4039
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,80 % de la somme arbitrée (min. 15 €)', ticket_entree = '10 000 €', versement_min = '10 000 €', distributeur = 'Primonial', service_extranet = 'previ-direct.com', options_gestion = ARRAY['Gestion libre','Gestion pilotée'], univers_classes = ARRAY['ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Primonial Capi PM 4039';

-- Suravenir::Primonial SéréniPierre 3168
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonification 3,00 % net si UC ≥ 50 %, 3,20 % net si UC ≥ 70 %. Sécurité Pierre Euro (fermé aux versements depuis 2021) : 2,10 % brut, 1,74 % net 2024', fonds_euros_contrainte_uc = 'Minimum 30 % en UC pour Sécurité Flex Euro, minimum 50 % en UC (max 35 %) pour Sécurité Pierre Euro (fermé aux versements depuis janv. 2021)', frais_arbitrage_note = '0,80 % du montant transféré (min. 15 €)', garantie_fonds_euros = 'Capital garanti à 100 % (effet cliquet) sur les trois fonds euros', ticket_entree = '10 000 €', versement_min = '1 000 € versement libre, 100 €/mois ou 300 €/trimestre ou 600 €/an programmé', distributeur = 'Primonial (réseau CGP / CGPI via Murano)', service_extranet = 'Gestion en ligne (espace partenaires Primonial / Murano)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique','Dynamisation de l''épargne'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::Primonial SéréniPierre 3168';

-- Suravenir::Primonial SéréniPierre Capi 3169
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Sécurité Pierre Euro / Sécurité Flex Euro / Actif Général Suravenir', fonds_euros_contrainte_uc = '50 % minimum en UC par versement. Sécurité Pierre Euro plafonné à 35 % (fermé aux versements depuis le 31/12/2020), Sécurité Flex Euro 30 % minimum en UC', frais_arbitrage_note = '0,80 % du montant arbitré (min. 15 €), arbitrages automatiques forfait 15 €', garantie_fonds_euros = 'Capital garanti à 100 %, effet cliquet annuel', ticket_entree = '10 000 €', versement_min = '1 000 € versement libre, 100 €/mois programmé', distributeur = 'Primonial / CGP indépendants partenaires', service_extranet = 'Gestion en ligne (consultation et opérations)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','OPCI'] WHERE key = 'Suravenir::Primonial SéréniPierre Capi 3169';

-- Suravenir::Primonial SéréniPierre Capi PM 4036
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Taux majoré : 3,00 % si UC en encours ≥ 50 %, 3,20 % si UC en encours ≥ 70 %', fonds_euros_contrainte_uc = '70 % minimum des versements en UC (30 % maximum en fonds euros), Sécurité Pierre Euro fermé aux versements depuis 2020', frais_arbitrage_note = '0,80 % du montant arbitré (min. 15 €)', garantie_fonds_euros = 'Capital garanti à 100 % net de frais de gestion, effet cliquet annuel', ticket_entree = '10 000 €', versement_min = '1 000 € versement libre, 100 €/mois programmé', distributeur = 'Primonial (via CGPI partenaires, réseau Primonial Partenaires)', service_extranet = 'Extranet Primonial partenaires (previ-direct.com)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Primonial SéréniPierre Capi PM 4036';

-- Suravenir::PROJECTION RETRAITE
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages gratuits et illimités', ticket_entree = '300 €', versement_min = '50 € versements suivants', distributeur = 'Crédit Mutuel (Bretagne et Sud-Ouest), réseau CM Arkéa', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI'] WHERE key = 'Suravenir::PROJECTION RETRAITE';

-- Suravenir::Puissance Avenir 2222
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Rendement 2 : 2,10 % net 2025 (2,50 % en gestion pilotée). Suravenir Opportunités 2 : 3,00 % net 2025', fonds_euros_contrainte_uc = 'Suravenir Rendement 2 : minimum 30 % en UC par versement. Suravenir Opportunités 2 : minimum 50 % en UC (accès sans condition du 01/01/2026 au 31/12/2026)', frais_arbitrage_note = 'Arbitrages gratuits et illimités en gestion libre, hors trackers/ETF (0,10 % par opération) et supports immobiliers (frais variables)', garantie_fonds_euros = 'Suravenir Rendement 2 : garantie partielle à 99,40 % du capital net investi par an. Suravenir Opportunités 2 : garantie partielle à 97 %', ticket_entree = '100 € en gestion libre, 1 000 € en gestion pilotée', versement_min = '25 €/mois programmé, 100 € versement libre', distributeur = 'assurancevie.com (Lucya)', service_extranet = 'Espace client en ligne assurancevie.com / Lucya, souscription 100 % en ligne avec signature électronique', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::Puissance Avenir 2222';

-- Suravenir::Puissance Avenir 2262
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Rendement 2 en mandat d''arbitrage : 2,50 % net 2025. Suravenir Opportunités 2 : 3,00 % net 2025 (gestion libre)', fonds_euros_contrainte_uc = 'Suravenir Rendement 2 : 30 % minimum en UC par versement. Suravenir Opportunités 2 : 50 % minimum en UC (offre temporaire 01/01/2026–31/12/2026 sans condition d''UC)', frais_arbitrage_note = 'Arbitrages gratuits et illimités en gestion libre, +0,10 % sur trackers/ETF à l''investissement', garantie_fonds_euros = 'Suravenir Rendement 2 : garantie partielle à 99,40 % du capital net de frais de gestion (0,60 %). Suravenir Opportunités 2 : garantie partielle', ticket_entree = '100 € en gestion libre, 1 000 € en mandat d''arbitrage', versement_min = '100 € versement complémentaire, 25 €/mois programmé', distributeur = 'assurancevie.com / Lucya', service_extranet = 'Espace client Lucya (assurancevie.com/asv/espace-client)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::Puissance Avenir 2262';

-- Suravenir::Puissance Avenir Capitalisation 2223
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Suravenir Rendement 2 : 30 % minimum d''UC par versement. Suravenir Opportunités 2 : aucune contrainte d''UC en 2026 (antérieurement 50 % minimum)', frais_arbitrage_note = 'Arbitrages gratuits et illimités, hors ETF/trackers (+0,10 % sur montants investis/désinvestis) et supports immobiliers (frais d''entrée spécifiques)', garantie_fonds_euros = 'Capital garanti net de frais de gestion (montants garantis au moins à hauteur des sommes versées nettes)', ticket_entree = '100 € minimum', versement_min = '100 € versement libre, 25 €/mois programmé, 25 € minimum par support', distributeur = 'assurancevie.com (Lucya)', service_extranet = 'Espace client en ligne assurancevie.com (versements, arbitrages, rachats partiels programmés)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Produits structurés'] WHERE key = 'Suravenir::Puissance Avenir Capitalisation 2223';

-- Suravenir::Puissance Avenir Capitalisation 2263
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Opportunités 2 selon part UC : 3,00 % net (< 30 % UC), 3,50 % (30-50 %), 4,00 % (50-70 %), 4,50 % (> 70 %). Suravenir Rendement 2 : 2,50 % net en gestion pilotée', fonds_euros_contrainte_uc = 'Suravenir Rendement 2 : 30 % minimum d''UC par versement. Suravenir Opportunités 2 : 50 % minimum d''UC (offre temporaire 2026 : aucune contrainte)', frais_arbitrage_note = 'Arbitrages gratuits et illimités, hors supports immobiliers et trackers/ETF (majoration de 0,10 %)', garantie_fonds_euros = 'Suravenir Rendement 2 : 99,4 % du capital annuel net (frais 0,60 %). Suravenir Opportunités 2 : 97 % du capital annuel net (frais max 3 %)', ticket_entree = '100 € en gestion libre, 1 000 € en gestion pilotée', versement_min = '25 €/mois programmé, 100 € versement libre', distributeur = 'assurancevie.com (Lucya)', service_extranet = 'previ-direct.com (espace client assurancevie.com)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::Puissance Avenir Capitalisation 2263';

-- Suravenir::Puissance Avenir PEA 2187
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages gratuits et illimités dans le cadre fiscal PEA, hors cadre fiscal : frais de gestion UC 0,60 %/an', garantie_fonds_euros = 'Sans objet (contrat de capitalisation PEA, pas de fonds euros)', ticket_entree = '100 €', versement_min = '25 €/mois programmé', distributeur = 'assurancevie.com', options_gestion = ARRAY['1 option gratuite dans le cadre fiscal PEA','5 options hors cadre fiscal PEA'], univers_classes = ARRAY['OPCVM'] WHERE key = 'Suravenir::Puissance Avenir PEA 2187';

-- Suravenir::Scala Life 2236
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Jusqu''à 2,80 % avec mandat d''arbitrage, jusqu''à 3,20 % si UC ≥ 70 % en encours (gestion libre et mandat)', fonds_euros_contrainte_uc = 'Bonus à partir de 50 % d''UC (3,00 %) et 70 % d''UC (3,20 %)', frais_arbitrage_note = 'Forfait 40 € par arbitrage, 1 arbitrage gratuit par an', garantie_fonds_euros = 'Garantie en capital (actif général), hors frais', ticket_entree = '50 000 €', versement_min = '1 000 € (arbitrage/modification)', distributeur = 'Scala Patrimoine (CGP, 100 % clean share, honoraires directs)', options_gestion = ARRAY['Gestion libre','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCI','Private equity'] WHERE key = 'Suravenir::Scala Life 2236';

-- Suravenir::Suravenir PER
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages illimités et gratuits en ligne', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '100 €', distributeur = 'Meilleurtaux Placement, assurancevie.com, Linxea, Epargnissimo', options_gestion = ARRAY['Gestion libre','Gestion sous mandat','Gestion à horizon retraite'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI','Private equity'] WHERE key = 'Suravenir::Suravenir PER';

-- Suravenir::SURAVENIR PER
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Bonus ponctuel distributeur Epargnissimo : +1,50 % net visant 4,15 % (offre close 2024)', fonds_euros_contrainte_uc = 'Fonds Euros Retraite accessible en gestion libre, sans quota d''UC obligatoire', frais_arbitrage_note = 'Arbitrages gratuits sur les fonds classiques, SCPI/SCI/OPCI/ETF avec frais propres possibles', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '1 000 €', versement_min = '100 €/mois programmé, 1 000 € par versement libre', distributeur = 'assurancevie.com, Linxea, Meilleurtaux, Altaprofits, Epargnissimo, Patrimea', service_extranet = 'Souscription et gestion en ligne via les courtiers', options_gestion = ARRAY['Gestion libre','Gestion pilotée à horizon retraite','Mandat d''arbitrage','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity'] WHERE key = 'Suravenir::SURAVENIR PER';

-- Suravenir::Vie Plus Impact 3207
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '3,00 % si UC ≥ 50 % en encours, 3,20 % si UC ≥ 70 % en encours', fonds_euros_contrainte_uc = 'Taux boosté conditionné à la part d''UC en encours (50 % ou 70 %)', frais_arbitrage_note = '1 arbitrage gratuit par année civile, puis 40 € par arbitrage', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '500 €', distributeur = 'Vie Plus (CGP)', options_gestion = ARRAY['Gestion libre','Gestion sous mandat','Gestion bicompartimentée'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI','Private equity'] WHERE key = 'Suravenir::Vie Plus Impact 3207';

-- Suravenir::WeSave Patrimoine 3198
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '300 €', versement_min = '20 €', distributeur = 'WeSave', service_extranet = 'wesave.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée (10 profils P1-P10)'], univers_classes = ARRAY['Fonds euros','ETF','OPCVM'] WHERE key = 'Suravenir::WeSave Patrimoine 3198';

-- Suravenir::Yomoni Vie 3185
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Suravenir Opportunités 2 selon part UC en encours : < 30 % → 3,00 %, 30-50 % → 3,50 %, 50-70 % → 4,00 %, > 70 % → 4,50 %', fonds_euros_contrainte_uc = 'Suravenir Opportunités 2 accessible uniquement en gestion libre, sans contrainte d''UC minimum, bonus progressif lié au taux d''UC', frais_arbitrage_note = 'Arbitrages gratuits et illimités', garantie_fonds_euros = 'Suravenir Opportunités 2 : capital garanti à 97 % net de frais de gestion. Suravenir Rendement 2 : garantie à 100 %', ticket_entree = '1 000 €', versement_min = '50 € (versements complémentaires ponctuels ou programmés)', distributeur = 'Yomoni (direct, plateforme propriétaire)', service_extranet = 'Espace client Yomoni (yomoni.fr), multicompartiment jusqu''à 100 compartiments thématiques', options_gestion = ARRAY['Gestion pilotée','Gestion libre','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage automatique','Dynamisation des plus-values'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','Private equity'] WHERE key = 'Suravenir::Yomoni Vie 3185';

-- Swiss Life Luxembourg::Swiss Life Luxembourg Univers Global
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '250 000 €', versement_min = '250 000 €', distributeur = 'CGP / Swiss Life Global Solutions', options_gestion = ARRAY['Gestion libre','Gestion conseillée','Gestion déléguée','Profil Sécurisé','Profil Équilibré','Profil Dynamique'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Fonds dédiés internes (FID)','Fonds collectifs internes (FIC)','Fonds d''assurance spécialisés (FAS)','Produits structurés','Private equity','ESG/ISR'] WHERE key = 'Swiss Life Luxembourg::Swiss Life Luxembourg Univers Global';

-- SwissLife France::Capi Expert Premium (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Selon part UC : < 40 % → 1,70 %, 40-60 % → 2,20 %, ≥ 60 % → 3,05 % (2024). +0,20 % pour clients Gestion Privée (encours foyer > 250 000 €)', fonds_euros_contrainte_uc = 'Taux conditionné à la part investie en UC (paliers à 40 % et 60 % d''UC)', frais_arbitrage_note = '0,50 % (min. 50 €) par arbitrage libre, changement de mode de gestion gratuit', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '25 000 €', distributeur = 'Courtiers et CGP partenaires SwissLife (non souscriptible en ligne)', service_extranet = 'Gestion en ligne (espace partenaire SwissLife)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Stop-loss','Stop-loss relatif','Sécurisation des plus-values','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','SCPI','SCI','Titres vifs'] WHERE key = 'SwissLife France::Capi Expert Premium (fermé à la commercialisation)';

-- SwissLife France::Capi Expert Premium (sans fonds en euros) (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrage non gratuit selon conditions contractuelles', ticket_entree = '25 000 €', distributeur = 'CGP partenaires SwissLife', service_extranet = 'Gestion en ligne disponible', options_gestion = ARRAY['Stop-loss','Stop-loss relatif','Sécurisation des plus-values','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['UC','SCPI','SCI','Titres vifs'] WHERE key = 'SwissLife France::Capi Expert Premium (sans fonds en euros) (fermé à la commercialisation)';

-- SwissLife France::Capi Expert Premium Plus
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '1,70 % si UC < 40 %, 2,20 % si UC 40-60 %, 3,05 % si UC > 60 % (net de frais de gestion, hors prélèvements sociaux). +0,20 % pour clients Gestion Privée (encours foyer > 250 000 €, max 3,25 %)', fonds_euros_contrainte_uc = 'Aucune contrainte minimale d''UC obligatoire, taux bonifié selon la part investie en UC', frais_arbitrage_note = 'Arbitrage libre : 1,00 % + 30 €. Changement de mode de gestion gratuit. Option d''allocation ou avenant de réorientation : +2,00 % max', garantie_fonds_euros = 'Capital garanti avec effet cliquet (performance annuelle définitivement acquise)', ticket_entree = '3 000 €', versement_min = '3 000 € versement initial', distributeur = 'Partenaires / CGP SwissLife France (non disponible en direct)', service_extranet = 'Espace en ligne SwissLife (gestion en ligne, souscription non digitale)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Fonds datés'] WHERE key = 'SwissLife France::Capi Expert Premium Plus';

-- SwissLife France::Capi Expert Premium Plus (sans fonds en Euros)
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1,00 % + 30 € par arbitrage libre. Changement de mode de gestion gratuit. Option d''allocation ou avenant de réorientation : +2,00 %', ticket_entree = '3 000 €', versement_min = '3 000 €', distributeur = 'SwissLife Assurance et Patrimoine (partenaires CGP/courtiers)', service_extranet = 'Gestion en ligne disponible', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['ETF','SCPI','SCI','OPCI','Private equity','Titres vifs'] WHERE key = 'SwissLife France::Capi Expert Premium Plus (sans fonds en Euros)';

-- SwissLife France::Capi Objectif Patrimoine
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Selon part UC : < 40 % → 1,70 %, 40-60 % → 2,20 %, > 60 % → 3,05 %. +0,20 % pour clients Gestion Privée (foyer > 250 000 €)', frais_arbitrage_note = 'Max 0,60 % + 30 € par arbitrage libre, aucun arbitrage gratuit. Changement de mode de gestion gratuit', garantie_fonds_euros = 'Garantie plancher en cas de décès (jusqu''à 75 000 €). Capital garanti à tout moment (actif général)', ticket_entree = '3 000 €', versement_min = '3 000 € initial', distributeur = 'Réseau CGP / partenaires SwissLife (Predictis, Haussmann Patrimoine), non distribué en ligne', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Arbitrage automatique','Sécurisation des plus-values','Investissement progressif'], univers_classes = ARRAY['Fonds euros','ETF','OPCI','SCI','Private equity'] WHERE key = 'SwissLife France::Capi Objectif Patrimoine';

-- SwissLife France::Darjeeling (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Selon part UC et encours : 1,90 % (< 40 % UC, ≤ 250 k€), 2,10 % (< 40 % UC, > 250 k€), 2,40 % (40-60 % UC, ≤ 250 k€), 2,60 % (40-60 % UC, > 250 k€), 3,25 % (≥ 60 % UC, ≤ 250 k€)', fonds_euros_contrainte_uc = 'Aucune contrainte obligatoire (100 % fonds euros possible), bonus conditionné à la part d''UC (≥ 40 % ou ≥ 60 % pour les paliers supérieurs)', frais_arbitrage_note = 'Arbitrages gratuits, ponctuels et automatiques, sans restriction', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '100 € ponctuel ou 50 €/mois programmé', versement_min = '50 € ponctuel ou 50 €/mois programmé', distributeur = 'Placement-direct.fr (SwissLife)', service_extranet = 'Espace client Placement-direct.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','OPCI'] WHERE key = 'SwissLife France::Darjeeling (fermé à la commercialisation)';

-- SwissLife France::ELITE SOVILA VIE
UPDATE public.investissement_av_contract_terms SET distributeur = 'Partenaires CGP Swiss Life', univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','SCI'] WHERE key = 'SwissLife France::ELITE SOVILA VIE';

-- SwissLife France::Epargne Retraite (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '2,20 % si UC 40-60 %, 3,05 % si UC > 60 %. +0,20 % si encours > 250 000 €', fonds_euros_contrainte_uc = '20 % maximum sur fonds euros', frais_arbitrage_note = '0,50 % du montant arbitré', garantie_fonds_euros = 'Capital garanti', ticket_entree = '900 €', distributeur = 'SwissLife France (réseau propre)', service_extranet = 'Gestion en ligne disponible', univers_classes = ARRAY['Fonds euros','Unités de compte'] WHERE key = 'SwissLife France::Epargne Retraite (fermé à la commercialisation)';

-- SwissLife France::Epargne Retraite Evolution 2 (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '+0,50 % si UC 40-60 %, +1,35 % si UC > 60 % (2024)', garantie_fonds_euros = 'Capital garanti net de frais', distributeur = 'Réseau conseillers SwissLife (CGP)', univers_classes = ARRAY['Fonds euros','OPCVM'] WHERE key = 'SwissLife France::Epargne Retraite Evolution 2 (fermé à la commercialisation)';

-- SwissLife France::Excelsio Capi
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,80 % (min. 30 €, max 800 €), 1 arbitrage gratuit par an, option d''allocation +0,70 % max', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '10 000 €', versement_min = '10 000 €', distributeur = 'Courtiers et CGP partenaires SwissLife', options_gestion = ARRAY['Gestion libre','Option d''allocation automatique','Avenant de réorientation d''épargne'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','SCPI','OPCI','SCI'] WHERE key = 'SwissLife France::Excelsio Capi';

-- SwissLife France::Excelsio Capi (sans fonds en euros)
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 arbitrage gratuit par an', ticket_entree = '10 000 €', versement_min = '10 000 €', distributeur = 'SwissLife France (réseau partenaires CGP)', options_gestion = ARRAY['Stop-loss','Stop-loss relatif','Sécurisation des plus-values','Investissement progressif','Rééquilibrage automatique','Gestion sous mandat','Avance'], univers_classes = ARRAY['OPCVM','ETF'] WHERE key = 'SwissLife France::Excelsio Capi (sans fonds en euros)';

-- SwissLife France::Excelsio Vie
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '10 000 €', versement_min = '10 000 €', distributeur = 'Swiss Life Assurance et Patrimoine, réseau CGP/partenaires', options_gestion = ARRAY['Stop-loss','Stop-loss relatif','Sécurisation des plus-values','Investissement progressif','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','OPCVM','Actions','Obligations','Alternatifs','Convertibles','Matières premières'] WHERE key = 'SwissLife France::Excelsio Vie';

-- SwissLife France::Expert Premium (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '+0,35 % si UC 40-60 %, +1,35 % si UC ≥ 60 %, +0,20 % pour clients Gestion Privée (encours foyer > 250 000 €), taux max 3,25 %', fonds_euros_contrainte_uc = 'Bonus conditionné à la part d''UC : 1,70 % (< 40 % UC), 2,05 % (40-60 % UC), 3,05 % (≥ 60 % UC), +0,20 % pour Gestion Privée', frais_arbitrage_note = '0,50 % du montant arbitré (min. 50 €)', garantie_fonds_euros = 'Capital garanti', ticket_entree = '8 000 €', versement_min = '500 €/mois, 750 €/trimestre, 1 000 €/semestre, 2 000 €/an programmé', distributeur = 'SwissLife France (réseau CGP partenaires)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros'] WHERE key = 'SwissLife France::Expert Premium (fermé à la commercialisation)';

-- SwissLife France::Expert Premium Plus
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Selon part UC : 2,20 % entre 40 et 60 % UC, 3,05 % au-delà de 60 % UC (net de frais de gestion, brut de prélèvements sociaux)', fonds_euros_contrainte_uc = 'Bonus conditionné à l''allocation en UC : palier 40-60 % pour taux intermédiaire, > 60 % UC pour taux maximum 3,05 %', frais_arbitrage_note = '1,00 % + 30 € par arbitrage libre. Changement de mode de gestion gratuit. Frais jusqu''à 1,20 % sous option d''allocation ou avenant de réorientation', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '3 000 €', versement_min = '3 000 € versement initial', distributeur = 'Réseau de CGP et courtiers partenaires SwissLife (non distribué en direct)', service_extranet = 'Extranet partenaires SwissLife', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs'] WHERE key = 'SwissLife France::Expert Premium Plus';

-- --- part_11.sql ---
-- SwissLife France::Globale Vie Capi Plus
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Jusqu''à 4,40 % avec bonus souscription, jusqu''à 3,05 % si plus de 60 % en UC', frais_arbitrage_note = '1 arbitrage gratuit par année civile, puis 60 € par opération', garantie_fonds_euros = 'Capital garanti', ticket_entree = '4 500 €', versement_min = '4 500 €' WHERE key = 'SwissLife France::Globale Vie Capi Plus';

-- SwissLife France::Globale Vie Plus
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif Général SwissLife Assurance et Patrimoine', fonds_euros_bonus = 'Taux majoré selon part UC, 1,70 % (UC < 40 %), 2,20 % (40-60 % UC), 3,05 % (> 60 % UC), +0,20 % clients Gestion Privée (encours foyer > 250 000 €)', fonds_euros_contrainte_uc = 'Bonification de taux conditionnée à la part d''UC (seuils 40 % et 60 %)', frais_arbitrage_note = '1 arbitrage gratuit par année civile, puis 60 € par arbitrage. Changement de mode de gestion gratuit', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '4 500 €', versement_min = '4 500 €', distributeur = 'Réseau partenaires SwissLife (courtiers et CGP)', service_extranet = 'SwissLife One (extranet partenaires)' WHERE key = 'SwissLife France::Globale Vie Plus';

-- SwissLife France::GPH Patrimoine Partenaires Vie
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais' WHERE key = 'SwissLife France::GPH Patrimoine Partenaires Vie';

-- SwissLife France::MCA Avenir Sérénité
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Swiss Life', fonds_euros_contrainte_uc = 'Taux progressif selon part UC, 1,70 % (< 40 % UC), 2,20 % (40-60 % UC), 3,05 % (> 60 % UC)', garantie_fonds_euros = 'Capital garanti net de frais', distributeur = 'Réseau partenaires CGP Swiss Life France' WHERE key = 'SwissLife France::MCA Avenir Sérénité';

-- SwissLife France::Objectif Epargne
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros SwissLife Assurance et Patrimoine', fonds_euros_bonus = 'Taux bonifié selon part UC, 1,70 % (< 40 % UC), 2,20 % (40-60 % UC), 3,05 % (> 60 % UC)', fonds_euros_contrainte_uc = 'Souscripteurs de plus de 80 ans, 50 % minimum sur le fonds en euros (non réductible par arbitrage)', frais_arbitrage_note = 'Jusqu''à 0,60 % du montant arbitré + 30 € (transfert sortant), aucun arbitrage gratuit par an', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '900 €', versement_min = '300 € par trimestre ou 75 € par mois (cotisations périodiques)', distributeur = 'Predictis / Capfinances (réseau CGP partenaires SwissLife)' WHERE key = 'SwissLife France::Objectif Epargne';

-- SwissLife France::Objectif Patrimoine
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = '2,20 % entre 40-60 % UC, 3,05 % au-delà de 60 % UC, +0,20 % si encours > 250 000 € (Gestion Privée)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '3 000 €', versement_min = '1 500 €', distributeur = 'SwissLife Assurance et Patrimoine (réseau CGP / courtiers)', options_gestion = ARRAY['Arbitrage libre','Réallocation automatique','Investissement progressif','Arbitrage de plus-values','Gestion déléguée Flornoy (Force 1 à 6)'] WHERE key = 'SwissLife France::Objectif Patrimoine';

-- SwissLife France::Oxygène Capi (sans fonds en euros)
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Arbitrages non gratuits, montant non précisé', ticket_entree = '3 000 €', versement_min = '3 000 €', distributeur = 'Réseau partenaires CGP SwissLife Assurance et Patrimoine', options_gestion = ARRAY['Stop-loss absolu','Stop-loss relatif','Sécurisation des plus-values','Investissement progressif'], univers_classes = ARRAY['Actions','Obligations','Convertibles','Stratégies alternatives','OPCVM'] WHERE key = 'SwissLife France::Oxygène Capi (sans fonds en euros)';

-- SwissLife France::Oxygène Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Euro+ SwissLife', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '3 000 €', versement_min = '3 000 €', distributeur = 'CGP réseau SwissLife / Nortia', options_gestion = ARRAY['Stop-loss absolu','Stop-loss relatif','Sécurisation des plus-values','Investissement progressif'], univers_classes = ARRAY['Fonds euros','Actions','Obligations','Convertibles','Stratégies alternatives'] WHERE key = 'SwissLife France::Oxygène Vie';

-- SwissLife France::Placement-direct Euro+
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'SwissLife Euro+', fonds_euros_contrainte_uc = '30 % minimum en UC, plafond 50 000 € par adhérent sur le fonds euros', frais_arbitrage_note = 'Arbitrages gratuits (à la demande et automatiques)', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '50 € (versements libres et programmés)', distributeur = 'Placement-direct.fr', service_extranet = 'Souscription et gestion en ligne sur placement-direct.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Sécurisation des plus-values','Rééquilibrage automatique'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','Private equity','Fonds datés'] WHERE key = 'SwissLife France::Placement-direct Euro+';

-- SwissLife France::Placement-direct Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Actif général de Swiss Life Assurance et Patrimoine', fonds_euros_bonus = 'Taux bonifié selon quotité UC et encours, < 40 % UC 1,90 % (≤ 250 000 €) ou 2,10 % (> 250 000 €), 40-60 % UC 2,40 % ou 2,60 %, > 60 % UC 3,25 % ou 3,45 %', fonds_euros_contrainte_uc = 'Bonus activé à partir de 40 % du contrat en UC, taux plancher 1,90 % sans contrainte UC', frais_arbitrage_note = 'Arbitrage gratuit entre fonds, frais de transaction 0,10 % sur ETF et 0,45 % sur titres vifs', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '500 €', versement_min = '50 € (versement libre), 50 €/mois (versements programmés)', distributeur = 'placement-direct.fr', service_extranet = 'Espace client en ligne sur placement-direct.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Investissement progressif','Sécurisation des plus-values','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Private equity','Titres vifs','Produits structurés','Fonds datés'] WHERE key = 'SwissLife France::Placement-direct Vie';

-- SwissLife France::Sélection Active
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'CGP / réseau partenaires SwissLife France', options_gestion = ARRAY['Gestion libre','Gestion pilotée'] WHERE key = 'SwissLife France::Sélection Active';

-- SwissLife France::Sélection Active Capi
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros SwissLife Assurance et Patrimoine', frais_arbitrage_note = '0,10 % par arbitrage libre, changement de mode de gestion gratuit, option d''allocation +0,50 % max/an', garantie_fonds_euros = 'Capital garanti', ticket_entree = '4 500 €', versement_min = '4 500 €', distributeur = 'CGP partenaires SwissLife', options_gestion = ARRAY['Option d''allocation','Avenant de réorientation d''épargne'], univers_classes = ARRAY['Fonds euros','Actions','Obligations','ETF','SCPI','OPCI','SCI','Diversifiés','Private equity'] WHERE key = 'SwissLife France::Sélection Active Capi';

-- SwissLife France::Sélection Oxygène (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros Oxygène', frais_arbitrage_note = '1 arbitrage gratuit par an, frais d''arbitrage libre 1 %, option allocation déléguée +1,20 % max', ticket_entree = '3 000 €', versement_min = '3 000 €', distributeur = 'Swiss Life Assurance et Patrimoine (réseaux CGP partenaires)', options_gestion = ARRAY['Gestion libre','Option d''allocation déléguée','Avenant de réorientation d''épargne'] WHERE key = 'SwissLife France::Sélection Oxygène (fermé à la commercialisation)';

-- SwissLife France::Sélection Oxygène Capitalisation (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'CGP / conseillers en gestion de patrimoine' WHERE key = 'SwissLife France::Sélection Oxygène Capitalisation (fermé à la commercialisation)';

-- SwissLife France::Stratégie Vie Evolution
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros SwissLife (gamme CGP)', fonds_euros_contrainte_uc = 'Taux progressif selon part UC, 1,70 % (< 40 % UC), 2,20 % (40-60 % UC), 3,05 % (≥ 60 % UC), +0,20 pt clients Gestion Privée (> 250 000 €)', garantie_fonds_euros = 'Capital garanti net de frais', distributeur = 'Swiss Life France (réseau courtiers et CGP)', options_gestion = ARRAY['Gestion libre','Gestion déléguée (allocations Force 1-6)','Gestion privée'] WHERE key = 'SwissLife France::Stratégie Vie Evolution';

-- SwissLife France::Stratégie Vie Multifonds
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros Swiss Life', fonds_euros_bonus = 'Taux bonifié selon part UC, 1,70 % (< 40 % UC), 2,20 % (40-60 % UC), 3,05 % (≥ 60 % UC), +0,20 % clients Private Wealth (> 250 000 €)', fonds_euros_contrainte_uc = 'Taux progressif selon part investie en UC', frais_arbitrage_note = '0,20 % + 30 € par arbitrage', garantie_fonds_euros = 'Capital garanti net de frais', ticket_entree = '3 000 €', versement_min = '3 000 €', distributeur = 'CGP / courtiers partenaires Swiss Life', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Gestion sous mandat'] WHERE key = 'SwissLife France::Stratégie Vie Multifonds';

-- SwissLife France::Swiss Life Capi Strategic Plus EurOpportunités (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'SwissLife EurOpportunités', fonds_euros_bonus = 'Taux bonifié selon part UC, 1,70 % (< 40 %), 2,20 % (40-60 %), 3,05 % (> 60 %), +0,20 % clients Gestion Privée', fonds_euros_contrainte_uc = 'Pas de quota UC obligatoire, taux servi majoré selon part investie en UC', frais_arbitrage_note = '1 arbitrage gratuit par an, puis 0,20 % du montant transféré + 30 €', garantie_fonds_euros = 'Capital et intérêts acquis garantis en permanence (effet de cliquet annuel)', ticket_entree = '3 000 €', versement_min = '3 000 € initial', distributeur = 'Swiss Life Assurance et Patrimoine (réseau CGP / agents généraux)', service_extranet = 'myswisslife.fr (consultation et pilotage en ligne)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'] WHERE key = 'SwissLife France::Swiss Life Capi Strategic Plus EurOpportunités (fermé à la commercialisation)';

-- SwissLife France::Swiss Life Strategic Plus EurOpportunités (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'SwissLife EurOpportunités', fonds_euros_bonus = 'Taux bonifié selon part UC, 2,20 % (40-60 % UC), 3,05 % (> 60 % UC)', fonds_euros_contrainte_uc = 'Taux de base 1,70 % (< 40 % UC), bonus progressif jusqu''à 3,05 % (> 60 % UC)', frais_arbitrage_note = '1er arbitrage gratuit par année civile, puis 1 % (minimum 90 €) par arbitrage suivant', garantie_fonds_euros = 'Capital garanti', distributeur = 'Swiss Life France (réseau propre, CGP)' WHERE key = 'SwissLife France::Swiss Life Strategic Plus EurOpportunités (fermé à la commercialisation)';

-- SwissLife France::SwissLife Capi Stratégic Premium
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds euros SwissLife Assurance et Patrimoine', fonds_euros_bonus = '2,20 % si 40-60 % en UC, 3,05 % si > 60 % en UC, +0,20 % clients Gestion Privée (encours foyer > 250 000 €, taux max 3,25 %)', fonds_euros_contrainte_uc = 'Quota UC minimum pour bonus 40 % (taux de base 1,70 % si < 40 % UC)', frais_arbitrage_note = '1 arbitrage gratuit par an, puis 0,20 % du montant arbitré (+ forfait 30 € selon sources)', garantie_fonds_euros = 'Capital garanti net de frais de gestion (effet cliquet annuel)', ticket_entree = '3 000 €', versement_min = '300 € (versement libre complémentaire), 150 € (versements programmés)', distributeur = 'Réseau CGP / courtiers patrimoniaux (non souscriptible en direct en ligne)', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'], univers_classes = ARRAY['Fonds euros','ETF','SCPI','SCI','OPCI','Titres vifs','Produits structurés'] WHERE key = 'SwissLife France::SwissLife Capi Stratégic Premium';

-- SwissLife France::SwissLife Evolution Plus
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds en euros SwissLife', fonds_euros_bonus = '+0,20 % clients Gestion Privée (encours foyer > 250 000 €), taux max 3,25 %', fonds_euros_contrainte_uc = 'Taux bonifié selon part UC, < 40 % UC 1,70 %, 40-60 % UC 2,20 %, > 60 % UC 3,05 % (net de frais de gestion, hors prélèvements sociaux)', frais_arbitrage_note = '0,20 % + 30 € minimum par arbitrage, 1 arbitrage gratuit par année civile, changement de mode de gestion gratuit', garantie_fonds_euros = 'Capital garanti net de frais de gestion', ticket_entree = '3 000 €', distributeur = 'Réseau SwissLife (agents généraux, CGP partenaires), pas de souscription en ligne directe', service_extranet = 'Espace client en ligne swisslife.fr', options_gestion = ARRAY['Gestion libre','Gestion pilotée','Sécurisation des plus-values','Stop-loss','Investissement progressif','Rééquilibrage'] WHERE key = 'SwissLife France::SwissLife Evolution Plus';

-- SwissLife France::SwissLife Retraite
UPDATE public.investissement_av_contract_terms SET fonds_euros_bonus = 'Jusqu''à 3,05 % avec plus de 60 % d''UC (2,20 % entre 40 et 60 % d''UC)', frais_arbitrage_note = '1 arbitrage gratuit par an, puis frais selon conditions', garantie_fonds_euros = 'Capital garanti', distributeur = 'Réseau Swiss Life, CGP partenaires', options_gestion = ARRAY['Stop-loss','Stop-loss relatif','Sécurisation des plus-values','Investissement progressif'], univers_classes = ARRAY['Fonds euros','UC','OPCVM','SCPI','SCI'] WHERE key = 'SwissLife France::SwissLife Retraite';

-- SwissLife France::SwissLife Retraite (art. 82)
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = 'Taux bonifié selon part UC, 1,70 % (< 40 % UC), 2,20 % (40-60 % UC), 3,05 % (> 60 % UC), +0,20 % clients Private Wealth (> 250 000 €)', frais_arbitrage_note = '1 arbitrage gratuit par an, puis frais selon conditions', garantie_fonds_euros = 'Capital garanti', distributeur = 'Réseau CGP Swiss Life', options_gestion = ARRAY['Stop-loss','Stop-loss relatif','Sécurisation des plus-values','Investissement progressif'], univers_classes = ARRAY['Fonds euros','UC','SCPI','SCI'] WHERE key = 'SwissLife France::SwissLife Retraite (art. 82)';

-- SwissLife France::SwissLife Stratégic Premium
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'SwissLife Euro Strategic', fonds_euros_bonus = 'Taux de base 1,70 %, jusqu''à 3,05 % si 60 % ou plus en UC', fonds_euros_contrainte_uc = '40 % minimum en UC pour le bonus, 60 % ou plus pour le taux maximum 3,05 %', frais_arbitrage_note = '0,50 % en ligne, 1 % pour arbitrages UC', garantie_fonds_euros = 'Capital garanti', ticket_entree = '3 000 €', versement_min = '25 €', distributeur = 'Swiss Life France (réseau propre + CGP)', options_gestion = ARRAY['Gestion libre','Gestion profilée Force 1 à 6','Sécurisation des plus-values','Dynamisation des plus-values','Limitation des pertes','Allocation constante'], univers_classes = ARRAY['Fonds euros','UC','ETF','SCPI','SCI','OPCI','Produits structurés'] WHERE key = 'SwissLife France::SwissLife Stratégic Premium';

-- SwissLife France::SwissLife Stratégic Vie Génération
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '0,20 % + 30 € par arbitrage, 1 arbitrage gratuit par an', ticket_entree = '60 000 €', versement_min = '60 000 €', distributeur = 'SwissLife France (réseau CGP / conseillers)', options_gestion = ARRAY['Gestion sous mandat'], univers_classes = ARRAY['OPCVM','SCPI','SCI','Actions','Obligations','Convertibles','Alternatif','Immobilier','Monétaire','Marchés émergents'] WHERE key = 'SwissLife France::SwissLife Stratégic Vie Génération';

-- SwissLife France::Titres@capi PEA (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Gratuit sur OPCVM, 0,29 % sur actions (min 25 €)', ticket_entree = '1 000 €', versement_min = '1 000 €', distributeur = 'Altaprofits', options_gestion = ARRAY['Gestion libre','Gestion pilotée Profil PEA (Lazard Frères)','Gestion pilotée Profil PEA Gestion Privée (Lazard Frères)','Multi-poches'], univers_classes = ARRAY['Actions','OPCVM'] WHERE key = 'SwissLife France::Titres@capi PEA (fermé à la commercialisation)';

-- SwissLife France::Titres@vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Swiss Life - Actif général', fonds_euros_bonus = 'Boost jusqu''à 1,55 % selon part UC et encours', fonds_euros_contrainte_uc = 'Taux maximum (3,45 %) réservé aux contrats > 250 000 € avec 60 % minimum en UC', frais_arbitrage_note = 'Arbitrage gratuit (manuel et automatique), frais de transaction sur titres vifs et ETF 0,29 % par opération (min 25 €)', garantie_fonds_euros = 'Capital garanti', ticket_entree = '1 000 €', versement_min = '450 €', distributeur = 'Altaprofits', options_gestion = ARRAY['Arbitrage automatique des plus-values','Arbitrage automatique des moins-values','Réallocations automatiques','Gestion assistée Asset Allocator','Gestion pilotée Lazard Frères Gestion (3 profils)'] WHERE key = 'SwissLife France::Titres@vie';

-- SwissLife France::UBS Patrimoine Capi
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '2 arbitrages gratuits par année civile, puis frais variables', garantie_fonds_euros = 'Capital garanti', ticket_entree = '10 000 €', versement_min = '10 000 €', distributeur = 'UBS (banque privée)', options_gestion = ARRAY['Gestion libre'], univers_classes = ARRAY['Fonds euros','OPCVM','ETF','Immobilier','SCPI','SCI','OPCI','Gestion alternative'] WHERE key = 'SwissLife France::UBS Patrimoine Capi';

-- SwissLife France::UBS Patrimoine Vie
UPDATE public.investissement_av_contract_terms SET fonds_euros_nom = 'Fonds Euro Swiss Life', frais_arbitrage_note = '0,20 % + 30 € par arbitrage', garantie_fonds_euros = 'Capital garanti net de frais de gestion', distributeur = 'UBS France (réseau banque privée)', options_gestion = ARRAY['Gestion libre','Gestion profilée'] WHERE key = 'SwissLife France::UBS Patrimoine Vie';

-- SwissLife France::Violetto (fermé à la commercialisation)
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = 'Minimum 50 € par arbitrage', garantie_fonds_euros = 'Capital garanti', ticket_entree = '8 000 €', versement_min = '8 000 €', distributeur = 'Arca Patrimoine', options_gestion = ARRAY['Gestion horizons','Gestion diversifiée','Gestion profilée','Flexible Dynamics (rotation mensuelle 25 fonds)'], univers_classes = ARRAY['Fonds euros','Actions Europe','Actions françaises','Actions internationales','Obligations','Fonds mixtes','Actions BRIC / matières premières'] WHERE key = 'SwissLife France::Violetto (fermé à la commercialisation)';

-- Utmost Luxembourg S.A.::Utmost Liberté Luxembourg
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '2 arbitrages gratuits par an, puis 0,50 % (min 100 €, max 1 000 €)', ticket_entree = '250 000 €', versement_min = '250 000 €', distributeur = 'CGP / conseillers en gestion de patrimoine', service_extranet = 'Utmost Connect', options_gestion = ARRAY['Fonds interne collectif (FIC)','Fonds interne dédié (FID)','Fonds d''assurance spécialisé (FAS)'], univers_classes = ARRAY['OPCVM','FID','FAS','Private equity','Immobilier non coté','Infrastructure'] WHERE key = 'Utmost Luxembourg S.A.::Utmost Liberté Luxembourg';

-- Vitis Life::Vitis Life Luxembourg
UPDATE public.investissement_av_contract_terms SET ticket_entree = '50 000 €', versement_min = '5 000 €', distributeur = 'CGP / conseillers en gestion de patrimoine', options_gestion = ARRAY['Gestion libre','Gestion sous mandat','Délégation de gestion'], univers_classes = ARRAY['OPCVM','FID','FIC','FAS','Fonds multi-devises','ETF','SCPI','Private equity'] WHERE key = 'Vitis Life::Vitis Life Luxembourg';

-- Wealins::Wealins Luxembourg
UPDATE public.investissement_av_contract_terms SET frais_arbitrage_note = '1 arbitrage gratuit par an, puis 0,50 % (plafond 500 € à 1 000 € selon source)', ticket_entree = '250 000 €', versement_min = '25 000 € (complémentaire, indicatif)', distributeur = 'CGP / family offices (via e-Wealins)', service_extranet = 'Souscription et gestion en ligne via e-Wealins', options_gestion = ARRAY['Gestion libre','Gestion déléguée (FID)','Gestion conseillée','Gestion pilotée'], univers_classes = ARRAY['ETF','Private equity','Titres vifs','Produits structurés'] WHERE key = 'Wealins::Wealins Luxembourg';

-- ===== Normalisation finale (résidus de méta-sourcing) =====
UPDATE public.investissement_av_contract_terms SET
  frais_arbitrage_note = regexp_replace(frais_arbitrage_note, ' selon sources?', '', 'g'),
  fonds_euros_bonus = regexp_replace(fonds_euros_bonus, ' selon sources?', '', 'g'),
  garantie_fonds_euros = regexp_replace(garantie_fonds_euros, ' selon sources?', '', 'g')
WHERE frais_arbitrage_note LIKE '%selon source%' OR fonds_euros_bonus LIKE '%selon source%' OR garantie_fonds_euros LIKE '%selon source%';
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = NULL WHERE fonds_euros_contrainte_uc = 'Non confirmée pour ce contrat';

-- ===== Nettoyage final (booléens bruts, point-virgules résiduels, pourcentages collés, fonds euros creux) =====
UPDATE public.investissement_av_contract_terms SET
  fonds_euros_nom       = regexp_replace(fonds_euros_nom,' ; ',', ','g'),
  fonds_euros_bonus     = regexp_replace(regexp_replace(fonds_euros_bonus,' ; ',', ','g'),'([0-9])%','\1 %','g'),
  fonds_euros_contrainte_uc = regexp_replace(regexp_replace(fonds_euros_contrainte_uc,' ; ',', ','g'),'([0-9])%','\1 %','g'),
  frais_arbitrage_note  = regexp_replace(regexp_replace(frais_arbitrage_note,' ; ',', ','g'),'([0-9])%','\1 %','g'),
  garantie_fonds_euros  = regexp_replace(regexp_replace(garantie_fonds_euros,' ; ',', ','g'),'([0-9])%','\1 %','g'),
  ticket_entree         = regexp_replace(ticket_entree,' ; ',', ','g'),
  versement_min         = regexp_replace(versement_min,' ; ',', ','g'),
  distributeur          = regexp_replace(distributeur,' ; ',', ','g'),
  service_extranet      = regexp_replace(service_extranet,' ; ',', ','g');
UPDATE public.investissement_av_contract_terms SET service_extranet = 'Gestion en ligne disponible' WHERE service_extranet = 'true';
UPDATE public.investissement_av_contract_terms SET service_extranet = NULL WHERE service_extranet = 'false';
UPDATE public.investissement_av_contract_terms SET garantie_fonds_euros = 'Capital garanti' WHERE garantie_fonds_euros IN ('true','false');
UPDATE public.investissement_av_contract_terms SET fonds_euros_contrainte_uc = NULL WHERE fonds_euros_contrainte_uc IN ('true','false');
UPDATE public.investissement_av_contract_terms SET
  fonds_euros_contrainte_uc = NULL,
  frais_arbitrage_note = 'Arbitrages gratuits en ligne, payants hors ligne'
WHERE key = 'Spirica::Privilège Saint Honoré';
UPDATE public.investissement_av_insurer_profiles SET
  positionnement = regexp_replace(positionnement,' ; ',', ','g'),
  fonds_euros    = regexp_replace(fonds_euros,' ; ',', ','g');
UPDATE public.investissement_av_insurer_profiles SET fonds_euros = NULL WHERE lower(fonds_euros) = 'variable' OR fonds_euros = 'standard';
