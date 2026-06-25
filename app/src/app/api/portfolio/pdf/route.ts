import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import PortefeuillePDF from "@/lib/PortefeuillePDF";
import {
  parsePortfolioParams,
  normalizeWeights,
  BENCHMARK_OPTIONS,
  BENCHMARK_CODE_RE,
  type PortfolioAnalysis,
} from "@/lib/portfolio";
import { annualizeForType } from "@/lib/format";
import { weightedExposure } from "@/lib/lookthrough";
import { fetchGeoRows, fetchSectorRows } from "@/lib/pdf/pdfData";

export const dynamic = "force-dynamic";

// Génère le PDF complet d'un portefeuille (vue d'ensemble, back-test vs indice,
// corrélation, exposition agrégée, détail des fonds). Stateless : tout vient de
// l'URL, comme l'analyse à l'écran. Réutilise le RPC inv_portfolio_analyze.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const holdings = normalizeWeights(parsePortfolioParams(p.get("isins"), p.get("weights")));
  if (holdings.length < 1) {
    return NextResponse.json({ error: "Aucun fonds valide" }, { status: 400 });
  }
  if (holdings.length > 20) {
    return NextResponse.json({ error: "20 fonds maximum" }, { status: 400 });
  }

  const isins = holdings.map((h) => h.isin);
  const weights = holdings.map((h) => h.weight); // %
  const years = Math.min(Math.max(Number(p.get("years")) || 5, 1), 10);
  const benchRaw = (p.get("benchmark") ?? "").trim().toLowerCase();
  const benchmark = BENCHMARK_CODE_RE.test(benchRaw) ? benchRaw : "msci_world";
  const benchmarkLabel = BENCHMARK_OPTIONS.find((b) => b.code === benchmark)?.label ?? benchmark;

  // Poids en fraction de portefeuille, pour l'exposition agrégée pondérée.
  const fundWeights: Record<string, number> = {};
  for (const h of holdings) fundWeights[h.isin] = h.weight / 100;

  const [analyzeRes, fundsRes, geoRows, sectorRows] = await Promise.all([
    supabase.rpc("inv_portfolio_analyze", {
      p_isins: isins,
      p_weights: weights,
      p_years: years,
      p_benchmark: benchmark,
    }),
    supabase
      .from("investissement_funds")
      .select("isin, name, gestionnaire, management_company, product_type, ongoing_charges, ter, sri, risk_score, performance_1y, performance_3y, retrocession_cgp")
      .in("isin", isins),
    fetchGeoRows(isins),
    fetchSectorRows(isins),
  ]);

  if (analyzeRes.error) {
    return NextResponse.json({ error: "Analyse indisponible", detail: analyzeRes.error.message }, { status: 500 });
  }

  // Noms + infos par fonds ; perf 3 ans annualisée pour cohérence avec l'app.
  const names: Record<string, string> = {};
  const fundsInfo: Record<string, Record<string, unknown>> = {};
  for (const f of (fundsRes.data ?? []) as Record<string, unknown>[]) {
    const isin = f.isin as string;
    names[isin] = f.name as string;
    fundsInfo[isin] = {
      ...f,
      performance_3y: annualizeForType(f.performance_3y as number | null, 3, f.product_type as string | null),
    };
  }

  const analysis = { ...(analyzeRes.data as object), names } as PortfolioAnalysis;

  const geoExpo = weightedExposure(geoRows, fundWeights, 6);
  const sectorExpo = weightedExposure(sectorRows, fundWeights, 6);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(PortefeuillePDF as any, {
    analysis,
    holdings,
    fundsInfo,
    geoExpo,
    sectorExpo,
    benchmarkLabel,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const date = new Date().toISOString().split("T")[0];
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="portefeuille-charlie-${date}.pdf"`,
    },
  });
}
