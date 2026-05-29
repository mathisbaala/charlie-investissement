import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { Fund, ScreenerResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const VIEW = "investissement_funds_cgp";

const COLS = [
  "isin","name","product_type","asset_class_broad","asset_class",
  "category_normalized","region_normalized","sector","management_style",
  "gestionnaire","ter","ongoing_charges","performance_1y","performance_3y",
  "performance_5y","average_performance","volatility_1y","volatility_3y",
  "sharpe_1y","sharpe_3y","max_drawdown_1y","max_drawdown_3y","risk_score",
  "sfdr_article","labels","pea_eligible","pea_pme_eligible","per_eligible",
  "av_fr_eligible","av_lux_eligible","cto_eligible",
  "entry_fee_max","exit_fee_max","performance_fee","retrocession_cgp",
  "ucits_compliant","is_institutional","accessible_retail","hedged",
  "aum_eur","morningstar_rating","currency","inception_date",
  "track_record_years","kid_url","data_completeness","updated_at",
  "share_class_group_id"
].join(",");

function p(sp: URLSearchParams, key: string) { return sp.get(key); }
function arr(v: string | null) { return v ? v.split(",").filter(Boolean) : []; }
function num(v: string | null) { const n = parseFloat(v ?? ""); return isNaN(n) ? undefined : n; }
function int(v: string | null) { const n = parseInt(v ?? "", 10); return isNaN(n) ? undefined : n; }

function dedup(funds: Fund[]): Fund[] {
  const best = new Map<string, Fund>();
  for (const f of funds) {
    const key = f.share_class_group_id ?? f.isin;
    const ex = best.get(key);
    if (!ex || (f.aum_eur ?? -1) > (ex.aum_eur ?? -1)) best.set(key, f);
  }
  return Array.from(best.values());
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;

  const sfdr    = arr(p(sp, "sfdr")).map(Number).filter(n => !isNaN(n));
  const sriMin  = num(p(sp, "sri_min"));
  const sriMax  = num(p(sp, "sri_max"));
  const terMax  = num(p(sp, "ter_max"));
  const p1yMin  = num(p(sp, "perf_1y_min"));
  const p3yMin  = num(p(sp, "perf_3y_min"));
  const volMax  = num(p(sp, "vol_max"));
  const shMin   = num(p(sp, "sharpe_min"));
  const aumMin  = num(p(sp, "aum_min"));  // in M€ from UI
  const trMin   = num(p(sp, "track_record_min"));
  const mstarMin= num(p(sp, "morningstar_min"));
  const retroMin= num(p(sp, "retrocession_min")); // en % → diviser par 100 pour fraction DB
  const envelopes = arr(p(sp, "envelopes"));
  const universe  = arr(p(sp, "universe"));
  const sectors   = arr(p(sp, "sector"));
  const currency  = arr(p(sp, "currency"));
  const mgr     = p(sp, "manager_search")?.trim() ?? "";
  const search  = p(sp, "search")?.trim() ?? "";
  const sortBy  = p(sp, "sort_by") ?? "data_completeness";
  const sortDir = p(sp, "sort_dir") === "asc";
  const page    = Math.max(1, int(p(sp, "page")) ?? 1);
  const perPage = Math.min(100, Math.max(1, int(p(sp, "per_page")) ?? 50));

  const VALID_SORT = new Set([
    "performance_3y","performance_1y","performance_5y","ter","ongoing_charges",
    "aum_eur","sharpe_1y","sharpe_3y","volatility_1y","max_drawdown_3y",
    "morningstar_rating","track_record_years","data_completeness",
    "retrocession_cgp","entry_fee_max"
  ]);
  const safeSort = VALID_SORT.has(sortBy) ? sortBy : "data_completeness";

  let q = supabase
    .from(VIEW)
    .select(COLS, { count: "exact" })
    .gte("data_completeness", 50);

  if (sfdr.length)      q = q.in("sfdr_article", sfdr);
  if (sriMin != null)   q = q.gte("risk_score", sriMin);
  if (sriMax != null)   q = q.lte("risk_score", sriMax);
  if (terMax != null)   q = (q as any).or(`ter.lte.${terMax},ongoing_charges.lte.${terMax}`);
  if (p1yMin != null)   q = q.gte("performance_1y", p1yMin);
  if (p3yMin != null)   q = q.gte("performance_3y", p3yMin);
  if (volMax != null)   q = q.lte("volatility_1y", volMax);
  if (shMin != null)    q = q.gte("sharpe_1y", shMin);
  if (aumMin != null)   q = q.gte("aum_eur", aumMin * 1_000_000);
  if (trMin != null)    q = q.gte("track_record_years", trMin);
  if (mstarMin != null) q = q.gte("morningstar_rating", mstarMin);
  if (retroMin != null) q = q.gte("retrocession_cgp", retroMin / 100);

  // Enveloppes
  if (envelopes.includes("PEA"))     q = q.eq("pea_eligible",     true);
  if (envelopes.includes("PEA-PME")) q = q.eq("pea_pme_eligible", true);
  if (envelopes.includes("PER"))     q = q.eq("per_eligible",     true);
  if (envelopes.includes("AV-FR"))   q = q.eq("av_fr_eligible",   true);
  if (envelopes.includes("AV-LUX"))  q = q.eq("av_lux_eligible",  true);
  if (envelopes.includes("CTO"))     q = q.eq("cto_eligible",     true);

  // Univers → product_type / asset_class
  if (universe.length) {
    const productTypes = universe.filter(u =>
      ["opcvm","etf","scpi","fps","fonds_euros","action","crypto"].includes(u)
    );
    if (productTypes.length) q = q.in("product_type", productTypes);
  }

  if (sectors.length)   q = q.in("sector", sectors);
  if (currency.length)  q = q.in("currency", currency);
  if (mgr)              q = q.ilike("gestionnaire", `%${mgr}%`);

  if (search) {
    const safe = search.replace(/[%_,()\[\]\\]/g, "");
    if (safe) q = (q as any).or(`name.ilike.%${safe}%,gestionnaire.ilike.%${safe}%`);
  }

  q = q.order(safeSort, { ascending: sortDir, nullsFirst: false });

  const overfetch = perPage * 5;
  const offset    = (page - 1) * overfetch;
  const { data, error, count } = await q.range(offset, offset + overfetch - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const raw  = (data as unknown as Fund[]) ?? [];
  const deduped = dedup(raw).slice(0, perPage);
  const rawCount = count ?? 0;
  const ratio = raw.length > 0 ? deduped.length / raw.length : 1;
  const total = Math.round(rawCount * ratio);

  const resp: ScreenerResponse = {
    data: deduped,
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  };
  return NextResponse.json(resp);
}
