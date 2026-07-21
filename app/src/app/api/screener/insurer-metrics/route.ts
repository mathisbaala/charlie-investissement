import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Métriques d'assureur pour la marketplace (/assureurs) : Solvabilité II + notation
// (profil) et meilleur taux de fonds euros du millésime le plus récent (historique).
// Alimente un aperçu chiffré sur chaque carte assureur — au-delà du simple comptage
// de supports. Données publiques qui bougent lentement → même cache edge que
// /insurers (force-static + ISR 300 s). `—` géré côté UI quand une métrique manque.
export const dynamic = "force-static";
export const revalidate = 300;

type ProfileRow = {
  company: string;
  kind: "fr" | "lux" | null;
  solvabilite_2_pct: number | null;
  notation: string | null;
  notation_agence: string | null;
};
type FeRow = { company: string; annee: number; taux_pct: number };

export type InsurerMetrics = {
  kind: "fr" | "lux" | null;
  solvabilite_2_pct: number | null;
  notation: string | null;
  notation_agence: string | null;
  fe_taux: number | null; // meilleur taux de fonds euros du dernier millésime connu
  fe_annee: number | null;
};

export async function GET(): Promise<NextResponse> {
  const [profilesRes, feRes] = await Promise.all([
    supabase
      .from("investissement_av_insurer_profiles")
      .select("company, kind, solvabilite_2_pct, notation, notation_agence")
      .returns<ProfileRow[]>(),
    supabase
      .from("investissement_av_fonds_euros_history")
      .select("company, annee, taux_pct")
      .returns<FeRow[]>(),
  ]);

  // Une panne DB doit se distinguer d'un « 0 métrique » : 500 franc (l'UI dégrade).
  if (profilesRes.error && feRes.error) {
    return NextResponse.json({ error: "db_failed" }, { status: 500 });
  }

  // Par assureur : millésime de fonds euros le plus récent, puis meilleur taux de
  // ce millésime (le fonds euros « de tête » — repère que lit un CGP).
  const feByCompany = new Map<string, { annee: number; taux: number }>();
  for (const r of feRes.data ?? []) {
    if (r.annee == null || r.taux_pct == null) continue;
    const cur = feByCompany.get(r.company);
    if (!cur || r.annee > cur.annee || (r.annee === cur.annee && Number(r.taux_pct) > cur.taux)) {
      feByCompany.set(r.company, { annee: r.annee, taux: Number(r.taux_pct) });
    }
  }

  const metrics: Record<string, InsurerMetrics> = {};
  for (const p of profilesRes.data ?? []) {
    const fe = feByCompany.get(p.company);
    metrics[p.company] = {
      kind: p.kind,
      solvabilite_2_pct: p.solvabilite_2_pct,
      notation: p.notation,
      notation_agence: p.notation_agence,
      fe_taux: fe?.taux ?? null,
      fe_annee: fe?.annee ?? null,
    };
  }
  // Assureurs sans profil mais présents dans l'historique fonds euros : on les expose
  // quand même (au moins le taux), pour ne pas perdre la métrique.
  for (const [company, fe] of feByCompany) {
    if (!metrics[company]) {
      metrics[company] = {
        kind: null, solvabilite_2_pct: null, notation: null, notation_agence: null,
        fe_taux: fe.taux, fe_annee: fe.annee,
      };
    }
  }

  return NextResponse.json({ data: metrics });
}
