import { describe, it, expect } from 'vitest'
import { PERIODS, seriesSpanYears, periodEnabled } from '../components/fund/NavChart'
import type { NavPointHF } from '../lib/types'

// Régression: ISSUE-002 — période plus longue que l'ancienneté du fonds
// Found by /qa on 2026-06-15
// Report: .gstack/qa-reports/qa-report-charlie-investissement-2026-06-15.md
//
// Un fonds de ~4 ans proposait un bouton « 5A » actif affichant ~4 ans de perf
// étiquetés 5 ans (doublon de « Max »). periodEnabled doit désactiver toute
// période non couverte par l'amplitude réelle de la série (même garde que
// KpiStrip.hasPeriod).

const DAY = 24 * 60 * 60 * 1000

// Série mensuelle synthétique couvrant `years` années jusqu'à aujourd'hui.
function seriesSpanning(years: number): NavPointHF[] {
  const now = Date.now()
  const start = now - years * 365.25 * DAY
  const points = Math.max(2, Math.round(years * 12))
  const out: NavPointHF[] = []
  for (let i = 0; i < points; i++) {
    const t = start + ((now - start) * i) / (points - 1)
    out.push({ date: new Date(t).toISOString().slice(0, 10), nav: 100 + i })
  }
  return out
}

const get = (label: string) => PERIODS.find((p) => p.label === label)!

describe('seriesSpanYears', () => {
  it('mesure l’amplitude du plus ancien au plus récent point', () => {
    expect(seriesSpanYears(seriesSpanning(4))).toBeGreaterThan(3.7)
    expect(seriesSpanYears(seriesSpanning(4))).toBeLessThan(4.3)
  })
  it('vaut 0 pour une série vide ou à un seul point', () => {
    expect(seriesSpanYears([])).toBe(0)
    expect(seriesSpanYears([{ date: '2024-01-01', nav: 100 }])).toBe(0)
  })
})

describe('periodEnabled — garde-fou des périodes vs ancienneté', () => {
  it('fonds de ~4 ans : 5A désactivé, 3A/1A/Max actifs (le bug ISSUE-002)', () => {
    const data = seriesSpanning(4)
    expect(periodEnabled(data, get('5A'))).toBe(false)
    expect(periodEnabled(data, get('3A'))).toBe(true)
    expect(periodEnabled(data, get('1A'))).toBe(true)
    expect(periodEnabled(data, get('Max'))).toBe(true)
  })

  it('fonds de ~6 ans : toutes les périodes actives', () => {
    const data = seriesSpanning(6)
    for (const p of PERIODS) expect(periodEnabled(data, p)).toBe(true)
  })

  it('fonds de ~2 ans : 3A et 5A désactivés, 1A et Max actifs', () => {
    const data = seriesSpanning(2)
    expect(periodEnabled(data, get('3A'))).toBe(false)
    expect(periodEnabled(data, get('5A'))).toBe(false)
    expect(periodEnabled(data, get('1A'))).toBe(true)
    expect(periodEnabled(data, get('Max'))).toBe(true)
  })

  it('tolérance 0,25 an : un fonds à 4,8 ans garde 5A actif', () => {
    expect(periodEnabled(seriesSpanning(4.8), get('5A'))).toBe(true)
  })

  it('Max reste actif dès 2 points même sur un historique très court', () => {
    const data = seriesSpanning(0.5)
    expect(periodEnabled(data, get('Max'))).toBe(true)
    expect(periodEnabled(data, get('1A'))).toBe(false)
  })

  it('série à un seul point : aucune période active, pas même Max', () => {
    const data: NavPointHF[] = [{ date: '2024-01-01', nav: 100 }]
    for (const p of PERIODS) expect(periodEnabled(data, p)).toBe(false)
  })
})
