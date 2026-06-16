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
// `tickers_search` = les tickers boursiers de l'ETF concaténés par espaces
// (DCAM, DCAMEUR…) ; permet de retrouver un ETF par son code de cotation, que la
// base ne stockait pas avant (retour utilisateur : « DCAM » ne renvoyait rien).
// PostgREST ne sait pas faire d'`ilike` sur une colonne tableau, d'où la colonne
// texte dénormalisée côté vue (cf. migration 20260616130000).
export const SEARCH_COLUMNS = [
  "name",
  "isin",
  "tickers_search",
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

// ─── Pertinence : priorité au match EXACT de ticker ──────────────────────────
// Le `ilike %mot%` matche en sous-chaîne : un ticker parasite (OpenFIGI attribue
// parfois « CSPX » à un autre ETF que l'iShares S&P 500) pouvait passer devant le
// vrai fonds, classé seulement par data_completeness. On repère donc une requête
// « ticker » (un seul mot, code court alphanumérique) pour remonter en tête les
// fonds dont c'est EXACTEMENT le ticker, classés par encours (le plus liquide
// d'abord) — ce qui départage justement les homonymes.

// Renvoie le token si la recherche est un mot unique de forme ticker, sinon null.
export function asTickerToken(search: string): string | null {
  const words = searchWords(search);
  if (words.length !== 1) return null;
  return /^[A-Za-z0-9]{2,7}$/.test(words[0]) ? words[0] : null;
}

// Motif POSIX (insensible à la casse via l'opérateur `imatch`) pour un match en
// MOT ENTIER dans `tickers_search` (tokens séparés par des espaces) : `\y` borne
// le mot, donc « \yCSPX\y » matche le token « CSPX » mais pas « CSPXJ ». Le token
// est garanti alphanumérique par asTickerToken → aucun métacaractère à échapper.
export function tickerWordPattern(token: string): string {
  return `\\y${token}\\y`;
}
