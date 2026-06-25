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

export interface PortfolioAnalysis {
  meta: PortfolioMeta;
  ratios: PortfolioRatios;
  curve: PortfolioCurvePoint[];
  funds: PortfolioFundStat[];
  correlation: PortfolioCorrelation[];
  names?: Record<string, string>;
  error?: string;
}

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
