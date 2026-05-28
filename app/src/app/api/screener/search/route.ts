import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/screener/search?q=carmignac&limit=10&min_completeness=60
//
// Autocomplete endpoint — recherche pg_trgm via search_funds_v2 RPC.
// Gère les correspondances partielles, accents, gestionnaires.
// Retourne les champs minimaux pour un dropdown typeahead.
//
// Query params:
//   q                — requis, min 2 caractères
//   limit            — optionnel, 1–20, défaut 10
//   min_completeness — optionnel, 0–100, défaut 60
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json(
      { error: "Le paramètre 'q' doit contenir au moins 2 caractères." },
      { status: 400 }
    );
  }

  const limit = Math.min(20, Math.max(1, parseInt(sp.get("limit") ?? "10", 10) || 10));
  const minCompleteness = Math.min(100, Math.max(0, parseInt(sp.get("min_completeness") ?? "60", 10) || 60));

  const { data, error } = await supabase.rpc("search_funds_v2", {
    p_query: q,
    p_limit: limit,
    p_min_complete: minCompleteness,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    isin: string;
    name: string;
    product_type: string;
    gestionnaire: string | null;
    ter: number | null;
    risk_score: number | null;
    relevance_score: number;
  };

  const results = ((data as unknown as Row[]) ?? []).map((row) => ({
    isin: row.isin,
    name: row.name,
    product_type: row.product_type,
    gestionnaire: row.gestionnaire,
    ter: row.ter,
    risk_score: row.risk_score,
    relevance_score: row.relevance_score,
  }));

  return NextResponse.json(
    { data: results, count: results.length },
    { headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=10" } }
  );
}
