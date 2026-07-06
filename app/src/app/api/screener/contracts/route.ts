import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Liste des contrats (assureur + contrat + nombre de fonds), pour alimenter la
// sélection « par contrat » imbriquée sous chaque assureur du screener.
// Chaque entrée porte une clé composite "Assureur::Contrat" utilisée comme valeur
// de filtre (cf. colonne contracts[] de la vue investissement_funds_cgp_ref).
export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase.rpc("get_contracts_list");
  // 500 (et non 200 + []) sur erreur RPC : voir route insurers. Source principale
  // de /assureurs → une panne ne doit pas se déguiser en « aucun contrat ».
  if (error) return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
  // Agrégation pure qui bouge lentement : mêmes en-têtes de cache edge que
  // /insurers, pour servir le FilterPanel en ~40 ms sur répétition et délester
  // Supabase quand le trafic monte.
  return NextResponse.json(
    { data: data ?? [] },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
