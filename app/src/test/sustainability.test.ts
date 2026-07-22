import { describe, it, expect } from 'vitest'
import { officialLabelsOf, sfdrInfo, OFFICIAL_LABELS, exclusionEntries } from '../lib/sustainability'

describe('officialLabelsOf', () => {
  it('ne garde que les labels officiels (ignore les tags internes)', () => {
    const got = officialLabelsOf(['screener-ready', 'isr', 'sri-4', 'esg', 'finansol'])
    expect(got.map((l) => l.key)).toEqual(['isr', 'finansol'])
  })
  it('insensible à la casse', () => {
    expect(officialLabelsOf(['ISR']).map((l) => l.key)).toEqual(['isr'])
  })
  it('renvoie [] pour null/undefined/aucun officiel', () => {
    expect(officialLabelsOf(null)).toEqual([])
    expect(officialLabelsOf(undefined)).toEqual([])
    expect(officialLabelsOf(['esg', 'sri-6'])).toEqual([])
  })
  it('préserve l\'ordre canonique d\'OFFICIAL_LABELS', () => {
    const got = officialLabelsOf(['finansol', 'isr'])
    expect(got.map((l) => l.key)).toEqual(['isr', 'finansol'])
  })
  it('expose les 3 labels officiels FR', () => {
    expect(OFFICIAL_LABELS.map((l) => l.key)).toEqual(['isr', 'greenfin', 'finansol'])
  })
})

describe('sfdrInfo', () => {
  it('article 9 = objectif durable', () => {
    expect(sfdrInfo(9)?.tag).toBe('Article 9')
    expect(sfdrInfo(9)?.title).toMatch(/durable/i)
  })
  it('article 8 = caractéristiques E/S', () => {
    expect(sfdrInfo(8)?.tag).toBe('Article 8')
  })
  it('article 6 = sans objectif de durabilité', () => {
    expect(sfdrInfo(6)?.tag).toBe('Article 6')
  })
  it('null/inconnu → null', () => {
    expect(sfdrInfo(null)).toBe(null)
    expect(sfdrInfo(undefined)).toBe(null)
    expect(sfdrInfo(7)).toBe(null)
  })
})

describe('exclusionEntries', () => {
  it('sépare exclut / n\'exclut pas, dans l\'ordre du vocabulaire', () => {
    const { excluded, notExcluded } = exclusionEntries({
      gambling: false, tobacco: true, controversial_weapons: true, fossil: false,
    })
    expect(excluded.map((e) => e.key)).toEqual(['tobacco', 'controversial_weapons'])
    expect(notExcluded.map((e) => e.key)).toEqual(['fossil', 'gambling'])
    expect(excluded[0].label).toBe('Tabac')
  })
  it('ignore les clés hors vocabulaire', () => {
    const { excluded, notExcluded } = exclusionEntries({ crypto_mining: true } as Record<string, boolean>)
    expect(excluded).toHaveLength(0)
    expect(notExcluded).toHaveLength(0)
  })
  it('null/undefined → vide (la carte se masque)', () => {
    expect(exclusionEntries(null)).toEqual({ excluded: [], notExcluded: [] })
    expect(exclusionEntries(undefined)).toEqual({ excluded: [], notExcluded: [] })
  })
})
