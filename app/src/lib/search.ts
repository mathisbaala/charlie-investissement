// Logique de recherche full-text du screener.
//
// La recherche libre ne doit pas se limiter au nom du fonds : un mot comme
// « France », « actions » ou « Europe » décrit souvent la zone géographique,
// la catégorie, la classe d'actif ou le secteur. Sans ça, une requête comme
// « ETF France » exigeait les deux mots dans le seul nom du fonds → très peu
// de résultats alors que la base en contient beaucoup plus de pertinents.

// Colonnes (de la vue investissement_funds_cgp) interrogées pour chaque mot.
// `isin` est inclus pour qu'une saisie partielle d'ISIN matche aussi (un ISIN
// complet est, lui, traité en amont par un raccourci exact — cf. asExactIsin).
export const SEARCH_COLUMNS = [
  "name",
  "isin",
  "gestionnaire",
  "category_normalized",
  "region_normalized",
  "asset_class",
  "sector",
] as const;

// Un ISIN : 2 lettres pays + 9 caractères alphanumériques + 1 chiffre de
// contrôle, soit 12 caractères. Repère une recherche par ISIN exact pour la
// router vers une recherche ciblée (cf. /api/funds), au lieu du ilike par mot.
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// Renvoie l'ISIN normalisé (trim + majuscules) si la saisie EST un ISIN complet,
// sinon null. Les ISIN sont stockés en majuscules : on normalise avant de tester.
export function asExactIsin(search: string): string | null {
  const s = search.trim().toUpperCase();
  return ISIN_RE.test(s) ? s : null;
}

// Découpe la recherche en mots, en retirant les caractères qui casseraient la
// syntaxe du filtre `.or()` de PostgREST (%, _, virgules, parenthèses, crochets).
export function searchWords(search: string): string[] {
  const safe = search.replace(/[%_,()[\]\\]/g, "");
  return safe.split(/\s+/).filter(Boolean);
}

// Clause OR PostgREST pour un mot : il peut matcher n'importe quelle colonne.
export function searchOrClause(word: string): string {
  return SEARCH_COLUMNS.map((c) => `${c}.ilike.%${word}%`).join(",");
}
