import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Liste des assureurs référençant des fonds (nom + nombre de fonds), pour
// alimenter le filtre « Référencé chez » du screener.
export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase.rpc("get_insurers_list");
  if (error) return NextResponse.json({ data: [] }, { status: 200 });
  return NextResponse.json({ data: data ?? [] });
}
