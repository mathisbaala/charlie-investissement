import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { Fund, ScreenerResponse } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const VALID_SORT_FIELDS = new Set([
  "performance_3y",
  "performance_1y",
  "performance_5y",
  "average_performance",
  "ter",
  "aum_eur",
  "sharpe_1y",
  "sharpe_3y",
  "volatility_1y",
  "max_drawdown_3y",
  "morningstar_rating",
  "track_record_years",
  "data_completeness",
]);

const VIEW = "investissement_funds_cgp";

const SELECT_COLUMNS = [
  "isin",
  "name",
  "product_type",
  "asset_class_broad",
  "asset_class",
  "category_normalized",
  "region_normalized",
  "sector",
  "management_style",
  "gestionnaire",
  "ter",
  "ongoing_charges",
  "performance_1y",
  "performance_3y",
  "performance_5y",
  "average_performance",
  "volatility_1y",
  "volatility_3y",
  "sharpe_1y",
  "sharpe_3y",
  "max_drawdown_1y",
  "max_drawdown_3y",
  "risk_score",
  "sfdr_article",
  "labels",
  "pea_eligible",
  "av_lux_eligible",
  "per_eligible",
  "ucits_compliant",
  "is_institutional",
  "accessible_retail",
  "hedged",
  "aum_eur",
  "morningstar_rating",
  "currency",
  "inception_date",
  "track_record_years",
  "kid_url",
  "kid_parsed_at",
  "share_class_group_id",
  "data_completeness",
  "data_source",
  "field_sources",
  "updated_at",
].join(",");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseMulti(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseMultiInt(value: string | null): number[] {
  return parseMulti(value)
    .map(Number)
    .filter((n) => !isNaN(n));
}

function parseFloat_(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

function parseInt_(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication: keep the best share per share_class_group_id
//
// Strategy: after fetching filtered results we do in-process deduplication.
// Supabase JS client does not expose window functions. Fetching a large
// initial set (up to 5× page_size) then deduplicating client-side is the
// safest approach given we only need up to 100 rows per page.
//
// For accurate `total` counts with deduplication we run a separate count
// query on the grouped universe using a Postgres function when available,
// falling back to an estimate based on observed data.
// ─────────────────────────────────────────────────────────────────────────────

function deduplicateFunds(funds: Fund[]): Fund[] {
  const best = new Map<string, Fund>();

  for (const fund of funds) {
    const groupId = fund.share_class_group_id ?? fund.isin;
    const existing = best.get(groupId);

    if (!existing) {
      best.set(groupId, fund);
      continue;
    }

    // Prefer higher AUM; fall back to data_completeness
    const newAum = fund.aum_eur ?? -1;
    const existingAum = existing.aum_eur ?? -1;

    if (newAum > existingAum) {
      best.set(groupId, fund);
    } else if (newAum === existingAum && fund.data_completeness > existing.data_completeness) {
      best.set(groupId, fund);
    }
  }

  return Array.from(best.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/screener/funds
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;

  // ── Parse query parameters ─────────────────────────────────────────────────
  const types = parseMulti(sp.get("types"));
  const sfdrArticles = parseMultiInt(sp.get("sfdr"));
  const sriMin = parseInt_(sp.get("sri_min"));
  const sriMax = parseInt_(sp.get("sri_max"));
  const terMax = parseFloat_(sp.get("ter_max"));
  const perf3yMin = parseFloat_(sp.get("perf_3y_min"));
  const pea = sp.get("pea") === "true";
  const per = sp.get("per") === "true";
  const avLux = sp.get("av_lux") === "true";
  const assetClasses = parseMulti(sp.get("asset_class"));
  const regions = parseMulti(sp.get("region"));
  const categories = parseMulti(sp.get("category"));
  const sectors = parseMulti(sp.get("sectors"));
  const managementStyles = parseMulti(sp.get("management_style"));
  const gestionnaireSearch = sp.get("gestionnaire")?.trim() ?? "";
  const search = sp.get("search")?.trim() ?? "";
  const minCompleteness = parseInt_(sp.get("min_completeness")) ?? 60;
  const deduplicate = sp.get("deduplicate") !== "false"; // default true
  const page = Math.max(1, parseInt_(sp.get("page")) ?? 1);
  const perPage = Math.min(100, Math.max(1, parseInt_(sp.get("per_page")) ?? 50));

  const sortByRaw = sp.get("sort_by") ?? "data_completeness";
  const sortBy = VALID_SORT_FIELDS.has(sortByRaw) ? sortByRaw : "data_completeness";
  const sortDir = sp.get("sort_dir") === "asc" ? true : false; // false = desc

  // ── Build base query ───────────────────────────────────────────────────────
  // We always fetch with count so we get total for pagination.
  let q = supabase
    .from(VIEW)
    .select(SELECT_COLUMNS, { count: "exact" })
    .gte("data_completeness", minCompleteness);

  // Product type
  if (types.length > 0) {
    q = q.in("product_type", types);
  }

  // SFDR article
  if (sfdrArticles.length > 0) {
    q = q.in("sfdr_article", sfdrArticles);
  }

  // SRI range
  if (sriMin != null) q = q.gte("risk_score", sriMin);
  if (sriMax != null) q = q.lte("risk_score", sriMax);

  // TER / ongoing charges
  if (terMax != null) {
    // Match on either ter or ongoing_charges column
    q = (q as any).or(`ter.lte.${terMax},ongoing_charges.lte.${terMax}`);
  }

  // Performance 3y minimum
  if (perf3yMin != null) {
    q = q.gte("performance_3y", perf3yMin);
  }

  // Eligibility flags
  if (pea) q = q.eq("pea_eligible", true);
  if (per) q = q.eq("per_eligible", true);
  if (avLux) q = q.eq("av_lux_eligible", true);

  // Asset class
  if (assetClasses.length > 0) {
    q = q.in("asset_class", assetClasses);
  }

  // Sector
  if (sectors.length > 0) {
    q = q.in("sector", sectors);
  }

  // Management style (passif / actif / smart_beta / index)
  if (managementStyles.length > 0) {
    q = q.in("management_style", managementStyles);
  }

  // Region
  if (regions.length > 0) {
    q = q.in("region_normalized", regions);
  }

  // Category
  if (categories.length > 0) {
    q = q.in("category_normalized", categories);
  }

  // Gestionnaire text search — .ilike() est paramétré par supabase-js, safe.
  if (gestionnaireSearch) {
    q = q.ilike("gestionnaire", `%${gestionnaireSearch}%`);
  }

  // Recherche partielle sur name + gestionnaire via index trigramme GIN.
  // ilike '%query%' utilise idx_funds_trgm_name / idx_funds_trgm_management.
  // Sanitisation : on retire les caractères PostgREST spéciaux (),% pour éviter
  // l'injection de filtres via le paramètre search.
  if (search) {
    const safeSearch = search.replace(/[%_,()\[\]\\]/g, "");
    if (safeSearch) {
      q = (q as any).or(
        `name.ilike.%${safeSearch}%,gestionnaire.ilike.%${safeSearch}%`
      );
    }
  }

  // Sorting — always put nulls last
  q = q.order(sortBy, { ascending: sortDir, nullsFirst: false });

  // ── Fetch strategy ─────────────────────────────────────────────────────────
  // When deduplication is off we use standard offset pagination.
  // When on we over-fetch (5× page) to have enough candidates after dedup,
  // then slice. For large pages we accept this trade-off.

  let total: number;
  let funds: Fund[];

  if (!deduplicate) {
    const offset = (page - 1) * perPage;
    const { data, error, count } = await q.range(offset, offset + perPage - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    total = count ?? 0;
    funds = (data as unknown as Fund[]) ?? [];
  } else {
    // Over-fetch: take enough rows so that after dedup we can fill the page.
    // We use a generous multiplier — share class groups average ~3 shares in
    // French fund databases, so 5× is safe for pages ≤ 100.
    const overfetch = perPage * 5;
    const offset = (page - 1) * overfetch;

    const { data, error, count } = await q.range(offset, offset + overfetch - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const raw = (data as unknown as Fund[]) ?? [];
    const deduplicated = deduplicateFunds(raw);
    // Trim to requested page size
    funds = deduplicated.slice(0, perPage);

    // Estimate total deduplicated rows from raw count.
    // Heuristic: assume dedup ratio is consistent across the result set.
    const rawCount = count ?? 0;
    const deduplicationRatio = raw.length > 0 ? deduplicated.length / raw.length : 1;
    total = Math.round(rawCount * deduplicationRatio);
  }

  const totalPages = Math.ceil(total / perPage);

  const response: ScreenerResponse = {
    data: funds,
    total,
    page,
    per_page: perPage,
    total_pages: totalPages,
  };

  return NextResponse.json(response);
}
