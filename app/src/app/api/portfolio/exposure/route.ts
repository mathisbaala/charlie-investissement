import { NextRequest, NextResponse } from "next/server";
import { fetchGeoRows, fetchSectorRows } from "@/lib/fundExposure";

export const dynamic = "force-dynamic";

const ISIN_RE = /^[A-Z0-9][A-Z0-9_]{1,29}$/i;

/**
 * Compositions géo / secteurs BRUTES par fonds (lignes ExpoRow) pour les
 * camemberts de répartition du portefeuille. L'agrégation pondérée se fait côté
 * client (`weightedExposure`) : les poids simulés changent à chaque glissement
 * du conseiller, seules les compositions — stables — transitent par le réseau.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = (req.nextUrl.searchParams.get("isins") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const isins = Array.from(new Set(raw)).filter((i) => ISIN_RE.test(i)).slice(0, 40);

  if (isins.length === 0) {
    return NextResponse.json({ error: "Au moins un ISIN requis" }, { status: 400 });
  }

  const [geo, sectors] = await Promise.all([fetchGeoRows(isins), fetchSectorRows(isins)]);

  return NextResponse.json(
    { geo, sectors },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } },
  );
}
