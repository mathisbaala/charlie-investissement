import { describe, it, expect, beforeEach } from 'vitest'
import { saveReleveHandoff, loadReleveHandoff, type HandoffReleve } from '../lib/releveHandoff'
import type { ReleveApiPosition } from '../lib/releve'

const pos = (isin: string, amount: number | null): ReleveApiPosition => ({
  isin, label: '', amount, known: true, name: isin, ter: 1.2, sri: 4, retro: 0.005,
})

const releve = (positions: ReleveApiPosition[]): HandoffReleve => ({
  id: 'r1', fileName: 'releve.pdf', positions, matches: [], chosen: -1, documentTotal: 1000,
})

describe('releveHandoff', () => {
  beforeEach(() => sessionStorage.clear())

  it('rejoue à l\'identique les relevés mémorisés (montants réels préservés)', () => {
    const src = [releve([pos('FR0000000001', 21166.33), pos('FR0000000002', 23.38)])]
    const token = saveReleveHandoff(src)
    expect(token).not.toBeNull()
    const back = loadReleveHandoff(token)
    expect(back).toEqual(src)
    // Fidélité au centime : ni arrondi, ni écrasement à 0.
    expect(back?.[0].positions[0].amount).toBe(21166.33)
    expect(back?.[0].positions[1].amount).toBe(23.38)
  })

  it('ne mémorise rien pour une liste vide (token null)', () => {
    expect(saveReleveHandoff([])).toBeNull()
  })

  it('renvoie null sans jeton', () => {
    saveReleveHandoff([releve([pos('FR0000000001', 100)])])
    expect(loadReleveHandoff(null)).toBeNull()
    expect(loadReleveHandoff('')).toBeNull()
  })

  it('renvoie null si le jeton ne correspond pas (dépôt écrasé depuis)', () => {
    const t1 = saveReleveHandoff([releve([pos('FR0000000001', 100)])])
    // Un second dépôt écrase le relais → l'ancien jeton devient périmé.
    saveReleveHandoff([releve([pos('FR0000000002', 200)])])
    expect(loadReleveHandoff(t1)).toBeNull()
  })

  it('renvoie null pour un jeton inconnu', () => {
    saveReleveHandoff([releve([pos('FR0000000001', 100)])])
    expect(loadReleveHandoff('h-inexistant')).toBeNull()
  })
})
