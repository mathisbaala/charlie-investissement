import { describe, it, expect } from 'vitest'
import {
  parsePortfolioParams,
  normalizeWeights,
  serializePortfolioParams,
  buildCorrelationMatrix,
  projectEuros,
  mergeCurves,
} from '../lib/portfolio'

describe('parsePortfolioParams', () => {
  it('parse isins + poids alignés', () => {
    const out = parsePortfolioParams('LU0533033238,IE00BF51K025', '60,40')
    expect(out).toEqual([
      { isin: 'LU0533033238', weight: 60 },
      { isin: 'IE00BF51K025', weight: 40 },
    ])
  })

  it('équipondère si les poids manquent', () => {
    const out = parsePortfolioParams('A1111111111X,B2222222222Y', null)
    expect(out.map((h) => h.weight)).toEqual([50, 50])
  })

  it('équipondère si le nombre de poids ne correspond pas', () => {
    const out = parsePortfolioParams('A1111111111X,B2222222222Y', '70')
    expect(out.map((h) => h.weight)).toEqual([50, 50])
  })

  it('équipondère si un poids est non numérique', () => {
    const out = parsePortfolioParams('A1111111111X,B2222222222Y', '70,abc')
    expect(out.map((h) => h.weight)).toEqual([50, 50])
  })

  it('accepte les ISIN synthétiques (fonds euros FE_*)', () => {
    const out = parsePortfolioParams('FE_AG2R,LU0533033238', '20,80')
    expect(out[0].isin).toBe('FE_AG2R')
  })

  it('écarte les ISIN invalides et déduplique', () => {
    const out = parsePortfolioParams('A1111111111X,!!bad,A1111111111X', null)
    expect(out).toEqual([{ isin: 'A1111111111X', weight: 100 }])
  })

  it('renvoie [] si aucun ISIN valide', () => {
    expect(parsePortfolioParams('', '50')).toEqual([])
    expect(parsePortfolioParams(null, null)).toEqual([])
  })
})

describe('normalizeWeights', () => {
  it('renormalise à 100 %', () => {
    const out = normalizeWeights([
      { isin: 'A', weight: 30 },
      { isin: 'B', weight: 10 },
    ])
    expect(out.map((h) => h.weight)).toEqual([75, 25])
  })

  it('équipondère si la somme est nulle', () => {
    const out = normalizeWeights([
      { isin: 'A', weight: 0 },
      { isin: 'B', weight: 0 },
    ])
    expect(out.map((h) => h.weight)).toEqual([50, 50])
  })

  it('ignore les poids négatifs (traités comme 0)', () => {
    const out = normalizeWeights([
      { isin: 'A', weight: -5 },
      { isin: 'B', weight: 50 },
    ])
    expect(out.map((h) => h.weight)).toEqual([0, 100])
  })

  it('gère une liste vide', () => {
    expect(normalizeWeights([])).toEqual([])
  })
})

describe('serializePortfolioParams', () => {
  it('sérialise isins + poids arrondis', () => {
    const out = serializePortfolioParams([
      { isin: 'A', weight: 33.33 },
      { isin: 'B', weight: 66.67 },
    ])
    expect(out).toEqual({ isins: 'A,B', weights: '33,67' })
  })
})

describe('buildCorrelationMatrix', () => {
  it('construit une matrice symétrique avec diagonale 1', () => {
    const m = buildCorrelationMatrix(
      ['A', 'B'],
      [{ a: 'A', b: 'B', c: 0.3 }],
    )
    expect(m).toEqual([
      [1, 0.3],
      [0.3, 1],
    ])
  })

  it('met null pour une paire absente', () => {
    const m = buildCorrelationMatrix(['A', 'B', 'C'], [{ a: 'A', b: 'B', c: 0.5 }])
    expect(m[0][2]).toBeNull() // A-C absent
    expect(m[1][0]).toBe(0.5) // B-A symétrique
    expect(m[2][2]).toBe(1) // diagonale
  })
})

describe('projectEuros', () => {
  it('projette valeur finale + gain', () => {
    expect(projectEuros(0.1775, 10000)).toEqual({ final: 11775, gain: 1775 })
  })
  it('gère une perf nulle/absente', () => {
    expect(projectEuros(null, 10000)).toEqual({ final: 10000, gain: 0 })
  })
  it('gère une perf négative', () => {
    expect(projectEuros(-0.2, 10000)).toEqual({ final: 8000, gain: -2000 })
  })
})

describe('mergeCurves', () => {
  it('fusionne portefeuille + benchmark par date', () => {
    const p = [{ d: '2021-01-01', v: 100 }, { d: '2021-01-08', v: 102 }]
    const b = [{ d: '2021-01-01', v: 100 }, { d: '2021-01-08', v: 105 }]
    expect(mergeCurves(p, b)).toEqual([
      { d: '2021-01-01', p: 100, b: 100 },
      { d: '2021-01-08', p: 102, b: 105 },
    ])
  })
  it('met b=null si benchmark absent ou date manquante', () => {
    const p = [{ d: '2021-01-01', v: 100 }]
    expect(mergeCurves(p, null)).toEqual([{ d: '2021-01-01', p: 100, b: null }])
    expect(mergeCurves(p, [{ d: '2099-01-01', v: 100 }])).toEqual([
      { d: '2021-01-01', p: 100, b: null },
    ])
  })
})
