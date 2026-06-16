import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Liste des assureurs référençant des fonds (nom + nombre de fonds), pour
// alimenter le filtre « Référencé chez » du screener.
export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase.rpc("get_insurers_list");
  // 500 (et non 200 + []) sur erreur RPC : la page /assureurs s'appuie sur ces
  // routes comme source principale et doit distinguer une panne d'un « 0 résultat ».
  // Le FilterPanel du screener dégrade déjà proprement sur !r.ok.
  if (error) return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
