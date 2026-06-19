import { describe, it, expect } from 'vitest'
import { blendExposure, findOverlaps, holdingKey } from '../lib/lookthrough'

describe('blendExposure', () => {
  it('équipondère sur les fonds contributeurs (somme ~100 %)', () => {
    // 2 fonds : A 60/40 USA/Europe, B 100 USA → blended USA = (0.6+1)/2=80, Europe = 0.4/2=20
    const rows = [
      { isin: 'A', label: 'USA', weight: 0.6 },
      { isin: 'A', label: 'Europe', weight: 0.4 },
      { isin: 'B', label: 'USA', weight: 1.0 },
    ]
    const out = blendExposure(rows)
    expect(out).toEqual([{ label: 'USA', weight: 80 }, { label: 'Europe', weight: 20 }])
  })
  it('ne compte QUE les fonds présents (un fonds sans données ne dilue pas)', () => {
    // seul A contribue → normalisé sur 1 fonds → 100 %
    const out = blendExposure([{ isin: 'A', label: 'USA', weight: 1.0 }])
    expect(out).toEqual([{ label: 'USA', weight: 100 }])
  })
  it('renvoie [] sans données', () => expect(blendExposure([])).toEqual([]))
  it('ignore poids null/NaN et labels vides', () => {
    const out = blendExposure([
      { isin: 'A', label: 'USA', weight: 1.0 },
      { isin: 'A', label: '', weight: 0.5 },
      { isin: 'A', label: 'X', weight: NaN },
    ])
    expect(out).toEqual([{ label: 'USA', weight: 100 }])
  })
  it('tri décroissant + cap au top N', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ isin: 'A', label: `P${i}`, weight: (i + 1) / 100 }))
    const out = blendExposure(rows, 12)
    expect(out.length).toBe(12)
    expect(out[0].label).toBe('P14')
  })
})

describe('holdingKey', () => {
  it('préfère le ticker (en majuscules)', () => expect(holdingKey('Apple Inc', 'aapl')).toBe('AAPL'))
  it('normalise le nom sans ticker', () => expect(holdingKey('Apple,  Inc.', null)).toBe('apple inc'))
})

describe('findOverlaps', () => {
  it('détecte une ligne détenue par ≥ 2 fonds (par ticker)', () => {
    const out = findOverlaps([
      { isin: 'A', position_name: 'Apple Inc', ticker: 'AAPL', weight: 0.05 },
      { isin: 'B', position_name: 'APPLE INC', ticker: 'AAPL', weight: 0.07 },
      { isin: 'A', position_name: 'Microsoft', ticker: 'MSFT', weight: 0.04 },
    ])
    expect(out.length).toBe(1)
    expect(out[0].ticker).toBe('AAPL')
    expect(out[0].count).toBe(2)
    expect(out[0].max_weight).toBe(7)
  })
  it('exclut les lignes génériques (Autre/Cash…)', () => {
    const out = findOverlaps([
      { isin: 'A', position_name: 'Autre', ticker: null, weight: 0.8 },
      { isin: 'B', position_name: 'autre', ticker: null, weight: 0.7 },
      { isin: 'A', position_name: 'Cash', ticker: null, weight: 0.1 },
      { isin: 'B', position_name: 'Cash', ticker: null, weight: 0.1 },
    ])
    expect(out).toEqual([])
  })
  it('une ligne dans un seul fonds n\'est pas un doublon', () => {
    const out = findOverlaps([
      { isin: 'A', position_name: 'Apple', ticker: 'AAPL', weight: 0.05 },
    ])
    expect(out).toEqual([])
  })
  it('matche par nom normalisé quand pas de ticker', () => {
    const out = findOverlaps([
      { isin: 'A', position_name: 'Nestlé S.A.', ticker: null, weight: 0.03 },
      { isin: 'B', position_name: 'nestlé sa', ticker: null, weight: 0.02 },
    ])
    expect(out.length).toBe(1)
    expect(out[0].count).toBe(2)
  })
})
