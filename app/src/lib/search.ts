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

// ─── Alias de raccourcis d'indices « collés » ────────────────────────────────
// La recherche texte matche par SOUS-CHAÎNE, tous les mots (RPC inv_funds_search).
// Un raccourci saisi sans espace ni ponctuation — « sp500 » — n'est sous-chaîne
// d'AUCUN nom « S&P 500 » (le « & » et l'espace cassent le match) → 0 résultat,
// alors que « s&p 500 », « sp 500 », « 500 » fonctionnent. On réécrit donc ces
// jetons vers leur forme canonique cherchable AVANT la RPC : « sp500 » → « s&p 500 »
// (jetons « s&p » + « 500 », tous deux sous-chaînes des noms). Ciblé sur les formes
// numériques recollées (jamais des tickers réels type CW8/DCAM), donc sans risque
// d'écraser une recherche par ticker. Clés en minuscules ; match par jeton entier.
const INDEX_SEARCH_ALIASES: Record<string, string> = {
  "sp500": "s&p 500",
  "s&p500": "s&p 500",
  "nasdaq100": "nasdaq 100",
  "nasdaq-100": "nasdaq 100",
  "cac40": "cac 40",
  "sbf120": "sbf 120",
  "eurostoxx": "euro stoxx",
  "eurostoxx50": "euro stoxx 50",
  "stoxx600": "stoxx 600",
  "msciworld": "msci world",
  "ftse100": "ftse 100",
  "dax40": "dax 40",
  "dax30": "dax 30",
  "nikkei225": "nikkei 225",
  "russell2000": "russell 2000",
  "csi300": "csi 300",
  "hangseng": "hang seng",
};

// Réécrit les jetons reconnus comme raccourci d'indice vers leur forme canonique
// cherchable. Les jetons inconnus (noms, tickers, gestionnaires) passent inchangés.
// Fonction pure (testable sans DB) ; appliquée à la requête texte avant la RPC.
export function expandSearchAliases(search: string): string {
  const trimmed = search.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((tok) => INDEX_SEARCH_ALIASES[tok.toLowerCase()] ?? tok)
    .join(" ");
}
