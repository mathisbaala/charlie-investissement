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
  { code: "msci_world", label: "MSCI World · actions monde" },
  { code: "sp500", label: "S&P 500 · actions US" },
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

/** Périodes de back-test proposées (années), partagées par le backtest agrégé et
 *  l'historique par support. `y` borne l'appel RPC (`inv_portfolio_analyze`). */
export const PORTFOLIO_PERIODS: { y: number; label: string }[] = [
  { y: 1, label: "1 an" }, { y: 3, label: "3 ans" }, { y: 5, label: "5 ans" },
  { y: 10, label: "10 ans" }, { y: 15, label: "15 ans" },
];

/** Tronque un libellé à `max` caractères, suffixe « … » si coupé. */
export function truncateLabel(name: string, max = 30): string {
  const n = name.trim();
  return n.length > max ? `${n.slice(0, max - 1)}…` : n;
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

/** Nombre maximal de fonds de comparaison sur le back-test. */
export const COMPARE_MAX = 3;

/** Fonds ajouté en comparaison du back-test (choisi via la recherche). */
export interface CompareFund {
  isin: string;
  name: string;
}

/**
 * Aligne la courbe d'un fonds de comparaison sur la grille de dates du
 * portefeuille (LOCF borné) puis la rebase à 100 au premier point aligné.
 *
 * Les deux courbes sortent du même RPC mais avec des fenêtres propres : leurs
 * grilles hebdomadaires ne partagent donc pas forcément les mêmes dates. Pour
 * chaque date de la grille on prend la dernière valeur du fonds ≤ date, à
 * condition qu'elle date de moins de `toleranceDays` (au-delà, la valeur est
 * périmée → null, la ligne s'interrompt au lieu de mentir en plateau).
 * Historique plus court que le portefeuille → nulls en tête, base 100 au
 * premier point couvert : la comparaison démarre là où le fonds existe.
 */
export function alignCompareCurve(
  grid: string[],
  curve: PortfolioCurvePoint[],
  toleranceDays = 10,
): (number | null)[] {
  const sorted = [...curve].sort((a, b) => (a.d < b.d ? -1 : 1));
  const tolMs = toleranceDays * 86400_000;
  const out: (number | null)[] = [];
  let i = 0;
  let base: number | null = null;
  for (const d of grid) {
    const t = new Date(d).getTime();
    while (i < sorted.length && new Date(sorted[i].d).getTime() <= t) i++;
    const last = i > 0 ? sorted[i - 1] : null;
    if (!last || t - new Date(last.d).getTime() > tolMs) {
      out.push(null);
      continue;
    }
    if (base == null) base = last.v;
    out.push(base > 0 ? (last.v / base) * 100 : null);
  }
  return out;
}

/**
 * Fusionne courbe portefeuille + indice + fonds comparés en un jeu unique
 * [{d, p, b, c0…}] pour le graphe multi-lignes. Les fonds comparés sont
 * réalignés sur la grille du portefeuille (cf. alignCompareCurve).
 */
export function mergeCurvesMulti(
  portfolio: PortfolioCurvePoint[],
  benchmark: PortfolioCurvePoint[] | undefined | null,
  compares: PortfolioCurvePoint[][],
): Record<string, string | number | null>[] {
  const rows = mergeCurves(portfolio, benchmark) as unknown as Record<
    string,
    string | number | null
  >[];
  const grid = portfolio.map((pt) => pt.d);
  compares.forEach((curve, idx) => {
    const aligned = alignCompareCurve(grid, curve);
    rows.forEach((row, ri) => {
      row[`c${idx}`] = aligned[ri];
    });
  });
  return rows;
}

// LOCF sur une courbe TRIÉE : dernière valeur dont la date ≤ cible, ou null si
// la courbe commence après la cible (pas d'extrapolation vers le passé).
function locfAt(curve: PortfolioCurvePoint[], targetMs: number): number | null {
  let v: number | null = null;
  for (const pt of curve) {
    if (new Date(pt.d).getTime() > targetMs) break;
    v = pt.v;
  }
  return v;
}

/**
 * Performance glissante sur `days` jours : dernier point de la courbe vs valeur
 * LOCF à (fin − days). `null` si la courbe ne couvre pas l'horizon (début de
 * courbe postérieur à la date cible) ou trop courte. La courbe est la grille
 * hebdo du RPC, triée croissante.
 */
export function trailingReturn(
  curve: PortfolioCurvePoint[],
  days: number,
): number | null {
  if (curve.length < 2) return null;
  const endMs = new Date(curve[curve.length - 1].d).getTime();
  const targetMs = endMs - days * 86400_000;
  if (new Date(curve[0].d).getTime() > targetMs) return null;
  const base = locfAt(curve, targetMs);
  const last = curve[curve.length - 1].v;
  if (base == null || base <= 0) return null;
  return last / base - 1;
}

/**
 * Performances par année civile : { "2023": 0.14, … }. L'année N est calculée
 * de la valeur LOCF au 31/12/N−1 à celle du 31/12/N (dernier point pour l'année
 * en cours → YTD). Une année n'apparaît que si la courbe couvre son début
 * (1er point ≤ 7 janvier), pour ne pas afficher une année partielle comme pleine.
 */
export function calendarYearReturns(
  curve: PortfolioCurvePoint[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (curve.length < 2) return out;
  const firstMs = new Date(curve[0].d).getTime();
  const lastDate = new Date(curve[curve.length - 1].d);
  const firstYear = new Date(curve[0].d).getFullYear();
  const lastYear = lastDate.getFullYear();
  for (let y = firstYear; y <= lastYear; y++) {
    if (firstMs > Date.UTC(y, 0, 7)) continue;
    const base = locfAt(curve, Date.UTC(y - 1, 11, 31, 23, 59, 59));
    const end =
      y === lastYear
        ? curve[curve.length - 1].v
        : locfAt(curve, Date.UTC(y, 11, 31, 23, 59, 59));
    if (base == null || base <= 0 || end == null) continue;
    out[String(y)] = end / base - 1;
  }
  return out;
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
