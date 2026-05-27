import { NextRequest, NextResponse } from "next/server";
import { supabase, Fund } from "@/lib/supabase";
import { interpretQuery, ScreenerFilters } from "@/lib/claude";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { query, filters: manualFilters } = body as {
    query?: string;
    filters?: ScreenerFilters;
  };

  let filters: ScreenerFilters = manualFilters ?? {};

  if (query?.trim()) {
    try {
      filters = await interpretQuery(query);
    } catch {
      // fallback : filtres manuels ou vides
    }
  }

  let q = supabase
    .from("investissement_funds_cgp")
    .select(
      "isin,name,product_type,gestionnaire,sfdr_article,risk_score,ongoing_charges,performance_1y,performance_3y,performance_5y,volatility_1y,volatility_3y,sharpe_1y,sharpe_3y,aum_eur,morningstar_rating,pea_eligible,per_eligible,av_lux_eligible,inception_date,data_completeness"
    )
    .gte("data_completeness", 50)
    .order("data_completeness", { ascending: false })
    .limit(filters.limit ?? 50);

  if (filters.sfdr_article?.length) {
    q = q.in("sfdr_article", filters.sfdr_article);
  }
  if (filters.sri_min != null) q = q.gte("risk_score", filters.sri_min);
  if (filters.sri_max != null) q = q.lte("risk_score", filters.sri_max);
  if (filters.ter_max != null) q = q.lte("ongoing_charges", filters.ter_max);
  if (filters.perf_1y_min != null) q = q.gte("performance_1y", filters.perf_1y_min);
  if (filters.pea_eligible === true) q = q.eq("pea_eligible", true);
  if (filters.per_eligible === true) q = q.eq("per_eligible", true);
  if (filters.av_lux_eligible === true) q = q.eq("av_lux_eligible", true);
  if (filters.product_type?.length) q = q.in("product_type", filters.product_type);
  if (filters.name_search?.trim()) {
    q = q.ilike("name", `%${filters.name_search.trim()}%`);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ funds: data as Fund[], filters });
}
