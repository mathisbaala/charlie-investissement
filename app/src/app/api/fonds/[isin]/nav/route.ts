import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { NavPoint, NavResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const ISIN_RE = /^[A-Z0-9]{12}$/i;

// GET /api/fonds/[isin]/nav?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=500
// Retourne l'historique de VL depuis investissement_fund_prices.
// Trié par date croissante — prêt pour un graphique temps-réel.
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
  const sp = req.nextUrl.searchParams;

  const from  = sp.get("from");
  const to    = sp.get("to");
  const limit = Math.min(2000, Math.max(1, parseInt(sp.get("limit") ?? "500", 10) || 500));

  let q = supabase
    .from("investissement_fund_prices")
    .select("isin, price_date, nav, currency, source")
    .eq("isin", upper)
    .order("price_date", { ascending: true })
    .limit(limit);

  if (from) q = q.gte("price_date", from);
  if (to)   q = q.lte("price_date", to);

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Normalise vers le format NavPoint (nav_date / nav_value)
  const points: NavPoint[] = (data ?? []).map((row) => ({
    isin:      row.isin,
    nav_date:  row.price_date,
    nav_value: row.nav,
    currency:  row.currency ?? "EUR",
    source:    row.source ?? null,
  }));

  const response: NavResponse = {
    data:  points,
    isin:  upper,
    count: points.length,
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
  });
}
