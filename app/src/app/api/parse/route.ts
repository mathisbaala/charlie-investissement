import { NextRequest, NextResponse } from "next/server";
import { parseFrenchQuery } from "@/lib/claude";
import { aiRateLimit, AI_COST } from "@/lib/rateLimit";

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
    return NextResponse.json(filters);
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}
