import { describe, it, expect } from 'vitest'
import { scoreFunds, ClientProfile } from '../lib/matching'

const baseProfile: ClientProfile = {
  age: 40,
  risk_profile: 'equilibre',
  horizon_years: 7,
  envelopes: ['av_lux'],
  esg_preference: 'indifferent',
}

const mockFund = {
  isin: 'FR0000000001',
  name: 'Fonds Test',
  product_type: 'opcvm',
  gestionnaire: 'Amundi',
  sfdr_article: 8,
  risk_score: 3,
  ongoing_charges: 0.5,
  performance_1y: 5.0,
  performance_3y: 4.0,
  performance_5y: 3.5,
  volatility_1y: 8.0,
  sharpe_1y: 0.8,
  aum_eur: 1_000_000_000,
  morningstar_rating: 4,
  pea_eligible: true,
  per_eligible: false,
  av_lux_eligible: true,
  inception_date: '2010-01-01',
  data_completeness: 90,
}

describe('scoreFunds', () => {
  it('returns empty array for empty candidates', () => {
    expect(scoreFunds([], baseProfile)).toEqual([])
  })

  it('attaches match_score, match_label, match_summary', () => {
    const [result] = scoreFunds([mockFund], baseProfile)
    expect(result.match_score).toBeGreaterThan(0)
    expect(result.match_score).toBeLessThanOrEqual(100)
    expect(result.match_label).toBeTruthy()
    expect(result.match_summary).toBeTruthy()
  })

  it('sorts by descending match_score', () => {
    const lowRiskFund = { ...mockFund, isin: 'FR0000000002', risk_score: 7, ongoing_charges: 2.5 }
    const results = scoreFunds([lowRiskFund, mockFund], baseProfile)
    expect(results[0].match_score).toBeGreaterThanOrEqual(results[1].match_score)
  })

  it('penalizes art9 preference when fund is art6', () => {
    const art9Profile: ClientProfile = { ...baseProfile, esg_preference: 'art9' }
    const art6Fund = { ...mockFund, sfdr_article: 6 }
    const art9Fund = { ...mockFund, isin: 'FR0000000003', sfdr_article: 9 }
    const results = scoreFunds([art6Fund, art9Fund], art9Profile)
    // art9 fund should rank higher
    expect(results[0].sfdr_article).toBe(9)
  })

  it('match_label is Excellent for high-scoring fund', () => {
    const idealFund = {
      ...mockFund,
      risk_score: 3,
      sfdr_article: 8,
      ongoing_charges: 0.2,
      performance_1y: 10,
      performance_3y: 9,
      performance_5y: 8,
      morningstar_rating: 5,
      data_completeness: 95,
    }
    const [result] = scoreFunds([idealFund], baseProfile)
    expect(['Excellent', 'Très bon']).toContain(result.match_label)
  })
})
