// Coût total de détention (CTD) d'un contrat d'assurance-vie / enveloppe.
//
// Un CGP compare des contrats sur le VRAI coût annuel supporté par le client,
// pas sur un seul frais isolé. Le CTD agrège les deux étages de frais :
//   1. les frais courants MOYENS des supports référencés (TER/frais courants,
//      stockés en fraction en base → convertis en % via feeFracToPct) ;
//   2. les frais de gestion du CONTRAT (enveloppe), sourcés si connus
//      (frais_gestion_uc_pct, déjà en %), sinon un indicatif par enveloppe.
//
// On expose la décomposition ET un drapeau « frais contrat sourcé ou indicatif »
// pour que l'affichage puisse marquer une estimation (tilde) sans jamais faire
// passer un ordre de grandeur pour une valeur contractuelle exacte.

import { feeFracToPct } from "@/lib/format";
import type { ContractType } from "@/lib/insurer-envelope";

// Frais de gestion annuels indicatifs du contrat par enveloppe (%/an), repli
// quand la valeur sourcée manque. Alignés sur les défauts de la fiche-contrat :
// AV/Capi ≈ 0,8 %, PER ≈ 0,6 %, PEA = titres en direct (pas de frais d'UC).
export const ENV_INDICATIVE_FEE: Record<ContractType, number> = {
  av: 0.8,
  capi: 0.8,
  per: 0.6,
  pea: 0,
  pep: 0.8,
};

// Frais contrat indicatif d'un contrat multi-enveloppe : on retient le plus élevé
// de ses enveloppes (borne haute honnête). « av » par défaut si aucun type.
export function indicativeContractFee(types: ContractType[] | null | undefined): number {
  const list = types && types.length ? types : (["av"] as ContractType[]);
  return list.reduce((max, t) => Math.max(max, ENV_INDICATIVE_FEE[t] ?? ENV_INDICATIVE_FEE.av), 0);
}

export type ContractCost = {
  // Coût total annuel en % (supports + contrat), null si les frais des supports
  // sont inconnus (pas de moyenne exploitable → CTD non calculable).
  total: number | null;
  // Frais courants moyens des supports, en % (null si absent).
  supportsPct: number | null;
  // Frais de gestion du contrat retenu, en % (sourcé ou indicatif).
  contractPct: number;
  // true si le frais contrat vient d'une valeur sourcée, false s'il est indicatif.
  contractSourced: boolean;
};

/**
 * Calcule le coût total de détention d'un contrat.
 * @param avgFeeFrac  frais courants moyens des supports, en FRACTION (0.008 = 0,8 %)
 * @param fraisGestionUcPct  frais de gestion du contrat sourcé, en % (déjà 0,8), ou null
 * @param types  enveloppe(s) du contrat, pour l'indicatif de repli
 */
export function contractTotalCost(
  avgFeeFrac: number | null | undefined,
  fraisGestionUcPct: number | null | undefined,
  types: ContractType[] | null | undefined,
): ContractCost {
  const supportsPct = feeFracToPct(avgFeeFrac);
  const contractSourced = fraisGestionUcPct != null;
  const contractPct = contractSourced ? Number(fraisGestionUcPct) : indicativeContractFee(types);
  const total =
    supportsPct == null ? null : Math.round((supportsPct + contractPct) * 1e2) / 1e2;
  return { total, supportsPct, contractPct, contractSourced };
}
