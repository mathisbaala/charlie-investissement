import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { decodeHtml, feeFracToPct, groupeName } from "@/lib/format";
import { contractTotalCost } from "@/lib/av-cost";
import type { ContractType } from "@/lib/insurer-envelope";
import { supportsSub } from "@/lib/partenaires";
import { PageShell } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { ArrowLeft, ChevronRight } from "@/components/ui/icons";
import { InsurerLogo } from "@/components/ui/InsurerLogo";
import { SolidityStat } from "@/components/ui/SolidityStat";

// ─── Fiche-contrat (rendu serveur, comme la fiche fonds) ─────────────────────
// L'onglet Assurance vie ne redirige plus vers le screener : il ouvre CETTE
// fiche. On y montre ce qu'on sait HONNÊTEMENT du contrat depuis la base
// (enveloppe, statut, supports, frais moyens, répartitions) ; les conditions
// propres au contrat (frais de gestion réels, versement, arbitrage, fonds euros,
// options) ne sont pas encore sourcées → bloc « à venir » assumé.

type Breakdown = { label: string; n: number };
type InsurerProfile = {
  kind: "fr" | "lux";
  groupe: string | null;
  positionnement: string | null;
  fonds_euros: string | null;
  forces: string[];
  limites: string[];
  lux: { ticket?: string; fid?: string; fas?: string; plancher_uc?: string } | null;
  // Solidité financière (SFCR) — Levier 3
  solvabilite_2_pct: number | null;
  notation: string | null;
  notation_agence: string | null;
  notation_annee: number | null;
  ppb_pct: number | null;
  ppb_annee: number | null;
  encours_vie_mds: number | null;
  encours_annee: number | null;
  sfcr_annee: number | null;
  sfcr_url: string | null;
};
// Historique du taux servi d'un fonds euros de l'assureur (multi-année).
type FondsEurosRate = {
  fonds_euros_nom: string;
  annee: number;
  taux_pct: number;
  bonus_note: string | null;
};
type ContractTerms = {
  frais_entree_pct: number | null;
  frais_gestion_uc_pct: number | null;
  frais_gestion_fonds_euros_pct: number | null;
  frais_arbitrage_pct: number | null;
  frais_arbitrage_note: string | null;
  fonds_euros_nom: string | null;
  fonds_euros_taux_pct: number | null;
  fonds_euros_annee: number | null;
  fonds_euros_bonus: string | null;
  fonds_euros_contrainte_uc: string | null;
  garantie_fonds_euros: string | null;
  univers_classes: string[];
  gestion_sous_mandat: boolean | null;
  options_gestion: string[];
  ticket_entree: string | null;
  versement_min: string | null;
  distributeur: string | null;
  service_extranet: string | null;
  source_url: string | null;
  as_of: string | null;
  confidence: "scraped" | "curated" | "indicative";
  notes: string | null;
};
type ContractOverview = {
  key: string;
  company: string;
  contract: string;
  types: string[];
  closed: boolean;
  variants: { contract: string; key: string }[];
  funds: number;
  avg_fee: number | null;
  classes: Breakdown[];
  regions: Breakdown[];
  managers: Breakdown[];
  sri: Record<string, number>;
  terms: ContractTerms | null;
};

const ENV_LABEL: Record<string, string> = {
  av: "Assurance vie", capi: "Capitalisation", per: "PER", pea: "PEA", pep: "PEP",
};

const CLASS_LABEL: Record<string, string> = {
  action: "Actions", obligation: "Obligations", diversifie: "Diversifiés",
  monetaire: "Monétaire", immobilier: "Immobilier", "non_coté": "Non coté",
  structure: "Produits structurés", matieres_premieres: "Matières premières",
};
function classLabel(raw: string): string {
  return CLASS_LABEL[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " ");
}

// Zones géographiques : les codes viennent en anglais/minuscules de la base
// (world, usa, emerging…). On les affiche en français capitalisé, comme les
// classes d'actifs — repli = majuscule initiale pour tout code non listé.
const REGION_LABEL: Record<string, string> = {
  world: "Monde", europe: "Europe", eurozone: "Zone euro", france: "France",
  germany: "Allemagne", switzerland: "Suisse", uk: "Royaume-Uni",
  usa: "États-Unis", "north_america": "Amérique du Nord",
  emerging: "Émergents", china: "Chine", india: "Inde", brazil: "Brésil",
  asia: "Asie", japan: "Japon", pacific: "Pacifique", latam: "Amérique latine",
  africa: "Afrique", "middle_east": "Moyen-Orient",
};
function regionLabel(raw: string): string {
  return REGION_LABEL[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " ");
}

// Barres de répartition : label + compte + barre proportionnelle au max local.
function BreakdownBars({ items, format }: { items: Breakdown[]; format?: (l: string) => string }) {
  if (items.length === 0) {
    return <p className="text-meta text-muted-2">Donnée non disponible.</p>;
  }
  const max = Math.max(...items.map((i) => i.n), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-3">
          <span className="text-body text-ink-2 w-40 shrink-0 truncate">
            {format ? format(it.label) : it.label}
          </span>
          <span className="flex-1 h-2 rounded-full bg-paper-2 overflow-hidden">
            <span
              className="block h-full rounded-full bg-accent/60"
              style={{ width: `${Math.max(4, (it.n / max) * 100)}%` }}
            />
          </span>
          <span className="text-meta text-muted tabular-nums w-10 text-right shrink-0">{it.n}</span>
        </li>
      ))}
    </ul>
  );
}

function LuxChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full bg-paper-2 border border-line px-2.5 py-1">
      <span className="text-caption text-muted-2">{label}</span>
      <span className="text-meta text-ink-2 font-medium">{value}</span>
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold">{label}</p>
      <p className="text-title text-ink font-semibold mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-caption text-muted-2 mt-0.5">{sub}</p>}
    </Card>
  );
}

function fmtPct(v: number | null | undefined): string | null {
  if (v == null) return null;
  return `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

// Majuscule initiale (valeurs de chips venant de la base, souvent en minuscules).
function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Historique du taux servi d'un fonds euros : libellé + suite d'années (barres
// proportionnelles au meilleur taux affiché), le millésime le plus récent en gras.
function FondsEurosTrend({ nom, rates }: { nom: string; rates: FondsEurosRate[] }) {
  const max = Math.max(...rates.map((r) => Number(r.taux_pct)), 0.01);
  const latest = rates.at(-1);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-meta text-ink-2 font-medium truncate">{nom}</span>
        {latest && (
          <span className="text-body text-ink font-semibold tabular-nums shrink-0">
            {fmtPct(latest.taux_pct)}
            <span className="text-caption text-muted-2 font-normal"> en {latest.annee}</span>
          </span>
        )}
      </div>
      <ul className="flex items-end gap-2 mt-2">
        {rates.map((r) => (
          <li key={r.annee} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <span className="text-caption text-muted tabular-nums">{fmtPct(r.taux_pct)}</span>
            <span className="w-full h-12 flex items-end rounded-sm bg-paper-2 overflow-hidden">
              <span
                className="block w-full rounded-sm bg-accent/50"
                style={{ height: `${Math.max(8, (Number(r.taux_pct) / max) * 100)}%` }}
              />
            </span>
            <span className="text-caption text-muted-2 tabular-nums">{String(r.annee).slice(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Ligne « libellé : valeur » ; ne s'affiche que si la valeur est renseignée.
function TermRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-line-soft last:border-0">
      <span className="text-meta text-muted shrink-0">{label}</span>
      <span className="text-body text-ink-2 font-medium text-right">{value}</span>
    </div>
  );
}

// Bloc « Conditions du contrat » quand les T&C sont sourcées (terms présent).
function TermsCard({ terms }: { terms: ContractTerms }) {
  const fraisArb = fmtPct(terms.frais_arbitrage_pct) ?? terms.frais_arbitrage_note;
  const fe = terms.fonds_euros_taux_pct != null
    ? `${fmtPct(terms.fonds_euros_taux_pct)}${terms.fonds_euros_annee ? ` (${terms.fonds_euros_annee})` : ""}`
    : null;

  return (
    <Card className="px-5 py-5">
      <h2 className="text-body-lg text-ink font-semibold mb-4">Conditions du contrat</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
        {/* Frais */}
        <div>
          <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-1.5">Frais</p>
          <TermRow label="Frais d'entrée (max)" value={fmtPct(terms.frais_entree_pct)} />
          <TermRow label="Frais de gestion (UC)" value={fmtPct(terms.frais_gestion_uc_pct)} />
          <TermRow label="Frais de gestion (fonds euros)" value={fmtPct(terms.frais_gestion_fonds_euros_pct)} />
          <TermRow label="Frais d'arbitrage" value={fraisArb} />
        </div>

        {/* Fonds euros */}
        <div>
          <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-1.5">Fonds euros</p>
          <TermRow label="Nom" value={terms.fonds_euros_nom} />
          <TermRow label="Taux servi" value={fe} />
          <TermRow label="Bonus de rendement" value={terms.fonds_euros_bonus} />
          <TermRow label="Contrainte d'UC" value={terms.fonds_euros_contrainte_uc} />
          <TermRow label="Garantie" value={terms.garantie_fonds_euros} />
        </div>

        {/* Accès & gestion */}
        <div>
          <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-1.5">Accès & gestion</p>
          <TermRow label="Ticket d'entrée" value={terms.ticket_entree} />
          <TermRow label="Versement minimum" value={terms.versement_min} />
          <TermRow label="Gestion sous mandat" value={terms.gestion_sous_mandat == null ? null : terms.gestion_sous_mandat ? "Disponible" : "Non"} />
          <TermRow label="Distributeur" value={terms.distributeur} />
          <TermRow label="Extranet / souscription" value={terms.service_extranet} />
        </div>

        {/* Univers & options */}
        <div className="flex flex-col gap-4">
          {terms.univers_classes?.length > 0 && (
            <div>
              <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-1.5">Univers accessible</p>
              <div className="flex flex-wrap gap-1.5">
                {terms.univers_classes.map((c) => (
                  <span key={c} className="text-caption text-ink-2 bg-paper-2 border border-line rounded-full px-2.5 py-1">{cap(c)}</span>
                ))}
              </div>
            </div>
          )}
          {terms.options_gestion?.length > 0 && (
            <div>
              <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-1.5">Options de gestion</p>
              <div className="flex flex-wrap gap-1.5">
                {terms.options_gestion.map((c) => (
                  <span key={c} className="text-caption text-ink-2 bg-paper-2 border border-line rounded-full px-2.5 py-1">{cap(c)}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default async function ContractPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  if (!key || !key.includes("::")) notFound();

  const { data, error } = await supabase.rpc("get_contract_overview", { p_key: key });
  const o = data as ContractOverview | null;
  if (error || !o || o.funds === 0) notFound();

  // Profil de l'assureur (curation vague 1, docs/mapping-assureurs-contrats-cgp.md)
  // + historique du taux servi des fonds euros : deux lectures indépendantes qui ne
  // dépendent que de `o.company`, lancées EN PARALLÈLE (avant : en série).
  const [{ data: profile }, { data: feRates }] = await Promise.all([
    supabase
      .from("investissement_av_insurer_profiles")
      .select(
        "kind, groupe, positionnement, fonds_euros, forces, limites, lux, solvabilite_2_pct, notation, notation_agence, notation_annee, ppb_pct, ppb_annee, encours_vie_mds, encours_annee, sfcr_annee, sfcr_url",
      )
      .eq("company", o.company)
      .maybeSingle<InsurerProfile>(),
    supabase
      .from("investissement_av_fonds_euros_history")
      .select("fonds_euros_nom, annee, taux_pct, bonus_note")
      .eq("company", o.company)
      .order("annee", { ascending: true })
      .returns<FondsEurosRate[]>(),
  ]);

  const feByFund = new Map<string, FondsEurosRate[]>();
  for (const r of feRates ?? []) {
    const arr = feByFund.get(r.fonds_euros_nom) ?? [];
    arr.push(r);
    feByFund.set(r.fonds_euros_nom, arr);
  }
  // Fonds euros triés par millésime le plus récent servi (le plus « vivant » en tête).
  const feFunds = [...feByFund.entries()].sort(
    (a, b) => (b[1].at(-1)?.annee ?? 0) - (a[1].at(-1)?.annee ?? 0),
  );

  const hasSolidity =
    profile != null &&
    (profile.solvabilite_2_pct != null ||
      profile.notation != null ||
      profile.ppb_pct != null ||
      profile.encours_vie_mds != null);

  const terPct = feeFracToPct(o.avg_fee);
  // Coût total de détention : frais moyens des supports + frais de gestion du
  // contrat (sourcé si connu, sinon indicatif enveloppe). Chiffre unique et
  // comparable — c'est le vrai coût annuel supporté sur une allocation moyenne.
  const cost = contractTotalCost(
    o.avg_fee,
    o.terms?.frais_gestion_uc_pct ?? null,
    (o.types ?? ["av"]) as ContractType[],
  );

  // SRI moyen pondéré par le nombre de supports de chaque cran.
  const sriEntries = Object.entries(o.sri ?? {});
  const sriTotal = sriEntries.reduce((s, [, n]) => s + n, 0);
  const sriAvg =
    sriTotal > 0
      ? sriEntries.reduce((s, [k, n]) => s + Number(k) * n, 0) / sriTotal
      : null;
  const sriBars: Breakdown[] = Array.from({ length: 7 }, (_, i) => ({
    label: String(i + 1),
    n: o.sri?.[String(i + 1)] ?? 0,
  }));

  const searchHref = `/recherche?contracts=${encodeURIComponent(o.key)}`;

  return (
    <PageShell className="space-y-5">
      <Link
        href="/partenaires"
        className="inline-flex items-center gap-1.5 text-label text-muted hover:text-ink-2 transition-colors"
      >
        <ArrowLeft size={12} />
        Tous les partenaires
      </Link>

      {/* En-tête */}
      <Card className="px-5 py-5 md:px-7 md:py-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <InsurerLogo company={o.company} size={54} className="mt-0.5 hidden sm:inline-flex" />
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {(o.types ?? []).map((t) => (
                <span
                  key={t}
                  className="text-caption uppercase tracking-widest font-semibold text-accent-ink bg-accent-soft border border-accent/20 rounded-full px-2.5 py-0.5"
                >
                  {ENV_LABEL[t] ?? t}
                </span>
              ))}
              <span
                className={`inline-flex items-center gap-1.5 text-caption font-medium rounded-full px-2.5 py-0.5 border ${
                  o.closed
                    ? "text-muted-2 bg-paper-2 border-line"
                    : "text-ok bg-ok-soft border-ok/20"
                }`}
              >
                <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${o.closed ? "border-[1.5px] border-muted-2" : "bg-ok"}`} />
                {o.closed ? "Fermé à la commercialisation" : "Ouvert"}
              </span>
            </div>
            <h1 className="text-display leading-[1.2] text-ink font-medium" style={{ fontFamily: "var(--font-sans)" }}>
              {decodeHtml(o.contract)}
            </h1>
            <p className="mt-2 text-meta text-muted">
              <span className="sm:hidden mr-1.5 align-middle"><InsurerLogo company={o.company} size={18} /></span>
              {decodeHtml(o.company)}
            </p>
            {o.variants?.length > 0 && (
              <p className="text-caption text-muted-2 mt-2">
                Mêmes supports que&nbsp;: {o.variants.map((v) => decodeHtml(v.contract)).join(" · ")}
              </p>
            )}
            </div>
          </div>

          <Link
            href={searchHref}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent text-paper text-label font-medium px-4 py-2.5 min-h-[44px] hover:bg-accent/90 transition-colors"
          >
            Voir les {o.funds.toLocaleString("fr-FR")} support{o.funds > 1 ? "s" : ""}
            <ChevronRight size={15} />
          </Link>
        </div>
      </Card>

      {/* Indicateurs clés */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Supports référencés"
          value={o.funds.toLocaleString("fr-FR")}
          sub={supportsSub(o.company, o.types ?? [])}
        />
        <StatCard
          label="Frais courants moyens"
          value={terPct != null ? `${terPct.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : "-"}
          sub="des supports (hors contrat)"
        />
        <StatCard
          label="Coût total estimé"
          value={
            cost.total != null
              ? `${cost.contractSourced ? "" : "~ "}${cost.total.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %/an`
              : "-"
          }
          sub="supports + gestion du contrat"
        />
        <StatCard
          label="SRI moyen"
          value={sriAvg != null ? `${sriAvg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} / 7` : "-"}
          sub="des supports"
        />
      </div>

      {/* L'assureur — profil curé (contexte assureur / enveloppe) */}
      {profile && (
        <Card className="px-5 py-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <InsurerLogo company={o.company} size={44} />
              <div className="min-w-0">
                <h2 className="text-body-lg text-ink font-semibold leading-tight">Le partenaire</h2>
                <p className="text-meta text-muted truncate">{decodeHtml(o.company)}</p>
              </div>
            </div>
            <span className="text-caption uppercase tracking-widest text-muted-2 font-semibold">
              {profile.kind === "lux" ? "Luxembourg" : "France"}
            </span>
          </div>
          {profile.groupe && (
            <p className="text-meta text-muted mt-1">Groupe&nbsp;: <span className="text-ink-2">{groupeName(profile.groupe)}</span></p>
          )}
          {profile.positionnement && (
            <p className="text-body text-ink-2 mt-2 max-w-[75ch]">{profile.positionnement}</p>
          )}

          {profile.fonds_euros && (
            <div className="mt-3 inline-flex items-baseline gap-2 rounded-lg bg-paper-2 border border-line px-3 py-1.5">
              <span className="text-caption uppercase tracking-widest text-muted-2 font-semibold">Fonds euros</span>
              <span className="text-body text-ink-2 font-medium">{profile.fonds_euros}</span>
            </div>
          )}

          {/* Solidité financière (SFCR) — Solvabilité II, notation, PPB, encours.
              Faits chiffrés et auditables (rapport SFCR annuel). */}
          {hasSolidity && (
            <div className="mt-4 pt-4 border-t border-line-soft">
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
                  sub={profile.ppb_annee ? `réserve de rendement · fin ${profile.ppb_annee}` : "réserve de rendement"}
                />
                <SolidityStat
                  label="Encours vie"
                  value={profile.encours_vie_mds != null ? `${Number(profile.encours_vie_mds).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Md€` : null}
                  sub={profile.encours_annee ? `provisions techniques · ${profile.encours_annee}` : "provisions techniques"}
                />
              </div>
            </div>
          )}

          {/* Rendement des fonds euros dans le temps (taux servis, nets de frais). */}
          {feFunds.length > 0 && (
            <div className="mt-4 pt-4 border-t border-line-soft">
              <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-3">
                Rendement des fonds euros
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
                {feFunds.slice(0, 4).map(([nom, rates]) => (
                  <FondsEurosTrend key={nom} nom={nom} rates={rates} />
                ))}
              </div>
              <p className="text-caption text-muted-2 mt-3">Taux servis nets de frais de gestion, hors prélèvements sociaux et fiscaux.</p>
            </div>
          )}

          {(profile.forces?.length > 0 || profile.limites?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mt-4">
              {profile.forces?.length > 0 && (
                <div>
                  <p className="text-caption uppercase tracking-widest text-ok font-semibold mb-1.5">Forces</p>
                  <ul className="flex flex-col gap-1">
                    {profile.forces.map((f) => (
                      <li key={f} className="text-meta text-ink-2 flex gap-2"><span className="text-ok shrink-0">+</span>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {profile.limites?.length > 0 && (
                <div>
                  <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-1.5">Points d&apos;attention</p>
                  <ul className="flex flex-col gap-1">
                    {profile.limites.map((l) => (
                      <li key={l} className="text-meta text-ink-2 flex gap-2"><span className="text-muted-2 shrink-0">–</span>{l}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Spécificités Luxembourg : ticket + seuils FID/FAS + garanties transverses.
              N'affiche la section que si au moins un seuil est renseigné (sinon en-tête vide). */}
          {profile.kind === "lux" && (profile.lux?.ticket || profile.lux?.fid || profile.lux?.fas || profile.lux?.plancher_uc) && (
            <div className="mt-4 pt-4 border-t border-line-soft">
              <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-2">Spécificités Luxembourg</p>
              <div className="flex flex-wrap gap-2">
                {profile.lux?.ticket && <LuxChip label="Ticket d'entrée" value={profile.lux.ticket} />}
                {profile.lux?.fid && <LuxChip label="Seuil FID" value={profile.lux.fid} />}
                {profile.lux?.fas && <LuxChip label="Seuil FAS" value={profile.lux.fas} />}
                {profile.lux?.plancher_uc && <LuxChip label="Frais UC plancher" value={profile.lux.plancher_uc} />}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Conditions du contrat : T&C réelles si sourcées, sinon « à venir » (honnête) */}
      {o.terms ? (
        <TermsCard terms={o.terms} />
      ) : (
        <Card className="px-5 py-5">
          <h2 className="text-body-lg text-ink font-semibold">Conditions du contrat</h2>
          <p className="text-meta text-muted mt-1.5">Ces conditions ne sont pas encore sourcées.</p>
          <div className="flex flex-wrap gap-2 mt-4">
            {[
              "Frais de gestion",
              "Frais de versement",
              "Frais d'arbitrage",
              "Taux fonds euros",
              "Options de gestion",
            ].map((t) => (
              <span key={t} className="inline-flex items-center text-caption text-muted-2 bg-paper-2 border border-line rounded-full px-2.5 py-1">
                {t}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Répartitions des supports (données réelles) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="px-5 py-5">
          <h2 className="text-label text-ink font-semibold mb-4">Classes d&apos;actifs</h2>
          <BreakdownBars items={o.classes ?? []} format={classLabel} />
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-label text-ink font-semibold mb-4">Zones géographiques</h2>
          <BreakdownBars items={o.regions ?? []} format={regionLabel} />
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-label text-ink font-semibold mb-4">Principaux gestionnaires</h2>
          <BreakdownBars items={o.managers ?? []} />
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-label text-ink font-semibold mb-4">Niveau de risque (SRI)</h2>
          {sriTotal > 0 ? (
            <BreakdownBars items={sriBars.map((b) => ({ ...b, label: `SRI ${b.label}` }))} />
          ) : (
            <p className="text-meta text-muted-2">Donnée non disponible.</p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
