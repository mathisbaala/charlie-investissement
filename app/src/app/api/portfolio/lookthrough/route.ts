import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { findOverlaps, canonicalSector } from "@/lib/lookthrough";

export const dynamic = "force-dynamic";

const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/i;

// Expo PAR FONDS (pas d'agrégation ni d'équipondération) : la comparaison se fait
// fonds par fonds, chaque fonds garde sa géo / ses secteurs propres.
type ExpoRow = { isin: string; label: string; weight: number };

function perFund(rows: ExpoRow[]): Record<string, { label: string; weight: number }[]> {
  // Somme par (isin, label) puis tri décroissant par fonds.
  const acc: Record<string, Map<string, number>> = {};
  for (const r of rows) {
    if (!r.label || !Number.isFinite(r.weight)) continue;
    (acc[r.isin] ??= new Map()).set(r.label, (acc[r.isin].get(r.label) ?? 0) + r.weight);
  }
  const out: Record<string, { label: string; weight: number }[]> = {};
  for (const isin of Object.keys(acc)) {
    out[isin] = [...acc[isin].entries()]
      .map(([label, weight]) => ({ label, weight }))
      .sort((a, b) => b.weight - a.weight);
  }
  return out;
}

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
    supabase.from("investissement_fund_holdings")
      .select("isin, position_name, ticker, weight").in("isin", isins).limit(4000),
  ]);

  const geoByFund = perFund(((geoRes.data ?? []) as any[]).map((g) => ({
    isin: g.isin, label: g.country_label || g.country_code, weight: Number(g.weight),
  })));
  const sectorsByFund = perFund(((secRes.data ?? []) as any[])
    .map((s) => ({ isin: s.isin, label: canonicalSector(s.sector_name) as string, weight: Number(s.weight) }))
    .filter((s) => s.label !== null));
  const overlaps = findOverlaps(((holdRes.data ?? []) as any[]).map((h) => ({
    isin: h.isin, position_name: h.position_name, ticker: h.ticker, weight: Number(h.weight),
  })));

  return NextResponse.json(
    { geoByFund, sectorsByFund, overlaps },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } },
  );
}
