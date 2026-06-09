import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Principales sociétés de gestion (nom + nombre de fonds), pour le filtre rapide
// « Société de gestion » du screener. Le champ texte couvre les autres.
export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase.rpc("get_management_companies_list");
  if (error) return NextResponse.json({ data: [] }, { status: 200 });
  return NextResponse.json({ data: data ?? [] });
}
