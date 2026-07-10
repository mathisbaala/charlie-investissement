// Univers de fonds d'EXEMPLE pour la démo de la plateforme d'allocation, quand
// aucune base n'est branchée (pas de secrets Supabase). Chiffres plausibles mais
// illustratifs — À NE PAS confondre avec les données réelles du contrat. En
// production, cet univers est remplacé par les fonds du contrat
// (investissement_funds_cgp_ref) via /api/portfolio/optimize.

import type { FundInput, AssetClass } from "./optimizer";

export const SAMPLE_CONTRACT = "Contrat démo::Cardif Elite Lux (exemple)";

export const SAMPLE_UNIVERSE: FundInput[] = [
  // Actions
  { isin: "LU1135865084", name: "Amundi S&P 500 UCITS ETF", assetClass: "actions", category: "Actions USA", expectedReturn: 0.162, volatility: 0.17, sri: 5, sfdr: 6, ter: 0.0015, gestionnaire: "Amundi" },
  { isin: "IE00B4L5Y983", name: "iShares Core MSCI World ETF", assetClass: "actions", category: "Actions Monde", expectedReturn: 0.14, volatility: 0.16, sri: 5, sfdr: 6, ter: 0.002, gestionnaire: "BlackRock" },
  { isin: "LU0115773425", name: "Fidelity Global Technology", assetClass: "actions", category: "Actions Technologie", expectedReturn: 0.188, volatility: 0.21, sri: 4, sfdr: 8, ter: 0.010, gestionnaire: "Fidelity" },
  { isin: "LU1897556517", name: "Groupama Global Disruption", assetClass: "actions", category: "Actions Disruption", expectedReturn: 0.177, volatility: 0.22, sri: 5, sfdr: 9, ter: 0.018, gestionnaire: "Groupama AM" },
  { isin: "LU1876459303", name: "Axiom European Banks Equity", assetClass: "actions", category: "Actions Europe Financières", expectedReturn: 0.26, volatility: 0.24, sri: 6, sfdr: 8, ter: 0.0185, gestionnaire: "Axiom AI" },
  { isin: "FR0010655746", name: "Moneta Multi Caps", assetClass: "actions", category: "Actions France", expectedReturn: 0.09, volatility: 0.15, sri: 4, sfdr: 8, ter: 0.017, gestionnaire: "Moneta AM" },
  // Diversifiés / flexibles
  { isin: "FR0011261197", name: "R-co Valor", assetClass: "diversifie", category: "Allocation Flexible", expectedReturn: 0.075, volatility: 0.11, sri: 4, sfdr: 8, ter: 0.015, gestionnaire: "Rothschild & Co" },
  { isin: "LU0171283459", name: "BGF Global Allocation", assetClass: "diversifie", category: "Multi-actifs Monde", expectedReturn: 0.071, volatility: 0.10, sri: 4, sfdr: 6, ter: 0.0175, gestionnaire: "BlackRock" },
  { isin: "FR0010097642", name: "CPR Croissance Dynamique", assetClass: "diversifie", category: "Allocation Flexible", expectedReturn: 0.082, volatility: 0.12, sri: 4, sfdr: 8, ter: 0.018, gestionnaire: "CPR AM" },
  // Obligations
  { isin: "LU1164219682", name: "AXA WF Euro Credit Total Return", assetClass: "obligations", category: "Obligations Crédit", expectedReturn: 0.047, volatility: 0.05, sri: 3, sfdr: 8, ter: 0.0075, gestionnaire: "AXA IM" },
  { isin: "FR0010230490", name: "Lazard Credit Opportunities", assetClass: "obligations", category: "Obligations Crédit", expectedReturn: 0.045, volatility: 0.055, sri: 3, sfdr: 8, ter: 0.0085, gestionnaire: "Lazard Frères Gestion" },
  { isin: "LU1694789535", name: "DNCA Invest Alpha Bonds", assetClass: "obligations", category: "Obligations Flexibles", expectedReturn: 0.035, volatility: 0.04, sri: 2, sfdr: 8, ter: 0.010, gestionnaire: "DNCA Finance" },
  // Monétaire
  { isin: "FR0013267663", name: "Hugau Moneterme", assetClass: "monetaire", category: "Monétaire", expectedReturn: 0.033, volatility: 0.005, sri: 1, sfdr: 8, ter: 0.001, gestionnaire: "Hugau Gestion" },
  // Immobilier
  { isin: "FR0011871128", name: "SCPI Primovie (part démo)", assetClass: "immobilier", category: "SCPI Santé/Éducation", expectedReturn: 0.045, volatility: 0.07, sri: 3, sfdr: 8, ter: 0.012, gestionnaire: "Primonial REIM" },
];

// Corrélation d'exemple, pilotée par les classes d'actifs (réaliste et stable) :
// forte intra-actions, modérée intra-obligations, faible inter-classes, monétaire
// quasi décorrélé. Remplacée en production par le RPC inv_fund_correlation.
const INTRA: Partial<Record<AssetClass, number>> = {
  actions: 0.78,
  obligations: 0.45,
  diversifie: 0.6,
  immobilier: 0.3,
};
const INTER: Record<string, number> = {
  "actions|diversifie": 0.6,
  "actions|obligations": 0.1,
  "actions|immobilier": 0.2,
  "obligations|diversifie": 0.35,
  "obligations|immobilier": 0.25,
  "diversifie|immobilier": 0.3,
};

export function sampleCorrelation(a: string, b: string): number | null {
  if (a === b) return 1;
  const fa = SAMPLE_UNIVERSE.find((f) => f.isin === a);
  const fb = SAMPLE_UNIVERSE.find((f) => f.isin === b);
  if (!fa || !fb) return null;
  if (fa.assetClass === "monetaire" || fb.assetClass === "monetaire") return 0.02;
  if (fa.assetClass === fb.assetClass) return INTRA[fa.assetClass] ?? 0.4;
  const key = [fa.assetClass, fb.assetClass].sort().join("|");
  return INTER[key] ?? 0.15;
}
