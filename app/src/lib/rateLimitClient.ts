"use client";

// Pont entre les appels IA (qui peuvent renvoyer 429) et le petit modal global
// qui informe l'utilisateur que ses crédits du jour sont épuisés.

export const RATE_LIMIT_EVENT = "charlie:rate-limit";

function notifyRateLimit(scope: "day" | "hour" = "day") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail: { scope } }));
}

/**
 * Si la réponse est un 429 (quota IA atteint), déclenche le modal et renvoie
 * `true` (l'appelant doit s'arrêter là). Sinon renvoie `false`.
 */
export async function handledRateLimit(res: Response): Promise<boolean> {
  if (res.status !== 429) return false;
  let scope: "day" | "hour" = "day";
  try {
    const body = await res.clone().json();
    if (body?.scope === "hour") scope = "hour";
  } catch { /* garde 'day' par défaut */ }
  notifyRateLimit(scope);
  return true;
}
