import { describe, it, expect } from 'vitest'
import { buildParams } from '../app/(app)/recherche/page'
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
