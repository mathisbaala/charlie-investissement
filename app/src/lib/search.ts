// Helpers purs de recherche texte du screener.
// La recherche libre elle-même passe par le RPC inv_funds_search (match par
// sous-chaîne sur plusieurs colonnes) ; ici on ne garde que deux prétraitements
// de la requête appliqués en amont : le raccourci ISIN exact et la réécriture
// des alias d'indices « collés ».

// Un ISIN : 2 lettres pays + 9 caractères alphanumériques + 1 chiffre de
// contrôle, soit 12 caractères. Repère une recherche par ISIN exact pour la
// router vers une recherche ciblée (cf. /api/funds).
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// Renvoie l'ISIN normalisé (trim + majuscules) si la saisie EST un ISIN complet,
// sinon null. Les ISIN sont stockés en majuscules : on normalise avant de tester.
export function asExactIsin(search: string): string | null {
  const s = search.trim().toUpperCase();
  return ISIN_RE.test(s) ? s : null;
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
