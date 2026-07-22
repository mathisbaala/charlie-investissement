// Moteur d'allocation — théorie moderne du portefeuille (Markowitz / max-Sharpe).
//
// Objectif (cf. spec) : parmi les fonds disponibles dans un contrat, proposer une
// allocation de 4 à 7 supports offrant le meilleur compromis risque/performance
// (ratio de Sharpe maximal), en respectant une répartition cible par classe
// d'actifs (ex. 60 % actions / 30 % obligations / 10 % crypto) et un plafond de
// risque (SRI).
//
// Paramètres exploités : SRI (risk_score), volatilité, performances historiques,
// corrélation entre actifs (matrice fournie), diversification. C'est le modèle
// classique qui exploite le PLUS de paramètres disponibles — d'où son choix.
//
// La corrélation intervient aux DEUX étages : à la sélection (gloutonne, chaque
// ajout est pénalisé par sa corrélation moyenne avec le panier courant — les
// fonds imposés par le client servant de panier de départ), puis à la
// pondération (covariance du max-Sharpe).
//
// Fonctions PURES et déterministes (mêmes entrées → même sortie) : tout le
// hasard est proscrit, l'optimiseur part d'un point initial fixe et itère.
// Le calcul des corrélations vit dans `./correlation` + le RPC SQL jumeau.

import {
  covarianceMatrix,
  averagePairwiseCorrelation,
  classCorrelation,
  missingPairCount,
} from "./correlation";
import { hrpWeights } from "./hrp";

/** Classes d'actifs canoniques manipulées par le moteur (buckets d'allocation). */
export type AssetClass =
  | "actions"
  | "obligations"
  | "monetaire"
  | "diversifie"
  | "immobilier"
  | "alternatif"
  | "crypto"
  | "fonds_euros";

/** Un fonds candidat, avec les paramètres nécessaires à l'optimisation. */
export interface FundInput {
  isin: string;
  name: string;
  assetClass: AssetClass;
  /** Catégorie fine (ex. « Actions USA », « Obligations Crédit ») — restitution. */
  category?: string | null;
  /** SRI réglementaire 1–7 (risk_score). */
  sri?: number | null;
  /** Rendement annualisé attendu, en FRACTION (0.062 = 6,2 %). */
  expectedReturn: number;
  /** Volatilité annualisée, en FRACTION (0.10 = 10 %). */
  volatility: number;
  /** Frais courants en fraction (0.015 = 1,5 %) — départage à qualité égale. */
  ter?: number | null;
  /**
   * Rétrocession distributeur en fraction de l'encours/an (0.008 = 0,8 %) —
   * estimée tant que les conventions réelles du cabinet ne sont pas saisies.
   * N'intervient QUE comme départage borné (cf. commissionTieBreak).
   */
  retrocession?: number | null;
  /** Article SFDR 6/8/9 — restitution durabilité. */
  sfdr?: number | null;
  /** Labels officiels durabilité (isr/greenfin/finansol) — proxy d'exclusions. */
  labels?: string[] | null;
  /**
   * Exclusions sectorielles documentées (EET/SFDR) : {clé: bool}. Clé présente =
   * politique documentée (true = le fonds exclut le secteur), clé absente =
   * inconnu → repli sur le proxy labels (cf. profileToConstraints).
   */
  esgExclusions?: Record<string, boolean> | null;
  managementStyle?: string | null;
  gestionnaire?: string | null;
  region?: string | null;
  /** Secteur normalisé (fonds sectoriels : « Énergie », « Santé »…) — sert aux
   *  exclusions éthiques du client (fossiles, armes…). */
  sector?: string | null;
  /** Politique d'exclusion DÉCLARÉE du fonds (annexe SFDR), tags normalisés
   *  « excl-fossiles », « excl-tabac », « excl-armes », « excl-jeux »,
   *  « excl-alcool ». Vide/absent = politique inconnue (≠ refus). */
  exclusionPolicies?: string[] | null;
  /** Notation Morningstar 1–5 étoiles (null si non noté, ex. SCPI). */
  rating?: number | null;
  /** Complétude 0–100 — pénalise les fonds mal renseignés à la sélection. */
  dataCompleteness?: number | null;
}

export interface OptimizerConstraints {
  /** Nombre minimum de supports (défaut 4). */
  minAssets: number;
  /** Nombre maximum de supports (défaut 7). */
  maxAssets: number;
  /**
   * Répartition cible par classe d'actifs, en POURCENTAGES (ex.
   * { actions: 60, obligations: 30, crypto: 10 }). Normalisée à 100 en interne.
   * Absente/vide → allocation libre (un seul bucket = 100 %).
   */
  classTargets?: Partial<Record<AssetClass, number>>;
  /** Poids maximum d'un seul fonds, en fraction (défaut 0.35). */
  maxWeightPerFund: number;
  /** SRI moyen pondéré à ne pas dépasser (optionnel). */
  maxWeightedSri?: number | null;
  /** Taux sans risque annualisé, en fraction (défaut 0.02). */
  riskFree: number;
  /** ISIN à inclure obligatoirement (ex. contrainte « Hegoa » du template). */
  mustInclude?: string[];
  /**
   * Poids de la pénalité de corrélation dans la sélection gloutonne (défaut
   * 0.5) : le score d'un candidat est réduit de λ × (corrélation moyenne avec
   * les fonds déjà retenus). 0 = sélection au score individuel pur.
   */
  correlationPenalty: number;
  /**
   * Méthode de pondération : « sharpe » (max-Sharpe, défaut) ou « hrp »
   * (hierarchical risk parity — budgets de risque hiérarchiques, sans
   * rendements attendus, robuste aux matrices bruitées). Dans les deux cas les
   * contraintes (cibles de classes, plafond par fonds, SRI) sont respectées.
   */
  method: AllocationMethod;
  /**
   * Zones géographiques demandées par le client, chacune avec ses régions de
   * la base (cf. GEO_TO_REGIONS). La sélection s'efforce de représenter CHAQUE
   * zone par au moins un fonds actions (bonus glouton puis passe de
   * réparation) — « monde + Asie » doit donner un fonds monde ET un fonds
   * asiatique, pas deux fonds monde. Zone impossible à couvrir → note.
   */
  coverRegions?: { zone: string; regions: string[] }[];
  /**
   * Départage « rémunération cabinet » : tolérance de score en dessous de
   * laquelle deux candidats sont jugés ÉQUIVALENTS pour le client — parmi eux,
   * celui à la meilleure rétrocession est retenu. 0 (défaut) = désactivé.
   * L'adéquation client reste première : un fonds mieux rémunérateur mais
   * moins adapté (écart de score > tolérance) n'est JAMAIS préféré.
   */
  commissionTieBreak: number;
}

/** Tolérance de score standard du départage rétrocession (quasi-équivalence). */
export const COMMISSION_TIE_BREAK_TOL = 0.05;

export type AllocationMethod = "sharpe" | "hrp";

export const DEFAULT_CONSTRAINTS: OptimizerConstraints = {
  minAssets: 4,
  maxAssets: 7,
  maxWeightPerFund: 0.35,
  maxWeightedSri: null,
  riskFree: 0.02,
  mustInclude: [],
  correlationPenalty: 0.5,
  method: "sharpe",
  commissionTieBreak: 0,
};

export interface AllocationLine {
  isin: string;
  name: string;
  assetClass: AssetClass;
  category?: string | null;
  /** Poids en POURCENTAGE (0–100), arrondi à 0,1 %. */
  weight: number;
  sri?: number | null;
  sfdr?: number | null;
  ter?: number | null;
  /** Rétrocession distributeur estimée (fraction/an) — cf. FundInput. */
  retrocession?: number | null;
  /** Notation Morningstar 1–5 étoiles (null si non noté). */
  rating?: number | null;
  region?: string | null;
  expectedReturn: number;
  volatility: number;
}

export interface AllocationResult {
  lines: AllocationLine[];
  /** Méthode de pondération effectivement utilisée. */
  method: AllocationMethod;
  /** Rendement annualisé attendu du portefeuille (fraction). */
  expectedReturn: number;
  /** Volatilité annualisée du portefeuille (fraction). */
  volatility: number;
  /** Ratio de Sharpe (annualisé). */
  sharpe: number;
  /** SRI moyen pondéré (1–7). */
  weightedSri: number | null;
  /** Poids réalisés par classe d'actifs (pourcentages). */
  classWeights: Partial<Record<AssetClass, number>>;
  diversification: {
    /** Nombre effectif de lignes = 1 / Σ wᵢ² (Herfindahl inverse). */
    effectiveHoldings: number;
    /** Corrélation moyenne des paires retenues (null si indisponible). */
    averageCorrelation: number | null;
    /** Nombre de classes d'actifs distinctes. */
    assetClasses: number;
  };
  /** Diagnostics non bloquants (contraintes assouplies, données manquantes…). */
  notes: string[];
}

// ─── Sélection des supports ─────────────────────────────────────────────────

/** Score scalaire de sélection (plus haut = meilleur). Départage intra-classe. */
export function selectionScore(f: FundInput, riskFree: number): number {
  // Sharpe implicite (rendement excédentaire / risque) — cœur du score.
  const vol = f.volatility > 1e-6 ? f.volatility : 1e-6;
  const sharpe = (f.expectedReturn - riskFree) / vol;
  // Bonus faibles frais (0 frais → +0.15 ; 3 % → 0) et complétude des données.
  const ter = f.ter ?? 0.015;
  const feeBonus = Math.max(0, 0.15 * (1 - ter / 0.03));
  const completeness = (f.dataCompleteness ?? 50) / 100;
  return sharpe + feeBonus + 0.2 * completeness;
}

/**
 * Répartit `budget` créneaux entre les classes cibles, ≥1 par classe présente,
 * proportionnellement au poids cible (plus grand reste), sans dépasser le nombre
 * de fonds réellement disponibles par classe.
 */
export function allocateSlots(
  targets: Record<string, number>,
  available: Record<string, number>,
  budget: number,
): Record<string, number> {
  const classes = Object.keys(targets).filter(
    (c) => targets[c] > 0 && (available[c] ?? 0) > 0,
  );
  const slots: Record<string, number> = {};
  for (const c of classes) slots[c] = 1; // socle : 1 par classe présente

  let used = classes.length;
  const totalTarget = classes.reduce((s, c) => s + targets[c], 0);

  // Distribution du reste par plus grand reste sur la part cible.
  while (used < budget) {
    let best: string | null = null;
    let bestRemainder = -Infinity;
    for (const c of classes) {
      if (slots[c] >= (available[c] ?? 0)) continue; // classe saturée
      const ideal = (targets[c] / totalTarget) * budget;
      const remainder = ideal - slots[c];
      if (remainder > bestRemainder) {
        bestRemainder = remainder;
        best = c;
      }
    }
    if (best === null) break; // toutes les classes saturées
    slots[best] += 1;
    used += 1;
  }
  return slots;
}

/**
 * Bonus de score quand un candidat représente une zone géographique demandée
 * encore absente du panier — assez fort pour faire passer un bon fonds de la
 * zone devant un très bon fonds redondant, sans écraser le score individuel.
 */
export const GEO_COVER_BONUS = 0.5;

/**
 * Score d'un candidat compte tenu du panier déjà constitué : score individuel
 * diminué de λ × (corrélation moyenne avec les fonds déjà retenus). La
 * corrélation d'une paire sans historique observable vaut le prior de classe
 * (`classCorrelation`) — jamais 0, sinon un trou de données passerait pour de
 * la diversification. Panier vide → score individuel pur.
 */
export function diversifiedScore(
  candidate: FundInput,
  basket: FundInput[],
  riskFree: number,
  penalty: number,
  corrOf: (a: string, b: string) => number | null,
): number {
  const base = selectionScore(candidate, riskFree);
  if (basket.length === 0 || penalty <= 0) return base;
  let sum = 0;
  for (const held of basket) {
    const rho = corrOf(candidate.isin, held.isin);
    sum += rho ?? classCorrelation(candidate.assetClass, held.assetClass);
  }
  return base - penalty * (sum / basket.length);
}

/**
 * Sélectionne les fonds de façon GLOUTONNE : les `mustInclude` (fonds imposés
 * par le client) forment le panier de départ, puis chaque ajout est le candidat
 * au meilleur `diversifiedScore` — score individuel pénalisé par sa corrélation
 * moyenne avec le panier courant. Les créneaux par classe cible sont respectés
 * (quotas `allocateSlots`), et la sélection complète jusqu'à `minAssets` si les
 * cibles n'y suffisent pas. Renvoie au plus `maxAssets` fonds. Déterministe
 * (départage par ISIN).
 */
export function selectFunds(
  funds: FundInput[],
  constraints: OptimizerConstraints,
  corrOf: (a: string, b: string) => number | null = () => null,
): { selected: FundInput[]; notes: string[] } {
  const notes: string[] = [];
  const { minAssets, maxAssets, riskFree, correlationPenalty } = constraints;
  const byIsin = new Map(funds.map((f) => [f.isin, f]));

  const selected: FundInput[] = [];
  const chosen = new Set<string>();

  // Zones géographiques à représenter (chacune par ≥ 1 fonds actions).
  const coverage = (constraints.coverRegions ?? []).map((z) => ({
    zone: z.zone,
    set: new Set(z.regions),
  }));
  const coversZone = (f: FundInput, z: { set: Set<string> }): boolean =>
    f.assetClass === "actions" && f.region != null && z.set.has(f.region);
  const uncoveredZones = () =>
    coverage.filter((z) => !selected.some((f) => coversZone(f, z)));

  // Meilleur candidat (score pénalisé par le panier courant) parmi `pool`.
  // Bonus si le candidat représente une zone demandée encore absente du panier.
  // Départage rétrocession (si activé) : parmi les candidats à ≤ `tieTol` du
  // meilleur score — donc équivalents pour le CLIENT — on retient celui qui
  // rémunère le mieux le cabinet. Jamais au-delà de la tolérance.
  const tieTol = Math.max(0, constraints.commissionTieBreak);
  const pickBest = (pool: FundInput[]): FundInput | null => {
    const open = uncoveredZones();
    const cands: { f: FundInput; s: number }[] = [];
    for (const f of pool) {
      if (chosen.has(f.isin)) continue;
      let s = diversifiedScore(f, selected, riskFree, correlationPenalty, corrOf);
      if (open.length > 0 && open.some((z) => coversZone(f, z))) s += GEO_COVER_BONUS;
      cands.push({ f, s });
    }
    if (cands.length === 0) return null;
    let maxS = -Infinity;
    for (const c of cands) if (c.s > maxS) maxS = c.s;
    const band = cands.filter((c) => c.s >= maxS - tieTol);
    band.sort((a, b) => {
      if (tieTol > 0) {
        const dr = (b.f.retrocession ?? 0) - (a.f.retrocession ?? 0);
        if (Math.abs(dr) > 1e-12) return dr;
      }
      return b.s - a.s || a.f.isin.localeCompare(b.f.isin);
    });
    return band[0].f;
  };

  // 1) Inclusions obligatoires : le panier de départ.
  for (const isin of constraints.mustInclude ?? []) {
    const f = byIsin.get(isin);
    if (f && !chosen.has(isin) && selected.length < maxAssets) {
      selected.push(f);
      chosen.add(isin);
    } else if (!f) {
      notes.push(`Support imposé introuvable dans l'univers : ${isin}`);
    }
  }

  const targets = normalizeTargets(constraints.classTargets);

  if (targets) {
    // 2) Sélection pilotée par les classes cibles : quotas par classe, puis
    // remplissage glouton — chaque tour ajoute le meilleur candidat toutes
    // classes non saturées confondues.
    const available: Record<string, number> = {};
    const byClass: Record<string, FundInput[]> = {};
    for (const f of funds) {
      available[f.assetClass] = (available[f.assetClass] ?? 0) + 1;
      (byClass[f.assetClass] ??= []).push(f);
    }
    // Créneaux déjà pris par les inclusions obligatoires, par classe.
    const taken: Record<string, number> = {};
    for (const f of selected) taken[f.assetClass] = (taken[f.assetClass] ?? 0) + 1;

    const budget = Math.min(maxAssets, funds.length);
    const slots = allocateSlots(targets, available, budget);

    for (;;) {
      if (selected.length >= maxAssets) break;
      const openPool: FundInput[] = [];
      for (const cls of Object.keys(slots)) {
        if ((taken[cls] ?? 0) < slots[cls]) openPool.push(...(byClass[cls] ?? []));
      }
      const f = pickBest(openPool);
      if (!f) break; // tous les créneaux servis ou saturés
      selected.push(f);
      chosen.add(f.isin);
      taken[f.assetClass] = (taken[f.assetClass] ?? 0) + 1;
    }

    for (const cls of Object.keys(targets)) {
      if (targets[cls] > 0 && !(available[cls] > 0)) {
        notes.push(
          `Aucun fonds disponible pour la classe « ${cls} » (${Math.round(targets[cls] * 10) / 10}% cible), poids redistribué.`,
        );
      }
    }
  }

  // 3) Complément glouton pour atteindre minAssets, toutes classes confondues.
  while (selected.length < minAssets && selected.length < maxAssets) {
    const f = pickBest(funds);
    if (!f) break;
    selected.push(f);
    chosen.add(f.isin);
  }

  // 4) Réparation de couverture géographique : chaque zone demandée doit être
  // représentée par un fonds actions. Ajout si un créneau reste, sinon échange
  // avec le fonds actions le plus faible (jamais un fonds imposé, jamais le
  // dernier représentant d'une autre zone demandée). Même classe → les quotas
  // de classes restent intacts.
  const mustSet = new Set(constraints.mustInclude ?? []);
  for (const z of coverage) {
    if (selected.some((f) => coversZone(f, z))) continue; // couverte entre-temps
    const candidates = funds
      .filter((f) => !chosen.has(f.isin) && coversZone(f, z))
      .sort(
        (a, b) =>
          diversifiedScore(b, selected, riskFree, correlationPenalty, corrOf) -
            diversifiedScore(a, selected, riskFree, correlationPenalty, corrOf) ||
          a.isin.localeCompare(b.isin),
      );
    const cand = candidates[0];
    if (!cand) {
      notes.push(
        `Zone « ${z.zone} » demandée : aucun fonds actions disponible pour la représenter dans cet univers.`,
      );
      continue;
    }
    if (selected.length < maxAssets) {
      selected.push(cand);
      chosen.add(cand.isin);
      continue;
    }
    const removable = selected.filter(
      (f) =>
        f.assetClass === "actions" &&
        !mustSet.has(f.isin) &&
        coverage.every(
          (oz) =>
            oz === z ||
            !coversZone(f, oz) ||
            selected.some((g) => g !== f && coversZone(g, oz)),
        ),
    );
    if (removable.length === 0) {
      notes.push(
        `Zone « ${z.zone} » demandée : impossible à représenter sans casser une autre contrainte.`,
      );
      continue;
    }
    removable.sort(
      (a, b) =>
        selectionScore(a, riskFree) - selectionScore(b, riskFree) ||
        a.isin.localeCompare(b.isin),
    );
    const out = removable[0];
    selected[selected.indexOf(out)] = cand;
    chosen.delete(out.isin);
    chosen.add(cand.isin);
    notes.push(
      `« ${out.name} » remplacé par « ${cand.name} » pour représenter la zone « ${z.zone} » demandée.`,
    );
  }

  if (selected.length < minAssets) {
    notes.push(
      `Univers trop petit : ${selected.length} fonds retenus (< ${minAssets} demandés).`,
    );
  }
  if (tieTol > 0) {
    notes.push(
      "Départage rémunération cabinet actif : à adéquation client équivalente, le fonds à la meilleure rétrocession (estimée) est retenu. Les critères client restent prioritaires.",
    );
  }
  return { selected, notes };
}

// ─── Optimisation des poids (max-Sharpe sous contraintes) ────────────────────

/** Normalise les cibles en fractions sommant à 1 ; null si absentes/vides. */
export function normalizeTargets(
  raw: Partial<Record<AssetClass, number>> | undefined,
): Record<string, number> | null {
  if (!raw) return null;
  const entries = Object.entries(raw).filter(([, v]) => (v ?? 0) > 0);
  if (entries.length === 0) return null;
  const sum = entries.reduce((s, [, v]) => s + (v as number), 0);
  const out: Record<string, number> = {};
  for (const [k, v] of entries) out[k] = ((v as number) / sum) * 100;
  return out;
}

/**
 * Contrainte de SRI moyen pondéré pour la projection des poids. Les SRI
 * inconnus (`null`) comptent comme `max` : ils sont neutres pour la contrainte,
 * ce qui la rend équivalente au SRI moyen renormalisé sur les SRI connus —
 * exactement la métrique restituée (`weightedAverage`).
 */
export interface SriConstraint {
  sri: (number | null)[];
  max: number;
}

/**
 * Projette un vecteur de poids sur l'ensemble réalisable :
 *  - poids ≥ 0 et ≤ cap ;
 *  - somme de chaque groupe de classe = sa cible (fraction) ;
 *  - SRI moyen pondéré ≤ plafond (si `sriConstraint` fourni) — projection sur
 *    le demi-espace Σ (sri_i − max)·w_i ≤ 0, qui déplace du poids des fonds
 *    risqués vers les défensifs.
 * Itère clip+renormalisation+demi-espace (façon Dykstra) puis termine par un
 * clip+renormalisation pour garantir EXACTEMENT les sommes de groupe (le SRI
 * est alors satisfait à la tolérance d'itération près ; l'insatisfiabilité
 * éventuelle est diagnostiquée par l'appelant).
 */
export function projectWeights(
  w: number[],
  groups: number[][],
  groupTargets: number[],
  cap: number,
  sriConstraint?: SriConstraint,
): number[] {
  const out = [...w];
  // Direction de la contrainte SRI : a_i = sri_i − max (inconnu → 0, neutre).
  const a = sriConstraint
    ? sriConstraint.sri.map((s) => (s == null ? 0 : s - sriConstraint.max))
    : null;
  const aNorm2 = a ? a.reduce((s, x) => s + x * x, 0) : 0;

  // Projection EXACTE d'un groupe sur { 0 ≤ w ≤ cap, Σ = cible } : bissection
  // sur le décalage θ tel que Σ clamp(w_i − θ, 0, cap) = cible. Contrairement à
  // l'ancien écrêtage + renormalisation multiplicative (qui oscillait sans
  // converger quand la masse se concentrait sur peu de fonds, laissant des
  // poids AU-DESSUS du plafond), l'excédent se déverse ici sur les autres
  // fonds du groupe.
  const projectGroup = (idx: number[], target: number): void => {
    if (idx.length === 0) return;
    if (idx.length * cap <= target + 1e-12) {
      // Plafond infaisable pour ce groupe (cas neutralisé en amont par le
      // relèvement du cap) : saturation uniforme, meilleur point atteignable.
      for (const i of idx) out[i] = cap;
      return;
    }
    let lo = Math.min(...idx.map((i) => out[i])) - cap - 1;
    let hi = Math.max(...idx.map((i) => out[i])) + 1;
    for (let k = 0; k < 60; k++) {
      const th = (lo + hi) / 2;
      const s = idx.reduce((acc, i) => acc + Math.min(Math.max(out[i] - th, 0), cap), 0);
      if (s > target) lo = th;
      else hi = th;
    }
    const th = (lo + hi) / 2;
    for (const i of idx) out[i] = Math.min(Math.max(out[i] - th, 0), cap);
  };
  const projectGroups = (): void => {
    for (let g = 0; g < groups.length; g++) projectGroup(groups[g], groupTargets[g]);
  };

  projectGroups();
  // Alternance demi-espace SRI ↔ groupes (façon Dykstra) ; on TERMINE par les
  // groupes pour garantir exactement bornes et sommes (le SRI est alors
  // satisfait à la tolérance d'itération près, diagnostiqué par l'appelant).
  if (a && aNorm2 > 1e-12) {
    for (let iter = 0; iter < 60; iter++) {
      const d = a.reduce((s, ai, i) => s + ai * out[i], 0);
      if (d <= 1e-12) break;
      for (let i = 0; i < out.length; i++) out[i] -= (d * a[i]) / aNorm2;
      projectGroups();
    }
  }
  return out;
}

/** Rendement, volatilité et Sharpe d'un portefeuille de poids `w` (fractions). */
export function portfolioStats(
  w: number[],
  mu: number[],
  cov: number[][],
  riskFree: number,
): { ret: number; vol: number; sharpe: number } {
  const n = w.length;
  let ret = 0;
  for (let i = 0; i < n; i++) ret += w[i] * mu[i];
  let variance = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) variance += w[i] * cov[i][j] * w[j];
  const vol = Math.sqrt(Math.max(variance, 0));
  const sharpe = vol > 1e-9 ? (ret - riskFree) / vol : 0;
  return { ret, vol, sharpe };
}

/**
 * Maximise le ratio de Sharpe par montée de gradient projetée. Départ = poids
 * cibles répartis uniformément dans chaque classe ; à chaque pas on suit le
 * gradient de Sharpe puis on reprojette sur l'ensemble réalisable. On conserve
 * le meilleur point réalisable rencontré. Déterministe.
 */
export function maximizeSharpe(
  mu: number[],
  cov: number[][],
  groups: number[][],
  groupTargets: number[],
  cap: number,
  riskFree: number,
  sriConstraint?: SriConstraint,
): number[] {
  const n = mu.length;
  // Départ : cible répartie uniformément dans chaque groupe (déjà réalisable).
  let w = new Array(n).fill(0);
  for (let g = 0; g < groups.length; g++) {
    const idx = groups[g];
    const even = groupTargets[g] / idx.length;
    for (const i of idx) w[i] = even;
  }
  w = projectWeights(w, groups, groupTargets, cap, sriConstraint);

  let best = [...w];
  let bestSharpe = portfolioStats(w, mu, cov, riskFree).sharpe;

  let lr = 0.5;
  for (let iter = 0; iter < 400; iter++) {
    const { ret, vol } = portfolioStats(w, mu, cov, riskFree);
    if (vol <= 1e-9) break;
    // ∇Sharpe = μ/σ − (μᵀw − rf)·(Σw)/σ³
    const excess = ret - riskFree;
    const sigma3 = vol * vol * vol;
    const grad = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let cw = 0;
      for (let j = 0; j < n; j++) cw += cov[i][j] * w[j];
      grad[i] = mu[i] / vol - (excess * cw) / sigma3;
    }
    // Normalise le gradient (stabilité) et fait un pas décroissant.
    const gnorm = Math.sqrt(grad.reduce((s, x) => s + x * x, 0)) || 1;
    const step = (lr / gnorm) * (1 - iter / 400);
    const next = w.map((wi, i) => wi + step * grad[i]);
    w = projectWeights(next, groups, groupTargets, cap, sriConstraint);

    const s = portfolioStats(w, mu, cov, riskFree).sharpe;
    if (s > bestSharpe) {
      bestSharpe = s;
      best = [...w];
    }
    lr *= 0.997;
  }
  return best;
}

// ─── Orchestration ───────────────────────────────────────────────────────────

/**
 * Optimise l'allocation complète : sélection des supports, construction de la
 * covariance depuis la corrélation fournie, maximisation du Sharpe sous
 * contraintes de classes et de plafond, puis statistiques et diversification.
 *
 * @param funds     univers candidat (déjà pré-filtré au contrat en amont)
 * @param corrOf    corrélation entre deux ISIN (ou null si inconnue)
 */
export function optimizeAllocation(
  funds: FundInput[],
  corrOf: (a: string, b: string) => number | null,
  partial: Partial<OptimizerConstraints> = {},
): AllocationResult {
  const constraints: OptimizerConstraints = { ...DEFAULT_CONSTRAINTS, ...partial };
  const { selected, notes } = selectFunds(funds, constraints, corrOf);

  if (selected.length === 0) {
    return {
      lines: [],
      method: constraints.method,
      expectedReturn: 0,
      volatility: 0,
      sharpe: 0,
      weightedSri: null,
      classWeights: {},
      diversification: { effectiveHoldings: 0, averageCorrelation: null, assetClasses: 0 },
      notes: [...notes, "Aucun fonds sélectionnable."],
    };
  }

  const n = selected.length;
  const mu = selected.map((f) => f.expectedReturn);
  const vols = selected.map((f) => f.volatility);

  // Matrice de corrélation du sous-ensemble retenu. Les paires sans historique
  // commun exploitable (null) reçoivent le prior de leur paire de classes
  // d'actifs — jamais 0, qui ferait passer un trou de données pour de la
  // diversification parfaite.
  const corr: (number | null)[][] = selected.map((fi, i) =>
    selected.map((fj, j) => (i === j ? 1 : corrOf(fi.isin, fj.isin))),
  );
  const missing = missingPairCount(corr);
  if (missing > 0) {
    notes.push(
      `${missing} paire(s) de fonds sans historique commun suffisant : corrélation prudente par classe d'actifs appliquée.`,
    );
  }
  const cov = covarianceMatrix(vols, corr, (i, j) =>
    classCorrelation(selected[i].assetClass, selected[j].assetClass),
  );

  // Groupes de contraintes : par classe cible, sinon un seul groupe = 100 %.
  const targets = normalizeTargets(constraints.classTargets);
  const { groups, groupTargets, adjNotes } = buildGroups(selected, targets);
  notes.push(...adjNotes);

  // Plafond effectif : au moins target/taille pour que chaque groupe soit faisable.
  let cap = constraints.maxWeightPerFund;
  for (let g = 0; g < groups.length; g++) {
    const needed = groupTargets[g] / groups[g].length;
    if (needed > cap) cap = needed; // sinon le groupe ne peut pas atteindre sa cible
  }
  if (cap > constraints.maxWeightPerFund + 1e-9) {
    notes.push(
      `Plafond par fonds relevé à ${(cap * 100).toFixed(0)}% : une classe a trop peu de supports pour respecter ${(constraints.maxWeightPerFund * 100).toFixed(0)}%.`,
    );
  }

  // Plafond de SRI moyen pondéré : contrainte DURE de l'optimisation (projection
  // à chaque pas), pas un simple avertissement après coup.
  const sriConstraint: SriConstraint | undefined =
    constraints.maxWeightedSri != null
      ? { sri: selected.map((f) => f.sri ?? null), max: constraints.maxWeightedSri }
      : undefined;

  let wFrac: number[];
  if (constraints.method === "hrp") {
    // HRP : poids par budgets de risque hiérarchiques (aucun rendement attendu),
    // puis projection sur les contraintes produit — les cibles de classes fixent
    // les poids INTER-classes, HRP conserve les rapports INTRA-classe.
    const corrFilled = corr.map((row, i) =>
      row.map((c, j) =>
        i === j ? 1 : c ?? classCorrelation(selected[i].assetClass, selected[j].assetClass),
      ),
    );
    const raw = hrpWeights(cov, corrFilled);
    wFrac = projectWeights(raw, groups, groupTargets, cap, sriConstraint);
    notes.push(
      "Pondération HRP (hierarchical risk parity) : répartition par budgets de risque hiérarchiques, indépendante des rendements attendus.",
    );
  } else {
    wFrac = maximizeSharpe(
      mu,
      cov,
      groups,
      groupTargets,
      cap,
      constraints.riskFree,
      sriConstraint,
    );
  }
  const stats = portfolioStats(wFrac, mu, cov, constraints.riskFree);

  // SRI moyen pondéré (ignore les SRI manquants en renormalisant leur poids).
  const weightedSri = weightedAverage(
    selected.map((f) => f.sri ?? null),
    wFrac,
  );
  // Encore au-dessus après optimisation sous contrainte : le plafond est
  // insatisfiable avec ce panier (classes cibles trop offensives / plafond par
  // fonds) — on le dit, on ne le masque pas.
  if (
    constraints.maxWeightedSri != null &&
    weightedSri != null &&
    weightedSri > constraints.maxWeightedSri + 0.05
  ) {
    notes.push(
      `SRI moyen pondéré ${weightedSri.toFixed(1)} > plafond ${constraints.maxWeightedSri} malgré la contrainte : insatisfiable avec ces fonds. Durcir les cibles vers les classes défensives.`,
    );
  }

  const classWeights: Partial<Record<AssetClass, number>> = {};
  selected.forEach((f, i) => {
    classWeights[f.assetClass] = (classWeights[f.assetClass] ?? 0) + wFrac[i] * 100;
  });

  const lines: AllocationLine[] = selected
    .map((f, i) => ({
      isin: f.isin,
      name: f.name,
      assetClass: f.assetClass,
      category: f.category ?? null,
      weight: Math.round(wFrac[i] * 1000) / 10,
      sri: f.sri ?? null,
      sfdr: f.sfdr ?? null,
      ter: f.ter ?? null,
      retrocession: f.retrocession ?? null,
      rating: f.rating ?? null,
      region: f.region ?? null,
      expectedReturn: f.expectedReturn,
      volatility: f.volatility,
    }))
    .sort((a, b) => b.weight - a.weight);

  const effectiveHoldings = 1 / Math.max(wFrac.reduce((s, x) => s + x * x, 0), 1e-12);

  return {
    lines,
    method: constraints.method,
    expectedReturn: stats.ret,
    volatility: stats.vol,
    sharpe: stats.sharpe,
    weightedSri,
    classWeights,
    diversification: {
      effectiveHoldings,
      averageCorrelation: averagePairwiseCorrelation(corr),
      assetClasses: new Set(selected.map((f) => f.assetClass)).size,
    },
    notes,
  };
}

/**
 * Recalcule un `AllocationResult` avec des poids IMPOSÉS par le conseiller
 * (curseurs de simulation du studio) : mêmes lignes, poids normalisés à 100 %,
 * et toutes les statistiques recalculées (rendement, volatilité, Sharpe, SRI
 * moyen pondéré, poids par classe, nombre effectif de lignes). L'ordre des
 * lignes est conservé (pas de re-tri : les curseurs ne doivent pas sauter).
 * Renvoie le résultat d'origine tel quel si les poids sont inutilisables
 * (longueur différente, total nul).
 *
 * @param weightsPct poids en POURCENTAGES (mêmes unités que les curseurs)
 * @param cov        covariance alignée sur result.lines
 */
export function reweightAllocation(
  result: AllocationResult,
  weightsPct: number[],
  cov: number[][],
  riskFree: number = DEFAULT_CONSTRAINTS.riskFree,
): AllocationResult {
  const n = result.lines.length;
  if (weightsPct.length !== n || cov.length !== n || n === 0) return result;
  const total = weightsPct.reduce((s, x) => s + Math.max(0, x), 0);
  if (total <= 1e-9) return result;

  const wFrac = weightsPct.map((x) => Math.max(0, x) / total);
  const mu = result.lines.map((l) => l.expectedReturn);
  const stats = portfolioStats(wFrac, mu, cov, riskFree);
  const weightedSri = weightedAverage(
    result.lines.map((l) => l.sri ?? null),
    wFrac,
  );
  const classWeights: Partial<Record<AssetClass, number>> = {};
  result.lines.forEach((l, i) => {
    classWeights[l.assetClass] = (classWeights[l.assetClass] ?? 0) + wFrac[i] * 100;
  });
  const lines = result.lines.map((l, i) => ({
    ...l,
    weight: Math.round(wFrac[i] * 1000) / 10,
  }));
  const effectiveHoldings = 1 / Math.max(wFrac.reduce((s, x) => s + x * x, 0), 1e-12);

  return {
    ...result,
    lines,
    expectedReturn: stats.ret,
    volatility: stats.vol,
    sharpe: stats.sharpe,
    weightedSri,
    classWeights,
    diversification: { ...result.diversification, effectiveHoldings },
    notes: [
      ...result.notes,
      "Poids ajustés manuellement par le conseiller. Statistiques recalculées sur la pondération simulée.",
    ],
  };
}

/**
 * Construit les groupes de contraintes de classe. Redistribue la cible des
 * classes sans fonds retenu vers les classes présentes (au prorata). Sans
 * cibles, un seul groupe rassemble tous les fonds (somme = 100 %).
 */
export function buildGroups(
  selected: FundInput[],
  targets: Record<string, number> | null,
): { groups: number[][]; groupTargets: number[]; adjNotes: string[] } {
  const adjNotes: string[] = [];
  if (!targets) {
    return {
      groups: [selected.map((_, i) => i)],
      groupTargets: [1],
      adjNotes,
    };
  }
  const idxByClass: Record<string, number[]> = {};
  selected.forEach((f, i) => (idxByClass[f.assetClass] ??= []).push(i));

  const present = Object.keys(targets).filter((c) => (idxByClass[c]?.length ?? 0) > 0);
  const presentSum = present.reduce((s, c) => s + targets[c], 0);
  if (presentSum <= 0) {
    return { groups: [selected.map((_, i) => i)], groupTargets: [1], adjNotes };
  }

  const groups: number[][] = [];
  const groupTargets: number[] = [];
  for (const c of present) {
    groups.push(idxByClass[c]);
    // Renormalise sur les seules classes présentes → somme des cibles = 1.
    groupTargets.push(targets[c] / presentSum);
  }
  return { groups, groupTargets, adjNotes };
}

/** Moyenne pondérée ignorant les valeurs nulles (renormalise leur poids). */
export function weightedAverage(
  values: (number | null)[],
  weights: number[],
): number | null {
  let acc = 0;
  let wsum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) {
      acc += v * weights[i];
      wsum += weights[i];
    }
  }
  return wsum > 0 ? acc / wsum : null;
}
