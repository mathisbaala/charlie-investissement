import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { blendExposure, findOverlaps } from "@/lib/lookthrough";

export const dynamic = "force-dynamic";

const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = (req.nextUrl.searchParams.get("isins") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const isins = Array.from(new Set(raw)).filter((i) => ISIN_RE.test(i)).slice(0, 4);

  if (isins.length < 2) {
    return NextResponse.json({ error: "Au moins 2 fonds requis" }, { status: 400 });
  }

  const [geoRes, secRes, holdRes] = await Promise.all([
    supabase.from("investissement_fund_geos")
      .select("isin, country_label, country_code, weight").in("isin", isins),
    supabase.from("investissement_fund_sectors")
      .select("isin, sector_name, weight").in("isin", isins),
    // Compo complète des ETF (jusqu'à 500 lignes/fonds) : 4 fonds → jusqu'à 2000
    // lignes. On relève la limite au-dessus du cap PostgREST par défaut (1000)
    // pour ne pas tronquer la détection de chevauchements.
    supabase.from("investissement_fund_holdings")
      .select("isin, position_name, ticker, weight").in("isin", isins).limit(4000),
  ]);

  // Géo agrégée par code ISO (clé) pour ne pas double-compter un même pays libellé
  // différemment selon la source (« Germany » FT vs « Allemagne » Morningstar).
  const geo = blendExposure(((geoRes.data ?? []) as any[]).map((g) => ({
    isin: g.isin, label: g.country_label || g.country_code,
    key: g.country_code || g.country_label, weight: Number(g.weight),
  })));
  const sectors = blendExposure(((secRes.data ?? []) as any[]).map((s) => ({
    isin: s.isin, label: s.sector_name, weight: Number(s.weight),
  })));
  const overlaps = findOverlaps(((holdRes.data ?? []) as any[]).map((h) => ({
    isin: h.isin, position_name: h.position_name, ticker: h.ticker, weight: Number(h.weight),
  })));

  return NextResponse.json(
    { geo, sectors, overlaps },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } },
  );
}
