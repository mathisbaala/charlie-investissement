// Moteur de recommandations de l'onglet « Analyse de l'existant »
// (docs/analyse-existant-spec.md §5). Principe : on ne refait PAS le
// portefeuille — chaque brique analytique produit un DIAGNOSTIC ciblé
// (constat chiffré → conseil minimal), trié par impact, plafonné pour éviter
// l'effet « tout rouge ». V1 : R1 corrélation, R3 concentration, R4 frais.

import type { PortfolioCorrelation } from "@/lib/portfolio";
import type { Expo } from "@/lib/lookthrough";

/** Nombre au format français (virgule décimale) pour les textes de conseil. */
const fr = (v: number, d = 2) => v.toFixed(d).replace(".", ",");

export type RecoKind = "correlation" | "concentration" | "frais";

export interface Recommendation {
  kind: RecoKind;
  /** Titre court affichable (« Fonds très corrélés »). */
  title: string;
  /** Constat chiffré, prêt à afficher. */
  detail: string;
  /** Impact relatif (tri décroissant) — 0..1, heuristique par règle. */
  impact: number;
}

// Seuils spec §5 (à calibrer avec l'usage — documentés dans le PDF client).
export const CORRELATION_PAIR_THRESHOLD = 0.9;
export const CORRELATION_AVG_THRESHOLD = 0.75;
export const GEO_CONCENTRATION_MAX = 60; // % du portefeuille sur une zone
export const SECTOR_CONCENTRATION_MAX = 35; // % sur un secteur
export const EXPENSIVE_DELTA_PT = 0.5; // pt de TER au-dessus de la médiane
export const EXPENSIVE_MIN_WEIGHT = 3; // % du portefeuille minimum
export const MAX_RECOMMENDATIONS = 5;

/** Paire de fonds sur-corrélés (R1). */
export interface CorrelatedPair {
  a: string;
  b: string;
  rho: number;
}

/**
 * R1 — paires au-dessus du seuil, triées par corrélation décroissante.
 * `correlation` vient du RPC inv_portfolio_analyze ({a, b, c}).
 */
export function overCorrelatedPairs(
  correlation: PortfolioCorrelation[],
  threshold = CORRELATION_PAIR_THRESHOLD,
): CorrelatedPair[] {
  return correlation
    .filter((p) => p.c !== null && p.c >= threshold && p.a !== p.b)
    .map((p) => ({ a: p.a, b: p.b, rho: p.c as number }))
    .sort((x, y) => y.rho - x.rho);
}

/** Corrélation moyenne des paires (null si aucune paire renseignée). */
export function averageCorrelation(
  correlation: PortfolioCorrelation[],
): number | null {
  const vals = correlation.filter((p) => p.c !== null && p.a !== p.b).map((p) => p.c as number);
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Ligne enrichie pour le diagnostic frais (R4). */
export interface FeeLine {
  isin: string;
  name: string;
  /** TER en % (ex. 1.8), null si inconnu. */
  ter: number | null;
  /** Poids en % du portefeuille (0-100). */
  weight: number;
}

/** Médiane des TER connus (null si aucun). */
export function medianTer(lines: FeeLine[]): number | null {
  const known = lines.map((l) => l.ter).filter((t): t is number => t !== null).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const mid = Math.floor(known.length / 2);
  return known.length % 2 === 1 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
}

/**
 * R4 — lignes sensiblement plus chères que la médiane du portefeuille
 * (TER > médiane + delta) ET pesant assez pour que ça compte. Triées par
 * surcoût pondéré décroissant.
 */
export function expensiveLines(
  lines: FeeLine[],
  deltaPt = EXPENSIVE_DELTA_PT,
  minWeight = EXPENSIVE_MIN_WEIGHT,
): (FeeLine & { median: number; surcost: number })[] {
  const median = medianTer(lines);
  if (median === null) return [];
  return lines
    .filter((l) => l.ter !== null && l.ter > median + deltaPt && l.weight >= minWeight)
    .map((l) => ({
      ...l,
      median,
      // Surcoût annuel en pt de portefeuille : (TER - médiane) × poids.
      surcost: ((l.ter as number) - median) * (l.weight / 100),
    }))
    .sort((a, b) => b.surcost - a.surcost);
}

/** Alerte de concentration (R3). */
export interface ConcentrationAlert {
  scope: "zone" | "secteur";
  label: string;
  weight: number;
  max: number;
}

/**
 * R3 — zone > GEO_CONCENTRATION_MAX % ou secteur > SECTOR_CONCENTRATION_MAX %.
 * `geo`/`sectors` : sorties de weightedExposure (poids en %, 0-100).
 */
export function concentrationAlerts(
  geo: Expo[],
  sectors: Expo[],
  geoMax = GEO_CONCENTRATION_MAX,
  sectorMax = SECTOR_CONCENTRATION_MAX,
): ConcentrationAlert[] {
  const out: ConcentrationAlert[] = [];
  for (const g of geo) {
    if (g.weight > geoMax) out.push({ scope: "zone", label: g.label, weight: g.weight, max: geoMax });
  }
  for (const s of sectors) {
    if (s.weight > sectorMax) out.push({ scope: "secteur", label: s.label, weight: s.weight, max: sectorMax });
  }
  return out.sort((a, b) => b.weight / b.max - a.weight / a.max);
}

/** SRI pondéré du portefeuille (null si aucun SRI connu). */
export function weightedSri(
  lines: { sri: number | null; weight: number }[],
): number | null {
  let acc = 0;
  let wsum = 0;
  for (const l of lines) {
    if (l.sri === null || !Number.isFinite(l.weight) || l.weight <= 0) continue;
    acc += l.sri * l.weight;
    wsum += l.weight;
  }
  return wsum > 0 ? Math.round((acc / wsum) * 10) / 10 : null;
}

/**
 * Assemble la liste finale : chaque règle contribue au plus une recommandation
 * synthétique (les détails restent affichés par les composants dédiés), tri
 * par impact, plafond MAX_RECOMMENDATIONS.
 */
export function buildRecommendations(input: {
  correlation: PortfolioCorrelation[];
  names: Record<string, string>;
  geo: Expo[];
  sectors: Expo[];
  fees: FeeLine[];
}): Recommendation[] {
  const out: Recommendation[] = [];
  const nameOf = (isin: string) => input.names[isin] ?? isin;

  const pairs = overCorrelatedPairs(input.correlation);
  if (pairs.length > 0) {
    const p = pairs[0];
    out.push({
      kind: "correlation",
      title: pairs.length > 1 ? `${pairs.length} paires de fonds très corrélées` : "Deux fonds très corrélés",
      detail:
        `« ${nameOf(p.a)} » et « ${nameOf(p.b)} » évoluent quasi à l'identique ` +
        `(corrélation ${fr(p.rho)}). Détenir les deux n'apporte pas de diversification ; ` +
        `en remplacer un par un support décorrélé éligible au même contrat.`,
      impact: Math.min(1, 0.6 + 0.1 * pairs.length),
    });
  } else {
    const avg = averageCorrelation(input.correlation);
    if (avg !== null && avg >= CORRELATION_AVG_THRESHOLD) {
      out.push({
        kind: "correlation",
        title: "Portefeuille globalement très corrélé",
        detail:
          `Corrélation moyenne de ${fr(avg)} entre les supports : les lignes se ressemblent ` +
          `plus qu'elles ne se complètent. Introduire une poche décorrélée (obligations, immobilier…).`,
        impact: 0.5,
      });
    }
  }

  for (const a of concentrationAlerts(input.geo, input.sectors).slice(0, 2)) {
    out.push({
      kind: "concentration",
      title: a.scope === "zone" ? `Concentration géographique : ${a.label}` : `Concentration sectorielle : ${a.label}`,
      detail:
        `${a.label} pèse ${fr(a.weight, 0)} % du portefeuille consolidé (repère : ${a.max} %). ` +
        `Cette exposition n'apparaît dans aucun relevé pris isolément ; rééquilibrer progressivement.`,
      impact: Math.min(1, a.weight / a.max / 2),
    });
  }

  const exp = expensiveLines(input.fees);
  if (exp.length > 0) {
    const l = exp[0];
    out.push({
      kind: "frais",
      title: exp.length > 1 ? `${exp.length} lignes sensiblement plus chères que le reste` : "Une ligne sensiblement plus chère que le reste",
      detail:
        `« ${l.name} » facture ${fr(l.ter as number)} %/an de frais courants, contre ` +
        `${fr(l.median)} % (médiane du portefeuille), soit environ ${fr(l.surcost * 100, 0)} bp de ` +
        `surcoût annuel au niveau du portefeuille. Chercher un équivalent moins chargé dans le même contrat.`,
      impact: Math.min(1, 0.3 + exp.reduce((s, e) => s + e.surcost, 0) * 10),
    });
  }

  return out.sort((a, b) => b.impact - a.impact).slice(0, MAX_RECOMMENDATIONS);
}
