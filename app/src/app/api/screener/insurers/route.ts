import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Cache edge (Next 16) : la seule façon de cacher un GET route handler est
// `force-static` (+ `revalidate`). `force-dynamic` neutralisait le `s-maxage`
// (cache jamais utilisé, x-vercel-cache MISS à chaque clic → RPC à chaque fois).
// Ici : prérendu puis ISR toutes les 300 s → CDN Vercel sert en ~40 ms. La donnée
// (liste d'assureurs) bouge lentement, refraîchie par le pipeline. Voir la matview
// investissement_insurers_list_mv derrière get_insurers_list.
export const dynamic = "force-static";
export const revalidate = 300;

// Liste des assureurs référençant des fonds (nom + nombre de fonds), pour
// alimenter le filtre « Référencé chez » du screener.
export async function GET(): Promise<NextResponse> {
  // `force-static` prérend cette route au build : GET s'exécute et instancie le
  // client Supabase. Sur un build preview Vercel (SUPABASE_URL absente),
  // getClient() jette et ferait planter tout le build. On l'attrape pour prérendre
  // une liste vide ; l'ISR rerévalide au runtime avec la vraie donnée. En prod le
  // build dispose de l'env, donc rien ne change. Voir lib/supabase.ts.
  let data: unknown[] | null = null;
  try {
    const res = await supabase.rpc("get_insurers_list");
    // 500 (et non 200 + []) sur erreur RPC : la page /partenaires s'appuie sur ces
    // routes comme source principale et doit distinguer une panne d'un « 0 résultat ».
    // Le FilterPanel du screener dégrade déjà proprement sur !r.ok.
    if (res.error) return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
    data = res.data;
  } catch {
    return NextResponse.json({ data: [] });
  }
  // Agrégation pure (aucune télémétrie, données anonymes qui bougent lentement) :
  // mêmes en-têtes de cache edge que top-performers / filters. Sert l'accueil et
  // le filtre « Référencé chez » en ~40 ms sur répétition au lieu de ~240 ms,
  // et déleste Supabase quand le trafic monte.
  // Pas d'en-tête Cache-Control manuel : `force-static` + `revalidate` pilotent
  // le s-maxage (Next l'ignorait sur une route dynamique, d'où l'ancien MISS).
  return NextResponse.json({ data: data ?? [] });
}
