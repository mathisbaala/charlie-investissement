-- Attributs PER / retraite des contrats (av_contract_terms) — pertinents CGP FR.
-- Additifs, nullables, non-breaking. Remplis par RÈGLE statutaire (loi PACTE pour les
-- PER ; régimes Madelin / Article 82-83 / PERP pour l'ancien) — aucun scraping, aucune
-- devinette : les schémas non déterminables restent NULL.
--
-- Ces colonnes remontent automatiquement au front via get_contract_overview (to_jsonb(t)).
--
-- envelope_type : bucket d'enveloppe, MIROIR EXACT de la regex de
--   investissement_contract_groups_mv.contract_type (aucune dérive avec l'app).
-- retraite_scheme : sous-type fin, uniquement pour envelope_type = 'per'.
-- sortie_modes / deblocage_anticipe_cases / versements_deductibles / transferable :
--   valeurs statutaires par schéma (indicatives, sous réserve des conditions du contrat).

alter table investissement_av_contract_terms
  add column if not exists envelope_type text,               -- per / av / capi / pea / pep
  add column if not exists retraite_scheme text,             -- perin / pereco / pero / madelin / perp / art82 / art83 / ancien
  add column if not exists sortie_modes text[],              -- capital / rente_viagere / capital_fractionne
  add column if not exists deblocage_anticipe_cases text[],  -- cas de déblocage anticipé statutaires
  add column if not exists versements_deductibles boolean,   -- versements déductibles du revenu imposable
  add column if not exists transferable boolean;             -- transférable (loi PACTE / vers PER)

comment on column investissement_av_contract_terms.envelope_type is
  'Bucket enveloppe, miroir exact de contract_groups_mv.contract_type (regex sur le nom).';
comment on column investissement_av_contract_terms.retraite_scheme is
  'Sous-type retraite (envelope_type=per) : perin/pereco/pero (PACTE), madelin/perp/art82/art83 (ancien), ancien=indéterminé.';
comment on column investissement_av_contract_terms.versements_deductibles is
  'Déductibilité disponible des versements (art. 163 quatervicies CGI pour PER, régimes Madelin/83 pour l''ancien). Indicatif.';

-- ── envelope_type : miroir EXACT de la MV (fill-only) ───────────────────────
update investissement_av_contract_terms set envelope_type = case
    when contract ~* 'plan d.epargne en actions|\mpea\M'          then 'pea'
    when contract ~* 'retraite|\mper\M|perin|\mpero\M|perp|madelin' then 'per'
    when contract ~* '\mpep\M|plan d.epargne populaire'           then 'pep'
    when contract ~* 'capitalisation|\mcapi'                      then 'capi'
    else 'av'
  end
where envelope_type is null;

-- ── retraite_scheme : sous-type fin (seulement les PER) ─────────────────────
update investissement_av_contract_terms set retraite_scheme = case
    when contract ~* 'madelin'                                    then 'madelin'
    when contract ~* 'art[. ]*82'                                 then 'art82'
    when contract ~* 'art[. ]*83|article 8'                       then 'art83'
    when contract ~* '\mperp\M'                                   then 'perp'
    when contract ~* '\mpereco\M|percol'                          then 'pereco'
    when contract ~* '\mpero\M|obligatoire'                       then 'pero'
    when contract ~* '\mper\M|perin|plan.{0,4}epargne.{0,4}retraite' then 'perin'
    else 'ancien'   -- « Retraite » générique sans marqueur de schéma → indéterminé
  end
where envelope_type = 'per' and retraite_scheme is null;

-- ── sortie_modes (statutaire par schéma) ────────────────────────────────────
update investissement_av_contract_terms
  set sortie_modes = array['capital','rente_viagere','capital_fractionne']
  where retraite_scheme in ('perin','pereco') and sortie_modes is null;
update investissement_av_contract_terms
  set sortie_modes = array['rente_viagere']
  where retraite_scheme in ('pero','madelin','perp','art83') and sortie_modes is null;
update investissement_av_contract_terms
  set sortie_modes = array['capital','rente_viagere']
  where retraite_scheme = 'art82' and sortie_modes is null;
-- retraite_scheme = 'ancien' : laissé NULL (non déterminable).

-- ── deblocage_anticipe_cases (statutaire) ───────────────────────────────────
-- PER individuel & collectif : 5 accidents de la vie + acquisition résidence principale.
update investissement_av_contract_terms
  set deblocage_anticipe_cases = array[
    'deces_conjoint_partenaire','invalidite','surendettement',
    'expiration_droits_chomage','cessation_non_salarie_liquidation_judiciaire',
    'acquisition_residence_principale']
  where retraite_scheme in ('perin','pereco') and deblocage_anticipe_cases is null;
-- PER obligatoire (compartiment 3) + Madelin/PERP/Art82-83 : les 5 accidents de la vie,
-- sans l'acquisition de la résidence principale.
update investissement_av_contract_terms
  set deblocage_anticipe_cases = array[
    'deces_conjoint_partenaire','invalidite','surendettement',
    'expiration_droits_chomage','cessation_non_salarie_liquidation_judiciaire']
  where retraite_scheme in ('pero','madelin','perp','art82','art83')
    and deblocage_anticipe_cases is null;

-- ── versements_deductibles / transferable (statutaire) ──────────────────────
update investissement_av_contract_terms set versements_deductibles = true
  where retraite_scheme in ('perin','pereco','pero','madelin','perp','art82','art83')
    and versements_deductibles is null;
update investissement_av_contract_terms set transferable = true
  where retraite_scheme in ('perin','pereco','pero','madelin','perp','art82','art83')
    and transferable is null;

-- ── Raffinage : contrats « Retraite » génériques nommés « individuel(le) » ──
-- Depuis la loi PACTE (oct. 2020) plus aucun Madelin/PERP/Art.83 ne peut être
-- souscrit ; un contrat « Retraite individuelle » est donc un PER individuel.
-- Choix VOLONTAIREMENT prudent (marqueur « individuel » explicite requis) : les
-- autres « Retraite » ambigus restent en 'ancien' (attributs statutaires NULL,
-- on ne devine pas). Fill-only, réversible.
update investissement_av_contract_terms set retraite_scheme = 'perin'
  where envelope_type = 'per' and retraite_scheme = 'ancien' and contract ~* 'individuel';

update investissement_av_contract_terms
  set sortie_modes = array['capital','rente_viagere','capital_fractionne']
  where retraite_scheme in ('perin','pereco') and sortie_modes is null;
update investissement_av_contract_terms
  set deblocage_anticipe_cases = array[
    'deces_conjoint_partenaire','invalidite','surendettement',
    'expiration_droits_chomage','cessation_non_salarie_liquidation_judiciaire',
    'acquisition_residence_principale']
  where retraite_scheme in ('perin','pereco') and deblocage_anticipe_cases is null;
update investissement_av_contract_terms set versements_deductibles = true
  where retraite_scheme in ('perin','pereco') and versements_deductibles is null;
update investissement_av_contract_terms set transferable = true
  where retraite_scheme in ('perin','pereco') and transferable is null;
