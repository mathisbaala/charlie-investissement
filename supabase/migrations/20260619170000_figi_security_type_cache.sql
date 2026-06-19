-- Cache du type de titre OpenFIGI par ISIN (garde de classification)
-- ============================================================================
-- openfigi-classify détecte les titres vifs (actions/REIT) mal classés 'opcvm'
-- et les reclasse en 'action'. Ce cache évite de ré-interroger OpenFIGI chaque
-- mois les fonds déjà confirmés (securityType2 = 'Mutual Fund'…). NULL = ISIN
-- inconnu d'OpenFIGI.
CREATE TABLE IF NOT EXISTS investissement_figi_security_type (
  isin            text PRIMARY KEY,
  security_type2  text,
  checked_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE investissement_figi_security_type IS
  'Cache securityType2 OpenFIGI par ISIN (openfigi-classify). Évite de re-checker les fonds confirmés.';
