"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from "@/components/ui/icons";
import { Card } from "@/components/ui/Card";
import { decodeHtml, feeFracToPct } from "@/lib/format";
import {
  type ContractType, type Envelope,
  typesOf, inEnvelope, realContracts,
} from "@/lib/insurer-envelope";

// ─── Comparateur des contrats d'un assureur ──────────────────────────────────
// Reçoit tous les groupes de contrats de l'assureur (une ligne = un jeu de
// supports, variantes collapsées) et les met en regard : supports, frais moyens
// des supports, conditions du contrat si sourcées (frais d'entrée/gestion, fonds
// euros), SRI moyen. L'enveloppe reste l'axe de lecture (mêmes pills que la
// liste) et chaque ligne ouvre la fiche-contrat détaillée.

export type ComparisonContract = {
  company: string;                        // injecté côté page (ContractLike)
  key: string;
  contract: string;
  types: ContractType[];
  closed: boolean;
  variants: { contract: string; key: string }[];
  funds: number;
  avg_fee: number | null;                 // fraction (TER moyen des supports)
  sri_avg: number | null;
  top_class: string | null;
  frais_entree_pct: number | null;        // déjà en %
  frais_gestion_uc_pct: number | null;    // déjà en %
  fonds_euros_taux_pct: number | null;    // déjà en %
  fonds_euros_annee: number | null;
  gestion_sous_mandat: boolean | null;
};

const ENV_LABEL: Record<string, string> = {
  av: "Assurance vie", capi: "Capitalisation", per: "PER", pea: "PEA", pep: "PEP",
};
const contractHref = (key: string) => `/assureurs/contrat?key=${encodeURIComponent(key)}`;

// % « brut » (valeurs terms déjà en pourcentage) ; 0 est significatif (gratuit).
function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}
// TER moyen des supports (fraction en base → %).
function fmtFee(frac: number | null | undefined): string {
  const p = feeFracToPct(frac);
  return p == null ? "—" : `${p.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}
function fmtSri(v: number | null | undefined): string {
  return v == null ? "—" : `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} / 7`;
}

// Colonnes triables : clé d'accès + sens « meilleur » par défaut au 1er clic.
type SortCol = "funds" | "avg_fee" | "frais_entree_pct" | "frais_gestion_uc_pct" | "fonds_euros_taux_pct" | "sri_avg";
const COLS: { key: SortCol; label: string; get: (c: ComparisonContract) => number | null; firstDir: "asc" | "desc"; render: (c: ComparisonContract) => string }[] = [
  { key: "funds",                label: "Supports",       get: (c) => c.funds,                firstDir: "desc", render: (c) => c.funds.toLocaleString("fr-FR") },
  { key: "avg_fee",              label: "Frais supports", get: (c) => c.avg_fee,              firstDir: "asc",  render: (c) => fmtFee(c.avg_fee) },
  { key: "frais_entree_pct",     label: "Frais d'entrée", get: (c) => c.frais_entree_pct,     firstDir: "asc",  render: (c) => fmtPct(c.frais_entree_pct) },
  { key: "frais_gestion_uc_pct", label: "Gestion (UC)",   get: (c) => c.frais_gestion_uc_pct, firstDir: "asc",  render: (c) => fmtPct(c.frais_gestion_uc_pct) },
  { key: "fonds_euros_taux_pct", label: "Fonds euros",    get: (c) => c.fonds_euros_taux_pct, firstDir: "desc", render: (c) => c.fonds_euros_taux_pct == null ? "—" : `${fmtPct(c.fonds_euros_taux_pct)}${c.fonds_euros_annee ? ` (${c.fonds_euros_annee})` : ""}` },
  { key: "sri_avg",              label: "SRI moyen",      get: (c) => c.sri_avg,              firstDir: "asc",  render: (c) => fmtSri(c.sri_avg) },
];

// Badges d'enveloppe + statut, réutilisés entre la ligne desktop et la carte mobile.
function EnvBadges({ c }: { c: ComparisonContract }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {typesOf(c).map((t) => (
        <span key={t} className="text-caption uppercase tracking-wider font-semibold text-accent-ink bg-accent-soft border border-accent/20 rounded-full px-2 py-0.5">
          {ENV_LABEL[t] ?? t}
        </span>
      ))}
      {c.closed && <span className="text-caption text-muted-2 italic">fermé</span>}
    </span>
  );
}

export default function ContractComparison({
  contracts, company, initialEnv,
}: {
  contracts: ComparisonContract[];
  company: string;
  initialEnv: Envelope | "all";
}) {
  const [env, setEnv] = useState<Envelope | "all">(initialEnv);
  const [hideClosed, setHideClosed] = useState(false);
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" } | null>(null);

  // Contrats « réels » (on retire le cas Lux redondant : unique contrat nommé
  // comme l'assureur). C'est l'univers de la comparaison, avant filtre enveloppe.
  const real = useMemo(() => realContracts(contracts, company), [contracts, company]);

  // Enveloppes réellement présentes → pills proposées (toujours « Toutes »).
  const envsPresent = useMemo(() => {
    const set = new Set<Envelope>();
    for (const c of real) for (const t of typesOf(c)) {
      if (t === "av" || t === "capi" || t === "per" || t === "pea") set.add(t);
    }
    return (["av", "capi", "per", "pea"] as Envelope[]).filter((e) => set.has(e));
  }, [real]);

  const filtered = useMemo(() => {
    let list = env === "all" ? real : real.filter((c) => inEnvelope(c, env));
    if (hideClosed) list = list.filter((c) => !c.closed);

    if (sort) {
      const col = COLS.find((c) => c.key === sort.col)!;
      list = [...list].sort((a, b) => {
        const va = col.get(a), vb = col.get(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;          // nulls toujours en bas
        if (vb == null) return -1;
        return sort.dir === "asc" ? va - vb : vb - va;
      });
    } else {
      // Défaut : ouverts d'abord, puis nb de supports décroissant.
      list = [...list].sort((a, b) => Number(a.closed) - Number(b.closed) || b.funds - a.funds);
    }
    return list;
  }, [real, env, hideClosed, sort]);

  const toggleSort = (col: SortCol) => {
    setSort((prev) => {
      if (prev?.col !== col) return { col, dir: COLS.find((c) => c.key === col)!.firstDir };
      return { col, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sort?.col !== col) return <ArrowUpDown size={12} className="text-muted-2 opacity-50 group-hover:opacity-100" />;
    return sort.dir === "asc" ? <ArrowUp size={12} className="text-accent-ink" /> : <ArrowDown size={12} className="text-accent-ink" />;
  };

  const hasClosed = real.some((c) => c.closed);

  return (
    <div>
      {/* Filtres : enveloppe (axe de lecture) + statut commercial */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-4">
        <div role="tablist" aria-label="Enveloppe" className="flex flex-wrap gap-1.5">
          {(["all", ...envsPresent] as (Envelope | "all")[]).map((e) => {
            const on = e === env;
            return (
              <button
                key={e}
                role="tab"
                aria-selected={on}
                onClick={() => setEnv(e)}
                className={`px-3 py-1.5 rounded-full text-label font-medium border transition-colors min-h-[36px] ${
                  on ? "bg-accent text-paper border-accent" : "bg-paper text-muted border-line hover:text-ink-2 hover:border-accent/40"
                }`}
              >
                {e === "all" ? "Toutes" : ENV_LABEL[e]}
              </button>
            );
          })}
        </div>
        {hasClosed && (
          <label className="text-label text-muted flex items-center gap-2 cursor-pointer select-none ml-auto">
            <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} className="accent-accent w-4 h-4" />
            Masquer les contrats fermés
          </label>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card className="px-5 py-8 text-center">
          <p className="text-body text-muted">Aucun contrat à comparer dans cette enveloppe.</p>
        </Card>
      ) : (
        <>
          {/* ── Desktop : tableau comparatif trié ─────────────────────────────── */}
          <Card className="hidden md:block overflow-hidden p-0">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-caption uppercase tracking-widest text-muted-2 font-semibold px-4 py-3">Contrat</th>
                    {COLS.map((col) => (
                      <th key={col.key} className="px-4 py-3">
                        <button
                          onClick={() => toggleSort(col.key)}
                          className="group inline-flex items-center gap-1.5 text-caption uppercase tracking-widest text-muted-2 font-semibold hover:text-ink-2 transition-colors w-full justify-end"
                        >
                          {col.label}
                          <SortIcon col={col.key} />
                        </button>
                      </th>
                    ))}
                    <th className="w-8" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.key} className="border-b border-line-soft last:border-0 hover:bg-accent/[0.03] transition-colors group">
                      <td className="px-4 py-3 max-w-[320px]">
                        <Link href={contractHref(c.key)} className="block">
                          <span className="flex items-center gap-2.5">
                            <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.closed ? "border-[1.5px] border-muted-2" : "bg-ok"}`} />
                            <span className="text-body text-ink font-medium group-hover:text-accent-ink truncate">{decodeHtml(c.contract)}</span>
                          </span>
                          <span className="flex items-center gap-2 mt-1 pl-4">
                            <EnvBadges c={c} />
                          </span>
                        </Link>
                      </td>
                      {COLS.map((col) => (
                        <td key={col.key} className="px-4 py-3 text-right text-body text-ink-2 tabular-nums whitespace-nowrap">
                          {col.render(c)}
                        </td>
                      ))}
                      <td className="pr-3">
                        <Link href={contractHref(c.key)} aria-label={`Détail de ${c.contract}`} className="flex items-center justify-center">
                          <ChevronRight size={15} className="text-muted-2 group-hover:text-accent-ink" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Mobile : cartes empilées ──────────────────────────────────────── */}
          <div className="md:hidden flex flex-col gap-3">
            {filtered.map((c) => (
              <Link key={c.key} href={contractHref(c.key)} className="block">
                <Card className="px-4 py-4 hover:border-accent/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.closed ? "border-[1.5px] border-muted-2" : "bg-ok"}`} />
                      <span className="text-body-lg text-ink font-semibold truncate">{decodeHtml(c.contract)}</span>
                    </span>
                    <ChevronRight size={15} className="text-muted-2 shrink-0 mt-1" />
                  </div>
                  <div className="mt-2"><EnvBadges c={c} /></div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                    {COLS.map((col) => (
                      <div key={col.key} className="flex items-baseline justify-between gap-2">
                        <dt className="text-caption text-muted-2">{col.label}</dt>
                        <dd className="text-meta text-ink-2 font-medium tabular-nums">{col.render(c)}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
