import { describe, it, expect } from 'vitest'
import { parsePctString } from '../components/simulator/SupportSources'

describe('parsePctString — frais texte d’un DICI', () => {
  it('extrait le premier pourcentage', () => {
    expect(parsePctString('3 %')).toBe(3)
    expect(parsePctString('jusqu\'à 5%')).toBe(5)
    expect(parsePctString('2,5 %')).toBe(2.5)
  })

  it('« néant / aucun / sans frais » valent 0', () => {
    expect(parsePctString('Néant')).toBe(0)
    expect(parsePctString('aucun')).toBe(0)
    expect(parsePctString('Sans frais')).toBe(0)
  })

  it('accepte un nombre seul', () => {
    expect(parsePctString('1.8')).toBe(1.8)
    expect(parsePctString('0')).toBe(0)
  })

  it('null si absent ou non interprétable', () => {
    expect(parsePctString(null)).toBeNull()
    expect(parsePctString(undefined)).toBeNull()
    expect(parsePctString('variable selon le support')).toBeNull()
  })
})
