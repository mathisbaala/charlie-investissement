// Passage de relais d'un relevé entre l'onglet « Frais » et « Portefeuille →
// Analyser ». Le fichier déposé est parsé UNE fois par /api/releve (dans l'onglet
// Frais) ; le fichier lui-même n'est plus disponible ensuite. Pour que le bouton
// « Analyse complète » ouvre EXACTEMENT le même diagnostic qu'un dépôt direct —
// montants réels au centime, contrat/assureur reconnu, DIC — on mémorise le
// relevé parsé (positions + matches) en sessionStorage et on le rejoue côté
// analyse. Sans ce relais, l'URL ne portait que des poids arrondis (montants
// reconstruits, petites lignes écrasées à 0) et perdait la reconnaissance
// d'assureur (donc le DIC et la convention cabinet).

import type { ReleveApiPosition, ReleveContractMatch } from "@/lib/releve";

/** Un relevé parsé, prêt à être rejoué tel quel côté « Analyser ». */
export interface HandoffReleve {
  id: string;
  fileName: string;
  positions: ReleveApiPosition[];
  matches: ReleveContractMatch[];
  /** Index du contrat retenu dans `matches` (-1 = non rattaché). */
  chosen: number;
  documentTotal: number | null;
}

interface HandoffPayload {
  token: string;
  releves: HandoffReleve[];
}

// Un seul emplacement, écrasé à chaque dépôt : pas d'accumulation en session.
const KEY = "charlie:releve-handoff";

/** Jeton opaque associé à un dépôt (identifie le relais dans l'URL de sortie). */
function makeToken(): string {
  return `h${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Mémorise les relevés parsés et renvoie le jeton à joindre au lien « Analyse
 * complète » (`?handoff=<token>`). Renvoie null si rien n'est mémorisable
 * (sessionStorage indisponible, ou aucun relevé).
 */
export function saveReleveHandoff(releves: HandoffReleve[]): string | null {
  if (releves.length === 0) return null;
  const token = makeToken();
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ token, releves } satisfies HandoffPayload));
    return token;
  } catch {
    return null;
  }
}

/**
 * Rejoue les relevés d'un relais si le jeton correspond (dépôt non modifié
 * depuis). Renvoie null si le jeton est absent, périmé (un autre dépôt a écrasé
 * le relais) ou illisible — l'appelant retombe alors sur les paramètres d'URL.
 */
export function loadReleveHandoff(token: string | null): HandoffReleve[] | null {
  if (!token) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HandoffPayload;
    if (parsed?.token !== token || !Array.isArray(parsed.releves)) return null;
    return parsed.releves.length > 0 ? parsed.releves : null;
  } catch {
    return null;
  }
}
