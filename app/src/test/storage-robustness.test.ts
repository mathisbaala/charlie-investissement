import { describe, it, expect, beforeEach } from 'vitest'
import { getRecentSearches, addSearch, clearSearches } from '../lib/searches'

// Régression : un localStorage corrompu (JSON valide mais pas un tableau, ex.
// `{}`) faisait renvoyer cette valeur, et le .filter()/.slice() en aval
// plantait le rendu (accueil). Les getters doivent toujours renvoyer
// un tableau, quoi qu'il y ait en storage.
// Trouvé par /qa le 2026-06-05.

describe('getRecentSearches — robustesse localStorage', () => {
  beforeEach(() => localStorage.clear())

  it('renvoie [] quand le storage est vide', () => {
    expect(getRecentSearches()).toEqual([])
  })

  it('renvoie [] sur du JSON invalide', () => {
    localStorage.setItem('charlie_searches', '{ pas du json')
    expect(getRecentSearches()).toEqual([])
  })

  it('renvoie [] quand le storage contient un objet au lieu d\'un tableau', () => {
    localStorage.setItem('charlie_searches', '{"query":"x"}')
    expect(Array.isArray(getRecentSearches())).toBe(true)
    expect(getRecentSearches()).toEqual([])
  })

  it('renvoie [] quand le storage contient null', () => {
    localStorage.setItem('charlie_searches', 'null')
    expect(getRecentSearches()).toEqual([])
  })

  it('filtre les entrées malformées et garde les valides', () => {
    localStorage.setItem(
      'charlie_searches',
      JSON.stringify([{ query: 'ETF monde' }, null, { count: 3 }, 'bad']),
    )
    const out = getRecentSearches()
    expect(out).toHaveLength(1)
    expect(out[0].query).toBe('ETF monde')
  })

  it('addSearch ne plante pas même si le storage est corrompu', () => {
    localStorage.setItem('charlie_searches', '{"corrompu":true}')
    expect(() => addSearch({ query: 'test', chips: [], count: 0 })).not.toThrow()
    expect(getRecentSearches()[0].query).toBe('test')
    clearSearches()
  })
})
