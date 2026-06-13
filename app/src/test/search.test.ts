import { describe, it, expect } from 'vitest'
import { SEARCH_COLUMNS, searchWords, searchOrClause, asExactIsin } from '../lib/search'

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
  // Régression « la recherche par ISIN ne fonctionne jamais » : une saisie
  // partielle d'ISIN doit pouvoir matcher la colonne isin (le cas exact, lui,
  // passe par asExactIsin / le raccourci API).
  it('searches the isin column too', () => {
    expect(searchOrClause('FR0010')).toContain('isin.ilike.%FR0010%')
  })
})

describe('asExactIsin', () => {
  // Régression : un ISIN complet doit être reconnu pour router vers la recherche
  // exacte (avant ce correctif, l'ISIN n'était cherché nulle part).
  it('recognises a well-formed ISIN', () =>
    expect(asExactIsin('FR0010315770')).toBe('FR0010315770'))
  it('normalises case and surrounding whitespace', () =>
    expect(asExactIsin('  lu0496786574 ')).toBe('LU0496786574'))
  it('rejects strings that are too short', () =>
    expect(asExactIsin('FR001031577')).toBeNull())
  it('rejects strings that are too long', () =>
    expect(asExactIsin('FR00103157700')).toBeNull())
  it('rejects a missing country prefix (must start with two letters)', () =>
    expect(asExactIsin('1R0010315770')).toBeNull())
  it('rejects a non-digit check character', () =>
    expect(asExactIsin('FR001031577X')).toBeNull())
  it('rejects ordinary text queries', () =>
    expect(asExactIsin('ETF France')).toBeNull())
})
