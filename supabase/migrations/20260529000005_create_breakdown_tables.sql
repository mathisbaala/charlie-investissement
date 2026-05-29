-- ─── Tables de décomposition fonds ───────────────────────────────────────────
-- Ces tables alimentent les sections "Composition", "Allocation sectorielle"
-- et "Allocation géographique" de la fiche fonds.
-- Sources cibles : Morningstar portfolio API, Quantalys, parsed KIDs.

-- ── Holdings (top positions) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investissement_fund_holdings (
  isin           text        NOT NULL REFERENCES investissement_funds(isin) ON DELETE CASCADE,
  rank           smallint    NOT NULL,               -- rang (1 = plus grosse position)
  position_name  text        NOT NULL,               -- nom de l'actif
  ticker         text,                               -- ticker ou ISIN de l'actif
  asset_type     text,                               -- action, obligation, cash, etc.
  sector         text,                               -- secteur (GICS ou Morningstar)
  country        text,                               -- code ISO2 du pays
  weight         numeric(6,4) NOT NULL,              -- poids en fraction (0.0523 = 5.23 %)
  source         text,                               -- morningstar | quantalys | kid
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (isin, rank)
);

CREATE INDEX IF NOT EXISTS idx_holdings_isin ON investissement_fund_holdings (isin);

-- ── Allocation sectorielle ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investissement_fund_sectors (
  isin         text        NOT NULL REFERENCES investissement_funds(isin) ON DELETE CASCADE,
  sector_name  text        NOT NULL,
  weight       numeric(6,4) NOT NULL,
  source       text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (isin, sector_name)
);

CREATE INDEX IF NOT EXISTS idx_sectors_isin ON investissement_fund_sectors (isin);

-- ── Allocation géographique ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investissement_fund_geos (
  isin           text        NOT NULL REFERENCES investissement_funds(isin) ON DELETE CASCADE,
  country_code   text        NOT NULL,   -- ISO2 (FR, US, DE…) ou région (Emerging Markets)
  country_label  text,
  weight         numeric(6,4) NOT NULL,
  source         text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (isin, country_code)
);

CREATE INDEX IF NOT EXISTS idx_geos_isin ON investissement_fund_geos (isin);

-- ── Activer RLS (lecture publique pour le frontend) ─────────────────────────
ALTER TABLE investissement_fund_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE investissement_fund_sectors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE investissement_fund_geos     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read holdings" ON investissement_fund_holdings
  FOR SELECT USING (true);
CREATE POLICY "public read sectors" ON investissement_fund_sectors
  FOR SELECT USING (true);
CREATE POLICY "public read geos" ON investissement_fund_geos
  FOR SELECT USING (true);
