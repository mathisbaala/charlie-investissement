import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Pas de `force-dynamic` : il neutralise l'en-tête `s-maxage` (Next le remplace
// par un simple `public`, cache edge jamais utilisé → chaque clic refrappe
// Supabase). L'appel RPC (fetch non caché) suffit à garder la route dynamique au
// build, et le Cache-Control ci-dessous atteint alors le CDN Vercel (~40 ms sur
// répétition). Voir get_insurers_list, matview investissement_insurers_list_mv.

// Liste des assureurs référençant des fonds (nom + nombre de fonds), pour
// alimenter le filtre « Référencé chez » du screener.
export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase.rpc("get_insurers_list");
  // 500 (et non 200 + []) sur erreur RPC : la page /assureurs s'appuie sur ces
  // routes comme source principale et doit distinguer une panne d'un « 0 résultat ».
  // Le FilterPanel du screener dégrade déjà proprement sur !r.ok.
  if (error) return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
  // Agrégation pure (aucune télémétrie, données anonymes qui bougent lentement) :
  // mêmes en-têtes de cache edge que top-performers / filters. Sert l'accueil et
  // le filtre « Référencé chez » en ~40 ms sur répétition au lieu de ~240 ms,
  // et déleste Supabase quand le trafic monte.
  return NextResponse.json(
    { data: data ?? [] },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
