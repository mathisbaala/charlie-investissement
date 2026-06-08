import { describe, it, expect } from 'vitest'
import { SEARCH_COLUMNS, searchWords, searchOrClause } from '../lib/search'

describe('searchWords', () => {
  it('splits on whitespace', () => expect(searchWords('ETF France')).toEqual(['ETF', 'France']))
  it('drops empty tokens from extra spaces', () => expect(searchWords('  ETF   France ')).toEqual(['ETF', 'France']))
  it('strips PostgREST-breaking characters (%, _, commas, parens, brackets)', () =>
    expect(searchWords('a%b,(c)[d]_e')).toEqual(['abcde']))
  it('returns empty array for blank input', () => expect(searchWords('   ')).toEqual([]))
})

describe('searchOrClause', () => {
  // Régression « ETF France » : la recherche libre ne cherchait que dans name +
  // gestionnaire, donc « France » devait apparaître dans le nom du fonds → très
  // peu de résultats. Elle doit aussi couvrir la zone géographique normalisée
  // (region_normalized) et la catégorie / classe d'actif / secteur.
  it('searches the geographic zone, not only the name', () => {
    const clause = searchOrClause('france')
    expect(clause).toContain('region_normalized.ilike.%france%')
    expect(clause).toContain('category_normalized.ilike.%france%')
    expect(clause).toContain('asset_class.ilike.%france%')
    expect(clause).toContain('sector.ilike.%france%')
  })
  it('still searches name and gestionnaire', () => {
    const clause = searchOrClause('amundi')
    expect(clause).toContain('name.ilike.%amundi%')
    expect(clause).toContain('gestionnaire.ilike.%amundi%')
  })
  it('emits one ilike clause per configured column', () => {
    const parts = searchOrClause('x').split(',')
    expect(parts).toHaveLength(SEARCH_COLUMNS.length)
  })
})
