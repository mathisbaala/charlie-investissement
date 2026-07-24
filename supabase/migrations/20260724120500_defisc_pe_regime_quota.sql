-- Approfondissement défiscalisation « private equity » (FIP/FCPI/FCPR/FPCI).
-- Additifs, nullables, non-breaking. Complète les colonnes existantes
-- (tax_scheme / tax_reduction_rate / tax_lock_up_years / vintage_year) par le
-- RÉGIME fiscal et le QUOTA d'investissement statutaire. Fill-only, aucune devinette.
--
-- tax_regime_detail :
--   ir_pme                      → réduction d'IR à la souscription (FIP/FCPI)
--   exoneration_pv              → pas de réduction IR ; exo d'IR sur les plus-values (FCPR)
--   apport_cession_150_0_b_ter  → support de remploi apport-cession + exo PV (FPCI)

alter table investissement_funds
  add column if not exists tax_regime_detail text,
  add column if not exists investment_quota_note text;

comment on column investissement_funds.tax_regime_detail is
  'Nature de l''avantage fiscal : ir_pme (réduction IR) / exoneration_pv / apport_cession_150_0_b_ter. Statutaire, indicatif.';
comment on column investissement_funds.investment_quota_note is
  'Quota d''investissement statutaire du fonds (indicatif, sous réserve du règlement du fonds et de la loi de finances).';

update investissement_funds set tax_regime_detail = 'ir_pme'
  where tax_scheme in ('fip','fip_corse','fip_outremer','fcpi') and tax_regime_detail is null;
update investissement_funds set tax_regime_detail = 'exoneration_pv'
  where tax_scheme = 'fcpr' and tax_regime_detail is null;
update investissement_funds set tax_regime_detail = 'apport_cession_150_0_b_ter'
  where tax_scheme = 'fpci' and tax_regime_detail is null;

update investissement_funds set investment_quota_note =
    '≥ 70 % en titres de PME régionales de moins de 8 ans (non cotées ou cotées sur un marché organisé).'
  where tax_scheme in ('fip','fip_corse','fip_outremer') and investment_quota_note is null;
update investissement_funds set investment_quota_note =
    '≥ 70 % en titres de PME innovantes.'
  where tax_scheme = 'fcpi' and investment_quota_note is null;
update investissement_funds set investment_quota_note =
    '≥ 50 % en titres de sociétés non cotées (quota fiscal FCPR).'
  where tax_scheme = 'fcpr' and investment_quota_note is null;
update investissement_funds set investment_quota_note =
    '≥ 50 % en titres non cotés ; éligible au remploi apport-cession (150-0 B ter), exonération d''IR sur les plus-values sous conditions (détention ≥ 5 ans).'
  where tax_scheme = 'fpci' and investment_quota_note is null;
