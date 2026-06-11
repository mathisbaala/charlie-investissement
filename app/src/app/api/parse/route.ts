import { NextRequest, NextResponse } from "next/server";
import { parseFrenchQuery } from "@/lib/claude";
import { aiRateLimit, AI_COST } from "@/lib/rateLimit";
import { logEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { query } = (await req.json()) as { query?: string };
    if (!query?.trim()) {
      return NextResponse.json({}, { status: 200 });
    }
    const limited = await aiRateLimit(req, AI_COST.parse);
    if (limited) return limited;
    const filters = await parseFrenchQuery(query.trim());
    // Télémétrie : recherche en langage naturel — capte les mots-clés réellement tapés.
    logEvent(req, { event_type: "search_nl", query: query.trim() });
    return NextResponse.json(filters);
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}
