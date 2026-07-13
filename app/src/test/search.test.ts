import { describe, it, expect } from 'vitest'
import { asExactIsin, expandSearchAliases } from '../lib/search'

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

describe('expandSearchAliases', () => {
  // Régression « sp500 → 0 résultat » : le raccourci collé n'est sous-chaîne
  // d'aucun nom « S&P 500 » (cassé par le « & »). On le réécrit vers la forme
  // canonique cherchable avant la RPC. Les autres orthographes marchaient déjà.
  it('rewrites the glued sp500 shorthand to a searchable form', () =>
    expect(expandSearchAliases('sp500')).toBe('s&p 500'))
  it('is case-insensitive on the alias token', () =>
    expect(expandSearchAliases('SP500')).toBe('s&p 500'))
  it('expands other common glued index shorthands', () => {
    expect(expandSearchAliases('nasdaq100')).toBe('nasdaq 100')
    expect(expandSearchAliases('cac40')).toBe('cac 40')
    expect(expandSearchAliases('eurostoxx50')).toBe('euro stoxx 50')
  })
  // L'alias ne s'applique qu'au JETON reconnu ; le reste de la requête est intact.
  it('expands only the matched token, leaving the rest untouched', () =>
    expect(expandSearchAliases('ETF sp500')).toBe('ETF s&p 500'))
  // Les jetons inconnus (noms, tickers, gestionnaires) passent inchangés — pas de
  // risque d'écraser une recherche par ticker réel (CW8, DCAM) ou par nom.
  it('leaves unknown tokens (names, tickers) unchanged', () => {
    expect(expandSearchAliases('CW8')).toBe('CW8')
    expect(expandSearchAliases('carmignac patrimoine')).toBe('carmignac patrimoine')
  })
  // Les orthographes déjà fonctionnelles ne doivent PAS être cassées.
  it('does not alter already-working spellings', () => {
    expect(expandSearchAliases('s&p 500')).toBe('s&p 500')
    expect(expandSearchAliases('sp 500')).toBe('sp 500')
  })
  it('returns empty string for blank input', () =>
    expect(expandSearchAliases('   ')).toBe(''))
})
