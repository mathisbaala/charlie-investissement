// Helpers partagés du lot C (capitalisation, entreprise, IFI). Rien ici ne
// duplique le socle : uniquement des combinaisons des barèmes de bareme.ts
// utilisées par plusieurs calculateurs du lot.

import {
  abattementDonation,
  abattementSuccession,
  applyBareme,
  baremeForLien,
  type LienParente,
} from "../bareme";

export type ModeTransmission = "donation" | "succession";

export interface DmtgResult {
  droits: number;
  /** Abattement personnel encore disponible (après consommation antérieure). */
  abattement: number;
  /** Base taxable après abattement. */
  taxable: number;
  /** Époux/PACS en succession : exonération totale (796-0 bis). */
  exonere: boolean;
}

/**
 * DMTG sur une base transmise : abattement personnel (donation ou succession
 * selon le mode, diminué de la part déjà consommée — art. 784 CGI) puis barème
 * progressif du lien (art. 777 CGI).
 */
export function droitsDmtg(
  base: number,
  lien: LienParente,
  mode: ModeTransmission,
  abattementConsomme = 0,
): DmtgResult {
  const plein = mode === "donation" ? abattementDonation(lien) : abattementSuccession(lien);
  if (plein === Infinity) {
    // Succession entre époux / partenaires PACS : exonérée (loi TEPA).
    return { droits: 0, abattement: Infinity, taxable: 0, exonere: true };
  }
  const abattement = Math.max(0, plein - Math.max(0, abattementConsomme));
  const taxable = Math.max(0, base - abattement);
  return {
    droits: applyBareme(baremeForLien(lien), taxable).droits,
    abattement,
    taxable,
    exonere: false,
  };
}
