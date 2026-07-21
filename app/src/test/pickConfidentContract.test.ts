import { describe, it, expect } from 'vitest'
import { pickConfidentContract } from '../components/simulator/FeeSimulator'
import type { ReleveContractMatch } from '../lib/releve'

const m = (company: string, contract: string, coverage: number): ReleveContractMatch => ({
  company, contract, coverage, matched: Math.round(coverage * 10),
})

describe('pickConfidentContract', () => {
  it('ne retient rien sans match', () => {
    expect(pickConfidentContract([])).toBeNull()
    // @ts-expect-error robustesse : entrée nulle
    expect(pickConfidentContract(undefined)).toBeNull()
  })

  it('ne retient rien si la couverture est faible', () => {
    expect(pickConfidentContract([m('Generali Vie', 'Himalia', 0.5)])).toBeNull()
  })

  it('retient un contrat unique à couverture forte', () => {
    expect(pickConfidentContract([m('Generali Vie', 'Himalia', 0.9)]))
      .toBe('Generali Vie::Himalia')
  })

  it('retient le contrat dominant quand il écrase le 2e candidat', () => {
    expect(pickConfidentContract([
      m('Generali Vie', 'Himalia', 0.95),
      m('Spirica', 'Autre', 0.4),
    ])).toBe('Generali Vie::Himalia')
  })

  it('ne retient rien quand deux contrats sont proches (relevé ambigu)', () => {
    expect(pickConfidentContract([
      m('Generali Vie', 'Himalia', 0.8),
      m('Spirica', 'Autre', 0.75),
    ])).toBeNull()
  })

  it('ne retient rien sur un relevé multi-contrats à faible couverture (cas DIGARD)', () => {
    expect(pickConfidentContract([
      m('SwissLife France', 'Placement-direct Euro+', 0.3333),
      m('BNP Paribas Cardif', 'Cardif Essentiel Retraite', 0.3333),
      m('Generali Vie', 'Himalia', 0.3333),
    ])).toBeNull()
  })
})
