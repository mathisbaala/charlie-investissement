// Vocabulaire des pages Partenaires : depuis l'arrivée des PEA bancaires
// (17/07/2026), la liste mêle des ASSUREURS (AV/capi/PER, supports = unités de
// compte) et des COURTIERS/banques (PEA, supports = fonds et ETF négociables).
// Le vocabulaire assurantiel (« assureur », « unités de compte ») est faux sur
// un PEA Fortuneo — ces helpers choisissent le bon terme.

/** Sociétés référencées qui sont des courtiers/banques, pas des assureurs. */
const BROKER_COMPANIES = new Set([
  "Fortuneo", "Bourse Direct", "BoursoBank", "Linxea",
  "Easybourse", "LCL", "Yomoni", "Caisse d'Épargne", "Banque Populaire", "Trade Republic",
]);

export type PartnerKind = "assureur" | "courtier";

/** Nature du partenaire d'après son nom (défaut : assureur). */
export function partnerKind(company: string): PartnerKind {
  return BROKER_COMPANIES.has((company || "").trim()) ? "courtier" : "assureur";
}

/**
 * Sous-libellé du compteur de supports d'un contrat.
 * PEA chez un courtier → « fonds et ETF négociables » ; tout le reste (AV,
 * capi, PER — y compris les PEA de capitalisation chez un ASSUREUR, qui
 * portent bien des unités de compte) → « unités de compte ».
 */
export function supportsSub(company: string, types: string[]): string {
  const onlyPea = (types ?? []).length > 0 && (types ?? []).every((t) => t === "pea");
  return partnerKind(company) === "courtier" && onlyPea
    ? "fonds et ETF négociables"
    : "unités de compte";
}
