import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VIEW = "investissement_funds_cgp";
const COLS = ["isin", "name", "gestionnaire", "product_type", "sfdr_article", "risk_score", "kid_url", "aum_eur"].join(",");

function int(v: string | null) { const n = parseInt(v ?? "", 10); return isNaN(n) ? undefined : n; }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const search   = sp.get("search")?.trim() ?? "";
  const types    = sp.get("types")?.split(",").filter(Boolean) ?? [];
  const page     = Math.max(1, int(sp.get("page")) ?? 1);
  const perPage  = Math.min(100, Math.max(1, int(sp.get("per_page")) ?? 50));

  let q = supabase
    .from(VIEW)
    .select(COLS, { count: "exact" })
    .not("kid_url", "is", null);

  if (search) {
    const safe = search.replace(/[%_,()\[\]\\]/g, "");
    if (safe) q = (q as any).or(`name.ilike.%${safe}%,isin.ilike.%${safe}%,gestionnaire.ilike.%${safe}%`);
  }

  if (types.length) q = q.in("product_type", types);

  q = q.order("name", { ascending: true, nullsFirst: false });

  const offset = (page - 1) * perPage;
  const { data, error, count } = await q.range(offset, offset + perPage - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  });
}
