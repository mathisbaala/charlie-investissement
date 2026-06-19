import { describe, it, expect } from 'vitest'
import { officialLabelsOf, sfdrInfo, OFFICIAL_LABELS } from '../lib/sustainability'

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
