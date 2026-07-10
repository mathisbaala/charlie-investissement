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
// Fonctions PURES et déterministes (mêmes entrées → même sortie) : tout le
// hasard est proscrit, l'optimiseur part d'un point initial fixe et itère.
// Le calcul des corrélations vit dans `./correlation` + le RPC SQL jumeau.

import { covarianceMatrix, averagePairwiseCorrelation } from "./correlation";

/** Classes d'actifs canoniques manipulées par le moteur (buckets d'allocation). */
export type AssetClass =
  | "actions"
  | "obligations"
  | "monetaire"
  | "diversifie"
  | "immobilier"
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
  /** Article SFDR 6/8/9 — restitution durabilité. */
  sfdr?: number | null;
  managementStyle?: string | null;
  gestionnaire?: string | null;
  region?: string | null;
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
}

export const DEFAULT_CONSTRAINTS: OptimizerConstraints = {
  minAssets: 4,
  maxAssets: 7,
  maxWeightPerFund: 0.35,
  maxWeightedSri: null,
  riskFree: 0.02,
  mustInclude: [],
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
  expectedReturn: number;
  volatility: number;
}

export interface AllocationResult {
  lines: AllocationLine[];
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
 * Sélectionne les fonds : respecte les créneaux par classe, inclut d'office les
 * `mustInclude`, et complète pour atteindre au moins `minAssets` si les cibles
 * n'y suffisent pas. Renvoie les fonds retenus (au plus `maxAssets`).
 */
export function selectFunds(
  funds: FundInput[],
  constraints: OptimizerConstraints,
): { selected: FundInput[]; notes: string[] } {
  const notes: string[] = [];
  const { minAssets, maxAssets, riskFree } = constraints;
  const byIsin = new Map(funds.map((f) => [f.isin, f]));

  // Classement global décroissant par score (stable via ISIN pour déterminisme).
  const ranked = [...funds].sort((a, b) => {
    const d = selectionScore(b, riskFree) - selectionScore(a, riskFree);
    return d !== 0 ? d : a.isin.localeCompare(b.isin);
  });

  const selected: FundInput[] = [];
  const chosen = new Set<string>();

  // 1) Inclusions obligatoires.
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
    // 2) Sélection pilotée par les classes cibles.
    const available: Record<string, number> = {};
    const rankedByClass: Record<string, FundInput[]> = {};
    for (const f of ranked) {
      available[f.assetClass] = (available[f.assetClass] ?? 0) + 1;
      (rankedByClass[f.assetClass] ??= []).push(f);
    }
    // Créneaux déjà pris par les inclusions obligatoires, par classe.
    const forced: Record<string, number> = {};
    for (const f of selected) forced[f.assetClass] = (forced[f.assetClass] ?? 0) + 1;

    const budget = Math.min(maxAssets, funds.length);
    const slots = allocateSlots(targets, available, budget);

    for (const cls of Object.keys(slots)) {
      const want = slots[cls] - (forced[cls] ?? 0);
      let taken = 0;
      for (const f of rankedByClass[cls] ?? []) {
        if (taken >= want || selected.length >= maxAssets) break;
        if (chosen.has(f.isin)) continue;
        selected.push(f);
        chosen.add(f.isin);
        taken += 1;
      }
    }
    for (const cls of Object.keys(targets)) {
      if (targets[cls] > 0 && !(available[cls] > 0)) {
        notes.push(
          `Aucun fonds disponible pour la classe « ${cls} » (${targets[cls]}% cible) — poids redistribué.`,
        );
      }
    }
  }

  // 3) Complément pour atteindre minAssets (par score global).
  for (const f of ranked) {
    if (selected.length >= Math.max(minAssets, selected.length)) {
      if (selected.length >= minAssets) break;
    }
    if (selected.length >= maxAssets) break;
    if (!chosen.has(f.isin)) {
      selected.push(f);
      chosen.add(f.isin);
    }
  }

  if (selected.length < minAssets) {
    notes.push(
      `Univers trop petit : ${selected.length} fonds retenus (< ${minAssets} demandés).`,
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
 * Projette un vecteur de poids sur l'ensemble réalisable :
 *  - poids ≥ 0 et ≤ cap ;
 *  - somme de chaque groupe de classe = sa cible (fraction).
 * Itère clip+renormalisation par groupe (façon Dykstra) pour satisfaire les deux.
 */
export function projectWeights(
  w: number[],
  groups: number[][],
  groupTargets: number[],
  cap: number,
): number[] {
  const out = [...w];
  for (let iter = 0; iter < 30; iter++) {
    // Clip [0, cap].
    for (let i = 0; i < out.length; i++) {
      if (out[i] < 0) out[i] = 0;
      else if (out[i] > cap) out[i] = cap;
    }
    // Renormalise chaque groupe à sa cible.
    let maxErr = 0;
    for (let g = 0; g < groups.length; g++) {
      const idx = groups[g];
      const target = groupTargets[g];
      const sum = idx.reduce((s, i) => s + out[i], 0);
      if (sum <= 1e-12) {
        // Groupe effondré : répartition uniforme sur la cible.
        const even = target / idx.length;
        for (const i of idx) out[i] = even;
      } else {
        const scale = target / sum;
        for (const i of idx) out[i] *= scale;
      }
      maxErr = Math.max(maxErr, Math.abs(idx.reduce((s, i) => s + out[i], 0) - target));
    }
    if (maxErr < 1e-9) break;
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
): number[] {
  const n = mu.length;
  // Départ : cible répartie uniformément dans chaque groupe (déjà réalisable).
  let w = new Array(n).fill(0);
  for (let g = 0; g < groups.length; g++) {
    const idx = groups[g];
    const even = groupTargets[g] / idx.length;
    for (const i of idx) w[i] = even;
  }
  w = projectWeights(w, groups, groupTargets, cap);

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
    w = projectWeights(next, groups, groupTargets, cap);

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
  const { selected, notes } = selectFunds(funds, constraints);

  if (selected.length === 0) {
    return {
      lines: [],
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

  // Matrice de corrélation du sous-ensemble retenu.
  const corr: (number | null)[][] = selected.map((fi, i) =>
    selected.map((fj, j) => (i === j ? 1 : corrOf(fi.isin, fj.isin))),
  );
  const cov = covarianceMatrix(vols, corr, 0);

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

  const wFrac = maximizeSharpe(mu, cov, groups, groupTargets, cap, constraints.riskFree);
  const stats = portfolioStats(wFrac, mu, cov, constraints.riskFree);

  // SRI moyen pondéré (ignore les SRI manquants en renormalisant leur poids).
  const weightedSri = weightedAverage(
    selected.map((f) => f.sri ?? null),
    wFrac,
  );
  if (
    constraints.maxWeightedSri != null &&
    weightedSri != null &&
    weightedSri > constraints.maxWeightedSri + 1e-6
  ) {
    notes.push(
      `SRI moyen pondéré ${weightedSri.toFixed(1)} > plafond ${constraints.maxWeightedSri} : durcir les cibles vers les classes défensives.`,
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
      expectedReturn: f.expectedReturn,
      volatility: f.volatility,
    }))
    .sort((a, b) => b.weight - a.weight);

  const effectiveHoldings = 1 / wFrac.reduce((s, x) => s + x * x, 0 || 1e-12);

  return {
    lines,
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
