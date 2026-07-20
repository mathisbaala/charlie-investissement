// ─── Simulateur de frais & de gains (assurance vie) ─────────────────────────
// Moteur PUR (aucun accès réseau/DB) : simulation année par année d'un contrat
// d'assurance vie à deux compartiments (fonds euros + unités de compte), avec
// les DEUX étages de frais que paye le client final :
//   1. frais du CONTRAT (enveloppe assureur) : entrée, gestion, sortie ;
//   2. frais des UC (supports)               : entrée, gestion (frais courants
//      / TER, reflétés dans la VL), sortie.
//
// Conventions de taux — pour éviter tout double comptage (cf. lib/format.ts,
// perfNetteClient) :
//   • `rendementUC` = perf annualisée RÉELLE des UC (VL), donc DÉJÀ NETTE des
//     frais courants du fonds. Le brut est reconstruit : brut = net/(1−TER) ;
//     les frais de gestion UC affichés sortent de cette reconstruction, sans
//     altérer la trajectoire nette.
//   • `rendementFE` = taux servi du fonds euros tel que publié, donc DÉJÀ NET
//     des frais de gestion du contrat sur le compartiment euros. Reconstruit
//     de la même façon pour la courbe de frais.
//   • Le seul frais qui DÉGRADE la trajectoire nette au-delà de la VL est le
//     frais de gestion du contrat sur les UC (l'assureur le prélève en unités).
//
// Tous les taux sont en POURCENTS (0.8 = 0,8 %), cohérent avec
// CONTRACT_FEE_DEFAULTS et l'UI ; les montants en euros.
//
// Hypothèses simplificatrices (affichées à l'écran) : pas d'arbitrage entre
// compartiments (l'allocation s'applique aux versements), versements en début
// d'année, frais de gestion prélevés en fin d'année, fiscalité et prélèvements
// sociaux hors périmètre.

import { weightedAverage } from "./optimizer";

export interface FeeParams {
  contratEntree: number;    // % sur chaque versement
  contratGestionUC: number; // %/an sur l'encours UC (prélevé en unités)
  contratGestionFE: number; // %/an sur l'encours fonds euros (déjà dans le taux servi)
  contratSortie: number;    // % au rachat, sur le capital total
  ucEntree: number;         // % sur la part du versement investie en UC
  ucGestion: number;        // %/an — frais courants / TER (déjà dans la VL)
  ucSortie: number;         // % au rachat, sur le compartiment UC
}

export interface SimulationInput {
  versementInitial: number; // €
  versementAnnuel: number;  // €/an (0 si aucun), investi en début d'année dès l'an 1
  dureeAnnees: number;      // horizon de simulation (entier ≥ 1)
  partUC: number;           // % de chaque versement investi en UC (0..100)
  rendementUC: number;      // %/an, net des frais courants (perf VL annualisée)
  rendementFE: number;      // %/an, taux servi net (publié)
  frais: FeeParams;
  /**
   * Rétrocession CGP (%/an sur l'encours UC) : la part des frais courants des
   * UC que la société de gestion reverse au cabinet. Ce n'est PAS un frais en
   * plus pour le client — c'est une tranche de `ucGestion`, déjà comptée dans
   * la courbe des frais. On la suit à part pour répondre à « qu'est-ce que le
   * CGP gagne ? » sans double comptage. 0 ou absent = non suivie.
   */
  retroCgp?: number;
  /**
   * Commission upfront du cabinet (%/versement) : la part des frais d'entrée
   * que le distributeur (CGP) encaisse à la souscription et à chaque versement.
   * Comme la rétro, ce n'est PAS un frais en plus — c'est une tranche des frais
   * d'entrée déjà payés par le client, plafonnée à ceux-ci (elle ne peut pas
   * excéder ce que le contrat prélève à l'entrée). On la suit à part pour « ce
   * que gagne le cabinet » sans double comptage. 0 ou absent = non suivie.
   */
  commissionCabinet?: number;
}

export interface FeeBreakdown {
  entreeContrat: number;
  entreeUC: number;
  gestionContratUC: number;
  gestionContratFE: number; // reconstruit (déjà dans le taux servi)
  gestionUC: number;        // reconstruit (déjà dans la VL)
  sortieContrat: number;
  sortieUC: number;
}

export interface YearPoint {
  annee: number;             // 0 = souscription (après frais d'entrée), puis fin d'année N
  valeurNette: number;       // encours total (avant frais de sortie)
  valeurUC: number;          // compartiment UC
  valeurFE: number;          // compartiment fonds euros
  valeurSansFrais: number;   // même trajectoire, zéro frais (les 2 étages)
  versementsCumules: number; // brut, avant frais d'entrée
  fraisAnnee: FeeBreakdown;
  fraisCumules: FeeBreakdown;
  totalFraisCumules: number; // somme des 7 postes cumulés
  retroCgpCumulee: number;   // rémunération CGP cumulée (tranche de gestionUC, 0 si non suivie)
  commCabinetCumulee: number; // commission upfront cumulée (tranche des frais d'entrée, 0 si non suivie)
}

export interface HorizonProjection {
  annees: number;
  valeurAvantSortie: number;
  fraisSortie: number;       // contrat + UC, appliqués au rachat
  fraisSortieContrat: number; // détail du précédent (part assureur)
  fraisSortieUC: number;      // détail du précédent (part société de gestion)
  valeurNette: number;       // ce que touche le client
  gainNet: number;           // valeurNette − versements cumulés
  totalFrais: number;        // tous postes, sortie incluse
  valeurSansFrais: number;   // trajectoire brute de tous frais
  manqueAGagner: number;     // valeurSansFrais − valeurAvantSortie (coût composé des frais)
  versementsCumules: number; // pour les ratios côté UI (frais / gain brut, etc.)
  retroCgpCumulee: number;   // rémunération CGP cumulée à cet horizon (0 si non suivie)
  commCabinetCumulee: number; // commission upfront cumulée à cet horizon (0 si non suivie)
}

export interface SimulationResult {
  points: YearPoint[];
  horizons: HorizonProjection[]; // aux années demandées (bornées à la durée)
}

export const HORIZONS_DEFAUT = [5, 10, 15];

// Bornes de sécurité : un taux de frais est borné à [0, 99,9] % (protège les
// dénominateurs 1−frais), un rendement à [−99,9, +∞[ (protège 1+r), et toute
// valeur non finie (NaN d'un champ vidé) retombe à 0.
const clampFrais = (v: number): number =>
  Number.isFinite(v) ? Math.min(Math.max(v, 0), 99.9) : 0;
const clampRendement = (v: number): number =>
  Number.isFinite(v) ? Math.max(v, -99.9) : 0;

const sanitizeFrais = (f: FeeParams): FeeParams => ({
  contratEntree: clampFrais(f.contratEntree),
  contratGestionUC: clampFrais(f.contratGestionUC),
  contratGestionFE: clampFrais(f.contratGestionFE),
  contratSortie: clampFrais(f.contratSortie),
  ucEntree: clampFrais(f.ucEntree),
  ucGestion: clampFrais(f.ucGestion),
  ucSortie: clampFrais(f.ucSortie),
});

const zeroBreakdown = (): FeeBreakdown => ({
  entreeContrat: 0, entreeUC: 0,
  gestionContratUC: 0, gestionContratFE: 0, gestionUC: 0,
  sortieContrat: 0, sortieUC: 0,
});

const totalBreakdown = (b: FeeBreakdown): number =>
  b.entreeContrat + b.entreeUC + b.gestionContratUC + b.gestionContratFE +
  b.gestionUC + b.sortieContrat + b.sortieUC;

const r2 = (v: number) => Math.round(v * 100) / 100;

const roundBreakdown = (b: FeeBreakdown): FeeBreakdown => ({
  entreeContrat: r2(b.entreeContrat), entreeUC: r2(b.entreeUC),
  gestionContratUC: r2(b.gestionContratUC), gestionContratFE: r2(b.gestionContratFE),
  gestionUC: r2(b.gestionUC), sortieContrat: r2(b.sortieContrat), sortieUC: r2(b.sortieUC),
});

/**
 * Rendement annualisé pondéré d'un panier d'UC (poids en %, perf en %/an).
 * Les UC sans perf sont ignorées (leurs poids aussi). Null si rien d'exploitable.
 * Enrobe weightedAverage (lib/optimizer) : même sémantique de renormalisation.
 */
export function rendementPondere(
  ucs: { perf: number | null | undefined; poids: number }[],
): number | null {
  const w = weightedAverage(
    ucs.map((u) => u.perf ?? null),
    ucs.map((u) => Math.max(0, u.poids)),
  );
  return w == null ? null : r2(w);
}

/**
 * Simulation année par année. Renvoie la trajectoire nette (par compartiment),
 * la trajectoire sans frais, et le détail des frais (annuels + cumulés) par
 * poste — de quoi tracer la courbe des frais et lire les projections aux
 * horizons demandés (5/10/15 ans par défaut, bornés à la durée simulée).
 */
export function simulate(
  input: SimulationInput,
  horizons: number[] = HORIZONS_DEFAUT,
): SimulationResult {
  const duree = Math.max(1, Math.floor(input.dureeAnnees));
  const partUC = Math.min(100, Math.max(0, input.partUC)) / 100;
  const f = sanitizeFrais(input.frais);
  const rUC = clampRendement(input.rendementUC);
  const rFE = clampRendement(input.rendementFE);
  // La rétrocession est une tranche des frais courants : elle ne peut pas
  // dépasser ce que la société de gestion prélève (assiette identique).
  const retroCgp = Math.min(clampFrais(input.retroCgp ?? 0), f.ucGestion);
  // La commission upfront est une tranche des frais d'entrée du contrat : elle
  // ne peut pas dépasser ce que le contrat prélève à l'entrée (assiette
  // identique). Plafond appliqué versement par versement dans verser().
  const commCabinet = Math.min(clampFrais(input.commissionCabinet ?? 0), f.contratEntree);

  // Facteurs annuels. Net UC = VL (nette de TER) dégradée du frais contrat UC.
  const factNetUC = (1 + rUC / 100) * (1 - f.contratGestionUC / 100);
  const factNetFE = 1 + rFE / 100;
  // Bruts reconstruits : ce que rapporteraient les mêmes supports sans AUCUN
  // frais de gestion (fonds ni contrat).
  const gUC = f.ucGestion / 100;
  const gFE = f.contratGestionFE / 100;
  const factBrutUC = (1 + rUC / 100) / (1 - gUC);
  const factBrutFE = (1 + rFE / 100) / (1 - gFE);

  let uc = 0, fe = 0, sfUC = 0, sfFE = 0, versements = 0, retroCumulee = 0, commCumulee = 0;
  const cumul = zeroBreakdown();
  const points: YearPoint[] = [];

  // Versement (initial ou annuel) : frais d'entrée contrat sur le tout, puis
  // frais d'entrée UC sur la part investie en unités de compte. La trajectoire
  // « sans frais » investit le même versement intégralement.
  const verser = (montant: number, an: FeeBreakdown) => {
    if (!(montant > 0)) return;
    versements += montant;
    const entreeContrat = montant * (f.contratEntree / 100);
    const investi = montant - entreeContrat;
    const versUC = investi * partUC;
    const entreeUC = versUC * (f.ucEntree / 100);
    uc += versUC - entreeUC;
    fe += investi * (1 - partUC);
    sfUC += montant * partUC;
    sfFE += montant * (1 - partUC);
    an.entreeContrat += entreeContrat;
    an.entreeUC += entreeUC;
    // Commission upfront : tranche des frais d'entrée du contrat reversée au
    // cabinet (plafonnée à entreeContrat, cf. commCabinet). Ne modifie aucun
    // encours ni la trajectoire — c'est une répartition, pas un frais en plus.
    commCumulee += montant * (commCabinet / 100);
  };

  const pousserPoint = (annee: number, an: FeeBreakdown) => {
    (Object.keys(cumul) as (keyof FeeBreakdown)[]).forEach((k) => { cumul[k] += an[k]; });
    points.push({
      annee,
      valeurNette: r2(uc + fe),
      valeurUC: r2(uc),
      valeurFE: r2(fe),
      valeurSansFrais: r2(sfUC + sfFE),
      versementsCumules: r2(versements),
      fraisAnnee: roundBreakdown(an),
      fraisCumules: roundBreakdown(cumul),
      totalFraisCumules: r2(totalBreakdown(cumul)),
      retroCgpCumulee: r2(retroCumulee),
      commCabinetCumulee: r2(commCumulee),
    });
  };

  const an0 = zeroBreakdown();
  verser(input.versementInitial, an0);
  pousserPoint(0, an0);

  for (let annee = 1; annee <= duree; annee++) {
    const an = zeroBreakdown();
    verser(input.versementAnnuel, an);

    // Frais de gestion de l'année, reconstruits depuis l'encours de début
    // d'année porté au brut (les prélèvements réels sont infra-annuels ; la
    // convention fin d'année est l'approximation standard des simulateurs).
    // C'est là que les frais deviennent « exponentiels » : l'assiette grossit
    // avec l'encours, donc le prélèvement annuel grossit d'année en année.
    an.gestionUC += uc * factBrutUC * gUC;
    an.gestionContratUC += uc * (1 + rUC / 100) * (f.contratGestionUC / 100);
    an.gestionContratFE += fe * factBrutFE * gFE;
    // Rétrocession CGP : même assiette et même convention que gestionUC (elle
    // en est une tranche), donc strictement ≤ gestionUC de l'année.
    retroCumulee += uc * factBrutUC * (retroCgp / 100);

    uc *= factNetUC;
    fe *= factNetFE;
    sfUC *= factBrutUC;
    sfFE *= factBrutFE;

    pousserPoint(annee, an);
  }

  const projections: HorizonProjection[] = [];
  for (const h of horizons) {
    if (h < 1 || h > duree) continue;
    const p = points[h];
    const sortieUC = p.valeurUC * (f.ucSortie / 100);
    const sortieContrat = (p.valeurNette - sortieUC) * (f.contratSortie / 100);
    const fraisSortie = r2(sortieUC + sortieContrat);
    const valeurNette = r2(p.valeurNette - fraisSortie);
    projections.push({
      annees: h,
      valeurAvantSortie: p.valeurNette,
      fraisSortie,
      fraisSortieContrat: r2(sortieContrat),
      fraisSortieUC: r2(sortieUC),
      valeurNette,
      gainNet: r2(valeurNette - p.versementsCumules),
      totalFrais: r2(p.totalFraisCumules + fraisSortie),
      valeurSansFrais: p.valeurSansFrais,
      manqueAGagner: r2(p.valeurSansFrais - p.valeurNette),
      versementsCumules: p.versementsCumules,
      retroCgpCumulee: p.retroCgpCumulee,
      commCabinetCumulee: p.commCabinetCumulee,
    });
  }

  return { points, horizons: projections };
}

/**
 * Répartition du coût total de la structure par DESTINATAIRE à un horizon :
 * qui encaisse quoi. Répond à « le coût de la structure, c'est quoi ? » :
 *   • assureur          — frais du contrat (entrée, gestion des 2 compartiments,
 *                          sortie) : il rémunère l'enveloppe assurance vie ;
 *   • société de gestion — frais des UC (entrée, frais courants, sortie),
 *                          NETS de ce qu'elle reverse au cabinet ;
 *   • cabinet (CGP)      — rétrocessions (part des frais courants des UC) ET
 *                          commission upfront (part des frais d'entrée du
 *                          contrat) reversées au conseiller. C'est ce que le
 *                          CGP gagne.
 * Total des trois = totalFrais de l'horizon (aucun frais caché, pas de double
 * comptage : la rétro sort de la poche société de gestion, la commission
 * upfront sort de la poche assureur).
 */
export interface FraisParDestinataire {
  assureur: number;
  societeGestion: number;
  cabinet: number;
}

export function repartitionFrais(
  fraisCumules: FeeBreakdown,
  h: HorizonProjection,
  retroCgpCumulee: number,
  commCabinetCumulee = 0,
): FraisParDestinataire {
  const retro = Math.min(retroCgpCumulee, fraisCumules.gestionUC);
  const comm = Math.min(commCabinetCumulee, fraisCumules.entreeContrat);
  return {
    assureur: r2(
      fraisCumules.entreeContrat + fraisCumules.gestionContratUC +
      fraisCumules.gestionContratFE + fraisCumules.sortieContrat +
      h.fraisSortieContrat - comm,
    ),
    societeGestion: r2(
      fraisCumules.entreeUC + fraisCumules.gestionUC + fraisCumules.sortieUC +
      h.fraisSortieUC - retro,
    ),
    cabinet: r2(retro + comm),
  };
}

/**
 * Part des frais dans le gain BRUT (avant tout frais) à un horizon donné, en %.
 * Lecture « valeur pour le client » côté CGP : des frais qui pèsent 20 % du
 * gain brut laissent 80 % de la création de valeur au client. Null si le gain
 * brut est nul ou négatif (le ratio n'a alors pas de sens).
 */
export function partFraisDansGainBrut(h: HorizonProjection): number | null {
  const gainBrut = h.valeurSansFrais - h.versementsCumules;
  if (!(gainBrut > 0)) return null;
  return r2((h.totalFrais / gainBrut) * 100);
}

/**
 * Projection simple d'une UC seule (table « toutes les UC ») : valeur d'un
 * montant investi à N années au rendement net annualisé donné, dégradé du
 * frais de gestion du contrat. Null si la perf est absente.
 */
export function projeterUC(
  perfNetteAnnuellePct: number | null | undefined,
  fraisContratPct: number,
  montant: number,
  annees: number,
): number | null {
  if (perfNetteAnnuellePct == null) return null;
  const fact = (1 + clampRendement(perfNetteAnnuellePct) / 100) * (1 - clampFrais(fraisContratPct) / 100);
  return r2(montant * Math.pow(fact, annees));
}

/**
 * Rémunération du cabinet sur UN support, au montant investi donné — vue
 * « détail par support » de l'onglet Frais. Deux flux, la lecture CGP directe :
 *   • retroAnnuelle    : rétrocession récurrente (%/an de l'encours du support) ;
 *   • commissionUpfront : commission one-shot à l'entrée (%/versement).
 * Snapshot sur le montant fourni (pas d'actualisation ni de composition) : le
 * cumul rigoureux sur l'horizon reste porté par la simulation agrégée. Montants
 * en euros, taux en % ; les valeurs absentes/invalides comptent pour 0.
 */
export interface RemunerationSupport {
  retroAnnuelle: number;     // €/an récurrent
  commissionUpfront: number; // € à la souscription
}

export function remunerationSupport(
  montant: number,
  retroPct: number | null | undefined,
  commissionUpfrontPct: number | null | undefined,
): RemunerationSupport {
  const m = Number.isFinite(montant) && montant > 0 ? montant : 0;
  return {
    retroAnnuelle: r2(m * (clampFrais(retroPct ?? 0) / 100)),
    commissionUpfront: r2(m * (clampFrais(commissionUpfrontPct ?? 0) / 100)),
  };
}

// ── Rapport de frais (export PDF client / cabinet) ───────────────────────────
// Vue-modèle CANONIQUE de l'onglet Frais : reprend EXACTEMENT les calculs de
// l'écran (mêmes appels simulate / repartitionFrais / remunerationSupport) pour
// que le document remis au client et l'écran ne divergent jamais. Fonction pure :
// la route /api/frais/pdf lui passe l'entrée brute et rend le résultat, l'écran
// pourrait s'y adosser à l'identique.

/** Un support dans le rapport : son montant alloué et la rémunération qu'il porte. */
export interface FraisReportHolding {
  isin: string;
  name: string;
  montant: number;           // € alloué au support (part UC × poids renormalisé)
  ter: number | null;        // % frais courants
  entryFee: number | null;   // % frais d'entrée du support
  effRetro: number | null;   // % rétrocession effective (support ou taux du contrat)
  retroAnnuelle: number;     // €/an récurrent
  commissionUpfront: number; // € à la souscription
}

/** Support en ENTRÉE du rapport (ce que le simulateur connaît de chaque UC). */
export interface FraisReportSupportInput {
  isin: string;
  name: string;
  poids: number;             // % du compartiment UC
  ter: number | null;
  entryFee: number | null;
  retro: number | null;      // rétrocession réelle du support (null = inconnue)
}

export interface FraisReport {
  horizons: HorizonProjection[];
  final: HorizonProjection;              // horizon le plus lointain simulé
  repart: FraisParDestinataire;          // ventilation du coût à l'horizon final
  partFraisGainBrut: number | null;      // frais / gain brut (%), à l'horizon final
  remuTotale: number;                    // rémunération cabinet cumulée à l'horizon final
  supports: FraisReportHolding[];        // détail par support (montant + rémunération)
}

/**
 * Construit le rapport de frais à partir de l'entrée de simulation et de la liste
 * des supports. `null` si aucun horizon n'est exploitable (durée < 1). Les
 * montants par support suivent la même règle que l'écran : la poche UC
 * (versement initial × part UC) répartie au prorata des poids.
 */
export function buildFraisReport(
  input: SimulationInput,
  supports: FraisReportSupportInput[],
  horizons: number[] = HORIZONS_DEFAUT,
): FraisReport | null {
  const sim = simulate(input, horizons);
  const final = sim.horizons[sim.horizons.length - 1];
  if (!final) return null;
  const finalPoint = sim.points[final.annees];
  const repart = repartitionFrais(
    finalPoint.fraisCumules, final, finalPoint.retroCgpCumulee, finalPoint.commCabinetCumulee,
  );

  const retroCgp = input.retroCgp ?? 0;
  const commissionCabinet = input.commissionCabinet ?? 0;
  const totalPoids = supports.reduce((a, s) => a + Math.max(0, s.poids), 0) || 1;
  const ucPot = input.versementInitial * (Math.min(100, Math.max(0, input.partUC)) / 100);
  const holdings: FraisReportHolding[] = supports.map((s) => {
    const montant = ucPot * (Math.max(0, s.poids) / totalPoids);
    const effRetro = s.retro ?? retroCgp;
    const remu = remunerationSupport(montant, effRetro, commissionCabinet);
    return {
      isin: s.isin, name: s.name, montant: Math.round(montant * 100) / 100,
      ter: s.ter, entryFee: s.entryFee, effRetro, ...remu,
    };
  });

  return {
    horizons: sim.horizons,
    final,
    repart,
    partFraisGainBrut: partFraisDansGainBrut(final),
    remuTotale: r2(final.retroCgpCumulee + final.commCabinetCumulee),
    supports: holdings,
  };
}
