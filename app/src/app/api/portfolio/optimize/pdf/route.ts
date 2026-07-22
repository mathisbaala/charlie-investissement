import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import AllocationReportPDF from "@/lib/AllocationReportPDF";
import { optimizeContract, paramsFromQuery } from "@/lib/allocationService";
import { loadLogo } from "@/lib/pdf/logo";
import { trackVercel } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// Export PDF de la proposition d'allocation (modèle « présentation client »).
// Même service que la route JSON → un seul chemin de vérité pour l'optimisation.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const parsed = paramsFromQuery(req.nextUrl.searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const out = await optimizeContract(parsed);
  if ("status" in out) {
    return NextResponse.json({ error: out.error, detail: out.detail }, { status: out.status });
  }

  const logo = (await loadLogo()) ?? undefined;
  const buf = await renderToBuffer(
    React.createElement(AllocationReportPDF, { presentation: out.presentation, logo }) as never,
  );

  trackVercel("pdf_export", { kind: "portfolio", profile: out.presentation.headline.profileLabel }, req);
  const filename = `allocation-${out.presentation.headline.profileLabel.toLowerCase()}.pdf`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
