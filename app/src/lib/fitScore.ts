// ─── Score d'adéquation (fit) — classement par pertinence du couloir intention ──
// Quand une recherche descriptive ou un profil client est actif (≠ navigation
// neutre), on ne se contente plus de trier par data_completeness : on classe les
// fonds qualifiés par un score COMPOSITE qui mesure l'adéquation à l'intention,
// tout en gardant la complétude comme terme DOMINANT (garde-fou : on ne propose
// jamais un fonds quasi vide, et un fonds bien renseigné n'est pas rétrogradé sous
// un fonds incomplet sans une supériorité nette ailleurs).
//
// Calculé entièrement côté TS sur les colonnes déjà projetées par /api/funds
// (aucune table ni migration). Fonction PURE → testable unitairement.

import type { Fund } from "./types";

// Poids du score composite (somme des termes positifs = 0.90, pénalité -0.10,
// boosts ±0.06). `complete` est délibérément dominant → « data_completeness reste
// strict » : la complétude pilote le classement, l'adéquation ordonne à l'intérieur.
export const FIT_WEIGHTS = {
  complete: 0.55,   // norm(data_completeness)        — terme dominant (garde-fou)
  quality: 0.22,    // qualité intrinsèque (Morningstar/alpha/Sharpe/ancienneté/encours)
  match: 0.13,      // adéquation fine à l'intention (marge SRI, labels en surplus, alpha)
  overshoot: 0.10,  // PÉNALITÉ : dépassement des seuils « doux » (quasi-match toléré)
} as const;

// Tolérances de la PROXIMITÉ DOUCE. Source unique : la route élargit les seuils non
// structurants de ces marges (un fonds à 0,52 % de frais n'est plus exclu d'un seuil
// à 0,50 %), et le fit pénalise ensuite le dépassement → le quasi-match passe JUSTE
// derrière le match exact au lieu de disparaître. SRI / SFDR / univers / zone /
// enveloppes / labels restent DURS (qualification binaire, jamais élargie).
export const SOFT_TOLERANCE = {
  terRel: 0.15,      // frais : seuil × 1.15
  drawdownAbs: 5,    // perte max : +5 points
  perfAbs: 3,        // perf min : −3 points
  volAbs: 3,         // volatilité max : +3 points
  sharpeAbs: 0.2,    // Sharpe min : −0.2
} as const;

// Contexte d'adéquation construit par la route à partir des filtres de la requête.
// Unités = celles reçues côté API (frais en %, drawdown en magnitude positive).
export type FitContext = {
  terMax?: number;          // % (la colonne ter du Fund est déjà en % après toApi)
  drawdownMax?: number;     // magnitude positive (%)
  perf1yMin?: number;
  perf3yMin?: number;
  perf5yMin?: number;
  volMax?: number;
  vol3yMax?: number;
  sharpeMin?: number;       // Sharpe 1 an min
  sharpe3yMin?: number;     // Sharpe 3 ans min
  sriMax?: number;
  sfdr?: number[];
  labels?: string[];        // labels durabilité demandés (isr/greenfin/finansol)
  beatsBenchmark?: boolean;
  envelopes?: string[];     // enveloppes DURES déjà filtrées (info pour le match)
  // ── Préférences DOUCES issues du profil (jamais des filtres durs) ──
  preferIncome?: boolean;   // objectif revenus / besoin de revenus réguliers
  preferEnvelopes?: string[]; // TMI élevé → favoriser PER/PEA (efficacité fiscale)
  novice?: boolean;         // investisseur novice → écarter les produits complexes
  smallTicket?: boolean;    // petit montant → favoriser l'accessible retail
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

// Dépassement d'un seuil MAX (le fonds devrait être ≤ seuil) : 0 si conforme,
// monte vers 1 au bord de la bande de tolérance. null si non applicable.
function overMax(value: number | null | undefined, threshold: number | undefined, band: number): number | null {
  if (threshold == null || value == null || band <= 0) return null;
  if (value <= threshold) return 0;
  return clamp01((value - threshold) / band);
}

// Dépassement d'un seuil MIN (le fonds devrait être ≥ seuil) : symétrique.
function underMin(value: number | null | undefined, threshold: number | undefined, band: number): number | null {
  if (threshold == null || value == null || band <= 0) return null;
  if (value >= threshold) return 0;
  return clamp01((threshold - value) / band);
}

// Qualité intrinsèque (0..1). Champs absents = point neutre/prudent (ne pénalise pas
// au-delà du raisonnable, mais ne récompense pas). Corrèle avec la complétude, donc
// renforce le terme dominant sans le dupliquer brutalement.
function qualityScore(f: Fund): number {
  const ms = f.morningstar_rating != null ? f.morningstar_rating / 5 : 0.5;
  const alpha = f.alpha_3y != null ? logistic(f.alpha_3y / 5) : 0.5; // alpha en % → ±5 % ≈ pleine échelle
  const sharpe = f.sharpe_3y != null ? clamp01((f.sharpe_3y + 0.5) / 2.5) : 0.5; // -0.5..2 → 0..1
  const track = f.track_record_years != null ? clamp01(f.track_record_years / 12) : 0.3;
  const aum = f.aum_eur != null && f.aum_eur > 0
    ? clamp01((Math.log10(f.aum_eur) - 6) / 3.5) // 1 M€ (10^6) → 0, ~3,5 Md€ (10^9.5) → 1
    : 0.3;
  return clamp01(0.30 * ms + 0.25 * alpha + 0.20 * sharpe + 0.13 * track + 0.12 * aum);
}

// Pénalité de dépassement (0..1) = moyenne des dépassements des seuils DOUX présents.
function overshootPenalty(f: Fund, c: FitContext): number {
  const parts: number[] = [];
  const push = (v: number | null) => { if (v != null) parts.push(v); };
  push(overMax(f.ter, c.terMax, (c.terMax ?? 0) * SOFT_TOLERANCE.terRel));
  // drawdown : colonne négative, on raisonne en magnitude positive.
  push(overMax(f.max_drawdown_3y != null ? -f.max_drawdown_3y : null, c.drawdownMax, SOFT_TOLERANCE.drawdownAbs));
  push(underMin(f.performance_1y, c.perf1yMin, SOFT_TOLERANCE.perfAbs));
  push(underMin(f.performance_3y, c.perf3yMin, SOFT_TOLERANCE.perfAbs));
  push(underMin(f.performance_5y, c.perf5yMin, SOFT_TOLERANCE.perfAbs));
  push(overMax(f.volatility_1y, c.volMax, SOFT_TOLERANCE.volAbs));
  push(overMax(f.volatility_3y, c.vol3yMax, SOFT_TOLERANCE.volAbs));
  push(underMin(f.sharpe_1y, c.sharpeMin, SOFT_TOLERANCE.sharpeAbs));
  push(underMin(f.sharpe_3y, c.sharpe3yMin, SOFT_TOLERANCE.sharpeAbs));
  if (!parts.length) return 0;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

// Adéquation fine à l'intention (0..1, neutre 0.5). Récompense le fonds qui ne se
// contente pas de passer les filtres mais les satisfait CONFORTABLEMENT.
function matchScore(f: Fund, c: FitContext): number {
  let s = 0.5;
  // Marge de risque : sous le plafond SRI = confort (sans valoriser un fonds
  // anormalement défensif au point d'être hors-sujet).
  if (c.sriMax != null && f.risk_score != null) {
    const head = c.sriMax - f.risk_score; // ≥ 0 (le hard filter a déjà écarté les > plafond)
    if (head >= 0) s += 0.08 * clamp01(head / 2); // confort plafonné à ~2 crans
  }
  // Labels durabilité EN SURPLUS : un fonds portant plus de labels demandés que le
  // minimum (au moins un) est plus aligné avec une intention DDA forte.
  if (c.labels?.length) {
    const have = Array.isArray(f.labels) ? (f.labels as string[]) : [];
    const matched = c.labels.filter((l) => have.includes(l)).length;
    if (matched > 0) s += 0.10 * clamp01((matched - 1) / Math.max(1, c.labels.length - 1) + 0.3);
  }
  // SFDR : article 9 quand 8 suffisait = ambition durable supérieure.
  if (c.sfdr?.includes(8) && c.sfdr?.includes(9) && f.sfdr_article === 9) s += 0.06;
  // « Bat son indice » : récompense la MARGE d'alpha, pas seulement le signe.
  if (c.beatsBenchmark && f.alpha_3y != null && f.alpha_3y > 0) {
    s += 0.10 * clamp01(f.alpha_3y / 4);
  }
  return clamp01(s);
}

// Boosts/pénalités DOUX issus du profil (additifs, faibles). Ne filtrent jamais —
// ne font que nuancer le classement quand une donnée propre manque (pas de colonne
// distribuant/capitalisant ni de yield → « revenus » s'approxime par la classe d'actif).
function prefAdjust(f: Fund, c: FitContext): number {
  let a = 0;
  if (c.preferIncome) {
    const incomeClass = ["immobilier", "obligation", "monetaire"].includes(f.asset_class_broad ?? "")
      || ["scpi", "fonds_euros", "opci"].includes(f.product_type ?? "")
      || (f.asset_class_broad === "diversifie" && f.allocation_profile === "prudent");
    if (incomeClass) a += 0.05;
  }
  if (c.preferEnvelopes?.length) {
    const ok = (c.preferEnvelopes.includes("PER") && f.per_eligible === true)
      || (c.preferEnvelopes.includes("PEA") && f.pea_eligible === true)
      || (c.preferEnvelopes.includes("PEA-PME") && f.pea_pme_eligible === true);
    if (ok) a += 0.03;
  }
  if (c.novice) {
    const complex = f.asset_class_broad === "alternatif"
      || ["smart_beta", "alternatif"].includes(f.management_style ?? "");
    if (complex) a -= 0.05;
  }
  if (c.smallTicket && f.accessible_retail === true) a += 0.03;
  return a;
}

// Score d'adéquation final (0..1). complétude DOMINANTE + qualité + adéquation
// − dépassement doux + nuances profil.
export function scoreFit(f: Fund, c: FitContext): number {
  const complete = clamp01((f.data_completeness ?? 0) / 100);
  const quality = qualityScore(f);
  const match = matchScore(f, c);
  const overshoot = overshootPenalty(f, c);
  const score =
    FIT_WEIGHTS.complete * complete +
    FIT_WEIGHTS.quality * quality +
    FIT_WEIGHTS.match * match -
    FIT_WEIGHTS.overshoot * overshoot +
    prefAdjust(f, c);
  return clamp01(score);
}

// Classe une liste de fonds par adéquation décroissante (tri STABLE : départage par
// data_completeness puis ISIN pour un ordre déterministe à score égal). Ne mute pas
// l'entrée.
export function rankByFit(funds: Fund[], c: FitContext): Fund[] {
  return funds
    .map((f) => ({ f, s: scoreFit(f, c) }))
    .sort((a, b) =>
      b.s - a.s ||
      (b.f.data_completeness ?? 0) - (a.f.data_completeness ?? 0) ||
      a.f.isin.localeCompare(b.f.isin),
    )
    .map((x) => x.f);
}
