import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { decodeHtml, feeFracToPct } from "@/lib/format";
import { PageShell } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { ArrowLeft, ChevronRight, Shield } from "@/components/ui/icons";

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
// Frais de gestion d'enveloppe INDICATIFS (moyenne de marché), en attendant les
// conditions réelles du contrat. Alignés sur CONTRACT_FEE_DEFAULTS (simulateur).
const ENV_INDICATIVE_FEE: Record<string, number> = {
  av: 0.8, capi: 0.8, per: 0.6, pea: 0, pep: 0,
};

const CLASS_LABEL: Record<string, string> = {
  action: "Actions", obligation: "Obligations", diversifie: "Diversifiés",
  monetaire: "Monétaire", immobilier: "Immobilier", "non_coté": "Non coté",
  structure: "Produits structurés", matieres_premieres: "Matières premières",
};
function classLabel(raw: string): string {
  return CLASS_LABEL[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " ");
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

const CONFIDENCE_LABEL: Record<ContractTerms["confidence"], string> = {
  scraped: "extrait du DIC",
  curated: "vérifié à la main",
  indicative: "indicatif",
};

// Bloc « Conditions du contrat » quand les T&C sont sourcées (terms présent).
function TermsCard({ terms }: { terms: ContractTerms }) {
  const fraisArb = fmtPct(terms.frais_arbitrage_pct) ?? terms.frais_arbitrage_note;
  const fe = terms.fonds_euros_taux_pct != null
    ? `${fmtPct(terms.fonds_euros_taux_pct)}${terms.fonds_euros_annee ? ` (${terms.fonds_euros_annee})` : ""}`
    : null;
  const sourceHost = terms.source_url ? (() => { try { return new URL(terms.source_url!).hostname.replace(/^www\./, ""); } catch { return null; } })() : null;

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
                  <span key={c} className="text-caption text-ink-2 bg-paper-2 border border-line rounded-full px-2.5 py-1">{c}</span>
                ))}
              </div>
            </div>
          )}
          {terms.options_gestion?.length > 0 && (
            <div>
              <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-1.5">Options de gestion</p>
              <div className="flex flex-wrap gap-1.5">
                {terms.options_gestion.map((c) => (
                  <span key={c} className="text-caption text-ink-2 bg-paper-2 border border-line rounded-full px-2.5 py-1">{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-caption text-muted-2 mt-4">
        {CONFIDENCE_LABEL[terms.confidence]}
        {terms.as_of ? ` · millésime ${new Date(terms.as_of).getFullYear()}` : ""}
        {sourceHost ? ` · source ${sourceHost}` : ""}
      </p>
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

  // Profil de l'assureur (curation vague 1, docs/mapping-assureurs-contrats-cgp.md) :
  // enrichit chaque fiche par le contexte assureur/enveloppe, en attendant les
  // conditions propres au contrat (frais réels, fonds euros du contrat, options).
  const { data: profile } = await supabase
    .from("investissement_av_insurer_profiles")
    .select("kind, groupe, positionnement, fonds_euros, forces, limites, lux")
    .eq("company", o.company)
    .maybeSingle<InsurerProfile>();

  const terPct = feeFracToPct(o.avg_fee);
  const primaryType = o.types?.[0] ?? "av";
  const indicativeFee = ENV_INDICATIVE_FEE[primaryType] ?? 0.8;

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
        href="/assureurs"
        className="inline-flex items-center gap-1.5 text-label text-muted hover:text-ink-2 transition-colors"
      >
        <ArrowLeft size={12} />
        Tous les assureurs
      </Link>

      {/* En-tête */}
      <Card className="px-5 py-5 md:px-7 md:py-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
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
            <p className="flex items-center gap-2 mt-2 text-meta text-muted">
              <Shield size={13} className="text-muted-2" />
              {decodeHtml(o.company)}
            </p>
            {o.variants?.length > 0 && (
              <p className="text-caption text-muted-2 mt-2">
                Mêmes supports que&nbsp;: {o.variants.map((v) => decodeHtml(v.contract)).join(" · ")}
              </p>
            )}
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
          sub="unités de compte"
        />
        <StatCard
          label="Frais courants moyens"
          value={terPct != null ? `${terPct.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : "—"}
          sub="des supports (hors contrat)"
        />
        <StatCard
          label="Frais de gestion"
          value={indicativeFee > 0 ? `~${indicativeFee.toLocaleString("fr-FR")} %/an` : "—"}
          sub="indicatif enveloppe"
        />
        <StatCard
          label="SRI moyen"
          value={sriAvg != null ? `${sriAvg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} / 7` : "—"}
          sub="des supports"
        />
      </div>

      {/* L'assureur — profil curé (contexte assureur / enveloppe) */}
      {profile && (
        <Card className="px-5 py-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-body-lg text-ink font-semibold">L&apos;assureur</h2>
            <span className="text-caption uppercase tracking-widest text-muted-2 font-semibold">
              {profile.kind === "lux" ? "Luxembourg" : "France"}
            </span>
          </div>
          {profile.groupe && (
            <p className="text-meta text-muted mt-1">Groupe&nbsp;: <span className="text-ink-2">{profile.groupe}</span></p>
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

          {/* Spécificités Luxembourg : ticket + seuils FID/FAS + garanties transverses */}
          {profile.kind === "lux" && (
            <div className="mt-4 pt-4 border-t border-line-soft">
              <p className="text-caption uppercase tracking-widest text-muted-2 font-semibold mb-2">Spécificités Luxembourg</p>
              <div className="flex flex-wrap gap-2">
                {profile.lux?.ticket && <LuxChip label="Ticket d'entrée" value={profile.lux.ticket} />}
                {profile.lux?.fid && <LuxChip label="Seuil FID" value={profile.lux.fid} />}
                {profile.lux?.fas && <LuxChip label="Seuil FAS" value={profile.lux.fas} />}
                {profile.lux?.plancher_uc && <LuxChip label="Frais UC plancher" value={profile.lux.plancher_uc} />}
              </div>
              <p className="text-caption text-muted-2 mt-2 max-w-[75ch]">
                Atouts transverses du Luxembourg&nbsp;: triangle de sécurité, super-privilège du souscripteur,
                neutralité fiscale (fiscalité du pays de résidence), multidevise, FID/FAS et crédit lombard.
              </p>
            </div>
          )}

          <p className="text-caption text-muted-2 mt-4">
            Repères assureur indicatifs (millésime 2025), à confirmer au contrat près.
          </p>
        </Card>
      )}

      {/* Conditions du contrat : T&C réelles si sourcées, sinon « à venir » (honnête) */}
      {o.terms ? (
        <TermsCard terms={o.terms} />
      ) : (
        <Card className="px-5 py-5">
          <h2 className="text-body-lg text-ink font-semibold">Conditions du contrat</h2>
          <p className="text-meta text-muted mt-1.5 max-w-[70ch]">
            Le contexte de l&apos;assureur et de l&apos;enveloppe figure ci-dessus. Les conditions propres à
            <em> ce </em> contrat ne sont pas encore renseignées dans notre base&nbsp;: nous affichons
            pour l&apos;instant les supports référencés et leurs caractéristiques. Le détail arrive prochainement.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {[
              "Frais de gestion réels",
              "Frais de versement",
              "Frais d'arbitrage",
              "Taux du fonds euros",
              "Options (gestion pilotée, garanties)",
            ].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5 text-caption text-muted-2 bg-paper-2 border border-line rounded-full px-2.5 py-1">
                {t}
                <span className="text-muted-2 italic">à venir</span>
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
          <BreakdownBars items={o.regions ?? []} />
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
