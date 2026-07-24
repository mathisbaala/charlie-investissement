// Libellés des attributs de défiscalisation « private equity » des fonds fiscaux
// (colonnes investissement_funds : tax_scheme / tax_regime_detail). Fonctions
// pures et testées — les cartes (fiche fonds) ne font que mapper ces libellés.

export const TAX_SCHEME_LABEL: Record<string, string> = {
  fip:          "FIP",
  fip_corse:    "FIP Corse",
  fip_outremer: "FIP Outre-mer",
  fcpi:         "FCPI",
  fcpr:         "FCPR",
  fpci:         "FPCI",
};

// Libellé du dispositif ; repli = code en majuscules (jamais masqué).
export function taxSchemeLabel(scheme: string | null | undefined): string | null {
  if (!scheme) return null;
  return TAX_SCHEME_LABEL[scheme.toLowerCase()] ?? scheme.toUpperCase();
}

const TAX_REGIME_LABEL: Record<string, string> = {
  ir_pme:                     "Réduction d'IR à la souscription",
  exoneration_pv:             "Exonération d'impôt sur les plus-values",
  apport_cession_150_0_b_ter: "Remploi apport-cession (150-0 B ter)",
};

// Libellé du régime fiscal ; null si régime inconnu/absent.
export function taxRegimeLabel(regime: string | null | undefined): string | null {
  if (!regime) return null;
  return TAX_REGIME_LABEL[regime] ?? null;
}

// Le dispositif ouvre-t-il droit à une réduction d'IR à la souscription ?
// (Sinon l'avantage porte sur l'exonération des plus-values — FCPR/FPCI.)
export function hasIrReduction(regime: string | null | undefined): boolean {
  return regime === "ir_pme";
}
