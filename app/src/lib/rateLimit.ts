import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Plafonds anti-abus des appels IA (par IP). Volontairement généreux : laisser
// un visiteur explorer toute la puissance du produit, mais l'empêcher de cramer
// les crédits Claude en une heure. Réglables via variables d'environnement.
//   - heure : proxy de « session » (« ne pas tout cramer en une heure »)
//   - jour  : plafond quotidien global
const HOUR_LIMIT = Number(process.env.AI_HOUR_LIMIT ?? 40);
const DAY_LIMIT  = Number(process.env.AI_DAY_LIMIT ?? 150);

// Coût relatif par type d'appel (l'extraction DICI en vision coûte bien plus
// cher qu'une simple interprétation de requête).
export const AI_COST = {
  parse: 1,         // recherche en langage naturel
  profile: 1,       // parsing d'un profil client
  chat: 2,          // message de chat
  dici: 3,          // extraction d'un DICI (vision + gros prompt)
} as const;

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Renvoie une réponse 429 si la limite IA est atteinte pour cette IP, sinon
 * `null` (l'appelant continue normalement). Fail-open : toute erreur de
 * comptage laisse passer — on ne casse jamais le produit pour un souci de
 * rate-limit (au pire on dépense un peu plus).
 */
export async function aiRateLimit(req: NextRequest, cost = 1): Promise<NextResponse | null> {
  try {
    const ip = clientIp(req);
    const { data, error } = await supabase.rpc("inv_ai_rate_limit", {
      p_ip: ip, p_hour_limit: HOUR_LIMIT, p_day_limit: DAY_LIMIT, p_cost: cost,
    });
    if (error || !data) return null;
    const r = data as { allowed: boolean; scope: "ok" | "hour" | "day" };
    if (r.allowed) return null;

    const perHour = r.scope === "hour";
    return NextResponse.json(
      {
        error: "rate_limited",
        scope: r.scope,
        message: perHour
          ? "Limite d'utilisation de l'IA atteinte pour cette heure. Réessayez d'ici une heure."
          : "Limite d'utilisation de l'IA atteinte pour aujourd'hui. Revenez demain.",
      },
      { status: 429, headers: { "Retry-After": perHour ? "3600" : "86400" } },
    );
  } catch {
    return null; // fail-open
  }
}
