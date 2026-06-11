-- ============================================================================
-- Fix faux positifs éligibilité PEA — OPCVM hors-UE
-- ----------------------------------------------------------------------------
-- Suite de 20260611140000. Parmi les OPCVM hors-EEE marqués PEA, deux cas :
--   • ETF mal classés product_type='opcvm' (Amundi/iShares/Xtrackers … UCITS ETF
--     sur MSCI Korea/Brazil/World/USA) → faux positifs, même nature que la vague ETF.
--   • Fonds indiciels / multi-actifs hors-UE (Amundi Index MSCI USA, Ossiam US,
--     iShares Portfolio, Lyxor MultiUnits) → faux positifs.
--
-- À CONSERVER (non touchés par cette migration) :
--   • Les vrais fonds PEA labellisés « PEA » dans le nom (Sextant PEA, LBPAM
--     Actions PEA US, Yomoni Monde PEA…) : PEA-éligibles par construction
--     (exposition monde/US obtenue DANS l'enveloppe via dérivés/fonds éligibles).
--   • Les fonds UE mal classés sur region_normalized mais dont category_normalized
--     dit Europe/France (ex. SARENNE EQUITY SELECTION = « Actions Europe »).
--
-- Garde-fous : nom sans « pea », nom sans token d'indice/zone UE, et
-- category_normalized non Europe/France. Backup avant modification.
-- ============================================================================

CREATE TABLE IF NOT EXISTS investissement_funds_pea_opcvm_backup_20260611 AS
SELECT isin, name, region_normalized, region_exposure, category_normalized, pea_eligible
FROM   investissement_funds
WHERE  pea_eligible IS TRUE AND product_type = 'opcvm'
  AND  region_normalized IN ('world','usa','emerging','asia','china','india','brazil','japan','uk','switzerland');

ALTER TABLE investissement_funds_pea_opcvm_backup_20260611 ENABLE ROW LEVEL SECURITY;

UPDATE investissement_funds
SET    pea_eligible = FALSE
WHERE  pea_eligible IS TRUE AND product_type = 'opcvm'
  AND  region_normalized IN ('world','usa','emerging','asia','china','india','brazil','japan','uk','switzerland')
  AND  name NOT ILIKE '%pea%'
  AND  name !~* '(europe|euro stoxx|eurostoxx|\meuro\M|\memu\M|stoxx|\mmib\M|\mcac\M|\mdax\M|ibex|\maex\M|eurozone|zone euro|italy|italie|spain|espagne|netherlands|nordic|finland|finlande|sweden|suède|belgium|belgique|portugal|poland|pologne)'
  AND  coalesce(category_normalized,'') !~* '(europe|france|zone euro)';
