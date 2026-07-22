// Helpers partagés du lot A (calculateurs de transmission). Uniquement de la
// mécanique commune de liquidation DMTG : abattement personnel restant selon le
// mode (donation/succession) puis barème progressif du lien. Aucun barème ici —
// tout vient de bareme.ts, source unique de vérité des valeurs légales.

import {
  applyBareme,
  baremeForLien,
  abattementDonation,
  abattementSuccession,
  type LienParente,
  type TrancheDetail,
} from "../bareme";

export type ModeMutation = "donation" | "succession";

/**
 * Abattement personnel restant : plein selon lien/mode, amputé de la part déjà
 * consommée par des donations de moins de 15 ans (rappel fiscal, art. 784 CGI).
 * Époux/PACS en succession : abattementSuccession renvoie Infinity (exonération
 * TEPA) — Infinity moins un consommé fini reste Infinity, ce qui est voulu.
 */
export function abattementRestant(lien: LienParente, mode: ModeMutation, consomme: number): number {
  const plein = mode === "donation" ? abattementDonation(lien) : abattementSuccession(lien);
  return Math.max(0, plein - Math.max(0, consomme));
}

export interface DmtgResult {
  droits: number;
  detail: TrancheDetail[];
  /** Base taxable après abattement. */
  taxable: number;
  /** Abattement effectivement imputé (borné par la base). */
  abattementApplique: number;
}

/**
 * Liquidation DMTG standard pour une base donnée : abattement restant du lien
 * puis barème art. 777. Base exonérée (abattement infini) → 0 partout.
 */
export function dmtgPourBase(
  lien: LienParente,
  mode: ModeMutation,
  base: number,
  consomme: number,
): DmtgResult {
  const abattement = abattementRestant(lien, mode, consomme);
  const taxable = Number.isFinite(abattement) ? Math.max(0, base - abattement) : 0;
  const { droits, detail } = applyBareme(baremeForLien(lien), taxable);
  return { droits, detail, taxable, abattementApplique: Math.min(abattement, Math.max(0, base)) };
}
