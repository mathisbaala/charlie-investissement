import { describe, it, expect, vi } from 'vitest'

// Le helper importe le client supabase (créé au chargement) et `after` de next/server :
// on les neutralise, ces tests ne couvrent que les fonctions pures.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('next/server', () => ({ after: () => {} }))

import { visitorHash, activeFilters } from '../lib/analytics'

describe('visitorHash', () => {
  it('est déterministe pour une même IP et un même sel', () => {
    expect(visitorHash('1.2.3.4', 'sel')).toBe(visitorHash('1.2.3.4', 'sel'))
  })
  it('diffère selon l\'IP', () => {
    expect(visitorHash('1.2.3.4', 'sel')).not.toBe(visitorHash('5.6.7.8', 'sel'))
  })
  it('diffère selon le sel (pseudonymisation non réversible sans le sel)', () => {
    expect(visitorHash('1.2.3.4', 'selA')).not.toBe(visitorHash('1.2.3.4', 'selB'))
  })
  it('ne contient jamais l\'IP en clair et fait 32 hex', () => {
    const h = visitorHash('1.2.3.4', 'sel')
    expect(h).not.toContain('1.2.3.4')
    expect(h).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('activeFilters', () => {
  it('retourne null quand aucun filtre actif', () => {
    expect(activeFilters({})).toBe(null)
    expect(activeFilters({ a: null, b: undefined, c: '', d: [] })).toBe(null)
  })
  it('garde les valeurs renseignées et écarte les vides', () => {
    expect(activeFilters({ ter_max: 1.5, search: '', regions: [], sfdr: [8, 9] }))
      .toEqual({ ter_max: 1.5, sfdr: [8, 9] })
  })
  it('conserve une chaîne non vide et écarte une chaîne d\'espaces', () => {
    expect(activeFilters({ mgr: 'Amundi', vide: '   ' })).toEqual({ mgr: 'Amundi' })
  })
  it('conserve la valeur 0 (filtre numérique légitime)', () => {
    expect(activeFilters({ perf_1y_min: 0 })).toEqual({ perf_1y_min: 0 })
  })
})
