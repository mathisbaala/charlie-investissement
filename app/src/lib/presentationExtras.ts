// ─── Extras de restitution client (PDF / PowerPoint) ─────────────────────────
// Tout ce que l'atelier Portefeuille affiche EN PLUS de la présentation de base
// (allocationRationale) et qui doit suivre dans les documents remis au client :
// répartitions géo / secteurs par transparence, projets du client et leurs
// probabilités, matrice de corrélation, projection indicative, back-test.
// Collecte au moment du téléchargement : chaque brique est optionnelle et
// tolérante aux trous (réseau, fonds hors base) — un document sans back-test
// vaut mieux que pas de document.

import { topSlices, weightedExposure, type Expo, type ExpoRow } from "@/lib/lookthrough";
import { goalToPlan, requiredAnnualReturn, goalSuccessProbabilityMC } from "@/lib/goalPlanning";
import { GOAL_PRIORITY_LABELS, type ClientGoal } from "@/lib/clientProfile";
import {
  normalizeWeights, serializePortfolioParams, mergeCurves, DEFAULT_BENCHMARK,
  type PortfolioAnalysis, type PortfolioRatios,
} from "@/lib/portfolio";

export interface GoalRow {
  label: string;
  targetEur: number;
  years: number;
  initialEur: number;
  monthlyEur: number;
  priorityLabel: string;
  /** Rendement annuel requis (fraction) ; null = hors de portée avec les moyens affectés. */
  requiredReturn: number | null;
  /** Probabilité de succès Monte Carlo (fraction 0-1) ; null si non calculable. */
  successProb: number | null;
}

export interface BacktestSummary {
  periodLabel: string;
  benchmarkLabel: string;
  /** Courbes base 100 fusionnées : p = portefeuille, b = indice (null si trou). */
  curve: { d: string; p: number | null; b: number | null }[];
  portfolio: PortfolioRatios;
  benchmark: PortfolioRatios | null;
}

export interface PresentationExtras {
  /** Répartitions look-through pondérées par les poids courants (top 5 + « Autres »). */
  exposure: { geo: Expo[]; sectors: Expo[] } | null;
  goals: GoalRow[];
  correlation: { names: string[]; matrix: (number | null)[][] } | null;
  projection: { amountEur: number; horizonYears: number; projectedEur: number } | null;
  backtest: BacktestSummary | null;
  /** Nombre effectif de lignes (1 / somme des poids²) : lecture de la concentration. */
  effectiveHoldings: number | null;
  /** Frais courants moyens pondérés (fraction). */
  avgTer: number | null;
}

// ─── Briques pures ────────────────────────────────────────────────────────────

/**
 * Agrégation des répartitions géo / secteurs d'un portefeuille : pondérée par
 * les poids courants (%), tronquée pour un camembert lisible. Partagée entre le
 * bloc écran (PortfolioExposure) et les exports PDF / PowerPoint.
 */
export function aggregateExposure(
  rows: { geo: ExpoRow[]; sectors: ExpoRow[] },
  lines: { isin: string; weight: number }[],
): { geo: Expo[]; sectors: Expo[] } {
  const fundWeights = Object.fromEntries(lines.map((l) => [l.isin, l.weight / 100]));
  return {
    geo: topSlices(weightedExposure(rows.geo, fundWeights, 500)),
    sectors: topSlices(weightedExposure(rows.sectors, fundWeights, 500)),
  };
}

/** Lignes « projet » prêtes à afficher, mêmes calculs que la carte Projets de l'atelier. */
export function buildGoalRows(
  goals: ClientGoal[],
  pockets: Record<string, { mu: number; sigma: number }>,
  globalMu: number,
  globalSigma: number,
): GoalRow[] {
  return goals
    .map((g) => ({ goal: g, plan: goalToPlan(g) }))
    .filter((r) => r.plan !== null)
    .map(({ goal, plan }) => {
      const pocket = pockets[goal.id] ?? null;
      const mu = pocket?.mu ?? globalMu;
      const sigma = pocket?.sigma ?? globalSigma;
      const rReq = requiredAnnualReturn(plan!);
      return {
        label: goal.label.trim() || "Projet",
        targetEur: plan!.target,
        years: plan!.years,
        initialEur: plan!.initial,
        monthlyEur: plan!.monthly,
        priorityLabel: GOAL_PRIORITY_LABELS[goal.priority],
        requiredReturn: rReq,
        successProb: rReq === null ? null : goalSuccessProbabilityMC(plan!, mu, sigma),
      };
    });
}

/** « 2021-04-19 » → « Avril 2021 » (libellé de période du back-test). */
export function frMonthLabel(d: string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const s = x.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Sous-échantillonnage régulier d'une courbe (premiers/derniers points gardés). */
export function thinCurve<T>(pts: T[], maxPoints = 120): T[] {
  if (pts.length <= maxPoints) return pts;
  const step = (pts.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => pts[Math.round(i * step)]);
}

// ─── Collecte (fetch tolérants) ───────────────────────────────────────────────

async function fetchExposure(
  lines: { isin: string; weight: number }[],
): Promise<{ geo: Expo[]; sectors: Expo[] } | null> {
  const isins = Array.from(new Set(lines.map((l) => l.isin))).sort().join(",");
  if (!isins) return null;
  try {
    const r = await fetch(`/api/portfolio/exposure?isins=${encodeURIComponent(isins)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { geo?: ExpoRow[]; sectors?: ExpoRow[] };
    const agg = aggregateExposure({ geo: j.geo ?? [], sectors: j.sectors ?? [] }, lines);
    return agg.geo.length === 0 && agg.sectors.length === 0 ? null : agg;
  } catch {
    return null;
  }
}

async function fetchBacktest(
  lines: { isin: string; weight: number }[],
  years = 5,
): Promise<BacktestSummary | null> {
  try {
    const serial = serializePortfolioParams(
      normalizeWeights(lines.map((l) => ({ isin: l.isin, weight: l.weight }))),
    );
    const qs = `isins=${serial.isins}&weights=${serial.weights}&benchmark=${DEFAULT_BENCHMARK}&years=${years}`;
    const r = await fetch(`/api/portfolio/analyze?${qs}`);
    if (!r.ok) return null;
    const j = (await r.json()) as PortfolioAnalysis;
    if (j.error || !j.ratios || !j.meta || j.meta.used === 0) return null;
    const bench = j.benchmark ?? null;
    const curve = thinCurve(mergeCurves(j.curve ?? [], bench?.curve));
    if (curve.length === 0) return null;
    const periodLabel =
      j.meta.start && j.meta.end ? `${frMonthLabel(j.meta.start)} à ${frMonthLabel(j.meta.end)}` : "";
    return {
      periodLabel,
      benchmarkLabel: bench?.label ?? "Indice",
      curve: curve.map((c) => ({ d: c.d, p: c.p ?? null, b: c.b ?? null })),
      portfolio: j.ratios,
      benchmark: bench
        ? {
            total_return: bench.total_return, annual_return: bench.annual_return,
            volatility: bench.volatility, sharpe: bench.sharpe, max_drawdown: bench.max_drawdown,
          }
        : null,
    };
  } catch {
    return null;
  }
}

/** Rassemble tous les extras au moment du téléchargement (PDF / PPTX). */
export async function collectPresentationExtras(args: {
  lines: { isin: string; weight: number }[];
  goals: ClientGoal[];
  pockets: Record<string, { mu: number; sigma: number }>;
  globalMu: number;
  globalSigma: number;
  correlation: { names: string[]; matrix: (number | null)[][] } | null;
  amountEur: number | null;
  horizonYears: number;
  projectedEur: number | null;
  effectiveHoldings: number | null;
  avgTer: number | null;
  /** Back-test seulement sur données réelles (l'univers démo n'a pas de séries). */
  includeBacktest: boolean;
}): Promise<PresentationExtras> {
  const [exposure, backtest] = await Promise.all([
    fetchExposure(args.lines),
    args.includeBacktest ? fetchBacktest(args.lines) : Promise.resolve(null),
  ]);
  return {
    exposure,
    goals: buildGoalRows(args.goals, args.pockets, args.globalMu, args.globalSigma),
    correlation:
      args.correlation && args.correlation.names.length >= 2 ? args.correlation : null,
    projection:
      args.amountEur != null && args.amountEur > 0 && args.projectedEur != null
        ? { amountEur: args.amountEur, horizonYears: args.horizonYears, projectedEur: args.projectedEur }
        : null,
    backtest,
    effectiveHoldings: args.effectiveHoldings,
    avgTer: args.avgTer,
  };
}
