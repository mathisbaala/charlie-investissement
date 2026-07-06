import { describe, it, expect } from 'vitest'
import { SEARCH_COLUMNS, searchWords, searchOrClause, asExactIsin, asTickerToken, tickerWordPattern, expandSearchAliases } from '../lib/search'

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
  // Régression « les tickers d'ETF ne sont pas reconnus » (retour utilisateur :
  // « DCAM » pour l'Amundi PEA Monde) : la recherche doit couvrir la colonne
  // tickers_search (codes de cotation concaténés, cf. migration 20260616130000).
  it('searches the ETF tickers column', () => {
    expect(searchOrClause('DCAM')).toContain('tickers_search.ilike.%DCAM%')
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

describe('asTickerToken', () => {
  // Pertinence : un mot unique court (ticker) déclenche la priorité au match exact.
  it('recognises a single ticker-like token', () => {
    expect(asTickerToken('DCAM')).toBe('DCAM')
    expect(asTickerToken('CW8')).toBe('CW8')
    expect(asTickerToken('  vwce ')).toBe('vwce')
  })
  it('rejects multi-word queries (relevance only for a lone ticker)', () =>
    expect(asTickerToken('ETF CW8')).toBeNull())
  it('rejects tokens too long to be a ticker', () =>
    expect(asTickerToken('Carmignac')).toBeNull())
  it('rejects a single character', () =>
    expect(asTickerToken('A')).toBeNull())
  it('returns null on blank input', () =>
    expect(asTickerToken('   ')).toBeNull())
})

describe('tickerWordPattern', () => {
  // Match en MOT ENTIER : « CSPX » ne doit pas matcher le token « CSPXJ ».
  it('wraps the token in POSIX word boundaries', () =>
    expect(tickerWordPattern('CSPX')).toBe('\\yCSPX\\y'))
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
