// ─── Client profile — shared types, serialisation, localStorage ──────────────

import type { ParsedFilters } from "./types";

export type RiskProfile = "prudent" | "modere" | "equilibre" | "dynamique" | "offensif";
export type EsgPref = "indifferent" | "art8" | "art9" | "labelise";
export type Objectif = "capitalisation" | "revenus" | "retraite" | "transmission" | "defiscalisation";
export type Tmi = "0" | "11" | "30" | "41" | "45";
export type PerteMax = "5" | "10" | "20" | "30" | "illimitee";
export type Experience = "novice" | "informe" | "experimente";
export type ManagementPref = "actif" | "passif";
export type IncomeNeed = "non" | "ponctuel" | "regulier";
export type ReactionBaisse = "vendre" | "conserver" | "renforcer";

export type RichClientProfile = {
  age: number | null;
  amount_eur: number | null;
  horizon_years: number | null;
  objectif: Objectif | null;
  income_need: IncomeNeed | null;
  experience: Experience | null;
  risk_profile: RiskProfile | null;
  perte_max: PerteMax | null;
  reaction_baisse: ReactionBaisse | null;
  envelopes: string[];
  esg: EsgPref;
  exclusions: string[];
  geographies: string[];
  tmi: Tmi | null;
  asset_classes: string[];
  management: ManagementPref | null;
  max_ter: number | null;
  no_entry_fee: boolean;
};

export const EMPTY_PROFILE: RichClientProfile = {
  age: null,
  amount_eur: null,
  horizon_years: null,
  objectif: null,
  income_need: null,
  experience: null,
  risk_profile: null,
  perte_max: null,
  reaction_baisse: null,
  envelopes: [],
  esg: "indifferent",
  exclusions: [],
  geographies: [],
  tmi: null,
  asset_classes: [],
  management: null,
  max_ter: null,
  no_entry_fee: false,
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
    p.income_need !== null ||
    p.age !== null ||
    p.horizon_years !== null ||
    p.tmi !== null ||
    p.exclusions.length > 0 ||
    p.geographies.length > 0 ||
    p.asset_classes.length > 0 ||
    p.experience !== null ||
    p.reaction_baisse !== null ||
    p.management !== null ||
    p.max_ter !== null ||
    p.no_entry_fee
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

const EXP_LABELS: Record<Experience, string> = {
  novice:       "investisseur novice (peu d'expérience des marchés)",
  informe:      "investisseur informé",
  experimente:  "investisseur expérimenté / averti",
};

const INCOME_LABELS: Record<IncomeNeed, string> = {
  non:      "pas de besoin de revenus (logique de capitalisation)",
  ponctuel: "besoin de revenus ponctuels / retraits occasionnels",
  regulier: "besoin de revenus réguliers / distribution",
};

const REACTION_LABELS: Record<ReactionBaisse, string> = {
  vendre:    "face à une forte baisse, tendance à vendre (sensibilité au risque élevée)",
  conserver: "face à une forte baisse, tendance à conserver ses positions",
  renforcer: "face à une forte baisse, tendance à renforcer (forte tolérance au risque)",
};

// Zones géographiques (vocabulaire UI) → libellé lisible pour le contexte NLP.
export const GEO_LABELS: Record<string, string> = {
  monde:         "Monde",
  europe:        "Europe",
  zone_euro:     "Zone euro",
  amerique_nord: "Amérique du Nord",
  emergents:     "Marchés émergents",
  asie:          "Asie",
  france:        "France",
};

export function serializeForNlp(p: RichClientProfile): string {
  const parts: string[] = [];

  if (p.age)            parts.push(`client de ${p.age} ans`);
  if (p.horizon_years)  parts.push(p.horizon_years <= 3
    ? "horizon court terme (< 3 ans)"
    : `horizon de placement ${p.horizon_years} ans`);
  if (p.experience)     parts.push(EXP_LABELS[p.experience]);
  if (p.objectif)       parts.push(OBJ_LABELS[p.objectif]);
  if (p.income_need)    parts.push(INCOME_LABELS[p.income_need]);
  if (p.risk_profile)   parts.push(RISK_LABELS[p.risk_profile]);
  if (p.reaction_baisse) parts.push(REACTION_LABELS[p.reaction_baisse]);
  if (p.perte_max && p.perte_max !== "illimitee")
                        parts.push(`tolérance aux pertes max ${p.perte_max}%`);
  if (p.envelopes.length)
                        parts.push(`enveloppes disponibles: ${p.envelopes.join(", ")}`);
  if (p.esg === "art8") parts.push("ESG: SFDR article 8 minimum");
  if (p.esg === "art9") parts.push("ESG: SFDR article 9 uniquement");
  if (p.esg === "labelise") parts.push("ESG: fonds labellisé (ISR/Greenfin/Finansol)");
  if (p.exclusions.length)
                        parts.push(`exclusions sectorielles: ${p.exclusions.join(", ")}`);
  if (p.geographies.length)
                        parts.push(`zones géographiques privilégiées: ${p.geographies.map((g) => GEO_LABELS[g] ?? g).join(", ")}`);
  if (p.tmi)            parts.push(`TMI ${p.tmi}%`);
  if (p.asset_classes.length)
                        parts.push(`classes d'actifs souhaitées: ${p.asset_classes.join(", ")}`);
  if (p.management === "actif")  parts.push("préférence gestion active");
  if (p.management === "passif") parts.push("préférence gestion indicielle (ETF / passif)");
  if (p.max_ter != null) parts.push(`frais courants max ${p.max_ter}%`);
  if (p.no_entry_fee)    parts.push("sans frais d'entrée");
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

// Exclusions du profil → secteur à écarter (exclude_sectors). Seul « fossiles » a une
// correspondance sectorielle FIABLE (→ Énergie). tabac/armes/jeux/alcool n'ont pas de
// secteur dédié dans la taxonomie (Consommation/Industrie seraient trop larges et
// écarteraient des fonds légitimes) → ils restent en contexte NLP (serializeForNlp),
// faute de donnée de composition fine filtrable. Limite assumée.
const EXCLUSION_TO_SECTOR: Record<string, string> = {
  fossiles: "Énergie",
};

// Horizon de placement → PLAFOND SRI de CAPACITÉ. Distinct de la tolérance (risk_profile) :
// un horizon court limite la capacité à supporter le risque quelle que soit l'appétence.
// On combine ensuite les deux plafonds par min() (le plus contraignant gagne). Reste
// « SRI seul » : aucune borne de volatilité/drawdown ajoutée. null = pas de plafond.
function horizonSriCap(h: number): number | null {
  if (h <= 3) return 2;
  if (h <= 5) return 4;
  if (h <= 10) return 6;
  return null;
}

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

  // Plafond SRI = le plus contraignant entre la tolérance (risk_profile) et la
  // capacité (horizon court). On ne pose jamais de plancher (un prudent peut voir
  // des fonds très sûrs).
  const sriCaps: number[] = [];
  if (p.risk_profile) {
    const c = RISK_TO_SRI_MAX[p.risk_profile];
    if (c != null) sriCaps.push(c);
  }
  if (p.horizon_years != null) {
    const c = horizonSriCap(p.horizon_years);
    if (c != null) sriCaps.push(c);
  }
  if (sriCaps.length) f.sri_max = Math.min(...sriCaps);

  if (p.esg === "art8")      f.sfdr = [8, 9];
  else if (p.esg === "art9") f.sfdr = [9];
  // « Labellisé » : fonds portant un label officiel de durabilité (recueil DDA).
  else if (p.esg === "labelise") f.labels = ["isr", "greenfin", "finansol"];

  if (p.perte_max && p.perte_max !== "illimitee") {
    const dd = PERTE_MAX_TO_PCT[p.perte_max];
    if (dd != null) f.drawdown_max = dd;
  }

  if (p.envelopes.length) f.envelopes = [...p.envelopes];

  const assetClasses = (p.asset_classes ?? [])
    .map((a) => ASSET_CLASS_TO_BROAD[a])
    .filter(Boolean);
  if (assetClasses.length) f.asset_class = assetClasses;

  if (p.management) f.management_style = [p.management];
  if (p.max_ter != null) f.ter_max = p.max_ter;
  if (p.no_entry_fee) f.no_entry_fee = true;

  // Exclusions sectorielles (seules celles ayant un secteur fiable deviennent un
  // filtre dur ; cf. EXCLUSION_TO_SECTOR). Le reste agit via le contexte NLP.
  const exclSectors = [
    ...new Set(
      (p.exclusions ?? []).map((e) => EXCLUSION_TO_SECTOR[e]).filter(Boolean),
    ),
  ];
  if (exclSectors.length) f.exclude_sectors = exclSectors;

  return f;
}

// Note : objectif, TMI, montant, âge, expérience et zones géographiques n'ont pas
// d'équivalent FILTRE DUR fiable → ils restent du contexte NLP (serializeForNlp) et
// n'agissent que via une recherche texte ultérieure. Le bouton « Trouver les fonds
// adaptés » ne transporte que les filtres durs ci-dessus — comportement assumé.
