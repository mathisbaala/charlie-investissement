import { describe, it, expect } from 'vitest'
import {
  simulate,
  rendementPondere,
  projeterUC,
  partFraisDansGainBrut,
  repartitionFrais,
  reductionRendementAnnuelle,
  remunerationSupport,
  HORIZONS_DEFAUT,
  type SimulationInput,
  type FeeParams,
} from '../lib/feeSimulator'

const SANS_FRAIS: FeeParams = {
  contratEntree: 0, contratGestionUC: 0, contratGestionFE: 0, contratSortie: 0,
  ucEntree: 0, ucGestion: 0, ucSortie: 0,
}

const FRAIS_TYPES: FeeParams = {
  contratEntree: 3, contratGestionUC: 0.8, contratGestionFE: 0.7, contratSortie: 1,
  ucEntree: 0, ucGestion: 1.8, ucSortie: 0,
}

const base: SimulationInput = {
  versementInitial: 10_000,
  versementAnnuel: 0,
  dureeAnnees: 15,
  partUC: 100,
  rendementUC: 5,
  rendementFE: 2.5,
  frais: SANS_FRAIS,
}

describe('simulate — trajectoire nette', () => {
  it('sans aucun frais, 100 % UC = capitalisation simple au rendement net', () => {
    const { points } = simulate(base)
    expect(points[0].valeurNette).toBe(10_000)
    expect(points[5].valeurNette).toBeCloseTo(10_000 * 1.05 ** 5, 1)
    expect(points[15].valeurNette).toBeCloseTo(10_000 * 1.05 ** 15, 1)
    // sans frais, la trajectoire « sans frais » est identique
    expect(points[15].valeurSansFrais).toBeCloseTo(points[15].valeurNette, 6)
    expect(points[15].totalFraisCumules).toBe(0)
  })

  it('100 % fonds euros = capitalisation au taux servi', () => {
    const { points } = simulate({ ...base, partUC: 0 })
    expect(points[10].valeurNette).toBeCloseTo(10_000 * 1.025 ** 10, 1)
    expect(points[10].valeurUC).toBe(0)
  })

  it('le frais de gestion contrat UC dégrade la trajectoire (composé)', () => {
    const { points } = simulate({
      ...base,
      frais: { ...SANS_FRAIS, contratGestionUC: 0.8 },
    })
    const attendu = 10_000 * (1.05 * (1 - 0.008)) ** 10
    expect(points[10].valeurNette).toBeCloseTo(attendu, 1)
  })

  it('le TER ne dégrade PAS la trajectoire nette (déjà dans la VL)', () => {
    const avec = simulate({ ...base, frais: { ...SANS_FRAIS, ucGestion: 1.8 } })
    const sans = simulate(base)
    expect(avec.points[10].valeurNette).toBeCloseTo(sans.points[10].valeurNette, 6)
    // mais il apparaît bien dans les frais cumulés
    expect(avec.points[10].fraisCumules.gestionUC).toBeGreaterThan(0)
  })

  it('frais d’entrée contrat puis UC appliqués en cascade sur le versement', () => {
    const { points } = simulate({
      ...base,
      dureeAnnees: 1,
      frais: { ...SANS_FRAIS, contratEntree: 3, ucEntree: 2 },
    })
    // 10 000 → 300 de frais contrat → 9 700 investis → 194 de frais UC
    expect(points[0].fraisAnnee.entreeContrat).toBe(300)
    expect(points[0].fraisAnnee.entreeUC).toBe(194)
    expect(points[0].valeurNette).toBe(9_506)
  })

  it('les versements annuels alimentent les deux compartiments au prorata', () => {
    const { points } = simulate({
      ...base, versementAnnuel: 1_200, partUC: 60, dureeAnnees: 2,
      rendementUC: 0, rendementFE: 0,
    })
    // an 2 : 10 000 + 2 × 1 200, sans rendement ni frais
    expect(points[2].valeurNette).toBeCloseTo(12_400, 6)
    expect(points[2].valeurUC).toBeCloseTo(12_400 * 0.6, 6)
    expect(points[2].versementsCumules).toBe(12_400)
  })
})

describe('simulate — courbe des frais', () => {
  it('les frais de gestion annuels CROISSENT avec l’encours (effet exponentiel)', () => {
    const { points } = simulate({ ...base, frais: FRAIS_TYPES })
    const g5 = points[5].fraisAnnee.gestionContratUC + points[5].fraisAnnee.gestionUC
    const g15 = points[15].fraisAnnee.gestionContratUC + points[15].fraisAnnee.gestionUC
    expect(g15).toBeGreaterThan(g5)
    // et le cumul est convexe : la 2e moitié coûte plus cher que la 1re
    const c7 = points[7].totalFraisCumules - points[0].totalFraisCumules
    const c15 = points[15].totalFraisCumules - points[7].totalFraisCumules
    expect(c15).toBeGreaterThan(c7)
  })

  it('cohérence : manque à gagner ≥ frais prélevés hors sortie (rendements positifs)', () => {
    // Vrai seulement à rendement positif : chaque euro de frais prélevé aurait
    // composé. À rendement négatif le manque à gagner peut passer SOUS le
    // nominal (le capital retiré aurait fondu) — comportement attendu, non testé
    // comme invariant. fraisSortie est non nul ici (contratSortie 1 %).
    const { horizons } = simulate({ ...base, frais: FRAIS_TYPES })
    const h15 = horizons.find((h) => h.annees === 15)!
    expect(h15.fraisSortie).toBeGreaterThan(0)
    expect(h15.manqueAGagner).toBeGreaterThanOrEqual(h15.totalFrais - h15.fraisSortie)
    expect(h15.valeurSansFrais).toBeGreaterThan(h15.valeurAvantSortie)
  })

  it('poste fonds euros : frais reconstruits sans toucher au taux servi', () => {
    const { points } = simulate({
      ...base, partUC: 0,
      frais: { ...SANS_FRAIS, contratGestionFE: 0.7 },
    })
    expect(points[10].valeurNette).toBeCloseTo(10_000 * 1.025 ** 10, 1)
    expect(points[10].fraisCumules.gestionContratFE).toBeGreaterThan(0)
  })
})

describe('simulate — horizons & sortie', () => {
  it('projette aux horizons standard 5/10/15 bornés à la durée', () => {
    const quinze = simulate(base)
    expect(quinze.horizons.map((h) => h.annees)).toEqual(HORIZONS_DEFAUT)
    const dix = simulate({ ...base, dureeAnnees: 10 })
    expect(dix.horizons.map((h) => h.annees)).toEqual([5, 10])
  })

  it('frais de sortie : UC sur le compartiment UC, contrat sur le reste', () => {
    const { horizons } = simulate({
      ...base, partUC: 100, dureeAnnees: 5, rendementUC: 0,
      frais: { ...SANS_FRAIS, ucSortie: 1, contratSortie: 2 },
    })
    const h5 = horizons[0]
    // 10 000 → sortie UC 100 → 9 900 → sortie contrat 198 → 9 702
    expect(h5.fraisSortie).toBeCloseTo(298, 2)
    expect(h5.valeurNette).toBeCloseTo(9_702, 2)
    expect(h5.gainNet).toBeCloseTo(-298, 2)
  })

  it('gainNet = valeur nette − versements cumulés (exposés sur l’horizon)', () => {
    const { horizons } = simulate({ ...base, versementAnnuel: 1_000, frais: FRAIS_TYPES })
    const h10 = horizons.find((h) => h.annees === 10)!
    expect(h10.versementsCumules).toBe(20_000)
    expect(h10.gainNet).toBeCloseTo(h10.valeurNette - 20_000, 2)
  })

  it('durée minimale forcée à 1 an, part UC bornée 0..100', () => {
    const { points } = simulate({ ...base, dureeAnnees: 0, partUC: 150 })
    expect(points.length).toBe(2) // an 0 + an 1
    expect(points[1].valeurFE).toBe(0)
  })

  it('écarte les horizons < 1 an', () => {
    const { horizons } = simulate(base, [0, -3, 5])
    expect(horizons.map((h) => h.annees)).toEqual([5])
  })

  it('sortie mixte : frais UC sur le compartiment UC, contrat sur le total restant', () => {
    const { horizons } = simulate({
      ...base, partUC: 50, dureeAnnees: 5, rendementUC: 0, rendementFE: 0,
      frais: { ...SANS_FRAIS, ucSortie: 1, contratSortie: 2 },
    }, [5])
    // 5 000 UC + 5 000 FE → sortie UC 50 (sur 5 000 seulement),
    // puis sortie contrat 2 % × (10 000 − 50) = 199 → net 9 751
    const h5 = horizons[0]
    expect(h5.fraisSortie).toBeCloseTo(249, 2)
    expect(h5.valeurNette).toBeCloseTo(9_751, 2)
  })

  it('borne les frais aberrants (≥ 100 %) et les rendements ≤ −100 %', () => {
    // contratGestionUC 150 % : borné à 99,9 → l'encours tend vers 0 sans
    // jamais devenir négatif ni osciller de signe.
    const folle = simulate({
      ...base, dureeAnnees: 3,
      frais: { ...SANS_FRAIS, contratGestionUC: 150 },
    }, [3])
    expect(folle.points[3].valeurNette).toBeGreaterThanOrEqual(0)
    // contratEntree 150 % : borné à 99,9 → investi ≥ 0.
    const entree = simulate({
      ...base, dureeAnnees: 1,
      frais: { ...SANS_FRAIS, contratEntree: 150 },
    }, [1])
    expect(entree.points[0].valeurNette).toBeGreaterThanOrEqual(0)
    // rendement −150 %/an : borné à −99,9 → la valeur reste ≥ 0.
    const krach = simulate({ ...base, dureeAnnees: 2, rendementUC: -150 }, [2])
    expect(krach.points[2].valeurNette).toBeGreaterThanOrEqual(0)
    // NaN (champ vidé côté UI) : neutralisé à 0, pas de contamination.
    const nan = simulate({ ...base, dureeAnnees: 2, rendementUC: NaN }, [2])
    expect(Number.isFinite(nan.points[2].valeurNette)).toBe(true)
  })
})

describe('rendementPondere', () => {
  it('pondère par les poids et ignore les UC sans perf', () => {
    expect(rendementPondere([
      { perf: 10, poids: 50 },
      { perf: 2, poids: 50 },
    ])).toBe(6)
    expect(rendementPondere([
      { perf: 10, poids: 50 },
      { perf: null, poids: 50 },
    ])).toBe(10)
  })

  it('null si aucune perf exploitable ou poids nuls', () => {
    expect(rendementPondere([])).toBeNull()
    expect(rendementPondere([{ perf: null, poids: 100 }])).toBeNull()
    expect(rendementPondere([{ perf: 5, poids: 0 }])).toBeNull()
  })
})

describe('partFraisDansGainBrut', () => {
  it('rapporte le total des frais au gain brut (avant tout frais), en %', () => {
    const { horizons } = simulate({ ...base, frais: FRAIS_TYPES })
    const h10 = horizons.find((h) => h.annees === 10)!
    const gainBrut = h10.valeurSansFrais - h10.versementsCumules
    expect(partFraisDansGainBrut(h10)).toBeCloseTo((h10.totalFrais / gainBrut) * 100, 1)
    expect(partFraisDansGainBrut(h10)!).toBeGreaterThan(0)
  })

  it('peut dépasser 100 % quand les frais mangent plus que le gain brut', () => {
    // Rendement net nul mais TER positif : le brut reconstruit est positif,
    // et les frais prélevés dépassent ce gain brut → ratio > 100 %, affiché.
    const plat = simulate({ ...base, rendementUC: 0, rendementFE: 0, frais: FRAIS_TYPES })
    expect(partFraisDansGainBrut(plat.horizons[0])!).toBeGreaterThan(100)
  })

  it('null si le gain brut est nul ou négatif (pas de croissance brute)', () => {
    // Seuls des frais d'entrée, aucun frais de gestion à reconstruire :
    // la trajectoire brute reste égale aux versements → gain brut nul.
    const nul = simulate({
      ...base, rendementUC: 0, rendementFE: 0,
      frais: { ...SANS_FRAIS, contratEntree: 3 },
    })
    expect(partFraisDansGainBrut(nul.horizons[0])).toBeNull()
    // Marché en perte : gain brut négatif → ratio sans signification.
    const perte = simulate({
      ...base, rendementUC: -5, rendementFE: -1,
      frais: { ...SANS_FRAIS, contratEntree: 3 },
    })
    expect(partFraisDansGainBrut(perte.horizons[0])).toBeNull()
  })
})

describe('rétrocession CGP & répartition des frais', () => {
  it('la rétro suit la même convention que gestionUC et en reste une tranche', () => {
    // TER 1,8 dont 0,9 reversé au cabinet : la rétro cumulée = la moitié
    // exacte des frais courants cumulés, à l'arrondi près.
    const sim = simulate({ ...base, frais: FRAIS_TYPES, retroCgp: 0.9 })
    const p = sim.points[15]
    expect(p.retroCgpCumulee).toBeGreaterThan(0)
    expect(p.retroCgpCumulee).toBeCloseTo(p.fraisCumules.gestionUC / 2, 0)
    // reportée sur les horizons
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(h.retroCgpCumulee).toBe(p.retroCgpCumulee)
  })

  it('bornée aux frais courants (une rétro > TER est plafonnée)', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES, retroCgp: 99 })
    const p = sim.points[15]
    expect(p.retroCgpCumulee).toBeLessThanOrEqual(p.fraisCumules.gestionUC + 0.01)
  })

  it('absente ou nulle → 0, sans toucher au reste de la simulation', () => {
    const avec = simulate({ ...base, frais: FRAIS_TYPES, retroCgp: 0.9 })
    const sans = simulate({ ...base, frais: FRAIS_TYPES })
    expect(sans.points[15].retroCgpCumulee).toBe(0)
    // la rétro est une tranche des frais existants, jamais un frais en plus
    expect(avec.points[15].valeurNette).toBe(sans.points[15].valeurNette)
    expect(avec.points[15].totalFraisCumules).toBe(sans.points[15].totalFraisCumules)
  })

  it('répartition par destinataire : assureur + société de gestion + cabinet = total frais', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES, retroCgp: 0.9 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    const p = sim.points[15]
    const r = repartitionFrais(p.fraisCumules, h, p.retroCgpCumulee)
    expect(r.assureur).toBeGreaterThan(0)
    expect(r.societeGestion).toBeGreaterThan(0)
    expect(r.cabinet).toBeGreaterThan(0)
    expect(r.assureur + r.societeGestion + r.cabinet).toBeCloseTo(h.totalFrais, 0)
    // la rétro sort de la poche société de gestion, pas de celle du client
    const sansRetro = repartitionFrais(p.fraisCumules, h, 0)
    expect(sansRetro.cabinet).toBe(0)
    expect(sansRetro.societeGestion).toBeCloseTo(r.societeGestion + r.cabinet, 1)
    expect(sansRetro.assureur).toBe(r.assureur)
  })
})

describe('commission upfront du cabinet', () => {
  it('cumule une tranche des frais d’entrée, sans toucher à la trajectoire', () => {
    // Frais d'entrée contrat 3 %, commission cabinet 2 % du versement.
    const avec = simulate({ ...base, frais: FRAIS_TYPES, commissionCabinet: 2 })
    const sans = simulate({ ...base, frais: FRAIS_TYPES })
    // 10 000 € versés une fois → 200 € de commission upfront, dès l'an 0.
    expect(avec.points[0].commCabinetCumulee).toBeCloseTo(200, 2)
    expect(avec.points[15].commCabinetCumulee).toBeCloseTo(200, 2)
    // c'est une répartition, jamais un frais en plus : valeur et total frais inchangés
    expect(avec.points[15].valeurNette).toBe(sans.points[15].valeurNette)
    expect(avec.points[15].totalFraisCumules).toBe(sans.points[15].totalFraisCumules)
    // reportée sur les horizons
    const h = avec.horizons.find((x) => x.annees === 15)!
    expect(h.commCabinetCumulee).toBeCloseTo(200, 2)
  })

  it('s’applique à chaque versement (initial + annuels)', () => {
    const sim = simulate({
      ...base, versementAnnuel: 1_000, dureeAnnees: 3,
      frais: FRAIS_TYPES, commissionCabinet: 2,
    }, [3])
    // 10 000 (an 0) + 3 × 1 000 (an 1-3) = 13 000 versés → 2 % = 260 €.
    expect(sim.points[3].commCabinetCumulee).toBeCloseTo(260, 2)
  })

  it('plafonnée aux frais d’entrée du contrat (ne peut pas les dépasser)', () => {
    // Commission 5 % mais frais d'entrée contrat 3 % → plafonnée à 3 %.
    const sim = simulate({ ...base, frais: FRAIS_TYPES, commissionCabinet: 5 }, [1])
    expect(sim.points[0].commCabinetCumulee).toBeCloseTo(10_000 * 0.03, 2)
  })

  it('absente ou nulle → 0', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES })
    expect(sim.points[0].commCabinetCumulee).toBe(0)
    expect(sim.horizons[0].commCabinetCumulee).toBe(0)
  })

  it('répartition : la commission upfront sort de la poche assureur, va au cabinet', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    const p = sim.points[15]
    const avecComm = repartitionFrais(p.fraisCumules, h, p.retroCgpCumulee, p.commCabinetCumulee)
    const sansComm = repartitionFrais(p.fraisCumules, h, p.retroCgpCumulee)
    // le cabinet gagne la commission en plus, l'assureur la perd d'autant
    expect(avecComm.cabinet).toBeCloseTo(sansComm.cabinet + p.commCabinetCumulee, 1)
    expect(avecComm.assureur).toBeCloseTo(sansComm.assureur - p.commCabinetCumulee, 1)
    // total conservé
    expect(avecComm.assureur + avecComm.societeGestion + avecComm.cabinet).toBeCloseTo(h.totalFrais, 0)
  })
})

describe('part frais de gestion contrat reversée au cabinet', () => {
  it('cumule un flux positif, sans toucher à la trajectoire (répartition)', () => {
    const avec = simulate({ ...base, frais: FRAIS_TYPES, contractFeeShare: 0.4 })
    const sans = simulate({ ...base, frais: FRAIS_TYPES })
    expect(avec.points[15].contractFeeCumulee).toBeGreaterThan(0)
    // pas un frais en plus : valeur nette et total des frais inchangés
    expect(avec.points[15].valeurNette).toBe(sans.points[15].valeurNette)
    expect(avec.points[15].totalFraisCumules).toBe(sans.points[15].totalFraisCumules)
    // reportée sur les horizons
    const h = avec.horizons.find((x) => x.annees === 15)!
    expect(h.contractFeeCumulee).toBeCloseTo(avec.points[15].contractFeeCumulee, 2)
  })

  it('croît avec le taux et avec le temps', () => {
    const bas = simulate({ ...base, frais: FRAIS_TYPES, contractFeeShare: 0.2 })
    const haut = simulate({ ...base, frais: FRAIS_TYPES, contractFeeShare: 0.5 })
    expect(haut.points[15].contractFeeCumulee).toBeGreaterThan(bas.points[15].contractFeeCumulee)
    expect(haut.points[15].contractFeeCumulee).toBeGreaterThan(haut.points[5].contractFeeCumulee)
  })

  it('absente ou nulle → 0', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES })
    expect(sim.points[15].contractFeeCumulee).toBe(0)
    expect(sim.horizons.find((x) => x.annees === 15)!.contractFeeCumulee).toBe(0)
  })

  it('répartition : la part contrat sort de la poche assureur, va au cabinet, total conservé', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2, contractFeeShare: 0.4 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    const p = sim.points[15]
    const avec = repartitionFrais(p.fraisCumules, h, p.retroCgpCumulee, p.commCabinetCumulee, p.contractFeeCumulee)
    const sans = repartitionFrais(p.fraisCumules, h, p.retroCgpCumulee, p.commCabinetCumulee)
    const cf = Math.min(p.contractFeeCumulee, p.fraisCumules.gestionContratUC + p.fraisCumules.gestionContratFE)
    // le cabinet gagne la part contrat en plus, l'assureur la perd d'autant
    expect(avec.cabinet).toBeCloseTo(sans.cabinet + cf, 1)
    expect(avec.assureur).toBeCloseTo(sans.assureur - cf, 1)
    // total conservé
    expect(avec.assureur + avec.societeGestion + avec.cabinet).toBeCloseTo(h.totalFrais, 0)
  })
})

describe('rétrocession fonds euros', () => {
  it('cumule un flux sur le compartiment euros, sans toucher la trajectoire', () => {
    const avec = simulate({ ...base, partUC: 50, frais: FRAIS_TYPES, eurosRetroShare: 0.2 })
    const sans = simulate({ ...base, partUC: 50, frais: FRAIS_TYPES })
    expect(avec.points[15].eurosRetroCumulee).toBeGreaterThan(0)
    // répartition, pas un frais en plus : valeur nette et total frais inchangés
    expect(avec.points[15].valeurNette).toBe(sans.points[15].valeurNette)
    expect(avec.points[15].totalFraisCumules).toBe(sans.points[15].totalFraisCumules)
    // reportée sur les horizons
    const h = avec.horizons.find((x) => x.annees === 15)!
    expect(h.eurosRetroCumulee).toBeCloseTo(avec.points[15].eurosRetroCumulee, 2)
  })

  it('nulle quand tout est en UC (pas de compartiment euros)', () => {
    const sim = simulate({ ...base, partUC: 100, frais: FRAIS_TYPES, eurosRetroShare: 0.3 })
    expect(sim.points[15].eurosRetroCumulee).toBe(0)
  })

  it('plafonnée aux frais de gestion du contrat sur le fonds euros', () => {
    const sim = simulate({ ...base, partUC: 50, frais: FRAIS_TYPES, eurosRetroShare: 99 })
    const p = sim.points[15]
    expect(p.eurosRetroCumulee).toBeLessThanOrEqual(p.fraisCumules.gestionContratFE + 0.01)
  })

  it('part gestion contrat + rétro euros réunies ≤ frais de gestion du contrat (cap conjoint)', () => {
    const sim = simulate({ ...base, partUC: 50, frais: FRAIS_TYPES, contractFeeShare: 99, eurosRetroShare: 99 })
    const p = sim.points[15]
    const capContrat = p.fraisCumules.gestionContratUC + p.fraisCumules.gestionContratFE
    expect(p.contractFeeCumulee + p.eurosRetroCumulee).toBeLessThanOrEqual(capContrat + 0.02)
  })

  it('répartition : la rétro euros sort de la poche assureur, va au cabinet, total conservé', () => {
    const sim = simulate({ ...base, partUC: 50, frais: FRAIS_TYPES, retroCgp: 0.9, eurosRetroShare: 0.2 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    const p = sim.points[15]
    const avec = repartitionFrais(p.fraisCumules, h, p.retroCgpCumulee, p.commCabinetCumulee, p.contractFeeCumulee, p.eurosRetroCumulee)
    const sans = repartitionFrais(p.fraisCumules, h, p.retroCgpCumulee, p.commCabinetCumulee, p.contractFeeCumulee)
    expect(avec.cabinet).toBeCloseTo(sans.cabinet + p.eurosRetroCumulee, 1)
    expect(avec.assureur).toBeCloseTo(sans.assureur - p.eurosRetroCumulee, 1)
    expect(avec.assureur + avec.societeGestion + avec.cabinet).toBeCloseTo(h.totalFrais, 0)
  })

  it('revenuCabinet inclut la rétro euros (5 composantes)', () => {
    const sim = simulate({ ...base, partUC: 50, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2, contractFeeShare: 0.2, eurosRetroShare: 0.2, honoraireForfait: 200 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(h.revenuCabinet).toBeCloseTo(
      h.retroCgpCumulee + h.commCabinetCumulee + h.contractFeeCumulee + h.eurosRetroCumulee + h.honoraireCumule, 2)
  })
})

describe('part gestion contrat — plafond sur les frais de gestion du contrat (UC + FE)', () => {
  it('plafonne l’accrual à la somme gestion contrat UC + FE (jamais plus que ce que le contrat prélève)', () => {
    // Taux délirant (99 %) : la part reversée est bornée aux frais de gestion
    // du contrat cumulés (UC + fonds euros), pas davantage. Mix UC/FE pour
    // exercer les DEUX jambes de l'assiette.
    const sim = simulate({ ...base, partUC: 60, frais: FRAIS_TYPES, contractFeeShare: 99 })
    const p = sim.points[15]
    const capGestionContrat = p.fraisCumules.gestionContratUC + p.fraisCumules.gestionContratFE
    expect(p.contractFeeCumulee).toBeLessThanOrEqual(capGestionContrat + 0.01)
    expect(p.contractFeeCumulee).toBeGreaterThan(0)
  })

  it('remuTotale (revenuCabinet) et repart.cabinet restent cohérents même à taux élevé', () => {
    // Régression : avant le plafond d'accrual, contractFeeCumulee (non plafonné)
    // gonflait revenuCabinet au-delà de la poche cabinet de la répartition.
    const sim = simulate({ ...base, partUC: 60, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2, contractFeeShare: 5 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    const p = sim.points[15]
    const r = repartitionFrais(p.fraisCumules, h, p.retroCgpCumulee, p.commCabinetCumulee, p.contractFeeCumulee)
    expect(h.revenuCabinet).toBeCloseTo(r.cabinet, 1)
  })
})

describe('honoraires de conseil (facturés en sus)', () => {
  it('forfait à la souscription + récurrent sur l’encours, sans toucher la trajectoire du contrat', () => {
    const avec = simulate({ ...base, frais: FRAIS_TYPES, honoraireForfait: 500, honoraireAnnuelPct: 0.5 })
    const sans = simulate({ ...base, frais: FRAIS_TYPES })
    // Le forfait est prélevé dès l'an 0.
    expect(avec.points[0].honoraireCumule).toBeCloseTo(500, 2)
    // La valeur nette du CONTRAT est strictement inchangée (facturés à côté).
    expect(avec.points[15].valeurNette).toBe(sans.points[15].valeurNette)
    expect(avec.points[15].totalFraisCumules).toBe(sans.points[15].totalFraisCumules)
    // Le récurrent s'accumule au-delà du forfait.
    expect(avec.points[15].honoraireCumule).toBeGreaterThan(500)
  })

  it('récurrent = somme de l’encours net annuel × taux (an 1..N)', () => {
    const annuelPct = 0.5
    const sim = simulate({ ...base, frais: FRAIS_TYPES, honoraireForfait: 0, honoraireAnnuelPct: annuelPct })
    const attendu = sim.points.slice(1).reduce((s, p) => s + p.valeurNette * (annuelPct / 100), 0)
    expect(sim.points[15].honoraireCumule).toBeCloseTo(attendu, 1)
  })

  it('absents → 0 (aucune régression)', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES })
    expect(sim.points[15].honoraireCumule).toBe(0)
    expect(sim.horizons.find((x) => x.annees === 15)!.honoraireCumule).toBe(0)
  })
})

describe('agrégats revenuCabinet & coutTotalClient (source unique UI/PDF)', () => {
  it('revenuCabinet = rétro + commission + part gestion contrat + honoraires', () => {
    const sim = simulate({ ...base, partUC: 60, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2, contractFeeShare: 0.3, honoraireForfait: 300, honoraireAnnuelPct: 0.2 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(h.revenuCabinet).toBeCloseTo(
      h.retroCgpCumulee + h.commCabinetCumulee + h.contractFeeCumulee + h.honoraireCumule, 2)
  })

  it('coutTotalClient = total des frais (structure) + honoraires', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES, honoraireForfait: 300, honoraireAnnuelPct: 0.2 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(h.coutTotalClient).toBeCloseTo(h.totalFrais + h.honoraireCumule, 2)
  })

  it('sans honoraires, coutTotalClient = totalFrais et revenuCabinet = poche cabinet structure', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(h.coutTotalClient).toBe(h.totalFrais)
    expect(h.revenuCabinet).toBeCloseTo(h.retroCgpCumulee + h.commCabinetCumulee, 2)
  })

  it('découpage upfront/récurrent : somme = revenuCabinet', () => {
    const sim = simulate({ ...base, partUC: 60, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2, contractFeeShare: 0.3, honoraireForfait: 300, honoraireAnnuelPct: 0.2 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(h.revenuCabinetUpfront + h.revenuCabinetRecurrent).toBeCloseTo(h.revenuCabinet, 2)
  })

  it('upfront = commission d\'entrée + forfait honoraire ; récurrent = rétro + honoraire annuel', () => {
    const sim = simulate({ ...base, partUC: 60, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2, contractFeeShare: 0.3, honoraireForfait: 300, honoraireAnnuelPct: 0.2 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(h.revenuCabinetUpfront).toBeCloseTo(h.commCabinetCumulee + 300, 2)
    expect(h.revenuCabinetRecurrent).toBeCloseTo(
      h.retroCgpCumulee + h.contractFeeCumulee + h.eurosRetroCumulee + (h.honoraireCumule - 300), 2)
  })

  it('sans upfront (ni commission ni forfait), tout le revenu cabinet est récurrent', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES, retroCgp: 0.9, honoraireAnnuelPct: 0.2 })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(h.revenuCabinetUpfront).toBe(0)
    expect(h.revenuCabinetRecurrent).toBeCloseTo(h.revenuCabinet, 2)
  })

  it('YearPoint : le récurrent est nul à l\'année 0, non nul dès l\'année 1', () => {
    const sim = simulate({ ...base, partUC: 60, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2, honoraireForfait: 300, honoraireAnnuelPct: 0.2 })
    expect(sim.points[0].revenuCabinetRecurrent).toBe(0)
    expect(sim.points[1].revenuCabinetRecurrent).toBeGreaterThan(0)
    // l'upfront (commission + forfait) est déjà là dès l'année 0
    expect(sim.points[0].revenuCabinetUpfront).toBeGreaterThan(0)
  })

  it('YearPoint : upfront + récurrent = poche cabinet cumulée à ce point', () => {
    const sim = simulate({ ...base, partUC: 60, frais: FRAIS_TYPES, retroCgp: 0.9, commissionCabinet: 2, contractFeeShare: 0.3, honoraireForfait: 300, honoraireAnnuelPct: 0.2 })
    const p = sim.points[5]
    expect(p.revenuCabinetUpfront + p.revenuCabinetRecurrent).toBeCloseTo(
      p.retroCgpCumulee + p.commCabinetCumulee + p.contractFeeCumulee + p.eurosRetroCumulee + p.honoraireCumule, 2)
  })
})

describe('reductionRendementAnnuelle — RIY PRIIPs (différence arithmétique)', () => {
  it('= rendement annualisé brut − rendement annualisé net (base versements)', () => {
    const sim = simulate({ ...base, frais: FRAIS_TYPES })
    const h = sim.horizons.find((x) => x.annees === 15)!
    const rBrut = Math.pow(h.valeurSansFrais / h.versementsCumules, 1 / h.annees) - 1
    const rNet = Math.pow(h.valeurNette / h.versementsCumules, 1 / h.annees) - 1
    expect(reductionRendementAnnuelle(h)).toBeCloseTo((rBrut - rNet) * 100, 2)
    expect(reductionRendementAnnuelle(h)).toBeGreaterThan(0)
  })

  it('nulle sans aucun frais', () => {
    const sim = simulate({ ...base, frais: SANS_FRAIS })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(reductionRendementAnnuelle(h)).toBeCloseTo(0, 2)
  })

  it('0 si versements cumulés nuls (garde-fou)', () => {
    const sim = simulate({ ...base, versementInitial: 0, versementAnnuel: 0, frais: FRAIS_TYPES })
    const h = sim.horizons.find((x) => x.annees === 15)!
    expect(reductionRendementAnnuelle(h)).toBe(0)
  })
})

describe('remunerationSupport', () => {
  it('rétro annuelle et commission upfront sur le montant investi', () => {
    const r = remunerationSupport(20_000, 0.9, 2)
    expect(r.retroAnnuelle).toBeCloseTo(180, 2)      // 0,9 % de 20 000
    expect(r.commissionUpfront).toBeCloseTo(400, 2)  // 2 % de 20 000
  })

  it('taux absents ou montant invalide → 0', () => {
    expect(remunerationSupport(20_000, null, undefined)).toEqual({ retroAnnuelle: 0, commissionUpfront: 0 })
    expect(remunerationSupport(-5, 0.9, 2)).toEqual({ retroAnnuelle: 0, commissionUpfront: 0 })
    expect(remunerationSupport(NaN, 0.9, 2)).toEqual({ retroAnnuelle: 0, commissionUpfront: 0 })
  })
})

describe('projeterUC', () => {
  it('capitalise au rendement net dégradé du frais contrat', () => {
    const sansFrais = projeterUC(5, 0, 10_000, 5)!
    expect(sansFrais).toBeCloseTo(10_000 * 1.05 ** 5, 1)
    const avecFrais = projeterUC(5, 0.8, 10_000, 5)!
    expect(avecFrais).toBeCloseTo(10_000 * (1.05 * 0.992) ** 5, 1)
    expect(avecFrais).toBeLessThan(sansFrais)
  })

  it('null si perf absente', () => {
    expect(projeterUC(null, 0.8, 10_000, 5)).toBeNull()
    expect(projeterUC(undefined, 0.8, 10_000, 5)).toBeNull()
  })
})
