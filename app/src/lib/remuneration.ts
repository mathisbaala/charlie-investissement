// ─── Rémunération cabinet & coût client d'un portefeuille (moteur pur) ─────────
//
// À partir d'un portefeuille (existant, déposé, ou construit) et du BARÈME du
// cabinet (conventions saisies dans « Mon cabinet », cf. lib/cabinet.ts), on
// déduit en miroir :
//   • côté CLIENT — le coût total de détention (CTD) : frais courants moyens des
//     supports + frais de gestion du contrat (cf. lib/av-cost) ;
//   • côté CABINET — ce que le portefeuille RAPPORTE au CGP : la part récurrente
//     (rétrocessions sur encours UC via la cascade du barème + part des frais de
//     gestion du contrat) et la part ponctuelle (frais d'entrée reversés).
//
// C'est la brique « traçabilité par portefeuille » : elle répond à « combien ce
// portefeuille coûte au client, combien il me rapporte, et quelle part du coût
// client je capte ». Fonction PURE (aucun réseau/DB) : l'appelant fournit les
// supports valorisés et la convention résolue.
//
// Conventions d'unités : tous les taux internes sont en FRACTION (0,018 = 1,8 %),
// alignés sur lib/cabinet (parts et rétrocessions) et lib/av-cost. Les montants
// sont en euros. Les pourcentages ne sont produits qu'en SORTIE (champs *Pct).

import {
  resolveFundRetrocession,
  resolveUcRetroShare,
  hasAnyConvention,
  type CabinetContract,
} from "@/lib/cabinet";
import { contractTotalCost } from "@/lib/av-cost";
import type { ContractType } from "@/lib/insurer-envelope";

/**
 * Rétrocession de place ESTIMÉE d'un fonds, en fraction d'encours/an, tant que la
 * convention réelle du cabinet ne couvre pas la ligne. Règle de marché unique
 * (source de vérité, réutilisée par estimateRetrocession) : la gestion passive
 * (ETF/indiciel) ne rétrocède rien ; la gestion active rétrocède ~50 % de ses
 * frais courants au distributeur. `null` si les frais sont inconnus.
 */
export function estimateRetroFrac(
  feesFrac: number | null | undefined,
  productType: string | null | undefined,
  managementStyle: string | null | undefined,
): number | null {
  const style = (managementStyle ?? "").trim().toLowerCase();
  const product = (productType ?? "").trim().toLowerCase();
  if (style.includes("passi") || style.includes("indiciel") || product === "etf") return 0;
  if (feesFrac == null || !Number.isFinite(feesFrac)) return null;
  return feesFrac * 0.5;
}

/**
 * Rétrocession de repli d'un fonds (fraction/an), utilisée quand le barème du
 * cabinet ne fixe pas de taux pour la ligne : la valeur SOURCÉE en base
 * (`retrocession_cgp`) fait foi si présente, sinon l'estimation de place. Sert à
 * enrichir une position (relevé déposé ou ajout manuel) d'un repli honnête.
 */
export function retroFallbackFrac(
  retrocessionCgpFrac: number | null | undefined,
  feesFrac: number | null | undefined,
  productType: string | null | undefined,
  managementStyle: string | null | undefined,
): number | null {
  if (retrocessionCgpFrac != null && Number.isFinite(retrocessionCgpFrac)) {
    return retrocessionCgpFrac;
  }
  return estimateRetroFrac(feesFrac, productType, managementStyle);
}

/** Un support valorisé en ENTRÉE du calcul de rémunération. */
export interface RemuHolding {
  isin: string;
  name: string;
  /** Montant investi sur la ligne (€). */
  amount: number;
  /** Frais courants du support, en FRACTION (0,018 = 1,8 %) ; null si inconnu. */
  terFrac: number | null;
  /** Rétrocession de repli du fonds (fraction/an), hors convention ; null si inconnue. */
  retroFallbackFrac: number | null;
}

/** Détail de rémunération d'une ligne. */
export interface RemuLine {
  isin: string;
  name: string;
  amount: number;
  /** Rétrocession retenue par la cascade (fraction/an), null si aucune donnée. */
  retroFrac: number | null;
  /** Rétrocession récurrente de la ligne (€/an). */
  retroAnnual: number;
  /** true si le taux vient de la convention cabinet, false si estimation de place. */
  sourced: boolean;
}

export interface Remuneration {
  // ── Côté cabinet (ce que le portefeuille rapporte) ──
  /** Rémunération récurrente totale (€/an) = rétro UC + part frais de gestion contrat. */
  recurringAnnual: number;
  /** Part « rétrocessions UC » du récurrent (€/an). */
  ucAnnual: number;
  /** Part « frais de gestion du contrat » du récurrent (€/an). */
  contractAnnual: number;
  /** Frais d'entrée reversés, versés UNE fois à la souscription (€). */
  entryOnce: number;
  /** Taux de rétro cabinet = récurrent / encours (%), null si encours nul. */
  retroRatePct: number | null;
  // ── Côté client (ce que le portefeuille coûte) ──
  /** Coût total de détention (CTD), %/an (frais fonds + frais contrat) ; null si TER inconnu. */
  clientCostPct: number | null;
  /** Coût client annualisé (€/an) ; null si CTD non calculable. */
  clientCostAnnual: number | null;
  /** Frais courants moyens des supports, %/an (part « société de gestion »). */
  supportsPct: number | null;
  /** Frais de gestion du contrat retenu, %/an (part « assureur »). */
  contractPct: number;
  /** true si le frais contrat est sourcé, false s'il est indicatif (repli enveloppe). */
  contractSourced: boolean;
  /** Part du coût client captée par le cabinet = récurrent / coût client (%). */
  captureSharePct: number | null;
  // ── Détail & qualité ──
  lines: RemuLine[];
  /** Encours total pris en compte (€). */
  totalAmount: number;
  /** true si au moins un taux du barème cabinet s'applique. */
  hasConvention: boolean;
  /** Nombre de lignes sans rétrocession exploitable (ni convention ni repli). */
  unknownRetroLines: number;
}

/**
 * Calcule la rémunération cabinet et le coût client d'un portefeuille valorisé,
 * selon la convention du cabinet (barème « Mon cabinet ») et un repli de place.
 *
 * Cascade de rétrocession par ligne (via lib/cabinet.resolveFundRetrocession) :
 *   exception par fonds → taux UC du contrat → repli (retroFallbackFrac).
 * La part des frais de gestion du contrat et les frais d'entrée reversés
 * s'appliquent à l'encours total (uniformes sur le contrat). Aucun double
 * comptage : la rétro est toujours une tranche du coût client (cf. mapping).
 *
 * @param holdings  supports valorisés (montant + frais)
 * @param convention  convention du contrat, ou null (repli de place seul)
 * @param opts.terMoyenPct  frais courants moyens pondérés du portefeuille (%), pour le CTD
 * @param opts.contractTypes  enveloppe(s) du contrat, pour l'indicatif de frais contrat
 */
export function buildRemuneration(
  holdings: RemuHolding[],
  convention: CabinetContract | null,
  opts: { terMoyenPct: number | null; contractTypes?: ContractType[] | null },
): Remuneration {
  const totalAmount = holdings.reduce((s, h) => s + (h.amount > 0 ? h.amount : 0), 0);

  const lines: RemuLine[] = holdings.map((h) => {
    const retroFrac = resolveFundRetrocession(
      convention, h.isin, h.terFrac, h.retroFallbackFrac,
    );
    // « Sourcé » = un taux du barème s'applique à la ligne (exception fonds ou
    // taux UC du contrat) ET on a des frais pour l'asseoir. Sinon = estimation.
    const sourced =
      resolveUcRetroShare(convention, h.isin) != null && h.terFrac != null;
    const amount = h.amount > 0 ? h.amount : 0;
    return {
      isin: h.isin,
      name: h.name,
      amount,
      retroFrac,
      retroAnnual: retroFrac != null ? Math.round(retroFrac * amount * 100) / 100 : 0,
      sourced,
    };
  });

  const ucAnnual = Math.round(lines.reduce((s, l) => s + l.retroAnnual, 0) * 100) / 100;
  const contractAnnual =
    Math.round((convention?.contractFeeShare ?? 0) * totalAmount * 100) / 100;
  const recurringAnnual = Math.round((ucAnnual + contractAnnual) * 100) / 100;
  const entryOnce =
    Math.round((convention?.entryFeeShare ?? 0) * totalAmount * 100) / 100;

  const retroRatePct =
    totalAmount > 0 ? Math.round((recurringAnnual / totalAmount) * 1e4) / 1e2 : null;

  // Coût client (CTD) : TER moyen (fraction) + frais de gestion du contrat.
  const cost = contractTotalCost(
    opts.terMoyenPct != null ? opts.terMoyenPct / 100 : null,
    null, // frais contrat sourcé non disponible ici → indicatif par enveloppe
    opts.contractTypes ?? null,
  );
  const clientCostPct = cost.total;
  const clientCostAnnual =
    clientCostPct != null ? Math.round((clientCostPct / 100) * totalAmount * 100) / 100 : null;
  const captureSharePct =
    clientCostAnnual != null && clientCostAnnual > 0
      ? Math.round((recurringAnnual / clientCostAnnual) * 1e4) / 1e2
      : null;

  return {
    recurringAnnual,
    ucAnnual,
    contractAnnual,
    entryOnce,
    retroRatePct,
    clientCostPct,
    clientCostAnnual,
    supportsPct: cost.supportsPct,
    contractPct: cost.contractPct,
    contractSourced: cost.contractSourced,
    captureSharePct,
    lines,
    totalAmount,
    hasConvention: hasAnyConvention(convention),
    unknownRetroLines: lines.filter((l) => l.retroFrac == null).length,
  };
}
