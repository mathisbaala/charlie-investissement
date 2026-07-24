import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import RapportFondsPDF from "@/lib/RapportFondsPDF";
import { annualizeForType, annualizeCumul } from "@/lib/format";
import { fetchNavSeries, fetchCompositionByFund } from "@/lib/pdf/pdfData";
import { applyBranding, parseClientBranding, type ClientBranding } from "@/lib/pdf/brandFromRequest";
import { trackVercel } from "@/lib/analytics";

// Rapport de fonds (fiche unique ou comparatif). Deux entrées :
//   • GET  — lien direct (?isins=), sans marque : documents aux couleurs Charlie.
//   • POST — { isins, branding } : le client transmet la marque de son cabinet
//     (couleur + logo PNG) pour teindre le document. Le logo étant trop volumineux
//     pour une query string, la personnalisation passe forcément par POST.

async function buildRapport(
  isinsRaw: string[],
  branding: ClientBranding,
  req: NextRequest,
): Promise<NextResponse> {
  const isins = isinsRaw.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
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

  // Marque du cabinet (couleur + logo) ou Charlie par défaut.
  const logo = await applyBranding(branding);
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isins = (url.searchParams.get("isins") ?? "").split(",");
  return buildRapport(isins, { accent: null, logo: null }, req);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON attendu" }, { status: 400 });
  }
  const raw = body.isins;
  const isins = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(",");
  return buildRapport(isins, parseClientBranding(body.branding), req);
}
