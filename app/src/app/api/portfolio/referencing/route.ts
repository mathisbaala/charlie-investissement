import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Référencement des supports imposés dans un contrat : pour une clé de contrat
// « Assureur::Contrat » et une liste d'ISIN, renvoie ceux qui sont RÉELLEMENT
// référencés dans ce contrat (même source de vérité que le screener : la vue
// investissement_funds_cgp_ref, colonne contracts[]). L'atelier s'en sert pour
// pastiller « non référencé » les fonds absents du contrat et bloquer la
// génération tant qu'ils ne sont pas retirés.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const contract = (sp.get("contract") ?? "").trim();
  const isins = (sp.get("isins") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  // Sans contrat réel (« Assureur::Contrat ») ou sans ISIN : rien à vérifier.
  // Le contrat démo n'a pas de référencement → tout est considéré référencé.
  if (!contract.includes("::") || isins.length === 0) {
    return NextResponse.json({ referenced: isins }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const { data, error } = await supabase
    .from("investissement_funds_cgp_ref")
    .select("isin")
    .overlaps("contracts", [contract])
    .in("isin", isins);

  if (error) {
    return NextResponse.json({ error: "referencing_lookup_failed" }, { status: 500 });
  }

  const referenced = (data ?? []).map((r) => (r as { isin: string }).isin.toUpperCase());
  return NextResponse.json(
    { referenced },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
