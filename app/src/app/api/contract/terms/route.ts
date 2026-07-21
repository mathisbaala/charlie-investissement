import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Termes de frais d'UN contrat reconnu (clé "Assureur::Contrat"), pour sourcer le
// coût client réel dans l'analyse de l'existant : frais de gestion UC et frais
// d'entrée du contrat, quand ils sont connus en base (av_contract_terms via
// get_contract_overview). Projection SLIM — la fiche-contrat (/assureurs/contrat)
// sert la vue complète. Repli silencieux (null) si le contrat n'est pas en base :
// l'appelant retombe alors sur l'indicatif d'enveloppe.
export const dynamic = "force-dynamic";

interface OverviewRow {
  types?: string[] | null;
  terms?: {
    frais_gestion_uc_pct: number | null;
    frais_gestion_fonds_euros_pct: number | null;
    frais_entree_pct: number | null;
    confidence?: "scraped" | "curated" | "indicative";
  } | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !key.includes("::")) {
    return NextResponse.json({ error: "missing_or_invalid_key" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("get_contract_overview", { p_key: key });
  if (error) return NextResponse.json({ error: "rpc_failed" }, { status: 500 });

  const o = data as OverviewRow | null;
  if (!o || !o.terms) {
    // Contrat non référencé en base : pas une erreur, juste pas de donnée sourcée.
    return NextResponse.json({ found: false });
  }
  return NextResponse.json({
    found: true,
    frais_gestion_uc_pct: o.terms.frais_gestion_uc_pct,
    frais_gestion_fonds_euros_pct: o.terms.frais_gestion_fonds_euros_pct,
    frais_entree_pct: o.terms.frais_entree_pct,
    confidence: o.terms.confidence ?? null,
    types: o.types ?? null,
  });
}
