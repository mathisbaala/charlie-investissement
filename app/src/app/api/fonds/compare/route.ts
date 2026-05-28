import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { FundDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

const ISIN_RE = /^[A-Z0-9]{12}$/i;
const MAX_FUNDS = 5;

// GET /api/fonds/compare?isins=FR001,FR002,FR003
// Retourne les fiches complètes de plusieurs fonds pour comparaison côte-à-côte.
// Limite : 5 fonds maximum.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = req.nextUrl.searchParams.get("isins") ?? "";
  const isins = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => ISIN_RE.test(s))
    .slice(0, MAX_FUNDS);

  if (isins.length === 0) {
    return NextResponse.json(
      { error: "Paramètre 'isins' requis — liste d'ISINs séparés par virgule (max 5)" },
      { status: 400 }
    );
  }

  const results = await Promise.all(
    isins.map((isin) => supabase.rpc("get_fund_detail", { p_isin: isin }))
  );

  const data: Record<string, FundDetail | null> = {};
  const errors: Record<string, string> = {};

  for (let i = 0; i < isins.length; i++) {
    const isin = isins[i];
    const { data: fund, error } = results[i];
    if (error) {
      errors[isin] = error.message;
    } else {
      data[isin] = (fund as unknown as FundDetail) ?? null;
    }
  }

  return NextResponse.json(
    { data, errors: Object.keys(errors).length > 0 ? errors : undefined },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
