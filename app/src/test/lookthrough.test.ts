import { describe, it, expect } from 'vitest'
import { weightedExposure, topSlices, findOverlaps, holdingKey, canonicalSector } from '../lib/lookthrough'

describe('topSlices (troncature camembert : top n + « Autres »)', () => {
  const expo = [
    { label: 'États-Unis', weight: 40 },
    { label: 'France', weight: 25 },
    { label: 'Japon', weight: 15 },
    { label: 'Allemagne', weight: 10 },
    { label: 'Suisse', weight: 6 },
    { label: 'Italie', weight: 3 },
    { label: 'Espagne', weight: 1 },
  ]
  it('regroupe le reliquat au-delà de n en « Autres »', () => {
    const out = topSlices(expo, 5)
    expect(out).toHaveLength(6)
    expect(out[5]).toEqual({ label: 'Autres', weight: 4 })
    expect(out.slice(0, 5).map((e) => e.label)).toEqual(['États-Unis', 'France', 'Japon', 'Allemagne', 'Suisse'])
  })
  it("rend l'exposition telle quelle quand elle tient déjà dans n parts", () => {
    expect(topSlices(expo.slice(0, 3), 5)).toEqual(expo.slice(0, 3))
    expect(topSlices([], 5)).toEqual([])
  })
  it("n'ajoute pas d'« Autres » à zéro (reliquat nul après arrondi)", () => {
    const flat = [...expo.slice(0, 5), { label: 'Poussière', weight: 0.01 }]
    expect(topSlices(flat, 5)).toHaveLength(5)
  })
})

describe('canonicalSector', () => {
  it('rabat les 3 taxonomies du même secteur sur un libellé FR', () => {
    expect(canonicalSector('Technology')).toBe('Technologie')
    expect(canonicalSector('Information Technology')).toBe('Technologie')
    expect(canonicalSector('Technologie')).toBe('Technologie')
  })
  it('est insensible à la casse et aux espaces', () => {
    expect(canonicalSector('  HEALTH CARE ')).toBe('Santé')
    expect(canonicalSector('Healthcare')).toBe('Santé')
  })
  it('écarte le junk (ISIN collé en secteur, artefacts) → null', () => {
    expect(canonicalSector('IT0005588881')).toBeNull()
    expect(canonicalSector('Volatilité sur 1 an (en EUR)')).toBeNull()
    expect(canonicalSector('Unknown')).toBeNull()
    expect(canonicalSector('')).toBeNull()
    expect(canonicalSector(null)).toBeNull()
  })
  it('laisse passer la longue traîne GICS fine telle quelle', () => {
    expect(canonicalSector('Aerospace & Defense')).toBe('Aerospace & Defense')
    expect(canonicalSector('Treasury')).toBe('Treasury')
  })
  it('fait fusionner les variantes dans l\'exposition agrégée (un seul secteur)', () => {
    // 2 fonds : A « Technology » 100 %, B « Technologie » 100 % → 1 ligne à 100
    const rows = [
      { isin: 'A', label: canonicalSector('Technology')!, weight: 1.0 },
      { isin: 'B', label: canonicalSector('Technologie')!, weight: 1.0 },
    ]
    expect(weightedExposure(rows, { A: 0.5, B: 0.5 })).toEqual([{ label: 'Technologie', weight: 100 }])
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

describe('weightedExposure', () => {
  it('pondère par les poids du portefeuille (contribution = poids fonds × poids ligne)', () => {
    // A pèse 75 % (100 % USA), B pèse 25 % (100 % Europe) → USA 75, Europe 25.
    const rows = [
      { isin: 'A', label: 'USA', weight: 1.0 },
      { isin: 'B', label: 'Europe', weight: 1.0 },
    ]
    const out = weightedExposure(rows, { A: 0.75, B: 0.25 })
    expect(out).toEqual([{ label: 'USA', weight: 75 }, { label: 'Europe', weight: 25 }])
  })
  it('normalise sur les seuls fonds porteurs de la ventilation', () => {
    // A (60 %) porte la donnée, B (40 %) non → on renormalise sur A → 100 %.
    const out = weightedExposure([{ isin: 'A', label: 'USA', weight: 1.0 }], { A: 0.6, B: 0.4 })
    expect(out).toEqual([{ label: 'USA', weight: 100 }])
  })
  it('fusionne par clé (un même pays sous deux libellés)', () => {
    const rows = [
      { isin: 'A', key: 'DE', label: 'Germany', weight: 1.0 },
      { isin: 'B', key: 'DE', label: 'Allemagne', weight: 1.0 },
    ]
    const out = weightedExposure(rows, { A: 0.5, B: 0.5 })
    expect(out.length).toBe(1)
    expect(out[0].weight).toBe(100)
  })
  it('renvoie [] si aucun fonds porteur n\'a de poids', () => {
    expect(weightedExposure([{ isin: 'A', label: 'USA', weight: 1 }], { B: 1 })).toEqual([])
    expect(weightedExposure([], {})).toEqual([])
  })
})
