import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { decodeHtml, groupeName } from "@/lib/format";
import { PageShell } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { ArrowLeft, ChevronRight, Shield } from "@/components/ui/icons";
import { InsurerLogo } from "@/components/ui/InsurerLogo";
import { SolidityStat } from "@/components/ui/SolidityStat";
import type { Envelope } from "@/lib/insurer-envelope";
import ContractComparison, { type ComparisonContract } from "./ContractComparison";

// ─── Page assureur : comparateur de ses contrats (rendu serveur) ─────────────
// Un clic sur un ASSUREUR dans /assureurs ouvre CETTE page (plus le screener
// filtré). On y compare les contrats de l'assureur côte à côte (supports, frais,
// fonds euros, SRI), avec le contexte assureur en en-tête (groupe, positionnement,
// solidité). Chaque contrat ouvre sa fiche détaillée ; un bouton mène toujours au
// screener pré-filtré sur l'assureur (accès à tous ses supports).

type InsurerProfile = {
  kind: "fr" | "lux";
  groupe: string | null;
  positionnement: string | null;
  fonds_euros: string | null;
  forces: string[];
  limites: string[];
  solvabilite_2_pct: number | null;
  notation: string | null;
  notation_agence: string | null;
  notation_annee: number | null;
  ppb_pct: number | null;
  encours_vie_mds: number | null;
  sfcr_annee: number | null;
  sfcr_url: string | null;
};
type InsurerComparison = {
  company: string;
  funds_total: number | null;
  contracts: ComparisonContract[];
};

const VALID_ENV: Envelope[] = ["av", "capi", "per", "pea"];

export default async function InsurerPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; env?: string }>;
}) {
  const { company, env } = await searchParams;
  if (!company) notFound();

  // Les deux lectures (comparaison + profil curé) sont indépendantes → en
  // parallèle plutôt qu'en séquence (deux allers-retours Supabase = ouverture
  // perçue comme lente sinon).
  const [comparison, profileRes] = await Promise.all([
    supabase.rpc("get_insurer_comparison", { p_company: company }),
    supabase
      .from("investissement_av_insurer_profiles")
      .select(
        "kind, groupe, positionnement, fonds_euros, forces, limites, solvabilite_2_pct, notation, notation_agence, notation_annee, ppb_pct, encours_vie_mds, sfcr_annee, sfcr_url",
      )
      .eq("company", company)
      .maybeSingle<InsurerProfile>(),
  ]);

  const { data, error } = comparison;
  const o = data as InsurerComparison | null;
  if (error || !o) notFound();

  const profile = profileRes.data;

  // L'assureur n'existe ni comme offre ni comme profil → 404 franc.
  if ((o.contracts?.length ?? 0) === 0 && !profile && !o.funds_total) notFound();

  const initialEnv: Envelope | "all" =
    env && (VALID_ENV as string[]).includes(env) ? (env as Envelope) : "all";

  const hasSolidity =
    profile != null &&
    (profile.solvabilite_2_pct != null ||
      profile.notation != null ||
      profile.ppb_pct != null ||
      profile.encours_vie_mds != null);

  const fundsTotal = o.funds_total ?? 0;
  const searchHref = `/recherche?insurer=${encodeURIComponent(company)}`;

  return (
    <PageShell className="space-y-5">
      <Link
        href="/assureurs"
        className="inline-flex items-center gap-1.5 text-label text-muted hover:text-ink-2 transition-colors"
      >
        <ArrowLeft size={12} />
        Tous les partenaires
      </Link>

      {/* En-tête assureur : contexte + accès direct à tous ses supports */}
      <Card className="px-5 py-5 md:px-7 md:py-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <InsurerLogo company={company} size={52} className="mt-1 rounded-xl" />
            <div className="min-w-0">
            {profile && (
              <span className="text-caption uppercase tracking-widest text-muted-2 font-semibold">
                {profile.kind === "lux" ? "Luxembourg" : "France"}
                {profile.groupe ? ` · Groupe ${groupeName(profile.groupe)}` : ""}
              </span>
            )}
            <h1 className="text-display leading-[1.2] text-ink font-medium mt-1" style={{ fontFamily: "var(--font-sans)" }}>
              {decodeHtml(company)}
            </h1>
            <p className="flex items-center gap-2 mt-2 text-meta text-muted">
              <Shield size={13} className="text-muted-2" />
              {fundsTotal > 0
                ? `${fundsTotal.toLocaleString("fr-FR")} support${fundsTotal > 1 ? "s" : ""} référencé${fundsTotal > 1 ? "s" : ""}`
                : "Assureur partenaire"}
              {o.contracts.length > 0 && <> · {o.contracts.length} contrat{o.contracts.length > 1 ? "s" : ""}</>}
            </p>
            {profile?.positionnement && (
              <p className="text-body text-ink-2 mt-3 max-w-[75ch]">{profile.positionnement}</p>
            )}
            {profile?.fonds_euros && (
              <div className="mt-3 inline-flex items-baseline gap-2 rounded-lg bg-paper-2 border border-line px-3 py-1.5">
                <span className="text-caption uppercase tracking-widest text-muted-2 font-semibold">Fonds euros</span>
                <span className="text-body text-ink-2 font-medium">{profile.fonds_euros}</span>
              </div>
            )}
            </div>
          </div>

          {fundsTotal > 0 && (
            <Link
              href={searchHref}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent text-paper text-label font-medium px-4 py-2.5 min-h-[44px] hover:bg-accent/90 transition-colors"
            >
              Voir les {fundsTotal.toLocaleString("fr-FR")} support{fundsTotal > 1 ? "s" : ""}
              <ChevronRight size={15} />
            </Link>
          )}
        </div>

        {/* Solidité financière (SFCR) — faits chiffrés au niveau assureur */}
        {hasSolidity && profile && (
          <div className="mt-5 pt-5 border-t border-line-soft">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2.5">
              <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold">Solidité financière</p>
              {profile.sfcr_url && (
                <a
                  href={profile.sfcr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-caption text-muted hover:text-accent-ink transition-colors underline decoration-line underline-offset-2"
                >
                  Rapport SFCR{profile.sfcr_annee ? ` ${profile.sfcr_annee}` : ""}
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <SolidityStat
                label="Solvabilité II"
                value={profile.solvabilite_2_pct != null ? `${Number(profile.solvabilite_2_pct).toLocaleString("fr-FR")} %` : null}
                sub="couverture du SCR"
              />
              <SolidityStat
                label="Notation"
                value={profile.notation}
                sub={[profile.notation_agence, profile.notation_annee].filter(Boolean).join(" · ") || null}
              />
              <SolidityStat
                label="PPB"
                value={profile.ppb_pct != null ? `${Number(profile.ppb_pct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : null}
                sub="réserve de rendement"
              />
              <SolidityStat
                label="Encours vie"
                value={profile.encours_vie_mds != null ? `${Number(profile.encours_vie_mds).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Md€` : null}
                sub="provisions techniques"
              />
            </div>
          </div>
        )}
      </Card>

      {/* Comparateur des contrats (interactif : enveloppe, tri, statut) */}
      <div>
        <h2 className="text-title text-ink font-semibold mb-4">Comparer les contrats</h2>
        <ContractComparison
          contracts={(o.contracts ?? []).map((c) => ({ ...c, company }))}
          company={company}
          initialEnv={initialEnv}
        />
      </div>
    </PageShell>
  );
}
