import { supabase } from "@/lib/supabase";
import type { ParsedFilters } from "@/lib/types";

// Cache d'interprétation des recherches en langage naturel (poste IA le plus
// fréquent : un appel LLM par recherche). Une requête déjà traduite en filtres est
// resservie sans réappeler le modèle → zéro token, zéro quota, réponse instantanée.
// Best-effort de bout en bout : toute erreur du cache retombe silencieusement sur
// l'appel modèle habituel — le cache n'est qu'un raccourci, jamais un point de panne.
//
// Aucune perte de pertinence : on ne mémorise QUE le JSON déjà validé
// (sanitizeParsedFilters) d'un appel modèle réussi, et on le ressert à l'identique.

// Version du cache. À incrémenter quand le prompt / mapping de parseFrenchQuery
// change de façon à modifier les filtres produits : les anciennes entrées (clé
// préfixée par l'ancienne version) sont alors ignorées, sans purge manuelle.
export const NLP_CACHE_VERSION = "v1";

// Fraîcheur : au-delà, on ré-interroge le modèle (filet de sécurité si le mapping
// évolue sans bump de version). Réglable par env, sans toucher au code.
const TTL_DAYS = Number(process.env.NLP_CACHE_TTL_DAYS ?? 60);

/**
 * Normalise une requête pour maximiser les correspondances de cache sans écraser
 * le sens : minuscules, espaces multiples réduits, `<>` retirés (comme le prompt),
 * borné à 500 caractères (comme parseFrenchQuery). Les accents sont conservés (ils
 * portent du sens en français). « ETF  Monde » et « etf monde » partagent la clé.
 */
export function normalizeNlQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function keyFor(norm: string): string {
  return `${NLP_CACHE_VERSION}:${norm}`;
}

/**
 * Renvoie les filtres mémorisés pour cette requête normalisée, ou `null` (miss /
 * périmé / erreur). Lecture ATOMIQUE : la RPC lit ET compte le hit en un seul
 * aller-retour (UPDATE ... RETURNING). Attendue par l'appelant → le compteur est
 * fiable même sur Vercel serverless (un fire-and-forget serait perdu au gel du
 * Lambda). Un miss ne met rien à jour et renvoie `null`.
 */
export async function getCachedFilters(norm: string): Promise<ParsedFilters | null> {
  if (!norm) return null;
  try {
    const { data, error } = await supabase.rpc("inv_nlp_cache_get", {
      p_key: keyFor(norm),
      p_max_age_days: TTL_DAYS,
    });
    if (error || data == null) return null;
    return data as ParsedFilters;
  } catch {
    return null; // best-effort : un cache indisponible = simple miss
  }
}

/**
 * Mémorise le résultat validé d'un appel modèle réussi (write-through). À n'appeler
 * QUE sur succès réel du modèle — jamais sur le repli `{}` d'une erreur, sous peine
 * d'empoisonner le cache. Best-effort : une écriture qui échoue est ignorée.
 */
export async function setCachedFilters(norm: string, filters: ParsedFilters): Promise<void> {
  if (!norm) return;
  try {
    await supabase.from("investissement_nlp_cache").upsert(
      {
        query_key: keyFor(norm),
        query_text: norm,
        filters,
        created_at: new Date().toISOString(), // rafraîchit le TTL à chaque ré-apprentissage
      },
      { onConflict: "query_key" },
    );
  } catch {
    /* best-effort : l'échec d'écriture ne doit jamais casser la recherche */
  }
}
