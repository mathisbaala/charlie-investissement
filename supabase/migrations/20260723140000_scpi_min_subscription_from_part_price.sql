-- Minimum à investir des SCPI / OPCI = prix d'UNE part ────────────────────────
-- Retour CGP : élargir le « minimum à investir par fonds » aux SCPI/SCI. Pour une
-- SCPI (ou un OPCI), le minimum de souscription est le prix d'une part : on ne
-- peut pas investir moins d'une part. Ce prix est déjà collecté dans
-- investissement_scpi_metrics.price_per_share (france-scpi.fr, ~265 fonds) et
-- affiché en « Prix de part » sur la fiche ; on le recopie dans le champ
-- fund-level min_subscription_eur (colonne « Minimum d'investissement », jusqu'ici
-- vide) pour répondre explicitement à « combien minimum pour entrer ».
--
-- Fill-only : ne touche que les lignes SANS minimum déjà renseigné (une valeur
-- curée à N parts, si on l'ajoute un jour, ne sera pas écrasée). Le scraper
-- scpi-full-scraper.py entretient ce champ pour les nouveaux fonds.
--
-- ⚠ SCI/SC (product_type='opcvm' + asset_class_broad='immobilier', ~640 fonds) :
-- AUCUN prix de part n'est disponible en base pour eux → non couverts ici. Il
-- faudra une source de VL/part (DIC, site SGP) pour leur minimum — chantier séparé.

UPDATE investissement_funds f
SET    min_subscription_eur = m.price_per_share,
       updated_at           = now()
FROM   investissement_scpi_metrics m
WHERE  m.isin = f.isin
  AND  m.price_per_share IS NOT NULL
  AND  m.price_per_share > 0
  AND  f.product_type IN ('scpi', 'opci')
  AND  f.min_subscription_eur IS NULL;
