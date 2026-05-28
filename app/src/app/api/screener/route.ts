// @deprecated Utilisez GET /api/screener/funds pour le screener paginé.
// NLP (interpretQuery) désactivé — trop coûteux en tokens Anthropic.
// Format de réponse : { funds, filters, total } — NON-STANDARD.
import { NextRequest, NextResponse } from "next/server";
import { supabase, Fund } from "@/lib/supabase";
import type { ScreenerFilters } from "@/lib/claude";

const VALID_SORT_FIELDS = new Set([
  "performance_3y", "performance_1y", "aum_eur", "data_completeness", "ter", "ongoing_charges"
]);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { query, filters: manualFilters } = body as {
    query?: string;
    filters?: ScreenerFilters;
  };

  // NLP désactivé — coût Anthropic trop élevé.
  // Pour réactiver : décommenter et passer ENABLE_NLP_SCREENER=true.
  const filters: ScreenerFilters = manualFilters ?? {};

  const completenessMin = filters.completeness_min ?? 50;
  const limitVal = Math.min(filters.limit ?? 50, 200);

  let q = supabase
    .from("investissement_funds_cgp")
    .select(
      "isin,name,product_type,gestionnaire,sfdr_article,risk_score,ongoing_charges," +
      "performance_1y,performance_3y,performance_5y,volatility_1y,volatility_3y," +
      "sharpe_1y,sharpe_3y,aum_eur,morningstar_rating,pea_eligible,per_eligible," +
      "av_lux_eligible,inception_date,data_completeness,region_normalized," +
      "asset_class_broad,labels,track_record_years,max_drawdown_3y"
    )
    .gte("data_completeness", completenessMin)
    .limit(limitVal);

  // ── Filtres existants ────────────────────────────────────────────────────────
  if (filters.sfdr_article?.length) q = q.in("sfdr_article", filters.sfdr_article);
  if (filters.sri_min != null) q = q.gte("risk_score", filters.sri_min);
  if (filters.sri_max != null) q = q.lte("risk_score", filters.sri_max);
  if (filters.ter_max != null) q = q.lte("ongoing_charges", filters.ter_max);
  if (filters.ter_min != null) q = q.gte("ongoing_charges", filters.ter_min);
  if (filters.perf_1y_min != null) q = q.gte("performance_1y", filters.perf_1y_min);
  if (filters.perf_3y_min != null) q = q.gte("performance_3y", filters.perf_3y_min);
  if (filters.aum_min != null) q = q.gte("aum_eur", filters.aum_min);
  if (filters.pea_eligible === true) q = q.eq("pea_eligible", true);
  if (filters.per_eligible === true) q = q.eq("per_eligible", true);
  if (filters.av_lux_eligible === true) q = q.eq("av_lux_eligible", true);
  if (filters.product_type?.length) q = q.in("product_type", filters.product_type);

  // ── Nouveaux filtres ─────────────────────────────────────────────────────────
  if (filters.region?.length) q = q.in("region_normalized", filters.region);
  if (filters.gestionnaire?.trim()) {
    q = q.ilike("gestionnaire", `%${filters.gestionnaire.trim()}%`);
  }

  // Filtre labels : chaque tag doit être présent dans le JSONB array
  if (filters.labels?.length) {
    for (const tag of filters.labels) {
      q = (q as any).contains("labels", JSON.stringify([tag]));
    }
  }

  // Recherche textuelle
  if (filters.name_search?.trim()) {
    const term = filters.name_search.trim();
    q = q.or(`name.ilike.%${term}%,gestionnaire.ilike.%${term}%`);
  }

  // ── Tri ───────────────────────────────────────────────────────────────────────
  const sortField = filters.sort_by && VALID_SORT_FIELDS.has(filters.sort_by)
    ? filters.sort_by
    : "data_completeness";
  const ascending = filters.sort_asc ?? false;
  q = q.order(sortField, { ascending, nullsFirst: false });

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ funds: data as unknown as Fund[], filters, total: data?.length ?? 0 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const filters: ScreenerFilters = {
    product_type: searchParams.get("type")?.split(",").filter(Boolean),
    sfdr_article: searchParams.get("sfdr")?.split(",").map(Number).filter(Boolean),
    pea_eligible: searchParams.get("pea") === "true" ? true : undefined,
    per_eligible: searchParams.get("per") === "true" ? true : undefined,
    av_lux_eligible: searchParams.get("av") === "true" ? true : undefined,
    ter_max: searchParams.get("ter_max") ? Number(searchParams.get("ter_max")) : undefined,
    sri_max: searchParams.get("sri_max") ? Number(searchParams.get("sri_max")) : undefined,
    sri_min: searchParams.get("sri_min") ? Number(searchParams.get("sri_min")) : undefined,
    region: searchParams.get("region")?.split(",").filter(Boolean),
    gestionnaire: searchParams.get("gestionnaire") ?? undefined,
    name_search: searchParams.get("q") ?? undefined,
    completeness_min: searchParams.get("completeness") ? Number(searchParams.get("completeness")) : undefined,
    sort_by: (searchParams.get("sort") as ScreenerFilters["sort_by"]) ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  };

  const body = new Request(req.url, { method: "POST", body: JSON.stringify({ filters }) });
  return POST(new NextRequest(body));
}
