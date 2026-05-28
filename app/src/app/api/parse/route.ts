import { NextRequest, NextResponse } from "next/server";
import { parseFrenchQuery } from "@/lib/claude";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { query } = (await req.json()) as { query?: string };
    if (!query?.trim()) {
      return NextResponse.json({}, { status: 200 });
    }
    const filters = await parseFrenchQuery(query.trim());
    return NextResponse.json(filters);
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}
