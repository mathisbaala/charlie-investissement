import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import RapportFondsPDF from "@/lib/RapportFondsPDF";
import { annualizeForType, annualizeCumul } from "@/lib/format";
import { fetchNavSeries, fetchCompositionByFund } from "@/lib/pdf/pdfData";
import { loadLogo } from "@/lib/pdf/logo";
import { trackVercel } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isinsParam = url.searchParams.get("isins") ?? "";
  const isins = isinsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);

  if (isins.length < 1) {
    return NextResponse.json({ error: "Au moins 1 ISIN requis" }, { status: 400 });
  }

  const { data: funds, error } = await supabase
    .from("investissement_funds")
    .select("*")
    .in("isin", isins);

  if (error || !funds?.length) {
    return NextResponse.json({ error: "Fonds introuvables" }, { status: 404 });
  }

  // Conserver l'ordre de sélection + annualiser les perfs cumulées 3y/5y
  // (cf. inv_annualize SQL / vue CGP — le composant reçoit des valeurs annualisées).
  const ordered = isins
    .map((isin) => funds.find((f) => f.isin === isin))
    .filter(Boolean)
    .map((f) => ({
      ...f,
      performance_3y: annualizeForType(f!.performance_3y, 3, f!.product_type),
      performance_5y: annualizeForType(f!.performance_5y, 5, f!.product_type),
      // benchmark_perf_* stocké cumulé → annualisé pour l'affichage (comme perf).
      // alpha_* est déjà en % (passe-plat via ...f).
      benchmark_perf_3y: annualizeCumul(f!.benchmark_perf_3y, 3),
      benchmark_perf_5y: annualizeCumul(f!.benchmark_perf_5y, 5),
    }));

  // Données « riches » du factsheet : historique de VL (courbes base 100) et
  // composition par fonds (géo / secteurs / lignes). Tolérant aux trous.
  const orderedIsins = ordered.map((f) => f!.isin as string);
  const [series, composition] = await Promise.all([
    fetchNavSeries(orderedIsins, 5),
    fetchCompositionByFund(orderedIsins),
  ]);

  const logo = await loadLogo();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(RapportFondsPDF as any, { funds: ordered, series, composition, logo });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  trackVercel("pdf_export", { kind: "rapport", funds: ordered.length }, req);
  const date = new Date().toISOString().split("T")[0];
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="rapport-fonds-${date}.pdf"`,
    },
  });
}
