import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { FundDetail, FundDetailResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// Standard ISIN (12 chars) OR internal identifiers (FE_*, CRYPTO_*)
const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/i;

// GET /api/fonds/[isin]
// Retourne la fiche complète d'un fonds via RPC get_fund_detail.
// Inclut les percentiles TER et perf 3Y dans la catégorie du fonds.
export async function GET(
  _req: NextRequest,
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

  const { data, error } = await supabase.rpc("get_fund_detail", {
    p_isin: upper,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "Fonds non trouvé", isin: upper },
      { status: 404 }
    );
  }

  const response: FundDetailResponse = { data: data as unknown as FundDetail };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
  });
}
