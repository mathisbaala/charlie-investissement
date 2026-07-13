// Frontière efficiente (Markowitz) — fonctions PURES et déterministes, dans le
// prolongement du moteur `optimizer.ts` (mêmes conventions : fractions partout,
// pas de hasard, descente de gradient projetée).
//
// Sert le graphique risque/rendement de la page allocation : pour l'ensemble
// des supports retenus, on trace l'enveloppe des portefeuilles optimaux
// { w ≥ 0, Σw = 1 } en balayant l'aversion au risque γ de l'objectif
// max  μᵀw − γ·wᵀΣw. γ grand → portefeuille de variance minimale ;
// γ → 0 → portefeuille 100 % sur l'actif au rendement maximal.

import { portfolioStats } from "./optimizer";

export interface FrontierPoint {
  /** Volatilité annualisée (fraction). */
  vol: number;
  /** Rendement annualisé attendu (fraction). */
  ret: number;
}

/**
 * Projection euclidienne exacte sur le simplexe { w ≥ 0, Σw = 1 }
 * (algorithme par tri de Held/Wolfe — classique et déterministe).
 */
export function projectToSimplex(w: number[]): number[] {
  const n = w.length;
  if (n === 0) return [];
  const sorted = [...w].sort((a, b) => b - a);
  let cum = 0;
  let theta = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    cum += sorted[i];
    const t = (cum - 1) / (i + 1);
    if (sorted[i] - t > 0) {
      k = i + 1;
      theta = t;
    }
  }
  // k ≥ 1 toujours (pour i=0 : sorted[0] − (sorted[0]−1) = 1 > 0).
  void k;
  return w.map((x) => Math.max(0, x - theta));
}

/**
 * Minimise γ·wᵀΣw − μᵀw sur le simplexe par descente de gradient projetée.
 * Départ uniforme (déterministe), pas décroissant, gradient normalisé
 * (stabilité — même recette que `maximizeSharpe`).
 */
function solveTradeoff(mu: number[], cov: number[][], gamma: number): number[] {
  const n = mu.length;
  let w = new Array(n).fill(1 / n);
  let best = [...w];
  let bestObj = objective(w, mu, cov, gamma);

  let lr = 0.5;
  for (let iter = 0; iter < 300; iter++) {
    const grad = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let cw = 0;
      for (let j = 0; j < n; j++) cw += cov[i][j] * w[j];
      grad[i] = 2 * gamma * cw - mu[i];
    }
    const gnorm = Math.sqrt(grad.reduce((s, x) => s + x * x, 0)) || 1;
    const step = (lr / gnorm) * (1 - iter / 300);
    w = projectToSimplex(w.map((wi, i) => wi - step * grad[i]));

    const obj = objective(w, mu, cov, gamma);
    if (obj < bestObj) {
      bestObj = obj;
      best = [...w];
    }
    lr *= 0.995;
  }
  return best;
}

function objective(w: number[], mu: number[], cov: number[][], gamma: number): number {
  const n = w.length;
  let ret = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    ret += w[i] * mu[i];
    for (let j = 0; j < n; j++) variance += w[i] * cov[i][j] * w[j];
  }
  return gamma * variance - ret;
}

/**
 * Frontière efficiente de l'univers (μ, Σ) sous { w ≥ 0, Σw = 1 } :
 * balaye γ (log-espacé), collecte les portefeuilles optimaux, puis ne garde
 * que l'enveloppe efficiente (à partir du portefeuille de variance minimale,
 * rendement croissant avec la volatilité). Renvoie des points triés par
 * volatilité croissante. Déterministe. [] si moins de 1 actif.
 */
export function efficientFrontier(
  mu: number[],
  cov: number[][],
  sweeps = 33,
): FrontierPoint[] {
  const n = mu.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{ vol: Math.sqrt(Math.max(cov[0][0], 0)), ret: mu[0] }];
  }

  const raw: FrontierPoint[] = [];
  // γ de 10³ (quasi min-variance) à 10⁻³ (quasi max-rendement), log-espacé.
  for (let k = 0; k < sweeps; k++) {
    const gamma = Math.pow(10, 3 - (6 * k) / (sweeps - 1));
    const w = solveTradeoff(mu, cov, gamma);
    const { ret, vol } = portfolioStats(w, mu, cov, 0);
    raw.push({ vol, ret });
  }
  // Coin max-rendement exact : 100 % sur le meilleur actif (départage : vol min).
  let iMax = 0;
  for (let i = 1; i < n; i++) {
    if (
      mu[i] > mu[iMax] ||
      (mu[i] === mu[iMax] && cov[i][i] < cov[iMax][iMax])
    ) {
      iMax = i;
    }
  }
  raw.push({ vol: Math.sqrt(Math.max(cov[iMax][iMax], 0)), ret: mu[iMax] });

  // Enveloppe efficiente : tri par volatilité, on ne garde que les points qui
  // améliorent strictement le rendement (branche supérieure de l'hyperbole).
  raw.sort((a, b) => a.vol - b.vol || b.ret - a.ret);
  const out: FrontierPoint[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(p);
    } else if (p.ret > last.ret + 1e-12) {
      // Écarte aussi les quasi-doublons horizontaux (bruit numérique du solveur).
      if (p.vol > last.vol + 1e-9) out.push(p);
      else out[out.length - 1] = { vol: Math.max(last.vol, p.vol), ret: p.ret };
    }
  }
  return out;
}
