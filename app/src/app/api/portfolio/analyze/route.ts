import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { PORTFOLIO_ISIN_RE, BENCHMARK_CODE_RE, type PortfolioAnalysis } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

// Analyse d'un portefeuille pondéré : délègue au RPC SQL inv_portfolio_analyze
// (courbe composite + ratios + corrélation, multi-rythme) puis enrichit avec les
// noms des fonds pour l'affichage. Stateless : tout vient de l'URL (lien partageable).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = req.nextUrl.searchParams;

  const isins = (p.get("isins") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => PORTFOLIO_ISIN_RE.test(s));
  const unique = Array.from(new Set(isins));

  if (unique.length < 1) {
    return NextResponse.json({ error: "Aucun fonds valide" }, { status: 400 });
  }
  if (unique.length > 20) {
    return NextResponse.json(
      { error: "20 fonds maximum par portefeuille" },
      { status: 400 },
    );
  }

  // Poids (pourcentages) ; le RPC renormalise. Absent/incohérent → équipondéré.
  const rawW = (p.get("weights") ?? "").split(",").map((s) => Number(s.trim()));
  const weights =
    rawW.length === unique.length && rawW.every((w) => Number.isFinite(w) && w >= 0)
      ? rawW
      : unique.map(() => 1);

  const years = Math.min(Math.max(Number(p.get("years")) || 5, 1), 10);

  const benchRaw = (p.get("benchmark") ?? "").trim().toLowerCase();
  const benchmark = BENCHMARK_CODE_RE.test(benchRaw) ? benchRaw : null;

  const [{ data, error }, namesRes] = await Promise.all([
    supabase.rpc("inv_portfolio_analyze", {
      p_isins: unique,
      p_weights: weights,
      p_years: years,
      p_benchmark: benchmark,
    }),
    supabase.from("investissement_funds").select("isin, name").in("isin", unique),
  ]);

  if (error) {
    return NextResponse.json(
      { error: "Analyse indisponible", detail: error.message },
      { status: 500 },
    );
  }

  const names: Record<string, string> = {};
  for (const row of (namesRes.data ?? []) as { isin: string; name: string }[]) {
    names[row.isin] = row.name;
  }

  const result = { ...(data as object), names } as PortfolioAnalysis;
  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
  });
}
