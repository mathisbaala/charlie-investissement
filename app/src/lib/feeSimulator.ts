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
  /**
   * Part des frais de gestion du CONTRAT reversée au cabinet (%/an de l'encours
   * total). Comme la rétro et l'upfront, ce n'est PAS un frais en plus : c'est
   * une tranche des frais de gestion du contrat (déjà payés par le client),
   * reversée au distributeur. On la suit à part pour « ce que gagne le cabinet »
   * sans double comptage. Vient du barème « Mon cabinet » (contractFeeShare).
   * 0 ou absent = non suivie.
   */
  contractFeeShare?: number;
  /**
   * Rétrocession sur le compartiment FONDS EUROS (%/an de l'encours euros) : la
   * part des frais de gestion du fonds euros que l'assureur reverse au cabinet.
   * Comme la part gestion contrat, c'est une TRANCHE des frais de gestion du
   * contrat sur le fonds euros (déjà payés par le client), pas un frais en plus.
   * L'asymétrie €/UC est structurelle : le fonds euros rétrocède peu (0–0,30 %,
   * souvent 0), l'assureur n'ayant pas de marge dessus (Solvabilité II). Vient du
   * barème « Mon cabinet » (eurosRetroShare). 0 ou absent = non suivie.
   */
  eurosRetroShare?: number;
  /**
   * Honoraires de conseil facturés DIRECTEMENT au client (facturation en sus,
   * hors rétrocession), 100 % revenu du cabinet. Contrairement aux frais du
   * contrat, ils ne sont PAS prélevés sur l'encours : ils ne dégradent donc pas
   * la valeur nette du contrat (`valeurNette`/`gainNet` restent inchangés). En
   * revanche ils s'ajoutent au COÛT TOTAL supporté par le client
   * (`coutTotalClient`) et au REVENU du cabinet (`revenuCabinet`).
   *   • honoraireForfait   : forfait ponctuel (€) prélevé à la souscription ;
   *   • honoraireAnnuelPct : honoraire récurrent (%/an de l'encours net).
   * 0 ou absent = non suivis.
   */
  honoraireForfait?: number;
  honoraireAnnuelPct?: number;
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
  contractFeeCumulee: number; // part frais de gestion contrat reversée au cabinet, cumulée (0 si non suivie)
  eurosRetroCumulee: number;  // rétrocession sur le fonds euros reversée au cabinet, cumulée (0 si non suivie)
  honoraireCumule: number;    // honoraires de conseil facturés en sus, cumulés (0 si non suivis)
  // Découpage compte d'exploitation du revenu cabinet, cumulé À CE POINT
  // (invariant upfront + récurrent = revenu cabinet cumulé). À l'année 0 le
  // récurrent vaut 0 → points[1].revenuCabinetRecurrent = récurrent de la 1re année.
  revenuCabinetUpfront: number;   // one-shot = commission d'entrée cumulée + forfait honoraire
  revenuCabinetRecurrent: number; // récurrent = rétro + part gestion contrat + rétro fonds euros + honoraire annuel
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
  contractFeeCumulee: number; // part frais de gestion contrat reversée, cumulée à cet horizon (0 si non suivie)
  eurosRetroCumulee: number;  // rétrocession fonds euros reversée, cumulée à cet horizon (0 si non suivie)
  honoraireCumule: number;    // honoraires de conseil facturés en sus, cumulés à cet horizon (0 si non suivis)
  // Agrégats prêts à l'affichage (source unique — l'UI et le PDF s'y adossent
  // pour ne jamais diverger) :
  revenuCabinet: number;    // TOTAL encaissé par le cabinet = rétro + commission + part gestion contrat + rétro fonds euros + honoraires
  // Découpage « compte d'exploitation » du revenu cabinet (invariant :
  // revenuCabinetUpfront + revenuCabinetRecurrent = revenuCabinet). Répartition,
  // pas de revenu en plus :
  revenuCabinetUpfront: number;   // one-shot à l'entrée = commission d'entrée (tous versements) + forfait honoraire
  revenuCabinetRecurrent: number; // récurrent (sur la durée) = rétro UC + part gestion contrat + rétro fonds euros + honoraire annuel
  coutTotalClient: number;  // TOTAL supporté par le client = totalFrais (structure) + honoraires facturés en sus
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
  // Part des frais de gestion du contrat reversée au cabinet (tranche d'encours
  // total/an). Le taux est borné ici ; l'accrual annuel est en plus plafonné aux
  // frais de gestion du contrat de l'année (UC + fonds euros), pour qu'il ne
  // puisse jamais dépasser ce que le contrat prélève réellement (assiette dont
  // il est censé n'être qu'une tranche).
  const contractFeeShare = clampFrais(input.contractFeeShare ?? 0);
  // Rétrocession fonds euros (%/an d'encours euros). Comme la part gestion
  // contrat, l'accrual est plafonné aux frais de gestion du contrat sur le fonds
  // euros de l'année : elle en est une tranche.
  const eurosRetroShare = clampFrais(input.eurosRetroShare ?? 0);
  // Honoraires de conseil facturés en sus (hors rétrocession) : forfait ponctuel
  // à la souscription + récurrent %/an de l'encours net. N'altèrent jamais la
  // trajectoire du contrat (facturés à côté) ; suivis pour le coût total client
  // et le revenu cabinet.
  const honoraireForfait = Math.max(0, Number.isFinite(input.honoraireForfait ?? 0) ? (input.honoraireForfait ?? 0) : 0);
  const honoraireAnnuel = clampFrais(input.honoraireAnnuelPct ?? 0);

  // Facteurs annuels. Net UC = VL (nette de TER) dégradée du frais contrat UC.
  const factNetUC = (1 + rUC / 100) * (1 - f.contratGestionUC / 100);
  const factNetFE = 1 + rFE / 100;
  // Bruts reconstruits : ce que rapporteraient les mêmes supports sans AUCUN
  // frais de gestion (fonds ni contrat).
  const gUC = f.ucGestion / 100;
  const gFE = f.contratGestionFE / 100;
  const factBrutUC = (1 + rUC / 100) / (1 - gUC);
  const factBrutFE = (1 + rFE / 100) / (1 - gFE);

  let uc = 0, fe = 0, sfUC = 0, sfFE = 0, versements = 0, retroCumulee = 0, commCumulee = 0, contractFeeCumulee = 0, eurosRetroCumulee = 0, honoraireCumulee = 0;
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
      contractFeeCumulee: r2(contractFeeCumulee),
      eurosRetroCumulee: r2(eurosRetroCumulee),
      honoraireCumule: r2(honoraireCumulee),
      revenuCabinetUpfront: r2(commCumulee + honoraireForfait),
      revenuCabinetRecurrent: r2(retroCumulee + contractFeeCumulee + eurosRetroCumulee + Math.max(0, honoraireCumulee - honoraireForfait)),
    });
  };

  const an0 = zeroBreakdown();
  verser(input.versementInitial, an0);
  // Honoraires : le forfait est prélevé à la souscription (an 0). Le récurrent
  // ne court qu'à partir de la 1re année (appliqué à l'encours de fin d'année).
  honoraireCumulee = honoraireForfait;
  pousserPoint(0, an0);

  for (let annee = 1; annee <= duree; annee++) {
    const an = zeroBreakdown();
    verser(input.versementAnnuel, an);

    // Frais de gestion de l'année, reconstruits depuis l'encours de début
    // d'année porté au brut (les prélèvements réels sont infra-annuels ; la
    // convention fin d'année est l'approximation standard des simulateurs).
    // C'est là que les frais deviennent « exponentiels » : l'assiette grossit
    // avec l'encours, donc le prélèvement annuel grossit d'année en année.
    const gestionContratUCan = uc * (1 + rUC / 100) * (f.contratGestionUC / 100);
    const gestionContratFEan = fe * factBrutFE * gFE;
    an.gestionUC += uc * factBrutUC * gUC;
    an.gestionContratUC += gestionContratUCan;
    an.gestionContratFE += gestionContratFEan;
    // Rétrocession CGP : même assiette et même convention que gestionUC (elle
    // en est une tranche), donc strictement ≤ gestionUC de l'année.
    retroCumulee += uc * factBrutUC * (retroCgp / 100);
    // Part frais de gestion contrat reversée au cabinet : tranche de l'encours
    // TOTAL de début d'année (porté au brut, même convention que la rétro),
    // PLAFONNÉE aux frais de gestion du contrat de l'année (UC + fonds euros) :
    // elle ne peut pas reverser plus que ce que le contrat prélève.
    const contractFeeAn = Math.min(
      (uc * factBrutUC + fe * factBrutFE) * (contractFeeShare / 100),
      gestionContratUCan + gestionContratFEan,
    );
    contractFeeCumulee += contractFeeAn;
    // Rétrocession fonds euros : tranche des frais de gestion du contrat sur le
    // compartiment euros de l'année, plafonnée à ceux-ci ET à ce qui reste après
    // la part gestion contrat déjà prélevée sur le contrat — pour que les deux
    // reversements réunis n'excèdent jamais les frais de gestion du contrat
    // (invariant revenuCabinet == poche cabinet de la répartition).
    eurosRetroCumulee += Math.min(
      fe * factBrutFE * (eurosRetroShare / 100),
      gestionContratFEan,
      Math.max(0, gestionContratUCan + gestionContratFEan - contractFeeAn),
    );

    uc *= factNetUC;
    fe *= factNetFE;
    sfUC *= factBrutUC;
    sfFE *= factBrutFE;

    // Honoraire récurrent : appliqué à l'encours net de fin d'année (après la
    // capitalisation et les frais du contrat de l'année). Facturé en sus, il ne
    // retranche rien de uc/fe.
    honoraireCumulee += (uc + fe) * (honoraireAnnuel / 100);

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
    const totalFrais = r2(p.totalFraisCumules + fraisSortie);
    // contractFeeCumulee et eurosRetroCumulee sont déjà plafonnés à l'accrual
    // (≤ frais de gestion du contrat), donc sommer directement les flux ne
    // double-compte rien.
    const revenuCabinet = r2(p.retroCgpCumulee + p.commCabinetCumulee + p.contractFeeCumulee + p.eurosRetroCumulee + p.honoraireCumule);
    // Découpage compte d'exploitation : ce que le cabinet encaisse À L'ENTRÉE
    // (commission d'entrée de tous les versements + forfait honoraire, one-shot)
    // vs le RÉCURRENT sur la durée (le reste). Le récurrent est calculé par
    // solde pour que la somme colle exactement au revenu total affiché.
    const revenuCabinetUpfront = r2(p.commCabinetCumulee + honoraireForfait);
    projections.push({
      annees: h,
      valeurAvantSortie: p.valeurNette,
      fraisSortie,
      fraisSortieContrat: r2(sortieContrat),
      fraisSortieUC: r2(sortieUC),
      valeurNette,
      gainNet: r2(valeurNette - p.versementsCumules),
      totalFrais,
      valeurSansFrais: p.valeurSansFrais,
      manqueAGagner: r2(p.valeurSansFrais - p.valeurNette),
      versementsCumules: p.versementsCumules,
      retroCgpCumulee: p.retroCgpCumulee,
      commCabinetCumulee: p.commCabinetCumulee,
      contractFeeCumulee: p.contractFeeCumulee,
      eurosRetroCumulee: p.eurosRetroCumulee,
      honoraireCumule: p.honoraireCumule,
      revenuCabinet,
      revenuCabinetUpfront,
      revenuCabinetRecurrent: r2(revenuCabinet - revenuCabinetUpfront),
      coutTotalClient: r2(totalFrais + p.honoraireCumule),
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
 *   • cabinet (CGP)      — rétrocessions (part des frais courants des UC),
 *                          commission upfront (part des frais d'entrée du
 *                          contrat) ET part des frais de gestion du contrat
 *                          reversées au conseiller. C'est ce que le CGP gagne.
 * Total des trois = totalFrais de l'horizon (aucun frais caché, pas de double
 * comptage : la rétro sort de la poche société de gestion, la commission
 * upfront ET la part de gestion contrat sortent de la poche assureur).
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
  contractFeeCumulee = 0,
  eurosRetroCumulee = 0,
): FraisParDestinataire {
  const retro = Math.min(retroCgpCumulee, fraisCumules.gestionUC);
  const comm = Math.min(commCabinetCumulee, fraisCumules.entreeContrat);
  // La part de gestion contrat ET la rétro fonds euros sortent des frais de
  // gestion du contrat (poche assureur, UC + fonds euros) : plafonnées à leur
  // somme, cumulativement — même base et même ordre que le plafond d'accrual
  // dans simulate(). Elles ne peuvent pas excéder ce que le contrat prélève.
  const gestionContrat = fraisCumules.gestionContratUC + fraisCumules.gestionContratFE;
  const contractFee = Math.min(contractFeeCumulee, gestionContrat);
  const eurosRetro = Math.min(eurosRetroCumulee, Math.max(0, gestionContrat - contractFee));
  return {
    assureur: r2(
      fraisCumules.entreeContrat + fraisCumules.gestionContratUC +
      fraisCumules.gestionContratFE + fraisCumules.sortieContrat +
      h.fraisSortieContrat - comm - contractFee - eurosRetro,
    ),
    societeGestion: r2(
      fraisCumules.entreeUC + fraisCumules.gestionUC + fraisCumules.sortieUC +
      h.fraisSortieUC - retro,
    ),
    cabinet: r2(retro + comm + contractFee + eurosRetro),
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
 * Réduction de rendement annualisée (« Reduction in Yield » / RIY) à un horizon :
 * de combien, en points de %/an, les frais rabaissent la performance annualisée.
 * Indicateur standardisé PRIIPs — c'est LA façon réglementaire de résumer
 * « l'effet cumulé des coûts sur le rendement » (MiFID II art. 24-4, DDA art. 29)
 * en un seul chiffre. Définition PRIIPs stricte : DIFFÉRENCE ARITHMÉTIQUE entre
 * le rendement annualisé BRUT (trajectoire sans aucun frais) et le rendement
 * annualisé NET (valeur effectivement perçue), les deux rapportés à la même base
 * (versements cumulés) : RIY = rBrut − rNet. 0 si les valeurs ne permettent pas
 * le calcul.
 */
export function reductionRendementAnnuelle(h: HorizonProjection): number {
  if (!(h.valeurNette > 0) || !(h.valeurSansFrais > 0) || !(h.versementsCumules > 0) || h.annees < 1) return 0;
  const rBrut = Math.pow(h.valeurSansFrais / h.versementsCumules, 1 / h.annees) - 1;
  const rNet = Math.pow(h.valeurNette / h.versementsCumules, 1 / h.annees) - 1;
  return r2((rBrut - rNet) * 100);
}

/**
 * Coût annuel moyen supporté par le client, exprimé en % de l'encours net moyen
 * sur la période — le « taux de frais annuel » façon frais courants (OGC), le
 * langage naturel du CGP pour comparer deux enveloppes entre elles. On lisse le
 * coût total client (frais de structure + honoraires facturés en sus) sur la
 * durée, puis on le rapporte à l'encours net effectivement porté année après
 * année (moyenne des encours de fin d'année, années 1..h — celles où les frais
 * courent). Null si l'encours moyen ou la durée ne sont pas exploitables.
 */
export function coutAnnuelMoyenPct(points: YearPoint[], h: HorizonProjection): number | null {
  if (!(h.annees >= 1)) return null;
  const encours: number[] = [];
  for (let i = 1; i <= h.annees && i < points.length; i++) {
    if (points[i].valeurNette > 0) encours.push(points[i].valeurNette);
  }
  if (encours.length === 0) return null;
  const encoursMoyen = encours.reduce((a, v) => a + v, 0) / encours.length;
  return r2((h.coutTotalClient / h.annees / encoursMoyen) * 100);
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

/**
 * Ventilation du coût total à l'horizon final PAR NATURE de frais (pas par
 * destinataire). C'est la lecture réglementaire attendue côté client (DDA art.
 * 29, MiFID II art. 24-4, annexe II du Règlement délégué (UE) 2017/565) : frais
 * d'entrée, frais de gestion de l'enveloppe, frais courants des supports, frais
 * de sortie. `dontConseil` est une part TRANSVERSE (déjà comprise dans les
 * lignes ci-dessus) qui isole ce qui rémunère le conseil, au titre de la
 * transparence sur les incitations. Les honoraires de conseil facturés en sus
 * (hors structure) forment une 5e ligne, de sorte que entree + gestionEnveloppe
 * + fraisCourants + sortie + honoraires = total (identité exacte = coût total
 * client, aucun frais caché).
 */
export interface FraisNature {
  entree: number;           // frais d'entrée cumulés (contrat + supports)
  gestionEnveloppe: number; // frais de gestion du contrat (UC + fonds euros), cumulés
  fraisCourants: number;    // frais courants des supports (TER), cumulés
  sortie: number;           // frais de sortie à l'horizon (contrat + supports)
  honoraires: number;       // honoraires de conseil facturés en sus (hors structure), cumulés
  total: number;            // = final.coutTotalClient (structure + honoraires)
  dontConseil: number;      // part rémunérant le conseil (transverse, = revenu cabinet total)
}

/** Point de la trajectoire pour l'illustration de l'effet cumulé des coûts. */
export interface FraisTrajectoirePoint {
  annee: number;
  versements: number;      // versements cumulés bruts
  valeurNette: number;     // encours après frais (avant sortie)
  valeurSansFrais: number; // même trajectoire, zéro frais
  fraisCumules: number;    // total des frais cumulés à cette année
}

export interface FraisReport {
  horizons: HorizonProjection[];
  final: HorizonProjection;              // horizon le plus lointain simulé
  repart: FraisParDestinataire;          // ventilation du coût à l'horizon final (par destinataire)
  nature: FraisNature;                   // ventilation du coût à l'horizon final (par nature)
  trajectoire: FraisTrajectoirePoint[];  // année par année (illustration effet des coûts)
  partFraisGainBrut: number | null;      // frais / gain brut (%), à l'horizon final
  reductionRendement: number;            // réduction de rendement annualisée (%/an, RIY)
  coutAnnuelMoyen: number | null;        // coût annuel moyen en % de l'encours net moyen (façon OGC), horizon final
  coutPremiereAnnee: number;             // frais cumulés fin d'année 1 (entrée + 1re année de gestion)
  coutRecurrentMoyen: number;            // frais récurrents moyens /an (gestion + courants), hors entrée/sortie
  coutTotalClient: number;               // coût total supporté par le client (structure + honoraires), horizon final
  coutTotalPctVersements: number | null; // coût total client en % des versements cumulés
  remuTotale: number;                    // rémunération cabinet issue de la structure (= repart.cabinet), horizon final
  revenuCabinet: number;                 // revenu cabinet TOTAL (structure + honoraires), horizon final
  revenuCabinetUpfront: number;          // part one-shot du revenu cabinet (commission d'entrée + forfait), horizon final
  revenuCabinetRecurrentAn1: number;     // revenu cabinet récurrent de la 1re année (rétro + honoraire annuel)
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
    finalPoint.fraisCumules, final, finalPoint.retroCgpCumulee,
    finalPoint.commCabinetCumulee, finalPoint.contractFeeCumulee,
    finalPoint.eurosRetroCumulee,
  );

  // Ventilation par nature à l'horizon final. Les frais de sortie ne sont pas
  // dans le cumul courant (appliqués une seule fois au rachat) → on les prend
  // sur la projection. Identité : entree + gestion + courants + sortie = total.
  const fc = finalPoint.fraisCumules;
  const nature: FraisNature = {
    entree: r2(fc.entreeContrat + fc.entreeUC),
    gestionEnveloppe: r2(fc.gestionContratUC + fc.gestionContratFE),
    fraisCourants: r2(fc.gestionUC),
    sortie: r2(final.fraisSortie),
    honoraires: r2(final.honoraireCumule),
    total: r2(final.coutTotalClient),
    dontConseil: r2(final.revenuCabinet),
  };

  const trajectoire: FraisTrajectoirePoint[] = sim.points.map((p) => ({
    annee: p.annee,
    versements: p.versementsCumules,
    valeurNette: p.valeurNette,
    valeurSansFrais: p.valeurSansFrais,
    fraisCumules: p.totalFraisCumules,
  }));

  // Coût de la 1re année : entrée + première année de gestion (points[1] existe
  // toujours ici, un horizon valide impose durée ≥ 1). Récurrent moyen : ce qui
  // reste (gestion + courants) lissé sur la durée, hors frais ponctuels.
  const coutPremiereAnnee = r2(sim.points[1]?.totalFraisCumules ?? nature.entree);
  const coutRecurrentMoyen = r2(Math.max(0, nature.total - nature.entree - nature.sortie) / final.annees);
  const coutTotalPctVersements = final.versementsCumules > 0
    ? r2((final.coutTotalClient / final.versementsCumules) * 100)
    : null;

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
    nature,
    trajectoire,
    partFraisGainBrut: partFraisDansGainBrut(final),
    reductionRendement: reductionRendementAnnuelle(final),
    coutAnnuelMoyen: coutAnnuelMoyenPct(sim.points, final),
    coutPremiereAnnee,
    coutRecurrentMoyen,
    coutTotalClient: final.coutTotalClient,
    coutTotalPctVersements,
    remuTotale: repart.cabinet,
    revenuCabinet: final.revenuCabinet,
    revenuCabinetUpfront: final.revenuCabinetUpfront,
    // Récurrent de la 1re année : le cumul récurrent à la fin de l'année 1
    // (le récurrent de l'année 0 est nul). points[1] existe (horizon valide → durée ≥ 1).
    revenuCabinetRecurrentAn1: r2(sim.points[1]?.revenuCabinetRecurrent ?? 0),
    supports: holdings,
  };
}
