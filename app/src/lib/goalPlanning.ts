// Goal-based : analyse des projets du client — fonctions PURES.
//
// Pour un projet (capital de départ, épargne mensuelle, horizon, montant
// cible), deux questions :
//  1. quel rendement annualisé FAUT-IL pour atteindre la cible ?
//     (`requiredAnnualReturn` — résolution par bissection, versements
//     capitalisés mensuellement)
//  2. quelle est la PROBABILITÉ d'y arriver avec le portefeuille proposé
//     (μ, σ annualisés) ? (`goalSuccessProbability` — approximation
//     log-normale : le rendement annualisé réalisé sur n années suit
//     N(m, s²/n) avec m = ln(1+μ) − s²/2 et s ≈ σ/(1+μ) ; la probabilité est
//     Φ((m − ln(1+r_requis))·√n / s).)
//
// C'est une approximation honnête et assumée — PAS une simulation Monte Carlo
// complète : les versements sont supposés suivre la même loi que le capital
// (en réalité leurs horizons plus courts resserrent un peu la dispersion).
// Suffisant pour ordonner les projets et nourrir la conversation client ;
// à affiner par simulation si le besoin devient réglementaire.

import type { ClientGoal, GoalPriority } from "./clientProfile";

export interface GoalPlan {
  /** Capital de départ affecté (€, ≥ 0). */
  initial: number;
  /** Épargne mensuelle affectée (€, ≥ 0). */
  monthly: number;
  /** Horizon en années (> 0). */
  years: number;
  /** Montant cible (€, > 0). */
  target: number;
}

/** Valeur future du plan au taux annuel `r` (capitalisation mensuelle). */
export function futureValue(plan: GoalPlan, r: number): number {
  const m = Math.round(plan.years * 12);
  const i = Math.pow(1 + r, 1 / 12) - 1;
  const growth = Math.pow(1 + i, m);
  const contrib =
    Math.abs(i) < 1e-12 ? plan.monthly * m : plan.monthly * ((growth - 1) / i);
  return plan.initial * growth + contrib;
}

/** Borne haute de recherche : au-delà de +100 %/an, la cible est « hors de portée ». */
const R_MAX = 1.0;
const R_MIN = -0.99;

/**
 * Rendement annualisé requis pour atteindre la cible, en fraction.
 * `null` si le plan est invalide (pas d'horizon, pas de cible, aucun moyen) ou
 * si même +100 %/an n'y suffirait pas (cible hors de portée — à afficher comme
 * telle). Peut être négatif : la cible est alors déjà « sécurisée » par le
 * simple rythme d'épargne.
 */
export function requiredAnnualReturn(plan: GoalPlan): number | null {
  if (plan.years <= 0 || plan.target <= 0) return null;
  if (plan.initial <= 0 && plan.monthly <= 0) return null;
  if (futureValue(plan, R_MAX) < plan.target) return null; // hors de portée
  if (futureValue(plan, R_MIN) >= plan.target) return R_MIN;

  let lo = R_MIN;
  let hi = R_MAX;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (futureValue(plan, mid) >= plan.target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Fonction de répartition de la loi normale centrée réduite (Abramowitz-Stegun). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/**
 * Probabilité (0–1) d'atteindre la cible du plan avec un portefeuille de
 * rendement attendu `mu` et volatilité `sigma` (fractions annualisées).
 * `null` si le plan est invalide ; 0 si la cible exige plus de +100 %/an.
 */
export function goalSuccessProbability(
  plan: GoalPlan,
  mu: number,
  sigma: number,
): number | null {
  if (plan.years <= 0 || plan.target <= 0) return null;
  if (plan.initial <= 0 && plan.monthly <= 0) return null;

  const rReq = requiredAnnualReturn(plan);
  if (rReq === null) return 0; // hors de portée, même à +100 %/an

  if (sigma <= 1e-9) return mu >= rReq ? 1 : 0; // portefeuille sans aléa

  const s = sigma / (1 + mu); // vol log approchée
  const m = Math.log(1 + mu) - (s * s) / 2; // drift log (traînée de volatilité)
  const z = ((m - Math.log(1 + rReq)) * Math.sqrt(plan.years)) / s;
  return Math.min(1, Math.max(0, normCdf(z)));
}

// ─── Simulation Monte Carlo ───────────────────────────────────────────────────
// Plus fidèle que l'approximation log-normale ci-dessus : chaque trajectoire
// simule le portefeuille MOIS PAR MOIS (rendement log-normal + versement),
// donc les versements vivent leur vraie vie (un versement récent a moins de
// temps de marché qu'un versement ancien). PRNG déterministe (seed fixe) :
// mêmes entrées → même probabilité, testable et stable à l'écran.

/** PRNG mulberry32 — rapide, déterministe, largement suffisant ici. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface McOptions {
  /** Nombre de trajectoires (défaut 2000). */
  paths?: number;
  /** Graine du PRNG (défaut 42) — même graine, même résultat. */
  seed?: number;
}

/**
 * Probabilité (0–1) d'atteindre la cible, par simulation Monte Carlo :
 * rendements mensuels log-normaux tirés de (μ, σ) annualisés, versement ajouté
 * en fin de mois, succès si la richesse finale atteint la cible.
 * `null` si le plan est invalide. Déterministe à graine fixée.
 */
export function goalSuccessProbabilityMC(
  plan: GoalPlan,
  mu: number,
  sigma: number,
  opts: McOptions = {},
): number | null {
  if (plan.years <= 0 || plan.target <= 0) return null;
  if (plan.initial <= 0 && plan.monthly <= 0) return null;
  if (sigma <= 1e-9) return futureValue(plan, mu) >= plan.target ? 1 : 0;

  const paths = Math.max(100, Math.round(opts.paths ?? 2000));
  const rand = mulberry32(opts.seed ?? 42);
  const months = Math.round(plan.years * 12);

  // Paramètres log mensuels : E[ln(1+R_an)] = ln(1+μ) − s²/2, s ≈ σ/(1+μ).
  const s = sigma / (1 + mu);
  const driftM = (Math.log(1 + mu) - (s * s) / 2) / 12;
  const volM = s / Math.sqrt(12);

  // Tirages normaux par Box-Muller (deux par itération, on garde les deux).
  let spare: number | null = null;
  const gauss = (): number => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u <= 1e-12) u = rand();
    v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

  let successes = 0;
  for (let p = 0; p < paths; p++) {
    let wealth = plan.initial;
    for (let t = 0; t < months; t++) {
      wealth = wealth * Math.exp(driftM + volM * gauss()) + plan.monthly;
    }
    if (wealth >= plan.target) successes += 1;
  }
  return successes / paths;
}

// ─── Poches par projet ────────────────────────────────────────────────────────
// Chaque projet est une POCHE SÉPARÉE : son capital, son épargne (jamais mis en
// commun avec les autres projets) et sa propre allocation, calibrée sur SON
// horizon et SA priorité — pas sur le portefeuille global.

/**
 * Plafond de SRI de la poche d'un projet. Capacité par horizon (même échelle
 * que le profil : court terme → défensif), durcie d'un cran si le projet est
 * vital (son échec n'est pas acceptable), et JAMAIS au-dessus du plafond global
 * du client (adéquation MIF : la tolérance du client reste la borne).
 */
export function pocketSriCap(
  horizonYears: number,
  priority: GoalPriority,
  profileCap: number | null,
): number {
  let cap: number;
  if (horizonYears <= 3) cap = 2;
  else if (horizonYears <= 5) cap = 4;
  else if (horizonYears <= 10) cap = 6;
  else cap = 7;
  if (priority === "vital") cap = Math.max(1, cap - 1);
  if (profileCap != null) cap = Math.min(cap, profileCap);
  return cap;
}

/**
 * Convertit un projet du profil client en plan analysable, ou `null` s'il est
 * trop incomplet (pas de cible ou pas d'horizon).
 */
export function goalToPlan(g: ClientGoal): GoalPlan | null {
  if (g.target_eur == null || g.target_eur <= 0) return null;
  if (g.horizon_years == null || g.horizon_years <= 0) return null;
  return {
    initial: Math.max(0, g.initial_eur ?? 0),
    monthly: Math.max(0, g.monthly_eur ?? 0),
    years: g.horizon_years,
    target: g.target_eur,
  };
}
