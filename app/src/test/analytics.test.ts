import { describe, it, expect, vi } from 'vitest'

// Le helper importe le client supabase (créé au chargement), `after` de next/server
// et le `track` serveur de Vercel : on les neutralise, ces tests ne couvrent que les
// fonctions pures.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@vercel/analytics/server', () => ({ track: async () => {} }))

import { visitorHash, activeFilters, vercelEventProps } from '../lib/analytics'

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

describe('vercelEventProps', () => {
  it('retourne un objet vide quand aucune dimension exploitable', () => {
    expect(vercelEventProps({ event_type: 'fund_view' })).toEqual({})
  })
  it('extrait les dimensions à faible cardinalité du meta', () => {
    expect(
      vercelEventProps({
        event_type: 'dici',
        meta: { product_type: 'etf', source: 'ai', matched: true, sort_by: 'ter' },
      }),
    ).toEqual({ product_type: 'etf', source: 'ai', matched: true, sort_by: 'ter' })
  })
  it('dérive des booléens has_results / has_query sans fuite de valeur brute', () => {
    const p = vercelEventProps({ event_type: 'search', query: 'msci world', result_count: 42 })
    expect(p).toEqual({ has_results: true, has_query: true })
    // Jamais la requête ni un ISIN en clair (forte cardinalité) dans les props Vercel.
    expect(JSON.stringify(p)).not.toContain('msci world')
  })
  it('has_results = false quand zéro résultat, et ignore une requête vide', () => {
    expect(vercelEventProps({ event_type: 'search', query: '   ', result_count: 0 }))
      .toEqual({ has_results: false })
  })
  it('ignore les champs meta de type inattendu (matched non booléen)', () => {
    expect(vercelEventProps({ event_type: 'dici', meta: { matched: 'oui', product_type: 42 } }))
      .toEqual({})
  })
})
