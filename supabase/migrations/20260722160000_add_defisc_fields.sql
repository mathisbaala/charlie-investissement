-- Attributs de défiscalisation (FIP/FCPI/FCPR) — pertinents CGP français.
-- Additifs, nullables, non-breaking. Remplis par scripts/enrichers/defisc-enricher.py
-- (règle statutaire : FIP/FCPI 18 %, FIP Corse/Outre-mer 30 %, FCPR 0 % / expo plus-values).
alter table investissement_funds
  add column if not exists tax_scheme text,            -- fip / fip_corse / fip_outremer / fcpi / fcpr
  add column if not exists tax_reduction_rate numeric, -- taux réduction IR à la souscription (fraction)
  add column if not exists tax_lock_up_years smallint, -- durée de blocage min pour conserver l'avantage
  add column if not exists vintage_year smallint;      -- millésime (année de collecte ≈ inception)

comment on column investissement_funds.tax_reduction_rate is
  'Taux statutaire de réduction IR à la souscription (indicatif, sous réserve loi de finances). FIP/FCPI 18%, FIP Corse/Outre-mer 30%.';
