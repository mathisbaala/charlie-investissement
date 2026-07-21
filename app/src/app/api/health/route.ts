import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { botGuard } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

type FreshnessRow = {
  product_type: string;
  total: number;
  exploitables: number;
  avg_completeness: number;
  last_updated_at: string | null;
  updated_last_24h: number;
  updated_last_7d: number;
};

// GET /api/health
// Santé et fraîcheur des données par type de fonds.
//
// Réponse :
//   status          — "ok" | "degraded"
//   summary         — totaux globaux + activité récente
//   by_type         — détail par product_type (completeness, last update, enrichissements J/7j)
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Cette route expose des totaux de complétude/enrichissement : mêmes garde-fous
  // anti-scraping que les autres endpoints de données (cf. décision « jamais
  // exposer la complétude »). Fail-open, ne casse pas un moniteur navigateur.
  const bot = botGuard(req);
  if (bot) return bot;

  const { data, error } = await supabase.rpc("get_data_freshness");

  if (error) {
    return NextResponse.json(
      { status: "error", error: error.message },
      { status: 500 }
    );
  }

  const rows = (data as unknown as FreshnessRow[]) ?? [];

  const totalAll       = rows.reduce((s, r) => s + Number(r.total), 0);
  const exploitables   = rows.reduce((s, r) => s + Number(r.exploitables), 0);
  const updatedToday   = rows.reduce((s, r) => s + Number(r.updated_last_24h), 0);
  const updatedWeek    = rows.reduce((s, r) => s + Number(r.updated_last_7d), 0);
  const lastUpdatedAt  = rows
    .map((r) => r.last_updated_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const exploitablesPct =
    totalAll > 0 ? Math.round((exploitables / totalAll) * 100) : 0;

  // Dégradé si aucun enrichissement dans les 7 derniers jours
  const status = updatedWeek > 0 ? "ok" : "degraded";

  return NextResponse.json(
    {
      status,
      summary: {
        total_funds:      totalAll,
        exploitables,
        exploitables_pct: exploitablesPct,
        updated_last_24h: updatedToday,
        updated_last_7d:  updatedWeek,
        last_updated_at:  lastUpdatedAt,
      },
      by_type: rows,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    }
  );
}
