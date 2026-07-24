// ─── Sérialisation des filtres screener ⇄ URL ────────────────────────────────
// `buildParams` : ParsedFilters → URLSearchParams (requête /api/funds + URL
// partageable). `filtersFromParams` : l'inverse, pour hydrater le screener à
// l'arrivée (page Profil client, lien partagé, enveloppe/assureur depuis
// l'accueil). Les deux partagent les MÊMES noms de clés → round-trip garanti.

import type { ParsedFilters } from "./types";
import { asExactIsin } from "./search";

// Colonnes triables exposées par /api/funds (miroir de VALID_SORT côté route).
// Source unique partagée : le parsing NLP (sort_intent) ne peut viser qu'une de ces
// colonnes, et la route retombe sur "data_completeness" pour toute valeur hors liste.
export const SORTABLE_COLUMNS = [
  "performance_3y", "performance_1y", "performance_5y", "ter", "ongoing_charges",
  "aum_eur", "sharpe_1y", "sharpe_3y", "volatility_1y", "max_drawdown_3y",
  "morningstar_rating", "track_record_years", "data_completeness",
  "retrocession_cgp", "entry_fee_max", "alpha_3y",
] as const;

// Tri par défaut du screener (qualité/complétude des données décroissante).
export const DEFAULT_SORT = { sort_by: "data_completeness", sort_dir: "desc" } as const;

// ─── Relâchement gracieux (0 résultat) ──────────────────────────────────────
// Ordre de DROP des filtres NON structurants (le moins structurant d'abord). Les
// filtres absents de cette liste ne sont JAMAIS relâchés : univers, classe d'actif,
// enveloppes, zone, secteur, exclusions, assureur/contrat, sfdr, sri_max (adéquation),
// recherche texte — ils définissent l'intention de fond, pas un confort.
export const RELAXABLE_ORDER = [
  "retrocession_min", "morningstar_min", "track_record_min", "aum_min",
  "labels", "allocation_profile", "beats_benchmark",
  "sharpe_3y_min", "sharpe_min", "vol_3y_max", "vol_max",
  "perf_5y_min", "perf_3y_min", "perf_1y_min", "drawdown_max", "ter_max",
] as const;

// Libellés lisibles des critères relâchés (bandeau UI).
const RELAX_LABELS: Record<string, string> = {
  retrocession_min: "Rétrocession min", morningstar_min: "Note Morningstar",
  track_record_min: "Ancienneté min", aum_min: "Encours min",
  labels: "Labels durabilité", allocation_profile: "Profil d'allocation",
  beats_benchmark: "Bat son indice", sharpe_3y_min: "Sharpe 3 ans",
  sharpe_min: "Sharpe", vol_3y_max: "Volatilité 3 ans", vol_max: "Volatilité",
  perf_5y_min: "Perf 5 ans", perf_3y_min: "Perf 3 ans", perf_1y_min: "Perf 1 an",
  drawdown_max: "Perte max", ter_max: "Frais",
};

export function relaxLabel(key: string): string {
  return RELAX_LABELS[key] ?? key;
}

// Filtres relâchables PRÉSENTS dans la requête, dans l'ordre de drop. `active` mappe
// chaque clé relâchable à sa présence (true = filtre posé). Fonction pure (testable).
export function relaxationOrder(active: Record<string, boolean>): string[] {
  return (RELAXABLE_ORDER as readonly string[]).filter((k) => active[k]);
}

// Intention de tri (NLP) → couple (sort_by, sort_dir). null si aucune intention
// valide. Le tri explicite par colonne (clic UI) reste prioritaire en amont.
export function sortFromIntent(
  f: ParsedFilters,
): { sort_by: string; sort_dir: "asc" | "desc" } | null {
  const si = f.sort_intent;
  if (!si || typeof si.field !== "string") return null;
  if (!(SORTABLE_COLUMNS as readonly string[]).includes(si.field)) return null;
  const dir = si.dir === "asc" ? "asc" : "desc";
  return { sort_by: si.field, sort_dir: dir };
}

export function buildParams(
  f: ParsedFilters,
  page: number,
  sortBy: string,
  sortDir: string,
): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.sfdr?.length)               sp.set("sfdr",              f.sfdr.join(","));
  if (f.sri_min        != null)      sp.set("sri_min",           String(f.sri_min));
  if (f.sri_max        != null)      sp.set("sri_max",           String(f.sri_max));
  if (f.ter_max        != null)      sp.set("ter_max",           String(f.ter_max));
  if (f.perf_1y_min    != null)      sp.set("perf_1y_min",       String(f.perf_1y_min));
  if (f.perf_3y_min    != null)      sp.set("perf_3y_min",       String(f.perf_3y_min));
  if (f.perf_5y_min    != null)      sp.set("perf_5y_min",       String(f.perf_5y_min));
  if (f.vol_max        != null)      sp.set("vol_max",           String(f.vol_max));
  if (f.vol_3y_max     != null)      sp.set("vol_3y_max",        String(f.vol_3y_max));
  if (f.sharpe_min     != null)      sp.set("sharpe_min",        String(f.sharpe_min));
  if (f.sharpe_3y_min  != null)      sp.set("sharpe_3y_min",     String(f.sharpe_3y_min));
  if (f.drawdown_max   != null)      sp.set("drawdown_max",      String(f.drawdown_max));
  if (f.no_entry_fee)                sp.set("no_entry_fee",      "true");
  if (f.aum_min        != null)      sp.set("aum_min",           String(f.aum_min));
  if (f.track_record_min != null)    sp.set("track_record_min",  String(f.track_record_min));
  if (f.morningstar_min  != null)    sp.set("morningstar_min",   String(f.morningstar_min));
  if (f.retrocession_min != null)    sp.set("retrocession_min",  String(f.retrocession_min));
  if (f.envelopes?.length)           sp.set("envelopes",         f.envelopes.join(","));
  if (f.universe?.length)            sp.set("universe",          f.universe.join(","));
  if (f.tax_schemes?.length)         sp.set("tax_scheme",        f.tax_schemes.join(","));
  if (f.asset_class?.length)         sp.set("asset_class",       f.asset_class.join(","));
  if (f.allocation_profile?.length)  sp.set("allocation_profile",f.allocation_profile.join(","));
  if (f.insurers?.length)            sp.set("insurer",           f.insurers.join(","));
  if (f.contracts?.length)           sp.set("contracts",         f.contracts.join(","));
  if (f.gestionnaires?.length)       sp.set("gestionnaire_in",   f.gestionnaires.join(","));
  if (f.region?.length)              sp.set("region",            f.region.join(","));
  if (f.sector?.length)              sp.set("sector",            f.sector.join(","));
  if (f.exclude_sectors?.length)     sp.set("exclude_sector",    f.exclude_sectors.join(","));
  if (f.exclude_regions?.length)     sp.set("exclude_region",    f.exclude_regions.join(","));
  if (f.management_style?.length)    sp.set("management_style",  f.management_style.join(","));
  if (f.currency?.length)            sp.set("currency",          f.currency.join(","));
  if (f.manager_search)              sp.set("manager_search",    f.manager_search);
  if (f.free_text)                   sp.set("search",            f.free_text);
  if (f.has_kid)                     sp.set("has_kid",           "true");
  if (f.beats_benchmark)             sp.set("beats_benchmark",   "true");
  if (f.labels?.length)              sp.set("labels",            f.labels.join(","));
  if (f.target_maturity)             sp.set("target_maturity",   "true");
  if (f.maturity_year_min != null)   sp.set("maturity_year_min", String(f.maturity_year_min));
  if (f.maturity_year_max != null)   sp.set("maturity_year_max", String(f.maturity_year_max));
  // Préférences DOUCES (couloir fit, pas des filtres durs) → pref_*.
  if (f.prefs?.income)               sp.set("pref_income",       "true");
  if (f.prefs?.envelopes?.length)    sp.set("pref_envelopes",    f.prefs.envelopes.join(","));
  if (f.prefs?.novice)               sp.set("pref_novice",       "true");
  if (f.prefs?.small_ticket)         sp.set("pref_small_ticket", "true");
  sp.set("sort_by",  sortBy);
  sp.set("sort_dir", sortDir);
  sp.set("page",     String(page));
  sp.set("per_page", "50");
  return sp;
}

// Inverse de buildParams. Ne lit QUE les clés de filtre (ignore sort_by/page/
// per_page) → l'objet retourné est vide quand l'URL ne porte aucun filtre.
export function filtersFromParams(sp: URLSearchParams): ParsedFilters {
  const f: ParsedFilters = {};
  const list = (k: string) => { const v = sp.get(k); return v ? v.split(",").filter(Boolean) : undefined; };
  const num  = (k: string) => { const v = sp.get(k); return v != null && v !== "" ? Number(v) : undefined; };

  if (sp.has("sfdr")) f.sfdr = (list("sfdr") ?? []).map(Number).filter((n) => !Number.isNaN(n));
  const numKeys: [string, keyof ParsedFilters][] = [
    ["sri_min", "sri_min"], ["sri_max", "sri_max"], ["ter_max", "ter_max"],
    ["perf_1y_min", "perf_1y_min"], ["perf_3y_min", "perf_3y_min"], ["perf_5y_min", "perf_5y_min"],
    ["vol_max", "vol_max"], ["vol_3y_max", "vol_3y_max"], ["sharpe_min", "sharpe_min"],
    ["sharpe_3y_min", "sharpe_3y_min"], ["drawdown_max", "drawdown_max"], ["aum_min", "aum_min"],
    ["track_record_min", "track_record_min"], ["morningstar_min", "morningstar_min"],
    ["retrocession_min", "retrocession_min"],
    ["maturity_year_min", "maturity_year_min"], ["maturity_year_max", "maturity_year_max"],
  ];
  for (const [param, key] of numKeys) {
    const v = num(param);
    if (v != null && !Number.isNaN(v)) (f[key] as number) = v;
  }
  if (sp.get("no_entry_fee")    === "true") f.no_entry_fee    = true;
  if (sp.get("has_kid")         === "true") f.has_kid         = true;
  if (sp.get("beats_benchmark") === "true") f.beats_benchmark = true;
  if (sp.get("target_maturity") === "true") f.target_maturity = true;

  const arrKeys: [string, keyof ParsedFilters][] = [
    ["envelopes", "envelopes"], ["universe", "universe"], ["tax_scheme", "tax_schemes"],
    ["asset_class", "asset_class"],
    ["allocation_profile", "allocation_profile"], ["insurer", "insurers"], ["contracts", "contracts"],
    ["gestionnaire_in", "gestionnaires"], ["region", "region"], ["sector", "sector"],
    ["exclude_sector", "exclude_sectors"], ["exclude_region", "exclude_regions"],
    ["management_style", "management_style"], ["currency", "currency"],
    ["labels", "labels"],
  ];
  for (const [param, key] of arrKeys) {
    const v = list(param);
    if (v?.length) (f[key] as string[]) = v;
  }
  if (sp.get("manager_search")) f.manager_search = sp.get("manager_search")!;
  if (sp.get("search"))         f.free_text      = sp.get("search")!;

  // Préférences douces (round-trip URL → UI). Vide si l'URL n'en porte aucune.
  const prefs: NonNullable<ParsedFilters["prefs"]> = {};
  if (sp.get("pref_income")       === "true") prefs.income = true;
  if (sp.get("pref_novice")       === "true") prefs.novice = true;
  if (sp.get("pref_small_ticket") === "true") prefs.small_ticket = true;
  const prefEnv = list("pref_envelopes");
  if (prefEnv?.length) prefs.envelopes = prefEnv;
  if (Object.keys(prefs).length) f.prefs = prefs;

  return f;
}

// ─── Filtre de référencement (assureur / contrat) ────────────────────────────
// Hérité de l'onglet Assurances vie : il borne l'univers à un assureur/contrat et
// doit SURVIVRE à chaque nouvelle recherche texte (sinon la requête repart sur tout
// le catalogue et le badge « Supports référencés chez… » disparaît). Ces deux
// helpers isolent la logique, réutilisée au montage et dans le handler de recherche.

// Nombre de filtres « durs » actifs (catégories contraintes) dans un ParsedFilters.
// Alimente le badge « Gérer mes filtres » de l'accueil, où l'on peut raisonner par
// filtres avant même d'écrire une requête. On ignore ce qui n'est pas un filtre de
// screener : requête texte, chips d'affichage, intention de tri, préférences douces.
const NON_FILTER_KEYS = new Set(["free_text", "chips", "sort_intent", "prefs"]);
export function countActiveFilters(f: ParsedFilters): number {
  let n = 0;
  for (const [k, v] of Object.entries(f)) {
    if (NON_FILTER_KEYS.has(k)) continue;
    if (Array.isArray(v)) { if (v.length > 0) n++; }
    else if (v != null && v !== "" && v !== false) n++;
  }
  return n;
}

// Ne conserve QUE les clés de référencement effectivement présentes.
export function pickReferencing(f: ParsedFilters): ParsedFilters {
  const ref: ParsedFilters = {};
  if (f.insurers?.length)  ref.insurers  = f.insurers;
  if (f.contracts?.length) ref.contracts = f.contracts;
  return ref;
}

// URL de recherche texte préservant le filtre de référencement (assureur/contrat),
// pour que le périmètre et le badge survivent au rechargement et au partage.
export function searchUrlWithReferencing(rawQuery: string, ref: ParsedFilters): string {
  const sp = new URLSearchParams();
  sp.set("q", rawQuery);
  if (ref.insurers?.length)  sp.set("insurer",   ref.insurers.join(","));
  if (ref.contracts?.length) sp.set("contracts", ref.contracts.join(","));
  return `/recherche?${sp.toString()}`;
}

// ─── Libellés lisibles des filtres issus du profil client ─────────────────────
// Source unique partagée entre la barre d'action de la page Profil client et le
// bandeau de contexte du screener (après redirection « Trouver les fonds adaptés »).
// Ne décrit que les clés qu'un profil produit ; le reste (assureur/contrat) a ses
// propres bandeaux.
const ENVELOPE_FILTER_LABELS: Record<string, string> = {
  PEA: "PEA", "PEA-PME": "PEA-PME", PER: "PER",
  "AV-FR": "AV France", "AV-LUX": "AV Luxembourg", CTO: "CTO",
};
const ASSET_BROAD_FILTER_LABELS: Record<string, string> = {
  action: "Actions", obligation: "Obligataire", immobilier: "Immobilier",
  alternatif: "Alternatif", monetaire: "Monétaire", diversifie: "Diversifié",
  matieres_premieres: "Matières prem.",
};
const MGMT_STYLE_FILTER_LABELS: Record<string, string> = {
  actif: "Gestion active", passif: "Gestion indicielle",
  smart_beta: "Smart beta", alternatif: "Gestion alternative",
};
const LABEL_FILTER_LABELS: Record<string, string> = {
  isr: "Label ISR", greenfin: "Label Greenfin", finansol: "Label Finansol",
};
// Dispositifs de défiscalisation (colonne tax_scheme). Source unique partagée
// entre l'UI (FilterPanel) et le bandeau de contexte du screener.
export const TAX_SCHEME_LABELS: Record<string, string> = {
  fip: "FIP", fip_corse: "FIP Corse", fip_outremer: "FIP Outre-mer",
  fcpi: "FCPI", fcpr: "FCPR",
};

export function describeScreenerFilters(f: ParsedFilters): string[] {
  const out: string[] = [];
  if (f.sri_min != null)      out.push(`SRI ≥ ${f.sri_min}`);
  if (f.sri_max != null)      out.push(`SRI ≤ ${f.sri_max}`);
  if (f.sfdr?.length)         out.push(`SFDR Art. ${f.sfdr.join(" / ")}`);
  if (f.drawdown_max != null) out.push(`Perte ≤ ${f.drawdown_max} %`);
  if (f.ter_max != null)      out.push(`Frais ≤ ${f.ter_max} %`);
  if (f.no_entry_fee)         out.push("Sans frais d'entrée");
  if (f.beats_benchmark)      out.push("Bat son indice");
  if (f.target_maturity || f.maturity_year_min != null || f.maturity_year_max != null) {
    const a = f.maturity_year_min, b = f.maturity_year_max;
    out.push(
      a != null && b != null ? `Échéance ${a}-${b}`
      : a != null ? `Échéance ≥ ${a}`
      : b != null ? `Échéance ≤ ${b}`
      : "Fonds à échéance",
    );
  }
  for (const l of f.labels ?? []) out.push(LABEL_FILTER_LABELS[l] ?? l);
  for (const t of f.tax_schemes ?? []) out.push(TAX_SCHEME_LABELS[t] ?? t);
  for (const e of f.envelopes ?? [])        out.push(ENVELOPE_FILTER_LABELS[e] ?? e);
  for (const a of f.asset_class ?? [])      out.push(ASSET_BROAD_FILTER_LABELS[a] ?? a);
  for (const m of f.management_style ?? []) out.push(MGMT_STYLE_FILTER_LABELS[m] ?? m);
  // Note : les assureurs du CGP (f.insurers) ne sont PAS listés ici — le screener
  // les affiche déjà via son bandeau de référencement dédié (« Supports référencés
  // chez… »), avec son propre retrait. Les dupliquer alourdirait l'en-tête.
  return out;
}

// Amorçage synchrone de l'écran de recherche au montage : décide les `filters` et
// l'état `parsing` initiaux à partir de la seule URL (jamais du cache de session,
// restauré côté client pour ne pas casser l'hydratation). Objectif : que le tout
// premier fetch parte déjà avec la bonne portée. Sans cet amorçage, le premier
// rendu partait avec des filtres vides → une requête screener par défaut (univers
// complet, tri complétude) redondante, la plus lourde et celle qui dépasse le
// statement timeout Supabase (500 transitoire), aussitôt supplantée par la requête
// filtrée. `parsing: true` gèle le fetch le temps que l'analyse NLP livre les
// filtres compris (cas d'une requête texte non-ISIN).
export function computeInitialSearchState(
  initialQ: string,
  initialUrlFilters: ParsedFilters,
  hasUrlFilters: boolean,
): { filters: ParsedFilters; parsing: boolean } {
  // Filtres décidés en amont (enveloppe/assureur, lien partagé), avec ou sans texte.
  if (hasUrlFilters) {
    if (initialQ && !asExactIsin(initialQ)) return { filters: initialUrlFilters, parsing: true };
    if (initialQ) return { filters: { free_text: initialQ, ...initialUrlFilters }, parsing: false };
    return { filters: initialUrlFilters, parsing: false };
  }
  if (initialQ) {
    // ISIN exact : recherche ciblée sans NLP. Sinon : parse NLP en cours.
    if (asExactIsin(initialQ)) return { filters: { free_text: initialQ }, parsing: false };
    return { filters: {}, parsing: true };
  }
  return { filters: {}, parsing: false };
}
