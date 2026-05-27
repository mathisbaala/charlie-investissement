import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { scoreFunds, ClientProfile } from "@/lib/matching";

export async function POST(req: NextRequest) {
  const profile = (await req.json()) as ClientProfile;

  if (!profile.risk_profile || !profile.envelopes || !profile.esg_preference) {
    return NextResponse.json({ error: "Profil incomplet" }, { status: 400 });
  }

  let q = supabase
    .from("investissement_funds_cgp")
    .select(
      "isin,name,product_type,gestionnaire,sfdr_article,risk_score,ongoing_charges,performance_1y,performance_3y,performance_5y,volatility_1y,sharpe_1y,aum_eur,morningstar_rating,pea_eligible,per_eligible,av_lux_eligible,inception_date,data_completeness"
    )
    .gte("data_completeness", 60)
    .order("data_completeness", { ascending: false })
    .limit(400);

  // Filtrer sur l'enveloppe — au moins une doit matcher
  if (profile.envelopes.length > 0) {
    const conditions: string[] = [];
    if (profile.envelopes.includes("pea")) conditions.push("pea_eligible.eq.true");
    if (profile.envelopes.includes("per")) conditions.push("per_eligible.eq.true");
    if (profile.envelopes.includes("av_lux")) conditions.push("av_lux_eligible.eq.true");
    if (conditions.length > 0) {
      q = q.or(conditions.join(","));
    }
  }

  // Filtrer SFDR si préférence stricte Art.9
  if (profile.esg_preference === "art9") {
    q = q.in("sfdr_article", [8, 9]);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ranked = scoreFunds(data ?? [], profile).slice(0, 20);

  return NextResponse.json({ results: ranked, profile });
}
