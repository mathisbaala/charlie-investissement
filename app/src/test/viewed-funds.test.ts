import { describe, it, expect, beforeEach } from 'vitest'
import { getViewedFunds, addViewedFund } from '../lib/viewedFunds'

// « Reprise d'activité » de l'accueil : derniers fonds consultés en localStorage.
// Mêmes garde-fous que getRecentSearches (un storage corrompu ne doit jamais
// planter l'accueil) + dédup par ISIN et plafond d'historique.

describe('viewedFunds — robustesse localStorage', () => {
  beforeEach(() => localStorage.clear())

  it('renvoie [] quand le storage est vide', () => {
    expect(getViewedFunds()).toEqual([])
  })

  it('renvoie [] sur du JSON invalide', () => {
    localStorage.setItem('charlie_viewed_funds', '{ pas du json')
    expect(getViewedFunds()).toEqual([])
  })

  it('renvoie [] quand le storage contient un objet au lieu d\'un tableau', () => {
    localStorage.setItem('charlie_viewed_funds', '{"isin":"x"}')
    expect(Array.isArray(getViewedFunds())).toBe(true)
    expect(getViewedFunds()).toEqual([])
  })

  it('filtre les entrées malformées (isin/name manquants) et garde les valides', () => {
    localStorage.setItem(
      'charlie_viewed_funds',
      JSON.stringify([
        { isin: 'FR0010315770', name: 'Comgest Monde C' },
        null,
        { isin: 'X' }, // name manquant
        { name: 'Y' }, // isin manquant
        'bad',
      ]),
    )
    const out = getViewedFunds()
    expect(out).toHaveLength(1)
    expect(out[0].isin).toBe('FR0010315770')
  })

  it('ajoute un fonds et le place en tête', () => {
    addViewedFund({ isin: 'A', name: 'Fonds A' })
    addViewedFund({ isin: 'B', name: 'Fonds B' })
    const out = getViewedFunds()
    expect(out.map((f) => f.isin)).toEqual(['B', 'A'])
    expect(out[0].viewed_at).toBeTypeOf('string')
  })

  it('déduplique par ISIN : re-consulter remonte le fonds sans doublon', () => {
    addViewedFund({ isin: 'A', name: 'Fonds A' })
    addViewedFund({ isin: 'B', name: 'Fonds B' })
    addViewedFund({ isin: 'A', name: 'Fonds A' })
    const out = getViewedFunds()
    expect(out).toHaveLength(2)
    expect(out[0].isin).toBe('A')
  })

  it('ignore un ISIN vide', () => {
    addViewedFund({ isin: '', name: 'Sans ISIN' })
    expect(getViewedFunds()).toEqual([])
  })

  it('plafonne l\'historique à 12 entrées', () => {
    for (let i = 0; i < 20; i++) addViewedFund({ isin: `ISIN${i}`, name: `Fonds ${i}` })
    const out = getViewedFunds()
    expect(out).toHaveLength(12)
    expect(out[0].isin).toBe('ISIN19')
  })

  it('addViewedFund ne plante pas même si le storage est corrompu', () => {
    localStorage.setItem('charlie_viewed_funds', '{"corrompu":true}')
    expect(() => addViewedFund({ isin: 'A', name: 'Fonds A' })).not.toThrow()
    expect(getViewedFunds()[0].isin).toBe('A')
  })
})
