import { NextRequest, NextResponse } from "next/server";
import { optimizeContract, paramsFromQuery } from "@/lib/allocationService";

export const dynamic = "force-dynamic";

// Optimiseur d'allocation par contrat (JSON) : sélectionne 4–7 supports du
// contrat et calcule les poids maximisant le ratio de Sharpe sous contraintes de
// classes d'actifs et de risque, puis renvoie l'allocation + la restitution.
// Toute la logique vit dans le service partagé lib/allocationService (testé) ;
// la variante PDF (…/pdf) réutilise le même service.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const parsed = paramsFromQuery(req.nextUrl.searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const out = await optimizeContract(parsed);
  if ("status" in out) {
    return NextResponse.json({ error: out.error, detail: out.detail }, { status: out.status });
  }

  return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
}
