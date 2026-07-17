import { describe, it, expect } from 'vitest'
import {
  parsePortfolioParams,
  normalizeWeights,
  serializePortfolioParams,
  appendHolding,
  buildCorrelationMatrix,
  projectEuros,
  mergeCurves,
  alignCompareCurve,
  mergeCurvesMulti,
  trailingReturn,
  calendarYearReturns,
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

describe('appendHolding', () => {
  it('liste vide → 1er fonds à 100 %', () => {
    expect(appendHolding([], 'FR0000000001')).toEqual([{ isin: 'FR0000000001', weight: 100 }])
  })

  it('poids du nouveau = moyenne des poids positifs existants', () => {
    const out = appendHolding(
      [{ isin: 'A', weight: 60 }, { isin: 'B', weight: 40 }],
      'C',
    )
    expect(out).toHaveLength(3)
    expect(out[2]).toEqual({ isin: 'C', weight: 50 }) // (60+40)/2
  })

  it('ignore les poids nuls/négatifs dans la moyenne', () => {
    const out = appendHolding(
      [{ isin: 'A', weight: 30 }, { isin: 'B', weight: 0 }],
      'C',
    )
    expect(out[2].weight).toBe(30) // moyenne des seuls positifs (30)
  })

  it('aucun poids positif → nouveau fonds à 100 %', () => {
    const out = appendHolding([{ isin: 'A', weight: 0 }], 'C')
    expect(out[1].weight).toBe(100)
  })

  it('doublon ISIN → liste inchangée (même référence)', () => {
    const list = [{ isin: 'A', weight: 50 }]
    expect(appendHolding(list, 'A')).toBe(list)
  })

  it('portefeuille plein (max atteint) → liste inchangée', () => {
    const list = [{ isin: 'A', weight: 50 }, { isin: 'B', weight: 50 }]
    expect(appendHolding(list, 'C', 2)).toBe(list)
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

describe('alignCompareCurve', () => {
  const grid = ['2021-01-04', '2021-01-11', '2021-01-18']

  it('aligne par LOCF une grille décalée de quelques jours et rebase à 100', () => {
    // Courbe du fonds anchorée 3 jours avant chaque date de grille, base 200.
    const curve = [
      { d: '2021-01-01', v: 200 },
      { d: '2021-01-08', v: 210 },
      { d: '2021-01-15', v: 190 },
    ]
    expect(alignCompareCurve(grid, curve)).toEqual([100, 105, 95])
  })

  it('reprend telle quelle une courbe déjà sur la grille', () => {
    const curve = grid.map((d, i) => ({ d, v: 100 + i }))
    expect(alignCompareCurve(grid, curve)).toEqual([100, 101, 102])
  })

  it('laisse null avant le début de l’historique puis rebase au premier point couvert', () => {
    const curve = [{ d: '2021-01-10', v: 50 }, { d: '2021-01-17', v: 55 }]
    expect(alignCompareCurve(grid, curve)).toEqual([null, 100, 110.00000000000001])
  })

  it('coupe (null) quand la dernière valeur dépasse la tolérance de fraîcheur', () => {
    const curve = [{ d: '2021-01-01', v: 100 }]
    // 2021-01-18 est à 17 jours du dernier point : au-delà des 10 jours tolérés.
    expect(alignCompareCurve(grid, curve)).toEqual([100, 100, null])
  })

  it('courbe vide → que des null', () => {
    expect(alignCompareCurve(grid, [])).toEqual([null, null, null])
  })

  it('ignore une base non positive (série corrompue)', () => {
    const curve = [{ d: '2021-01-04', v: 0 }, { d: '2021-01-11', v: 10 }]
    expect(alignCompareCurve(grid, curve)).toEqual([null, null, null])
  })
})

describe('mergeCurvesMulti', () => {
  const p = [{ d: '2021-01-04', v: 100 }, { d: '2021-01-11', v: 102 }]
  const b = [{ d: '2021-01-04', v: 100 }, { d: '2021-01-11', v: 101 }]

  it('sans fonds comparé, équivaut à mergeCurves', () => {
    expect(mergeCurvesMulti(p, b, [])).toEqual([
      { d: '2021-01-04', p: 100, b: 100 },
      { d: '2021-01-11', p: 102, b: 101 },
    ])
  })

  it('ajoute une clé c<i> rebasée par fonds comparé', () => {
    const c0 = [{ d: '2021-01-02', v: 50 }, { d: '2021-01-09', v: 60 }]
    const c1 = [{ d: '2021-01-04', v: 100 }, { d: '2021-01-11', v: 90 }]
    expect(mergeCurvesMulti(p, b, [c0, c1])).toEqual([
      { d: '2021-01-04', p: 100, b: 100, c0: 100, c1: 100 },
      { d: '2021-01-11', p: 102, b: 101, c0: 120, c1: 90 },
    ])
  })

  it('benchmark absent → b=null, fonds comparés toujours présents', () => {
    const c0 = [{ d: '2021-01-04', v: 10 }, { d: '2021-01-11', v: 11 }]
    expect(mergeCurvesMulti(p, null, [c0])).toEqual([
      { d: '2021-01-04', p: 100, b: null, c0: 100 },
      { d: '2021-01-11', p: 102, b: null, c0: 110.00000000000001 },
    ])
  })
})

describe('trailingReturn', () => {
  // Courbe hebdo d'un an : 100 → 152 par pas réguliers.
  const weekly = Array.from({ length: 53 }, (_, i) => ({
    d: new Date(Date.UTC(2025, 0, 6) + i * 7 * 86400_000).toISOString().slice(0, 10),
    v: 100 + i,
  }))

  it('calcule la perf sur un horizon couvert', () => {
    // 28 jours = 4 pas hebdo : 152 vs 148.
    expect(trailingReturn(weekly, 28)).toBeCloseTo(152 / 148 - 1, 10)
  })
  it('renvoie null quand la courbe ne couvre pas l’horizon', () => {
    expect(trailingReturn(weekly, 400)).toBeNull()
  })
  it('renvoie null sur une courbe trop courte ou une base nulle', () => {
    expect(trailingReturn([{ d: '2025-01-06', v: 100 }], 7)).toBeNull()
    expect(trailingReturn([{ d: '2025-01-06', v: 0 }, { d: '2025-01-13', v: 5 }], 7)).toBeNull()
  })
})

describe('calendarYearReturns', () => {
  const curve = [
    { d: '2023-01-02', v: 100 },
    { d: '2023-12-25', v: 110 },
    { d: '2024-12-30', v: 121 },
    { d: '2025-06-30', v: 133.1 },
  ]

  it('année pleine : du 31/12 précédent au 31/12 de l’année', () => {
    const r = calendarYearReturns(curve)
    expect(r['2024']).toBeCloseTo(121 / 110 - 1, 10)
  })
  it('année en cours : YTD jusqu’au dernier point', () => {
    expect(calendarYearReturns(curve)['2025']).toBeCloseTo(133.1 / 121 - 1, 10)
  })
  it('première année sans 31/12 précédent : absente', () => {
    expect(calendarYearReturns(curve)['2023']).toBeUndefined()
  })
  it('année dont le début n’est pas couvert : absente', () => {
    // Courbe démarrant en mars 2024 → 2024 partielle, exclue ; 2025 présente.
    const late = [
      { d: '2024-03-04', v: 100 },
      { d: '2024-12-30', v: 108 },
      { d: '2025-05-05', v: 118.8 },
    ]
    const r = calendarYearReturns(late)
    expect(r['2024']).toBeUndefined()
    expect(r['2025']).toBeCloseTo(118.8 / 108 - 1, 10)
  })
  it('courbe vide → objet vide', () => {
    expect(calendarYearReturns([])).toEqual({})
  })
})
