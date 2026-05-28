import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { ScreenerFiltersResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/screener/filters
// Dynamic filter values with counts — via server-side SQL RPC, cached 5 minutes.
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { data, error } = await supabase.rpc("get_screener_filter_options");

  if (error) {
    return NextResponse.json(
      { error: "Erreur lors du chargement des filtres", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data as unknown as ScreenerFiltersResponse, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
