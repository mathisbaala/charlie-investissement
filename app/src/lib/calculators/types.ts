// Socle des calculateurs patrimoniaux : un calculateur = des champs typés + une
// fonction de calcul PURE et déterministe (aucune IA dans le calcul — l'IA ne
// sert qu'à router la demande et pré-remplir les champs, cf. /api/calculateurs).
// Chaque module de `defs/` exporte un CalculatorDef enregistré dans registry.ts.

export type FieldType = "eur" | "pct" | "int" | "enum" | "bool" | "date";

export interface FieldOption {
  value: string;
  label: string;
}

/** Valeurs saisies (formulaire) ou extraites (IA) — clé = FieldDef.key. */
export type CalcValues = Record<string, number | string | boolean | undefined>;

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Choix pour type "enum". */
  options?: FieldOption[];
  /** Champ obligatoire pour lancer le calcul (défaut : true). */
  required?: boolean;
  /** Valeur proposée par défaut (pré-remplie, modifiable). */
  default?: number | string | boolean;
  /** Aide courte affichée sous le champ (unité, référence légale…). */
  help?: string;
  min?: number;
  max?: number;
  /** Champ conditionnel : affiché (et exigé) seulement si le prédicat est vrai. */
  showIf?: (values: CalcValues) => boolean;
}

// ─── Restitution structurée ──────────────────────────────────────────────────
// Le résultat n'est JAMAIS un paragraphe : des blocs typés que l'UI sait rendre
// (tuiles KPI, tableaux de tranches, graphiques, notes d'hypothèses).

export interface CalcKpi {
  label: string;
  /** Valeur déjà formatée (ex. « 38 194 € ») — l'UI n'interprète pas. */
  value: string;
  hint?: string;
  tone?: "ok" | "bad";
}

export interface CalcTable {
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface CalcChartItem {
  label: string;
  value: number;
}

export interface CalcChart {
  type: "bar" | "donut";
  title?: string;
  /** Valeurs en euros (l'UI formate). */
  items: CalcChartItem[];
}

export interface CalcResult {
  kpis: CalcKpi[];
  tables?: CalcTable[];
  charts?: CalcChart[];
  /** Hypothèses et limites du calcul — affichées sous le résultat. */
  notes?: string[];
  /** Références légales (ex. « Art. 777 CGI »). */
  refs?: string[];
}

export type CalculatorCategory = "transmission";

export interface CalculatorDef {
  /** Slug stable (URL, routing IA). */
  id: string;
  title: string;
  /** Une phrase — sert à la carte UI ET au prompt de routing IA. */
  description: string;
  category: CalculatorCategory;
  /** Formulations alternatives pour aider le routing IA (« DDV », « 990 I »…). */
  aliases?: string[];
  fields: FieldDef[];
  compute: (values: CalcValues) => CalcResult;
}

// ─── Helpers partagés (formatage, lecture des valeurs) ───────────────────────

/** Format euro entier fr-FR (« 38 194 € »). */
export function eur(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
}

/** Format pourcentage (« 31,25 % »), sans zéros inutiles. */
export function pct(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

/** Lit un nombre depuis CalcValues (0 si absent/invalide — les champs requis sont validés en amont). */
export function num(v: CalcValues, key: string): number {
  const raw = v[key];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function str(v: CalcValues, key: string): string {
  return typeof v[key] === "string" ? (v[key] as string) : "";
}

export function bool(v: CalcValues, key: string): boolean {
  return v[key] === true || v[key] === "true";
}

/**
 * Champs actifs pour des valeurs données (résout les showIf) — l'UI n'affiche
 * que ceux-là, la validation n'exige que ceux-là.
 */
export function activeFields(def: CalculatorDef, values: CalcValues): FieldDef[] {
  return def.fields.filter((f) => !f.showIf || f.showIf(values));
}

/** Clés des champs requis actifs encore manquants (bloquent le calcul). */
export function missingFields(def: CalculatorDef, values: CalcValues): FieldDef[] {
  return activeFields(def, values).filter((f) => {
    if (f.required === false) return false;
    const v = values[f.key];
    if (v === undefined || v === "") return f.default === undefined;
    return false;
  });
}

/** Valeurs complètes : saisies + défauts des champs actifs non renseignés. */
export function withDefaults(def: CalculatorDef, values: CalcValues): CalcValues {
  const out: CalcValues = { ...values };
  for (const f of activeFields(def, values)) {
    if ((out[f.key] === undefined || out[f.key] === "") && f.default !== undefined) {
      out[f.key] = f.default;
    }
  }
  return out;
}
