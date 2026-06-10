import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Liste des contrats (assureur + contrat + nombre de fonds), pour alimenter la
// sélection « par contrat » imbriquée sous chaque assureur du screener.
// Chaque entrée porte une clé composite "Assureur::Contrat" utilisée comme valeur
// de filtre (cf. colonne contracts[] de la vue investissement_funds_cgp_ref).
export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase.rpc("get_contracts_list");
  if (error) return NextResponse.json({ data: [] }, { status: 200 });
  return NextResponse.json({ data: data ?? [] });
}
