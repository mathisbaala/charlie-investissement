import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Cache edge (Next 16) : `force-static` + `revalidate` (seule façon de cacher un
// GET route handler). `force-dynamic` neutralisait le `s-maxage`. Prérendu puis
// ISR toutes les 300 s → CDN Vercel ~40 ms. Donnée à évolution lente.
export const dynamic = "force-static";
export const revalidate = 300;

// Liste des contrats (assureur + contrat + nombre de fonds), pour alimenter la
// sélection « par contrat » imbriquée sous chaque assureur du screener.
// Chaque entrée porte une clé composite "Assureur::Contrat" utilisée comme valeur
// de filtre (cf. colonne contracts[] de la vue investissement_funds_cgp_ref).
export async function GET(): Promise<NextResponse> {
  // `force-static` fait prérendre cette route au build (phase « Generating static
  // pages »), donc GET s'exécute et instancie le client Supabase. Sur un build
  // preview Vercel, SUPABASE_URL est absente → getClient() jette → le prerender
  // planterait tout le build. On l'attrape pour prérendre une liste vide : au
  // runtime (env présente) l'ISR rerévalide avec la vraie donnée. En prod le build
  // a l'env, donc rien ne change. Voir lib/supabase.ts (init paresseuse).
  let data: unknown[] | null = null;
  try {
    const res = await supabase.rpc("get_contracts_list");
    // 500 (et non 200 + []) sur erreur RPC : voir route insurers. Source principale
    // de /assureurs → une panne ne doit pas se déguiser en « aucun contrat ».
    if (res.error) return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
    data = res.data;
  } catch {
    return NextResponse.json({ data: [] });
  }
  // s-maxage piloté par force-static + revalidate (voir en-tête du fichier).
  return NextResponse.json({ data: data ?? [] });
}
