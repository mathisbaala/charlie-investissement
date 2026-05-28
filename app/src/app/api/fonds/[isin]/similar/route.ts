import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { SimilarFund, SimilarFundsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const ISIN_RE = /^[A-Z0-9]{12}$/i;

// GET /api/fonds/[isin]/similar?limit=6
// Retourne jusqu'à `limit` fonds similaires via RPC get_similar_funds.
// Similarité : même product_type + catégorie/région proches, complétude ≥ 60.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ isin: string }> }
): Promise<NextResponse> {
  const { isin } = await params;

  if (!ISIN_RE.test(isin)) {
    return NextResponse.json(
      { error: "ISIN invalide — 12 caractères alphanumériques attendus" },
      { status: 400 }
    );
  }

  const upper = isin.toUpperCase();
  const limit = Math.min(
    20,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "6", 10) || 6)
  );

  const { data, error } = await supabase.rpc("get_similar_funds", {
    p_isin: upper,
    p_limit: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response: SimilarFundsResponse = {
    data: (data as unknown as SimilarFund[]) ?? [],
    ref_isin: upper,
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
  });
}
