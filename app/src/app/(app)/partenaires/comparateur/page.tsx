import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { decodeHtml, feeFracToPct, groupeName } from "@/lib/format";
import { contractTotalCost } from "@/lib/av-cost";
import type { ContractType } from "@/lib/insurer-envelope";
import { PageShell } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { ArrowLeft, ChevronRight, X, Shield } from "@/components/ui/icons";
import { InsurerLogo } from "@/components/ui/InsurerLogo";
import { EmptyState } from "@/components/ui/EmptyState";
import { ComparatorSync } from "./ComparatorSync";

// ─── Comparateur TRANSVERSAL de contrats (rendu serveur) ─────────────────────
// Met côte à côte 2 à 4 contrats de N'IMPORTE quels assureurs, choisis depuis les
// fiches assureur (panier → barre flottante → cette page). Piloté par l'URL
// (?key=…&key=…) donc PARTAGEABLE. Les attributs sont en lignes, les contrats en
// colonnes ; le coût total de détention (supports + gestion contrat) est la ligne
// mise en avant. Aucune donnée inventée : « — » quand la valeur n'est pas sourcée.

const COMPARE_MAX = 4;

type Row = {
  company: string;
  key: string;
  contract: string;
  types: ContractType[];
  closed: boolean;
  funds: number;
  avg_fee: number | null;
  sri_avg: number | null;
  top_class: string | null;
  frais_entree_pct: number | null;
  frais_gestion_uc_pct: number | null;
  frais_arbitrage_pct: number | null;
  frais_arbitrage_note: string | null;
  fonds_euros_taux_pct: number | null;
  fonds_euros_annee: number | null;
  gestion_sous_mandat: boolean | null;
  ticket_entree: string | null;
  terms_confidence: "scraped" | "curated" | "indicative" | null;
  insurer_kind: "fr" | "lux" | null;
  insurer_groupe: string | null;
  insurer_solvabilite_2_pct: number | null;
  insurer_notation: string | null;
  insurer_notation_agence: string | null;
  insurer_ppb_pct: number | null;
};

const ENV_LABEL: Record<string, string> = {
  av: "Assurance vie", capi: "Capitalisation", per: "PER", pea: "PEA", pep: "PEP",
};
const CLASS_LABEL: Record<string, string> = {
  action: "Actions", obligation: "Obligations", diversifie: "Diversifiés",
  monetaire: "Monétaire", immobilier: "Immobilier", "non_coté": "Non coté",
  structure: "Produits structurés", matieres_premieres: "Matières premières",
};

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}
function fmtFee(frac: number | null | undefined): string {
  const p = feeFracToPct(frac);
  return p == null ? "—" : `${p.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

// href de la page sans le contrat d'index i (retrait de colonne), ou vers la
// liste si plus rien ne reste.
function hrefWithout(keys: string[], i: number): string {
  const rest = keys.filter((_, j) => j !== i);
  if (rest.length === 0) return "/partenaires";
  return "/partenaires/comparateur?" + rest.map((k) => `key=${encodeURIComponent(k)}`).join("&");
}

export default async function ComparateurPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string | string[] }>;
}) {
  const { key } = await searchParams;
  const rawKeys = (Array.isArray(key) ? key : key ? [key] : [])
    .filter((k) => k && k.includes("::"));
  // Dédup en préservant l'ordre de sélection, plafonné à 4.
  const keys = [...new Set(rawKeys)].slice(0, COMPARE_MAX);

  if (keys.length === 0) {
    return (
      <PageShell className="space-y-5">
        <Link href="/partenaires" className="inline-flex items-center gap-1.5 text-label text-muted hover:text-ink-2 transition-colors">
          <ArrowLeft size={12} /> Tous les partenaires
        </Link>
        <div className="flex h-48">
          <EmptyState
            icon={<Shield size={16} />}
            title="Aucun contrat à comparer."
            hint="Ouvrez un partenaire, ajoutez des contrats avec + puis revenez ici."
          />
        </div>
      </PageShell>
    );
  }

  const { data, error } = await supabase.rpc("get_contracts_comparison", { p_keys: keys });
  const rows = (data as Row[] | null) ?? [];

  // Réordonne selon l'ordre de sélection de l'URL (la RPC trie par statut/supports).
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const ordered = keys.map((k) => byKey.get(k)).filter((r): r is Row => r != null);

  if (error || ordered.length === 0) {
    return (
      <PageShell className="space-y-5">
        <Link href="/partenaires" className="inline-flex items-center gap-1.5 text-label text-muted hover:text-ink-2 transition-colors">
          <ArrowLeft size={12} /> Tous les partenaires
        </Link>
        <div className="flex h-48">
          <EmptyState
            icon={<Shield size={16} />}
            title="Impossible de charger la comparaison."
            hint="Les contrats sélectionnés sont peut-être introuvables. Réessayez depuis un partenaire."
          />
        </div>
      </PageShell>
    );
  }

  // Lignes d'attributs : label + rendu par contrat. `emphasis` = ligne saillante
  // (coût total). `section` ouvre un groupe (assureur).
  const rowsDef: { label: string; sub?: string; emphasis?: boolean; section?: string; render: (r: Row) => React.ReactNode }[] = [
    { label: "Enveloppe", render: (r) => (
      <span className="inline-flex flex-wrap gap-1">
        {(r.types ?? ["av"]).map((t) => (
          <span key={t} className="text-caption uppercase tracking-wider font-semibold text-accent-ink bg-accent-soft border border-accent/20 rounded-full px-2 py-0.5">{ENV_LABEL[t] ?? t}</span>
        ))}
      </span>
    ) },
    { label: "Statut", render: (r) => r.closed
      ? <span className="text-meta text-muted-2">Fermé</span>
      : <span className="text-meta text-ok">Ouvert</span> },
    { label: "Supports (UC)", render: (r) => <span className="tabular-nums">{r.funds.toLocaleString("fr-FR")}</span> },
    { label: "Coût total estimé", sub: "supports + gestion contrat", emphasis: true, render: (r) => {
      const cost = contractTotalCost(r.avg_fee, r.frais_gestion_uc_pct, r.types);
      if (cost.total == null) return "—";
      return <span className="tabular-nums">{`${cost.contractSourced ? "" : "~ "}${cost.total.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`}</span>;
    } },
    { label: "Frais moyens des supports", render: (r) => <span className="tabular-nums">{fmtFee(r.avg_fee)}</span> },
    { label: "Frais de gestion (UC)", render: (r) => <span className="tabular-nums">{fmtPct(r.frais_gestion_uc_pct)}</span> },
    { label: "Frais d'entrée (max)", render: (r) => <span className="tabular-nums">{fmtPct(r.frais_entree_pct)}</span> },
    { label: "Frais d'arbitrage", render: (r) => <span className="tabular-nums">{r.frais_arbitrage_pct != null ? fmtPct(r.frais_arbitrage_pct) : (r.frais_arbitrage_note ?? "—")}</span> },
    { label: "Fonds euros (dernier taux)", render: (r) => r.fonds_euros_taux_pct != null
      ? <span className="tabular-nums">{`${fmtPct(r.fonds_euros_taux_pct)}${r.fonds_euros_annee ? ` (${r.fonds_euros_annee})` : ""}`}</span>
      : "—" },
    { label: "SRI moyen", render: (r) => r.sri_avg != null ? <span className="tabular-nums">{`${Number(r.sri_avg).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} / 7`}</span> : "—" },
    { label: "Classe dominante", render: (r) => r.top_class ? (CLASS_LABEL[r.top_class] ?? r.top_class) : "—" },
    { label: "Gestion sous mandat", render: (r) => r.gestion_sous_mandat == null ? "—" : r.gestion_sous_mandat ? "Disponible" : "Non" },
    { label: "Ticket d'entrée", render: (r) => r.ticket_entree ?? "—" },
    // ── Solidité de l'assureur ──
    { label: "Solvabilité II", section: "L'assureur", render: (r) => r.insurer_solvabilite_2_pct != null ? <span className="tabular-nums">{`${Number(r.insurer_solvabilite_2_pct).toLocaleString("fr-FR")} %`}</span> : "—" },
    { label: "Notation", render: (r) => r.insurer_notation
      ? <span>{r.insurer_notation}{r.insurer_notation_agence ? <span className="text-caption text-muted-2"> · {r.insurer_notation_agence}</span> : null}</span>
      : "—" },
    { label: "PPB", sub: "réserve de rendement", render: (r) => r.insurer_ppb_pct != null ? <span className="tabular-nums">{`${Number(r.insurer_ppb_pct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`}</span> : "—" },
    { label: "Groupe", render: (r) => r.insurer_groupe ? groupeName(r.insurer_groupe) : "—" },
  ];

  const gridCols = `minmax(150px, 1.1fr) repeat(${ordered.length}, minmax(150px, 1fr))`;

  return (
    <PageShell className="space-y-5">
      <ComparatorSync items={ordered.map((r) => ({ key: r.key, company: r.company, contract: r.contract }))} />

      <Link href="/partenaires" className="inline-flex items-center gap-1.5 text-label text-muted hover:text-ink-2 transition-colors">
        <ArrowLeft size={12} /> Tous les partenaires
      </Link>

      <div>
        <h1 className="text-display leading-[1.2] text-ink font-medium" style={{ fontFamily: "var(--font-sans)" }}>
          Comparateur de contrats
        </h1>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[560px]">
            {/* En-tête : une colonne par contrat (logo, nom, assureur, retrait) */}
            <div className="grid border-b border-line" style={{ gridTemplateColumns: gridCols }}>
              <div className="px-4 py-4" />
              {ordered.map((r, i) => (
                <div key={r.key} className="px-4 py-4 border-l border-line-soft">
                  <div className="flex items-start justify-between gap-2">
                    <InsurerLogo company={r.company} size={32} className="rounded-lg" />
                    <Link href={hrefWithout(keys, i)} aria-label={`Retirer ${r.contract}`} className="text-muted-2 hover:text-ink transition-colors" prefetch={false}>
                      <X size={14} />
                    </Link>
                  </div>
                  <Link href={`/partenaires/contrat?key=${encodeURIComponent(r.key)}`} className="group block mt-2">
                    <p className="text-body text-ink font-semibold leading-tight group-hover:text-accent-ink">{decodeHtml(r.contract)}</p>
                    <p className="text-caption text-muted truncate mt-0.5">{decodeHtml(r.company)}</p>
                  </Link>
                </div>
              ))}
            </div>

            {/* Lignes d'attributs */}
            {rowsDef.map((row) => (
              <div key={row.label}>
                {row.section && (
                  <div className="grid border-t border-line bg-paper-2/60" style={{ gridTemplateColumns: gridCols }}>
                    <div className="px-4 py-2 text-caption uppercase tracking-widest text-muted-2 font-semibold" style={{ gridColumn: `1 / span ${ordered.length + 1}` }}>
                      {row.section}
                    </div>
                  </div>
                )}
                <div className={`grid border-t border-line-soft ${row.emphasis ? "bg-accent/[0.04]" : ""}`} style={{ gridTemplateColumns: gridCols }}>
                  <div className="px-4 py-3">
                    <span className={`text-meta ${row.emphasis ? "text-ink font-semibold" : "text-muted"}`}>{row.label}</span>
                    {row.sub && <span className="block text-caption text-muted-2">{row.sub}</span>}
                  </div>
                  {ordered.map((r) => (
                    <div key={r.key} className={`px-4 py-3 border-l border-line-soft text-body ${row.emphasis ? "text-ink font-semibold" : "text-ink-2"}`}>
                      {row.render(r)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {ordered.length < COMPARE_MAX && (
        <Link href="/partenaires" className="inline-flex items-center gap-1.5 text-label font-medium text-accent hover:underline">
          Ajouter un autre contrat
          <ChevronRight size={14} />
        </Link>
      )}

    </PageShell>
  );
}
