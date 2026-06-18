// ─── Client profile — shared types, serialisation, localStorage ──────────────

import type { ClientProfile, Envelope } from "./matching";

export type RiskProfile = "prudent" | "modere" | "equilibre" | "dynamique" | "offensif";
export type EsgPref = "indifferent" | "art8" | "art9";
export type Objectif = "capitalisation" | "revenus" | "retraite" | "transmission" | "defiscalisation";
export type Tmi = "0" | "11" | "30" | "41" | "45";
export type PerteMax = "5" | "10" | "20" | "30" | "illimitee";

export type RichClientProfile = {
  age: number | null;
  amount_eur: number | null;
  horizon_years: number | null;
  objectif: Objectif | null;
  risk_profile: RiskProfile | null;
  perte_max: PerteMax | null;
  envelopes: string[];
  esg: EsgPref;
  exclusions: string[];
  tmi: Tmi | null;
  asset_classes: string[];
};

export const EMPTY_PROFILE: RichClientProfile = {
  age: null,
  amount_eur: null,
  horizon_years: null,
  objectif: null,
  risk_profile: null,
  perte_max: null,
  envelopes: [],
  esg: "indifferent",
  exclusions: [],
  tmi: null,
  asset_classes: [],
};

// ─── localStorage ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "charlie_client_profile";

export function loadStoredProfile(): RichClientProfile {
  if (typeof window === "undefined") return EMPTY_PROFILE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PROFILE;
    return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<RichClientProfile>) };
  } catch {
    return EMPTY_PROFILE;
  }
}

export function saveStoredProfile(p: RichClientProfile): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export function clearStoredProfile(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

// ─── Active check ─────────────────────────────────────────────────────────────

export function isProfileActive(p: RichClientProfile): boolean {
  return (
    p.risk_profile !== null ||
    p.envelopes.length > 0 ||
    p.esg !== "indifferent" ||
    p.objectif !== null ||
    p.age !== null ||
    p.horizon_years !== null ||
    p.tmi !== null ||
    p.exclusions.length > 0 ||
    p.asset_classes.length > 0
  );
}

// ─── Serialise to NLP context string ─────────────────────────────────────────

const RISK_LABELS: Record<RiskProfile, string> = {
  prudent:   "profil prudent (SRI 1-3, capital protégé)",
  modere:    "profil modéré (SRI 2-4)",
  equilibre: "profil équilibré (SRI 3-5)",
  dynamique: "profil dynamique (SRI 4-6, croissance)",
  offensif:  "profil offensif (SRI 5-7, performance max)",
};

const OBJ_LABELS: Record<Objectif, string> = {
  capitalisation: "objectif capitalisation / croissance du capital",
  revenus:        "objectif revenus réguliers / distribution",
  retraite:       "préparation retraite",
  transmission:   "objectif transmission patrimoniale",
  defiscalisation:"objectif défiscalisation / réduction d'impôts",
};

export function serializeForNlp(p: RichClientProfile): string {
  const parts: string[] = [];

  if (p.age)            parts.push(`client de ${p.age} ans`);
  if (p.horizon_years)  parts.push(p.horizon_years <= 3
    ? "horizon court terme (< 3 ans)"
    : `horizon de placement ${p.horizon_years} ans`);
  if (p.objectif)       parts.push(OBJ_LABELS[p.objectif]);
  if (p.risk_profile)   parts.push(RISK_LABELS[p.risk_profile]);
  if (p.perte_max && p.perte_max !== "illimitee")
                        parts.push(`tolérance aux pertes max ${p.perte_max}%`);
  if (p.envelopes.length)
                        parts.push(`enveloppes disponibles: ${p.envelopes.join(", ")}`);
  if (p.esg === "art8") parts.push("ESG: SFDR article 8 minimum");
  if (p.esg === "art9") parts.push("ESG: SFDR article 9 uniquement");
  if (p.exclusions.length)
                        parts.push(`exclusions sectorielles: ${p.exclusions.join(", ")}`);
  if (p.tmi)            parts.push(`TMI ${p.tmi}%`);
  if (p.asset_classes.length)
                        parts.push(`classes d'actifs souhaitées: ${p.asset_classes.join(", ")}`);
  if (p.amount_eur) {
    const m = p.amount_eur >= 1_000_000
      ? `${(p.amount_eur / 1_000_000).toFixed(1)}M€`
      : `${Math.round(p.amount_eur / 1000)}k€`;
    parts.push(`montant à investir: ${m}`);
  }

  return parts.join(", ");
}

// ─── Conversion vers le payload du moteur de matching ────────────────────────
// /matching partage le MÊME profil (RichClientProfile, localStorage) que le
// panneau de recherche. Le moteur /api/matching attend un ClientProfile plus
// restreint : on convertit ici. Le profil « modéré » (absent du barème matching)
// est rabattu sur « équilibré ». Enveloppes : forme UI (PEA, AV-FR…) → clés API.

const RISK_TO_MATCHING: Record<RiskProfile, ClientProfile["risk_profile"]> = {
  prudent: "prudent",
  modere: "equilibre",
  equilibre: "equilibre",
  dynamique: "dynamique",
  offensif: "offensif",
};

const ENVELOPE_TO_MATCHING: Record<string, Envelope> = {
  PEA: "pea",
  "PEA-PME": "pea_pme",
  PER: "per",
  "AV-FR": "av_fr",
  "AV-LUX": "av_lux",
  CTO: "cto",
};

// perte_max (RichClientProfile) → tolérance en % positif. « illimitée » = pas de contrainte.
const PERTE_MAX_TO_PCT: Record<PerteMax, number | null> = {
  "5": 5, "10": 10, "20": 20, "30": 30, illimitee: null,
};

// asset_classes du profil (vocabulaire parse-profile) → valeurs asset_class_broad de la base.
const ASSET_CLASS_TO_BROAD: Record<string, string> = {
  actions: "action",
  obligations: "obligation",
  scpi: "immobilier",
  immobilier: "immobilier",
  private_equity: "alternatif",
  monetaire: "monetaire",
  multi_actifs: "diversifie",
};

export function toMatchingProfile(p: RichClientProfile): ClientProfile {
  return {
    age: p.age ?? 45,
    risk_profile: RISK_TO_MATCHING[p.risk_profile ?? "equilibre"] ?? "equilibre",
    horizon_years: p.horizon_years ?? 10,
    amount_eur: p.amount_eur ?? undefined,
    envelopes: (p.envelopes ?? [])
      .map((e) => ENVELOPE_TO_MATCHING[e])
      .filter((e): e is Envelope => Boolean(e)),
    esg_preference: p.esg,
    max_loss_pct: p.perte_max ? PERTE_MAX_TO_PCT[p.perte_max] : null,
    preferred_asset_classes: (p.asset_classes ?? [])
      .map((a) => ASSET_CLASS_TO_BROAD[a])
      .filter(Boolean),
  };
}
