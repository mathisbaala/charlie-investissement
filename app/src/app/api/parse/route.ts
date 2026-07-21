import { NextRequest, NextResponse } from "next/server";
import { parseFrenchQueryResult } from "@/lib/claude";
import { aiRateLimit, botGuard, dataRateLimit, AI_COST } from "@/lib/rateLimit";
import { getCachedFilters, setCachedFilters, normalizeNlQuery } from "@/lib/nlpCache";
import { logEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Anti-bot + anti-burst en amont du quota IA journalier : un client
  // non-navigateur ou une rafale d'une même IP sont écartés avant tout appel
  // facturé (défense en profondeur, cf. lib/rateLimit).
  const bot = botGuard(req);
  if (bot) return bot;
  const burst = await dataRateLimit(req, 1);
  if (burst) return burst;
  try {
    const { query } = (await req.json()) as { query?: string };
    const q = query?.trim();
    if (!q) {
      return NextResponse.json({}, { status: 200 });
    }
    const norm = normalizeNlQuery(q);
    // 1) Cache : une requête déjà interprétée est resservie sans réappeler le
    //    modèle — ni token, ni quota IA consommés (le cache passe AVANT le quota).
    const cached = await getCachedFilters(norm);
    if (cached) {
      logEvent(req, { event_type: "search_nl", query: q });
      return NextResponse.json(cached);
    }
    // 2) Miss : on applique le quota IA, puis on interroge le modèle.
    const limited = await aiRateLimit(req, AI_COST.parse);
    if (limited) return limited;
    const { filters, ok } = await parseFrenchQueryResult(q);
    // Write-through : on ne mémorise QUE les succès réels (jamais le repli d'erreur).
    if (ok) void setCachedFilters(norm, filters);
    // Télémétrie : recherche en langage naturel — capte les mots-clés réellement tapés.
    logEvent(req, { event_type: "search_nl", query: q });
    return NextResponse.json(filters);
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}
