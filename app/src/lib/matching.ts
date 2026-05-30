export type RiskProfile = "prudent" | "equilibre" | "dynamique" | "offensif";
export type EsgPreference = "indifferent" | "art8" | "art9";
export type Envelope = "pea" | "pea_pme" | "per" | "av_fr" | "av_lux" | "cto";

export interface ClientProfile {
  age: number;
  risk_profile: RiskProfile;
  horizon_years: number;
  amount_eur?: number;
  envelopes: Envelope[];
  esg_preference: EsgPreference;
}

export interface MatchResult {
  isin: string;
  name: string;
  product_type: string;
  gestionnaire: string | null;
  sfdr_article: number | null;
  risk_score: number | null;
  ongoing_charges: number | null;
  retrocession_cgp: number | null;
  performance_1y: number | null;
  performance_3y: number | null;
  performance_5y: number | null;
  volatility_1y: number | null;
  sharpe_1y: number | null;
  aum_eur: number | null;
  morningstar_rating: number | null;
  pea_eligible: boolean | null;
  pea_pme_eligible: boolean | null;
  per_eligible: boolean | null;
  av_fr_eligible: boolean | null;
  av_lux_eligible: boolean | null;
  cto_eligible: boolean | null;
  inception_date: string | null;
  data_completeness: number;
  match_score: number;
  match_label: string;
  match_summary: string;
}

const RISK_IDEALS: Record<RiskProfile, number> = {
  prudent: 2,
  equilibre: 3,
  dynamique: 5,
  offensif: 6,
};

function scoreRisk(sri: number | null, profile: RiskProfile): number {
  if (!sri) return 10;
  const dist = Math.abs(sri - RISK_IDEALS[profile]);
  if (dist === 0) return 30;
  if (dist === 1) return 22;
  if (dist === 2) return 12;
  return 2;
}

function scoreESG(sfdr: number | null, pref: EsgPreference): number {
  if (pref === "indifferent") return 10;
  if (pref === "art9") {
    if (sfdr === 9) return 20;
    if (sfdr === 8) return 8;
    return 0;
  }
  if (sfdr === 8 || sfdr === 9) return 20;
  return 5;
}

function scoreTER(ter: number | null, horizon: number): number {
  if (ter == null) return 6;
  const base =
    ter <= 0.3 ? 15 :
    ter <= 0.7 ? 13 :
    ter <= 1.0 ? 10 :
    ter <= 1.5 ? 6 :
    ter <= 2.0 ? 3 : 0;
  const multiplier = horizon >= 10 ? 1.15 : horizon >= 5 ? 1.0 : 0.85;
  return Math.min(15, Math.round(base * multiplier));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function weightedPerf(fund: any, horizon: number): number {
  let w1 = 0.5, w3 = 0.35, w5 = 0.15;
  if (horizon >= 7) { w1 = 0.2; w3 = 0.4; w5 = 0.4; }
  else if (horizon >= 4) { w1 = 0.3; w3 = 0.5; w5 = 0.2; }
  return (fund.performance_1y ?? 0) * w1 +
         (fund.performance_3y ?? 0) * w3 +
         (fund.performance_5y ?? 0) * w5;
}

function scoreQuality(morningstar: number | null, completeness: number): number {
  let s = 0;
  if (morningstar != null) s += morningstar >= 4 ? 5 : morningstar >= 3 ? 3 : 1;
  if (completeness >= 90) s += 5;
  else if (completeness >= 80) s += 3;
  return s;
}

function matchLabel(score: number): string {
  if (score >= 75) return "Excellent";
  if (score >= 60) return "Très bon";
  if (score >= 45) return "Bon";
  if (score >= 30) return "Correct";
  return "Faible";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSummary(fund: any): string {
  const parts: string[] = [];
  if (fund.sfdr_article) parts.push(`Art.${fund.sfdr_article}`);
  if (fund.risk_score) parts.push(`SRI ${fund.risk_score}/7`);
  if (fund.ongoing_charges != null) parts.push(`TER ${fund.ongoing_charges.toFixed(2)}%`);
  if (fund.performance_3y != null) {
    const sign = fund.performance_3y >= 0 ? "+" : "";
    parts.push(`${sign}${fund.performance_3y.toFixed(1)}% sur 3 ans`);
  }
  return parts.join(" · ");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scoreFunds(candidates: any[], profile: ClientProfile): MatchResult[] {
  const perfScores = candidates.map((f) => weightedPerf(f, profile.horizon_years));
  const minP = Math.min(...perfScores);
  const maxP = Math.max(...perfScores);
  const perfRange = maxP - minP || 1;

  return candidates
    .map((fund, i) => {
      const riskScore = scoreRisk(fund.risk_score, profile.risk_profile);
      const esgScore = scoreESG(fund.sfdr_article, profile.esg_preference);
      const terScore = scoreTER(fund.ongoing_charges, profile.horizon_years);
      const perfNorm = Math.round(((perfScores[i] - minP) / perfRange) * 25);
      const qualScore = scoreQuality(fund.morningstar_rating, fund.data_completeness);
      const total = riskScore + esgScore + terScore + perfNorm + qualScore;

      return {
        ...fund,
        match_score: Math.min(100, total),
        match_label: matchLabel(total),
        match_summary: buildSummary(fund),
      } as MatchResult;
    })
    .sort((a, b) => b.match_score - a.match_score);
}
