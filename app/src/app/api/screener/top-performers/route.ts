import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { feeFracToPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const VALID_SORT = new Set([
  "performance_3y",
  "performance_1y",
  "sharpe_3y",
  "aum_eur",
]);

// GET /api/screener/top-performers
// Top fonds par critère — utilisé pour les widgets "meilleurs fonds" du frontend.
//
// Query params:
//   type             — product_type filtre (opcvm, etf, scpi…)
//   category         — category_normalized
//   region           — region_normalized
//   sort_by          — performance_3y (défaut) | performance_1y | sharpe_3y | aum_eur
//   limit            — 1–50, défaut 10
//   min_completeness — 0–100, défaut 70
//   min_aum          — encours minimum en euros
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;

  const sortByRaw = sp.get("sort_by") ?? "performance_3y";
  const sortBy = VALID_SORT.has(sortByRaw) ? sortByRaw : "performance_3y";
  const limit = Math.min(50, Math.max(1, parseInt(sp.get("limit") ?? "10", 10) || 10));
  const minCompleteness = Math.min(100, Math.max(0, parseInt(sp.get("min_completeness") ?? "70", 10) || 70));
  const minAum = sp.get("min_aum") ? parseInt(sp.get("min_aum")!, 10) || null : null;

  const { data, error } = await supabase.rpc("get_top_performers", {
    p_product_type:     sp.get("type") ?? null,
    p_category:         sp.get("category") ?? null,
    p_region:           sp.get("region") ?? null,
    p_sort_by:          sortBy,
    p_limit:            limit,
    p_min_completeness: minCompleteness,
    p_min_aum:          minAum,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Frontière API : frais fraction (DB) → % (widgets accueil affichent via pct()).
  const funds = (data ?? []).map((f: any) => ({
    ...f,
    ter: feeFracToPct(f.ter),
    ongoing_charges: feeFracToPct(f.ongoing_charges),
  }));

  return NextResponse.json(
    { data: funds, sort_by: sortBy },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
