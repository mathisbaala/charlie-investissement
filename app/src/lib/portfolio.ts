// Types + helpers purs du moteur portefeuille (étape A/B/C).
// Le calcul lourd (courbe, ratios, corrélation) vit dans le RPC SQL
// inv_portfolio_analyze ; ici on ne fait que (dé)sérialiser le portefeuille
// pour le lien partageable et normaliser les poids côté UI.

export interface PortfolioRatios {
  total_return: number | null;
  annual_return: number | null;
  volatility: number | null;
  sharpe: number | null;
  max_drawdown: number | null;
}

export interface PortfolioCurvePoint {
  d: string;
  v: number;
}

export interface PortfolioFundStat {
  isin: string;
  weight: number;
  volatility: number | null;
  total_return: number | null;
}

export interface PortfolioCorrelation {
  a: string;
  b: string;
  c: number | null;
}

export interface PortfolioMeta {
  requested: number;
  used: number;
  excluded: string[];
  start: string | null;
  end: string | null;
  n_weeks: number | null;
  rf_pct: number;
}

export interface PortfolioBenchmark {
  code: string;
  label: string;
  total_return: number | null;
  annual_return: number | null;
  volatility: number | null;
  sharpe: number | null;
  max_drawdown: number | null;
  curve: PortfolioCurvePoint[];
}

export interface PortfolioAnalysis {
  meta: PortfolioMeta;
  ratios: PortfolioRatios;
  curve: PortfolioCurvePoint[];
  funds: PortfolioFundStat[];
  correlation: PortfolioCorrelation[];
  benchmark?: PortfolioBenchmark | null;
  names?: Record<string, string>;
  error?: string;
}

/** Indices de référence proposés pour le back-test (codes investissement_index_catalog). */
export const BENCHMARK_OPTIONS: { code: string; label: string }[] = [
  { code: "msci_world", label: "MSCI World — actions monde" },
  { code: "sp500", label: "S&P 500 — actions US" },
  { code: "cac40_gr", label: "CAC 40 (dividendes réinvestis)" },
  { code: "eurostoxx50", label: "Euro Stoxx 50" },
  { code: "mix_75_25", label: "Diversifié dynamique (75/25)" },
  { code: "mix_50_50", label: "Diversifié équilibré (50/50)" },
  { code: "mix_25_75", label: "Diversifié prudent (25/75)" },
  { code: "global_agg", label: "Obligations monde" },
  { code: "eur_mmf", label: "Monétaire € (€STR)" },
];

export const DEFAULT_BENCHMARK = "msci_world";
// Code benchmark valide (lettres/chiffres/underscore) — garde-fou côté API.
export const BENCHMARK_CODE_RE = /^[a-z0-9_]{2,40}$/;

/** Une ligne de portefeuille : un fonds et son poids en POURCENTAGE (0-100). */
export interface Holding {
  isin: string;
  weight: number;
}

// ISIN « élargi » : accepte aussi nos identifiants synthétiques (FE_AG2R…).
export const PORTFOLIO_ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/;

/**
 * Reconstruit un portefeuille depuis les paramètres d'URL (lien partageable).
 * `isins` = "A,B,C" ; `weights` = "50,30,20" (pourcentages).
 * Poids absent / incohérent / non numérique → équipondération.
 * ISIN invalides écartés, doublons dédupliqués (1er poids gagne).
 */
export function parsePortfolioParams(
  isinsParam: string | null | undefined,
  weightsParam: string | null | undefined,
): Holding[] {
  const isins = (isinsParam ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => PORTFOLIO_ISIN_RE.test(s));

  const seen = new Set<string>();
  const unique = isins.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
  if (unique.length === 0) return [];

  // Attention : "".split(",") === [""] → [NaN]/[0], qui validerait par hasard un
  // portefeuille à 1 fonds. On traite donc l'absence de poids explicitement.
  const hasWeights = !!(weightsParam && weightsParam.trim());
  const rawWeights = hasWeights
    ? weightsParam!.split(",").map((s) => Number(s.trim()))
    : [];
  const weightsValid =
    hasWeights &&
    rawWeights.length === unique.length &&
    rawWeights.every((w) => Number.isFinite(w) && w >= 0);

  const equal = 100 / unique.length;
  return unique.map((isin, i) => ({
    isin,
    weight: weightsValid ? rawWeights[i] : equal,
  }));
}

/**
 * Renormalise les poids pour qu'ils totalisent 100 %.
 * Somme nulle / négative → équipondération.
 */
export function normalizeWeights(holdings: Holding[]): Holding[] {
  if (holdings.length === 0) return [];
  const sum = holdings.reduce((acc, h) => acc + (h.weight > 0 ? h.weight : 0), 0);
  if (sum <= 0) {
    const equal = 100 / holdings.length;
    return holdings.map((h) => ({ ...h, weight: equal }));
  }
  return holdings.map((h) => ({
    ...h,
    weight: ((h.weight > 0 ? h.weight : 0) / sum) * 100,
  }));
}

/**
 * Ajoute un fonds (ISIN déjà connu) à un portefeuille, pour l'ajout inline.
 * - Doublon (ISIN déjà présent) ou portefeuille plein (`max`) → renvoie la liste
 *   inchangée (référence identique : pas de re-render inutile).
 * - Poids du nouveau fonds = moyenne des poids positifs existants (il pèse comme
 *   les autres ; on ne force pas la renormalisation des poids choisis par l'user).
 *   Liste vide → 100 %. Jamais 0 (un poids nul serait ignoré par l'analyse).
 */
export function appendHolding(holdings: Holding[], isin: string, max = 20): Holding[] {
  if (holdings.length >= max || holdings.some((h) => h.isin === isin)) return holdings;
  const positive = holdings.filter((h) => h.weight > 0);
  const weight = holdings.length
    ? (positive.length ? positive.reduce((a, h) => a + h.weight, 0) / positive.length : 100)
    : 100;
  return [...holdings, { isin, weight }];
}

/**
 * Sérialise un portefeuille en paramètres d'URL pour le lien partageable.
 * Poids arrondis à l'entier (suffisant, l'analyse renormalise de toute façon).
 */
export function serializePortfolioParams(holdings: Holding[]): {
  isins: string;
  weights: string;
} {
  return {
    isins: holdings.map((h) => h.isin).join(","),
    weights: holdings.map((h) => String(Math.round(h.weight))).join(","),
  };
}

/**
 * Projection en euros : valeur finale et gain pour un montant initial investi,
 * à partir de la performance totale sur la période (fraction, ex. 0.1775).
 */
export function projectEuros(
  totalReturn: number | null | undefined,
  amount: number,
): { final: number; gain: number } {
  const r = totalReturn ?? 0;
  const final = amount * (1 + r);
  return { final, gain: final - amount };
}

/**
 * Fusionne la courbe du portefeuille et celle du benchmark (mêmes dates : grille
 * commune) en un jeu unique [{d, p, b}] pour un graphe à deux lignes.
 */
export function mergeCurves(
  portfolio: PortfolioCurvePoint[],
  benchmark: PortfolioCurvePoint[] | undefined | null,
): { d: string; p: number | null; b: number | null }[] {
  const bMap = new Map<string, number>();
  for (const pt of benchmark ?? []) bMap.set(pt.d, pt.v);
  return portfolio.map((pt) => ({
    d: pt.d,
    p: pt.v,
    b: bMap.has(pt.d) ? bMap.get(pt.d)! : null,
  }));
}

/**
 * Construit une matrice de corrélation NxN (symétrique, diagonale = 1) depuis la
 * liste de paires renvoyée par le RPC. `null` si la paire est absente.
 */
export function buildCorrelationMatrix(
  isins: string[],
  pairs: PortfolioCorrelation[],
): (number | null)[][] {
  const lookup = new Map<string, number | null>();
  for (const p of pairs) {
    lookup.set(`${p.a}|${p.b}`, p.c);
    lookup.set(`${p.b}|${p.a}`, p.c);
  }
  return isins.map((ri) =>
    isins.map((ci) => {
      if (ri === ci) return 1;
      return lookup.has(`${ri}|${ci}`) ? lookup.get(`${ri}|${ci}`)! : null;
    }),
  );
}
