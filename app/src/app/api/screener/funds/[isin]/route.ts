import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { Fund } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/screener/funds/[isin]
//
// Returns the full VIEW row for the given ISIN from investissement_funds_cgp.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ isin: string }> }
): Promise<NextResponse> {
  const { isin } = await params;

  // Basic ISIN validation — 12 alphanumeric characters
  if (!isin || !/^[A-Z0-9]{12}$/i.test(isin)) {
    return NextResponse.json(
      { error: "ISIN invalide — format attendu : 12 caractères alphanumériques" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("investissement_funds_cgp")
    .select("*")
    .eq("isin", isin.toUpperCase())
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "Fonds non trouvé", isin: isin.toUpperCase() },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: data as unknown as Fund });
}
