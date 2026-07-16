-- ============================================================================
-- investissement_av_insurer_profiles — profils assureurs (vague de curation 1)
-- ----------------------------------------------------------------------------
-- Vague 1 du « mapping exhaustif CGP » : les CONDITIONS propres au contrat ne
-- sont pas dans notre base d'éligibilité (frais gestion réels, versement,
-- arbitrage, fonds euros du contrat, options). En attendant leur curation
-- contrat par contrat, on enrichit chaque fiche-contrat par le profil de son
-- ASSUREUR — donnée robuste (le nom d'assureur matche notre base) et à haute
-- valeur CGP : groupe, positionnement sur le canal courtage, fonds euros
-- indicatif, forces / limites, et spécificités Luxembourg (ticket, FID/FAS).
--
-- Source : docs/mapping-assureurs-contrats-cgp.md (v1). Les FAITS STRUCTURELS
-- (groupe, positionnement, univers, seuils Lux) sont stables ; les TAUX de fonds
-- euros et frais sont des ORDRES DE GRANDEUR millésime 2025 → la colonne
-- fonds_euros porte le libellé « indicatif 2025 » et l'UI l'affiche comme tel.
--
-- Clé = `company`, identique à investissement_contract_groups_mv.company (donc
-- au champ o.company renvoyé par get_contract_overview). RLS activée + grants
-- révoqués (l'app lit en service_role, qui bypass RLS), cohérent avec le
-- durcissement anti-scraping.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.investissement_av_insurer_profiles (
  company        text PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('fr', 'lux')),
  groupe         text,
  positionnement text,
  fonds_euros    text,
  forces         text[]  NOT NULL DEFAULT '{}',
  limites        text[]  NOT NULL DEFAULT '{}',
  lux            jsonb,
  source         text    NOT NULL DEFAULT 'docs/mapping-assureurs-contrats-cgp.md v1',
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investissement_av_insurer_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investissement_av_insurer_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.investissement_av_insurer_profiles TO service_role;

INSERT INTO public.investissement_av_insurer_profiles
  (company, kind, groupe, positionnement, fonds_euros, forces, limites, lux)
VALUES
  -- ── Socles français de l'architecture ouverte CGP ────────────────────────
  ('Generali Vie', 'fr', 'Generali',
   'Leader historique du courtage CGP, univers très large (Himalia, Xaélidia, PER ; Espace Lux au Luxembourg).',
   '1,90 % à 3,40 % selon quota d''UC (indicatif 2025)',
   ARRAY['Profondeur d''offre','PER','Notoriété sur le canal CGP'],
   ARRAY['Frais de gestion élevés en direct (~1 %)'], NULL),

  ('Spirica', 'fr', 'Crédit Agricole Assurances',
   'Champion de l''architecture ouverte (SCPI/SCI, titres vifs, private equity), souvent distribué via UAF Life Patrimoine (Netlife, Nouvelle Génération).',
   'Nouvelle Génération ~3,08 % (indicatif 2025)',
   ARRAY['Univers non coté et immobilier','Frais compétitifs'],
   ARRAY['Distribution dépendante de la plateforme'], NULL),

  ('Suravenir', 'fr', 'Crédit Mutuel Arkéa',
   'Momentum 2025, forte poussée sur les CGP et les courtiers en ligne.',
   '2,10 % à 3,00 % selon gestion (indicatif 2025)',
   ARRAY['Solvabilité élevée','Dynamique de collecte'],
   ARRAY['Image historiquement « en ligne »'], NULL),

  ('SwissLife France', 'fr', 'Swiss Life',
   'Haut de gamme CGP et banque privée (Strategic Premium, Placement Privilège, PER).',
   '1,70 % à 3,05 %, +0,20 pt en gestion privée (indicatif 2025)',
   ARRAY['Qualité de gestion','Gestion sous mandat'],
   ARRAY['Positionnement premium, tickets plus élevés'], NULL),

  ('BNP Paribas Cardif', 'fr', 'BNP Paribas',
   'Puissance de bilan, multi-canal (Cardif Elite, Multiplacements Privilège, Nova Stratégie).',
   '~2,75 % (indicatif 2025)',
   ARRAY['Solidité','Gamme large'],
   ARRAY['Moins « pure CGP » que Generali'], NULL),

  ('APICIL', 'fr', 'Groupe Apicil (mutualiste)',
   'Outsider intégré verticalement : plateforme Intencial + assureur luxembourgeois OneLife.',
   'variable',
   ARRAY['Dynamique','Intégration plateforme + Luxembourg'],
   ARRAY['Part de marché encore en construction'], NULL),

  ('Abeille Vie', 'fr', 'Aéma Groupe (ex-Aviva)',
   'Gros stock et réseau courtage historique (Abeille Épargne Plurielle).',
   'variable',
   ARRAY['Base installée'],
   ARRAY['Modernisation en cours'], NULL),

  ('AXA France', 'fr', 'AXA',
   'Adresse les CGP via son entité grossiste dédiée AXA Thema.',
   'variable',
   ARRAY['Marque','Solidité'],
   ARRAY['Accès via une entité dédiée'], NULL),

  ('AG2R La Mondiale', 'fr', 'AG2R La Mondiale',
   'Présent, plus fort sur le collectif (Vivépargne, Multéo) ; bras luxembourgeois = La Mondiale Europartner.',
   'variable',
   ARRAY['Solidité'],
   ARRAY['Moins central en AV individuelle CGP'], NULL),

  -- ── Bancassureurs & réseaux (présents en courtage, moins « pure CGP ») ────
  ('CNP Assurances', 'fr', 'CNP Assurances (Caisse des Dépôts / La Banque Postale)',
   'Bancassureur de premier plan, présent en courtage (ex. Lucya CNP).',
   NULL, ARRAY['Poids de marché'], ARRAY['Moins central sur le canal CGP pur'], NULL),

  ('Predica', 'fr', 'Crédit Agricole Assurances',
   'Bancassureur du groupe Crédit Agricole (réseaux LCL / Crédit Agricole).',
   NULL, ARRAY['Puissance du réseau'], ARRAY['Distribution surtout bancaire'], NULL),

  ('ACM Vie', 'fr', 'Crédit Mutuel (Assurances du Crédit Mutuel)',
   'Bancassureur du Crédit Mutuel / CIC.',
   NULL, ARRAY['Adossement bancaire'], ARRAY['Distribution surtout réseau'], NULL),

  ('Allianz France', 'fr', 'Allianz',
   'Assureur généraliste avec une offre patrimoniale CGP (Allianz Wealth).',
   NULL, ARRAY['Solidité de groupe'], ARRAY['Positionnement multi-canal'], NULL),

  ('Groupama Gan Vie', 'fr', 'Groupama',
   'Réseaux Gan et Groupama, offre patrimoniale (Gan Patrimoine).',
   NULL, ARRAY['Maillage réseau'], ARRAY['Moins central en AV CGP'], NULL),

  ('Oradéa Vie', 'fr', 'Société Générale Assurances',
   'Assureur-vie de Société Générale dédié au courtage, en repli.',
   NULL, ARRAY['Gamme courtage'], ARRAY['Activité en repli'], NULL),

  ('Afer', 'fr', 'Association Afer (contrat assuré par Abeille Assurances)',
   'Grande association d''épargnants, contrat multisupport de référence.',
   NULL, ARRAY['Communauté d''adhérents','Frais négociés'], ARRAY['Offre associative, moins « architecture ouverte »'], NULL),

  ('Agipi', 'fr', 'Association Agipi (contrats assurés par AXA)',
   'Association d''épargne adossée à AXA (gamme CLER, Cliquet).',
   NULL, ARRAY['Cadre associatif'], ARRAY['Univers plus restreint'], NULL),

  ('MMA Vie', 'fr', 'Covéa (MMA / MAAF / GMF)',
   'Assureur mutualiste du groupe Covéa (marque MMA).',
   NULL, ARRAY['Solidité mutualiste'], ARRAY['Moins central sur le canal CGP'], NULL),

  ('MAAF Vie', 'fr', 'Covéa (MMA / MAAF / GMF)',
   'Assureur mutualiste du groupe Covéa (marque MAAF).',
   NULL, ARRAY['Solidité mutualiste'], ARRAY['Moins central sur le canal CGP'], NULL),

  ('GMF Vie', 'fr', 'Covéa (MMA / MAAF / GMF)',
   'Assureur mutualiste du groupe Covéa (marque GMF).',
   NULL, ARRAY['Solidité mutualiste'], ARRAY['Moins central sur le canal CGP'], NULL),

  ('La France Mutualiste', 'fr', 'La France Mutualiste',
   'Mutuelle d''épargne (retraite mutualiste, assurance vie).',
   NULL, ARRAY['Cadre mutualiste'], ARRAY['Univers restreint'], NULL),

  ('Carac', 'fr', 'Carac',
   'Mutuelle d''épargne patrimoniale.',
   NULL, ARRAY['Cadre mutualiste'], ARRAY['Univers restreint'], NULL),

  ('Maif', 'fr', 'MAIF',
   'Assureur mutualiste militant (AV Responsable et Solidaire).',
   NULL, ARRAY['Positionnement ISR / solidaire'], ARRAY['Distribution surtout directe'], NULL),

  ('Macif Vie', 'fr', 'Macif (Aéma Groupe)',
   'Assureur mutualiste (Aéma), épargne grand public.',
   NULL, ARRAY['Base mutualiste'], ARRAY['Distribution surtout directe'], NULL),

  ('MACSF', 'fr', 'MACSF',
   'Mutuelle des professionnels de santé (RES multisupport).',
   NULL, ARRAY['Fidélité de la cible santé'], ARRAY['Cible professionnelle spécifique'], NULL),

  ('La Banque Postale Life', 'fr', 'La Banque Postale',
   'Offre vie du groupe La Banque Postale.',
   NULL, ARRAY['Adossement bancaire public'], ARRAY['Moins central sur le canal CGP'], NULL),

  ('Linxea', 'fr', 'Linxea (courtier en ligne)',
   'Courtier en ligne : distribue des contrats portés par Suravenir, Spirica et Apicil — assureur porteur variable selon le contrat.',
   NULL, ARRAY['Frais réduits','Souscription en ligne'], ARRAY['Distributeur, pas porteur de risque'], NULL),

  -- ── Compartiment luxembourgeois (haut de gamme, triangle de sécurité) ─────
  ('Cardif Lux Vie', 'lux', 'BNP Paribas',
   'Leader luxembourgeois adossé à un bilan bancaire, bon compromis sécurité / rendement.',
   NULL, ARRAY['Solidité','FID / FAS'], ARRAY['Ticket d''entrée élevé'],
   '{"ticket":"250 k€","fid":"250 k€","fas":"~500 k€","plancher_uc":"0,50 %"}'::jsonb),

  ('Wealins', 'lux', 'Groupe Foyer',
   '+10 Md€ d''actifs, clientèle exigeante et internationale.',
   NULL, ARRAY['Ticket accessible (125 k€)','Clientèle internationale'], ARRAY['Notoriété plus confidentielle'],
   '{"ticket":"125 k€","fid":"125–250 k€","plancher_uc":"0,50 %"}'::jsonb),

  ('Generali Luxembourg', 'lux', 'Generali',
   'Cohérence avec l''offre France (Espace Lux).',
   NULL, ARRAY['Continuité avec l''offre FR'], ARRAY['Ticket d''entrée élevé'],
   '{"ticket":"250 k€","fid":"250 k€","fas":"~1 M€","plancher_uc":"0,50 %"}'::jsonb),

  ('Apicil / OneLife', 'lux', 'Groupe Apicil',
   'Ticket le plus accessible du Luxembourg, plateforme digitale, distribué via Intencial.',
   NULL, ARRAY['Ticket le plus bas (50 k€)','Plateforme digitale'], ARRAY['Offre plus récente'],
   '{"ticket":"50 k€","fid":"125 k€","plancher_uc":"0,50 %"}'::jsonb),

  ('APICIL Luxembourg', 'lux', 'Groupe Apicil',
   'Compartiment luxembourgeois du groupe Apicil (OneLife).',
   NULL, ARRAY['Intégration plateforme Intencial'], ARRAY['Périmètre en construction'],
   '{"ticket":"50 k€","fid":"125 k€"}'::jsonb),

  ('Baloise Life', 'lux', 'Bâloise',
   'Accessible et bien référencé sur le canal CGP.',
   NULL, ARRAY['Ticket accessible (100 k€)'], ARRAY['Acteur de taille moyenne'],
   '{"ticket":"100 k€","fid":"125 k€","fas":"~250 k€"}'::jsonb),

  ('Suravenir Luxembourg', 'lux', 'Crédit Mutuel Arkéa',
   'Bras luxembourgeois de Suravenir.',
   NULL, ARRAY['Continuité avec Suravenir FR'], ARRAY['Offre Lux plus récente'],
   '{"ticket":"250 k€"}'::jsonb),

  ('AXA Wealth Europe', 'lux', 'AXA',
   'Complément luxembourgeois du groupe AXA.',
   NULL, ARRAY['Solidité de groupe'], ARRAY['Ticket d''entrée élevé'],
   '{"ticket":"250 k€","fid":"250 k€"}'::jsonb),

  ('Natixis Life Luxembourg', 'lux', 'BPCE / Natixis',
   'Acteur luxembourgeois complémentaire.',
   NULL, ARRAY['Adossement BPCE'], ARRAY['Ticket d''entrée élevé'],
   '{"ticket":"250 k€"}'::jsonb),

  ('Vitis Life', 'lux', 'Vitis Life',
   'Acteur luxembourgeois complémentaire.',
   NULL, ARRAY['Souplesse'], ARRAY['Notoriété confidentielle'],
   '{"ticket":"250 k€"}'::jsonb),

  ('Utmost Luxembourg S.A.', 'lux', 'Utmost (UK)',
   'Référence HNWI / family office (ex-Lombard International), présence dans 30+ pays et large choix de dépositaires.',
   NULL, ARRAY['Référence très haut de gamme','Multidevise / international'], ARRAY['Cible patrimoniale élevée'],
   '{"ticket":"250 k€","fid":"250 k€"}'::jsonb)
ON CONFLICT (company) DO UPDATE SET
  kind = EXCLUDED.kind, groupe = EXCLUDED.groupe, positionnement = EXCLUDED.positionnement,
  fonds_euros = EXCLUDED.fonds_euros, forces = EXCLUDED.forces, limites = EXCLUDED.limites,
  lux = EXCLUDED.lux, source = EXCLUDED.source, updated_at = now();

COMMIT;
