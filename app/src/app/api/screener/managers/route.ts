import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Principales sociétés de gestion (nom + nombre de fonds), pour le filtre rapide
// « Société de gestion » du screener. Le champ texte couvre les autres.
export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase.rpc("get_management_companies_list");
  if (error) return NextResponse.json({ data: [] }, { status: 200 });
  // Agrégation pure qui bouge lentement : mêmes en-têtes de cache edge que
  // /insurers, pour servir le FilterPanel en ~40 ms sur répétition et délester
  // Supabase quand le trafic monte.
  return NextResponse.json(
    { data: data ?? [] },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
