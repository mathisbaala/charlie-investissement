// ─── Client profile — shared types, serialisation, localStorage ──────────────

import type { ParsedFilters } from "./types";

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

// ─── Tables de conversion partagées ──────────────────────────────────────────
// Utilisées par profileToScreenerFilters (redirection vers le screener).

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

// ─── Conversion vers les filtres du screener ─────────────────────────────────
// « Trouver les fonds adaptés » depuis la page Profil client redirige vers le
// screener avec ces filtres pré-remplis. On ne traduit que les champs qui ont
// un équivalent FILTRE DUR ; l'âge, l'horizon, l'objectif, le montant et la TMI
// restent dans le profil (contexte NLP, sérialisé par serializeForNlp) sans
// devenir des filtres rigides.

// Profil de risque → PLAFOND SRI. Logique d'adéquation MIF : on ne propose jamais
// un fonds plus risqué que la tolérance du client. Pas de plancher (un prudent peut
// vouloir voir des fonds très sûrs). « offensif » = aucun plafond (null).
const RISK_TO_SRI_MAX: Record<RiskProfile, number | null> = {
  prudent: 3,
  modere: 4,
  equilibre: 5,
  dynamique: 6,
  offensif: null,
};

export function profileToScreenerFilters(p: RichClientProfile): ParsedFilters {
  const f: ParsedFilters = {};

  if (p.risk_profile) {
    const sriMax = RISK_TO_SRI_MAX[p.risk_profile];
    if (sriMax != null) f.sri_max = sriMax;
  }

  if (p.esg === "art8")      f.sfdr = [8, 9];
  else if (p.esg === "art9") f.sfdr = [9];

  if (p.perte_max && p.perte_max !== "illimitee") {
    const dd = PERTE_MAX_TO_PCT[p.perte_max];
    if (dd != null) f.drawdown_max = dd;
  }

  if (p.envelopes.length) f.envelopes = [...p.envelopes];

  const assetClasses = (p.asset_classes ?? [])
    .map((a) => ASSET_CLASS_TO_BROAD[a])
    .filter(Boolean);
  if (assetClasses.length) f.asset_class = assetClasses;

  return f;
}
