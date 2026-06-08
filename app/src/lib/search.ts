// Logique de recherche full-text du screener.
//
// La recherche libre ne doit pas se limiter au nom du fonds : un mot comme
// « France », « actions » ou « Europe » décrit souvent la zone géographique,
// la catégorie, la classe d'actif ou le secteur. Sans ça, une requête comme
// « ETF France » exigeait les deux mots dans le seul nom du fonds → très peu
// de résultats alors que la base en contient beaucoup plus de pertinents.

// Colonnes (de la vue investissement_funds_cgp) interrogées pour chaque mot.
export const SEARCH_COLUMNS = [
  "name",
  "gestionnaire",
  "category_normalized",
  "region_normalized",
  "asset_class",
  "sector",
] as const;

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
