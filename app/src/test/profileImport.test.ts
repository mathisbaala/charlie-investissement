import { describe, it, expect } from 'vitest'
import { fileToParseBody } from '../lib/profileImport'

// fileToParseBody route le fichier vers le bon corps de requête /api/parse-profile
// selon son extension : PDF → document base64, texte/CSV → texte brut.
// (Le branche Excel délègue à la lib `xlsx` chargée dynamiquement — non couvert ici.)

describe('fileToParseBody', () => {
  it('encode un PDF en base64 avec le bon media type', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'profil.pdf', {
      type: 'application/pdf',
    })
    const body = await fileToParseBody(file)
    expect(body.file_type).toBe('application/pdf')
    expect(typeof body.file_base64).toBe('string')
    expect(body.file_base64.length).toBeGreaterThan(0)
    expect(body.text).toBeUndefined()
  })

  it('lit un .txt comme texte brut', async () => {
    const file = new File(['client prudent, PEA, 45 ans'], 'profil.txt', {
      type: 'text/plain',
    })
    const body = await fileToParseBody(file)
    expect(body.text).toBe('client prudent, PEA, 45 ans')
    expect(body.file_base64).toBeUndefined()
  })

  it('traite une extension inconnue comme du texte', async () => {
    const file = new File(['contenu libre'], 'profil.csv', { type: 'text/csv' })
    const body = await fileToParseBody(file)
    expect(body.text).toBe('contenu libre')
  })

  it('détecte l\'extension sans tenir compte de la casse', async () => {
    const file = new File([new Uint8Array([9, 9])], 'PROFIL.PDF', {
      type: 'application/pdf',
    })
    const body = await fileToParseBody(file)
    expect(body.file_type).toBe('application/pdf')
    expect(typeof body.file_base64).toBe('string')
  })
})
