import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Plafonds anti-abus des appels IA (par IP). Stratégie « démo » : laisser un
// visiteur prendre l'outil en main (quelques recherches + uploads, ~10-15 min)
// puis le bloquer jusqu'au lendemain — il revient chaque jour, sans cramer les
// crédits, et on l'incite à demander un accès complet. Le plafond JOUR est la
// contrainte qui mord ; l'heure est calée pareil pour qu'une seule session
// puisse l'atteindre. Réglables via variables d'environnement (sans redéploiement
// du code, juste un redeploy Vercel).
//   coûts : 1 recherche=1, 1 chat=2, 1 upload DICI=3
const HOUR_LIMIT = Number(process.env.AI_HOUR_LIMIT ?? 25);
const DAY_LIMIT  = Number(process.env.AI_DAY_LIMIT ?? 25);

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
          ? "Vous avez atteint votre quota de découverte pour cette heure. Réessayez d'ici une heure — ou contactez-nous pour un accès complet."
          : "Vous avez atteint votre quota de découverte du jour. Revenez demain — ou contactez-nous pour débloquer un accès complet à Charlie.",
      },
      { status: 429, headers: { "Retry-After": perHour ? "3600" : "86400" } },
    );
  } catch {
    return null; // fail-open
  }
}
