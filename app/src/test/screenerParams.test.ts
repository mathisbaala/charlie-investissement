import { describe, it, expect } from 'vitest'
import { buildParams } from '../app/(app)/recherche/page'
import { filtersFromParams, describeScreenerFilters, sortFromIntent, relaxationOrder, relaxLabel, RELAXABLE_ORDER } from '../lib/screenerParams'
import type { ParsedFilters } from '../lib/types'

// Régression : la recherche par classe d'actif. Avant le correctif, le parser NLP
// et l'UI ne transmettaient AUCUN filtre asset_class à /api/funds — « fonds
// obligataire » remontait ~59 % de non-obligataire (diversifié, monétaire,
// actions). buildParams doit sérialiser asset_class pour que l'API filtre sur
// asset_class_broad. Ce filtre est distinct de « universe » (type de produit).
describe('buildParams — filtre classe d\'actif', () => {
  it('sérialise asset_class en paramètre séparé', () => {
    const f: ParsedFilters = { asset_class: ['obligation'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('asset_class')).toBe('obligation')
  })

  it('joint plusieurs classes d\'actif par des virgules', () => {
    const f: ParsedFilters = { asset_class: ['action', 'diversifie'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('asset_class')).toBe('action,diversifie')
  })

  it('n\'émet pas asset_class quand il est absent', () => {
    const sp = buildParams({}, 1, 'data_completeness', 'desc')
    expect(sp.has('asset_class')).toBe(false)
  })

  it('garde asset_class et universe distincts (un OPCVM peut être obligataire)', () => {
    const f: ParsedFilters = { universe: ['opcvm'], asset_class: ['obligation'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('universe')).toBe('opcvm')
    expect(sp.get('asset_class')).toBe('obligation')
  })
})

// Profil d'allocation : sous-filtre des diversifiés (prudent/équilibré/dynamique/
// flexible), demandé par un gérant qui cherchait « la classification Flexible ».
// buildParams doit le sérialiser pour que l'API filtre sur la colonne allocation_profile.
describe('buildParams — filtre profil d\'allocation', () => {
  it('sérialise allocation_profile en paramètre séparé', () => {
    const f: ParsedFilters = { allocation_profile: ['flexible'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('allocation_profile')).toBe('flexible')
  })

  it('joint plusieurs profils par une virgule', () => {
    const f: ParsedFilters = { allocation_profile: ['prudent', 'flexible'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('allocation_profile')).toBe('prudent,flexible')
  })

  it('n\'émet pas allocation_profile quand il est absent', () => {
    const sp = buildParams({}, 1, 'data_completeness', 'desc')
    expect(sp.has('allocation_profile')).toBe(false)
  })
})

describe('buildParams — filtre assureur (référencement)', () => {
  it('sérialise insurers vers le paramètre "insurer"', () => {
    const f: ParsedFilters = { insurers: ['AXA France'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('insurer')).toBe('AXA France')
  })

  it('joint plusieurs assureurs par des virgules', () => {
    const f: ParsedFilters = { insurers: ['AXA France', 'Suravenir'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('insurer')).toBe('AXA France,Suravenir')
  })

  it('n\'émet pas "insurer" quand il est absent', () => {
    const sp = buildParams({}, 1, 'data_completeness', 'desc')
    expect(sp.has('insurer')).toBe(false)
  })
})

describe('buildParams — filtre par contrat', () => {
  it('sérialise contracts (clé composite Assureur::Contrat) vers "contracts"', () => {
    const f: ParsedFilters = { contracts: ['Suravenir::Linxea Spirit 2'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('contracts')).toBe('Suravenir::Linxea Spirit 2')
  })

  it('joint plusieurs contrats par des virgules', () => {
    const f: ParsedFilters = { contracts: ['Suravenir::Linxea Spirit 2', 'AXA France::Coralis Sélection'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('contracts')).toBe('Suravenir::Linxea Spirit 2,AXA France::Coralis Sélection')
  })

  it('n\'émet pas "contracts" quand il est absent', () => {
    const sp = buildParams({}, 1, 'data_completeness', 'desc')
    expect(sp.has('contracts')).toBe(false)
  })
})

// Régression feedback #2 : « fonds action monde peu exposé tech/us ». La négation
// doit produire des EXCLUSIONS (jamais un filtre positif sector/region inversé).
describe('buildParams — exclusions (négation NL)', () => {
  it('sérialise exclude_sectors vers "exclude_sector"', () => {
    const f: ParsedFilters = { exclude_sectors: ['Technologie'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('exclude_sector')).toBe('Technologie')
    // Ne doit PAS produire un filtre secteur positif.
    expect(sp.has('sector')).toBe(false)
  })

  it('sérialise exclude_regions vers "exclude_region"', () => {
    const f: ParsedFilters = { exclude_regions: ['usa'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('exclude_region')).toBe('usa')
    expect(sp.has('region')).toBe(false)
  })

  it('combine region positive (world) et exclusions (tech/us)', () => {
    const f: ParsedFilters = {
      asset_class: ['action'], region: ['world'],
      exclude_sectors: ['Technologie'], exclude_regions: ['usa'],
    }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('region')).toBe('world')
    expect(sp.get('exclude_sector')).toBe('Technologie')
    expect(sp.get('exclude_region')).toBe('usa')
  })

  it('n\'émet pas les exclusions quand elles sont absentes', () => {
    const sp = buildParams({}, 1, 'data_completeness', 'desc')
    expect(sp.has('exclude_sector')).toBe(false)
    expect(sp.has('exclude_region')).toBe(false)
  })
})

describe('buildParams — filtre société de gestion', () => {
  it('sérialise gestionnaires vers "gestionnaire_in"', () => {
    const f: ParsedFilters = { gestionnaires: ['Amundi'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('gestionnaire_in')).toBe('Amundi')
  })

  it('joint plusieurs sociétés de gestion par des virgules', () => {
    const f: ParsedFilters = { gestionnaires: ['Amundi', 'BlackRock'] }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('gestionnaire_in')).toBe('Amundi,BlackRock')
  })
})

// filtersFromParams est l'inverse de buildParams : il hydrate le screener à
// l'arrivée depuis la page Profil client / un lien partagé. Round-trip garanti.
describe('filtersFromParams — inverse de buildParams', () => {
  it('reconstruit un jeu de filtres complet (round-trip)', () => {
    const f: ParsedFilters = {
      sfdr: [8, 9], sri_max: 5, ter_max: 1.5, drawdown_max: 20,
      no_entry_fee: true, has_kid: true, envelopes: ['PEA', 'PER'],
      asset_class: ['action'], insurers: ['AXA France'],
      contracts: ['Suravenir::Linxea Spirit 2'], gestionnaires: ['Amundi'],
      region: ['world'], exclude_sectors: ['Technologie'], manager_search: 'Carmignac',
      free_text: 'msci world',
    }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(filtersFromParams(sp)).toEqual(f)
  })

  it('ignore les paramètres de tri / pagination (objet vide sans filtre)', () => {
    const sp = buildParams({}, 3, 'performance_3y', 'asc')
    expect(filtersFromParams(sp)).toEqual({})
  })

  it('relie le profil client au screener via le round-trip', () => {
    // profileToScreenerFilters → buildParams → filtersFromParams = filtres d'origine.
    const f: ParsedFilters = { sri_max: 3, sfdr: [9], envelopes: ['PEA-PME'] }
    expect(filtersFromParams(buildParams(f, 1, 'data_completeness', 'desc'))).toEqual(f)
  })
})

// describeScreenerFilters : libellés lisibles du bandeau « Profil client » (page
// profil + bandeau de contexte du screener). Source unique de vérité.
describe('describeScreenerFilters', () => {
  it('libelle chaque clé de filtre issue du profil', () => {
    const out = describeScreenerFilters({
      sri_max: 5, sfdr: [8, 9], drawdown_max: 20,
      envelopes: ['PEA', 'PER'], asset_class: ['action'],
    })
    expect(out).toEqual(['SRI ≤ 5', 'SFDR Art. 8 / 9', 'Perte ≤ 20 %', 'PEA', 'PER', 'Actions'])
  })

  it('renvoie une liste vide sans filtre', () => {
    expect(describeScreenerFilters({})).toEqual([])
  })

  it('libelle un plancher SRI et les enveloppes AV', () => {
    expect(describeScreenerFilters({ sri_min: 2, envelopes: ['AV-FR', 'AV-LUX'] }))
      .toEqual(['SRI ≥ 2', 'AV France', 'AV Luxembourg'])
  })

  it('libelle les frais, le sans-frais-d\'entrée et le style de gestion', () => {
    const out = describeScreenerFilters({
      ter_max: 1, no_entry_fee: true, management_style: ['passif'],
    })
    expect(out).toEqual(['Frais ≤ 1 %', "Sans frais d'entrée", 'Gestion indicielle'])
  })
})

// sortFromIntent : intention de tri (NLP) → couple (sort_by, sort_dir) sûr.
describe('sortFromIntent', () => {
  it('retourne null sans intention', () => {
    expect(sortFromIntent({})).toBeNull()
    expect(sortFromIntent({ sort_intent: undefined })).toBeNull()
  })

  it('mappe une intention valide', () => {
    expect(sortFromIntent({ sort_intent: { field: 'ter', dir: 'asc' } }))
      .toEqual({ sort_by: 'ter', sort_dir: 'asc' })
    expect(sortFromIntent({ sort_intent: { field: 'aum_eur', dir: 'desc' } }))
      .toEqual({ sort_by: 'aum_eur', sort_dir: 'desc' })
  })

  it('rejette une colonne non triable', () => {
    expect(sortFromIntent({ sort_intent: { field: 'risk_score', dir: 'asc' } })).toBeNull()
    expect(sortFromIntent({ sort_intent: { field: 'bidon', dir: 'asc' } })).toBeNull()
  })

  it('retombe sur desc pour une direction non « asc »', () => {
    // @ts-expect-error — direction invalide testée volontairement
    expect(sortFromIntent({ sort_intent: { field: 'ter', dir: 'x' } }))
      .toEqual({ sort_by: 'ter', sort_dir: 'desc' })
  })
})

// relaxationOrder : filtres relâchables PRÉSENTS, dans l'ordre de drop.
describe('relaxationOrder', () => {
  it('ne retourne que les filtres présents, dans l\'ordre canonique', () => {
    expect(relaxationOrder({ ter_max: true, aum_min: true })).toEqual(['aum_min', 'ter_max'])
    expect(relaxationOrder({})).toEqual([])
    const order = relaxationOrder({ ter_max: true, retrocession_min: true, aum_min: true })
    expect(order).toEqual(['retrocession_min', 'aum_min', 'ter_max'])
  })

  it('ignore les clés non relâchables (structurantes)', () => {
    expect(relaxationOrder({ sri_max: true, universe: true } as Record<string, boolean>)).toEqual([])
  })

  it('RELAXABLE_ORDER n\'inclut aucun filtre structurant', () => {
    for (const k of ['universe', 'asset_class', 'envelopes', 'region', 'sector', 'sri_max', 'sfdr']) {
      expect(RELAXABLE_ORDER as readonly string[]).not.toContain(k)
    }
  })
})

describe('relaxLabel', () => {
  it('donne un libellé lisible, identité en repli', () => {
    expect(relaxLabel('ter_max')).toBe('Frais')
    expect(relaxLabel('inconnu')).toBe('inconnu')
  })
})

// Fonds obligataires datés (à échéance) : découvrabilité du sous-univers daté.
// Avant le correctif, aucune notion d'échéance n'existait — « obligataire daté 2028 »
// retombait sur ~4 260 fonds obligataires indifférenciés. buildParams/filtersFromParams
// doivent porter target_maturity + les bornes de millésime en round-trip.
describe('params — fonds à échéance (obligataire daté)', () => {
  it('sérialise target_maturity et les bornes de millésime', () => {
    const f: ParsedFilters = { target_maturity: true, maturity_year_min: 2027, maturity_year_max: 2030 }
    const sp = buildParams(f, 1, 'data_completeness', 'desc')
    expect(sp.get('target_maturity')).toBe('true')
    expect(sp.get('maturity_year_min')).toBe('2027')
    expect(sp.get('maturity_year_max')).toBe('2030')
  })

  it('n\'émet rien quand le filtre échéance est absent', () => {
    const sp = buildParams({}, 1, 'data_completeness', 'desc')
    expect(sp.has('target_maturity')).toBe(false)
    expect(sp.has('maturity_year_min')).toBe(false)
    expect(sp.has('maturity_year_max')).toBe(false)
  })

  it('round-trip URL → filtres', () => {
    const sp = buildParams({ target_maturity: true, maturity_year_min: 2028 }, 1, 'data_completeness', 'desc')
    const f = filtersFromParams(sp)
    expect(f.target_maturity).toBe(true)
    expect(f.maturity_year_min).toBe(2028)
    expect(f.maturity_year_max).toBeUndefined()
  })

  it('décrit le filtre pour le bandeau de contexte', () => {
    expect(describeScreenerFilters({ target_maturity: true, maturity_year_min: 2027, maturity_year_max: 2030 }))
      .toContain('Échéance 2027–2030')
    expect(describeScreenerFilters({ target_maturity: true })).toContain('Fonds à échéance')
    expect(describeScreenerFilters({ maturity_year_max: 2029 })).toContain('Échéance ≤ 2029')
  })
})
