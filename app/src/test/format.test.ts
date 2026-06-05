import { describe, it, expect } from 'vitest'
import { pct, eur, fmtAum, dt, dtYear, fmtSharpe, fmtYears, productTypeLabel, capitalize, feeFracToPct } from '../lib/format'

describe('pct', () => {
  it('returns em dash for null', () => expect(pct(null)).toBe('—'))
  it('returns em dash for undefined', () => expect(pct(undefined)).toBe('—'))
  it('formats positive without sign by default', () => expect(pct(5.5)).toBe('5,5 %'))
  it('adds + sign when requested and positive', () => expect(pct(5.5, true)).toBe('+5,5 %'))
  it('no + for zero even with sign', () => expect(pct(0, true)).toBe('0,0 %'))
  it('formats negative correctly', () => expect(pct(-3.2)).toBe('-3,2 %'))
})

describe('feeFracToPct', () => {
  // Régression : la base stocke les frais en fraction (0.018), l'UI attend des %.
  // Avant correctif, la liste affichait "0,0 %" car la fraction n'était pas convertie.
  it('returns null for null/undefined', () => {
    expect(feeFracToPct(null)).toBe(null)
    expect(feeFracToPct(undefined)).toBe(null)
  })
  it('converts a standard OPCVM TER fraction to percent', () => expect(feeFracToPct(0.018)).toBe(1.8))
  it('converts a cheap ETF fraction', () => expect(feeFracToPct(0.0009)).toBe(0.09))
  it('converts an SCPI fee-on-rent fraction (>=0.1) correctly', () => expect(feeFracToPct(0.18)).toBe(18))
  it('handles zero', () => expect(feeFracToPct(0)).toBe(0))
})

describe('fmtAum', () => {
  it('returns em dash for null', () => expect(fmtAum(null)).toBe('—'))
  it('converts raw euros to M€', () => {
    // 500 000 000 = 500 M€
    expect(fmtAum(500_000_000)).toContain('M€')
  })
  it('rounds large amounts to nearest 100M€', () => {
    // 2 300 000 000 = 2300 M€ → rounds to 2 300 M€
    const result = fmtAum(2_300_000_000)
    expect(result).toContain('M€')
    expect(result).toContain('2')
  })
})

describe('productTypeLabel', () => {
  it('returns null for null input', () => expect(productTypeLabel(null)).toBe(null))
  it('maps opcvm', () => expect(productTypeLabel('opcvm')).toBe('OPCVM'))
  it('maps etf', () => expect(productTypeLabel('etf')).toBe('ETF'))
  it('maps scpi', () => expect(productTypeLabel('scpi')).toBe('SCPI'))
  it('capitalizes unknown types', () => expect(productTypeLabel('unknown-type')).toBe('Unknown-type'))
})

describe('capitalize', () => {
  it('returns null for null', () => expect(capitalize(null)).toBe(null))
  it('capitalizes first letter', () => expect(capitalize('hello')).toBe('Hello'))
  it('preserves already capitalized', () => expect(capitalize('Hello')).toBe('Hello'))
})

describe('fmtYears', () => {
  it('returns null for null', () => expect(fmtYears(null)).toBe(null))
  it('formats years with label', () => expect(fmtYears(5)).toBe('5,0 ans'))
})

describe('fmtSharpe', () => {
  it('returns em dash for null', () => expect(fmtSharpe(null)).toBe('—'))
  it('formats to 2 decimals', () => expect(fmtSharpe(1.234)).toContain('1,23'))
})
