"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight, ArrowUp, ArrowDown } from "@/components/ui/icons";
import { SfdrBadge, SriBadge } from "@/components/ui/Badge";
import { useSelection } from "@/components/SelectionProvider";
import { pct, fmtAumShort, decodeHtml } from "@/lib/format";
import type { Fund } from "@/lib/types";

interface FundTableProps {
  funds: Fund[];
  onRowClick?: (fund: Fund) => void;
  activeFundIsin?: string | null;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  onSort?: (field: string) => void;
}

function EligPill({ label, active }: { label: string; active: boolean | null }) {
  if (!active) return null;
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-caption font-medium bg-ok-soft text-ok">
      {label}
    </span>
  );
}

// Référencement assureur : « chez quel(s) assureur(s) le fonds est référencé ».
// Teinte neutre pour ne pas concurrencer les pills d'éligibilité (vertes).
function InsurerChips({ insurers, max = 3 }: { insurers: string[] | null; max?: number }) {
  const list = insurers ?? [];
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const extra = list.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {shown.map((c) => (
        <span
          key={c}
          className="inline-block px-1.5 py-0.5 rounded text-caption font-medium bg-paper-2 border border-line-soft text-muted"
        >
          {c}
        </span>
      ))}
      {extra > 0 && (
        <span title={list.join(" · ")} className="text-caption text-muted-2">+{extra}</span>
      )}
    </div>
  );
}

function SortTh({
  field, label, align = "right", sortBy, sortDir, onSort, children,
}: {
  field: string; label?: string; align?: "left" | "right" | "center";
  sortBy?: string; sortDir?: "asc" | "desc";
  onSort?: (f: string) => void;
  children?: React.ReactNode;
}) {
  const active = sortBy === field;
  const cls = `px-3 py-3 text-caption uppercase tracking-widest font-semibold whitespace-nowrap select-none ${
    onSort ? "cursor-pointer hover:text-ink transition-colors" : ""
  } ${active ? "text-ink" : "text-muted"} text-${align}`;

  return (
    <th className={cls} onClick={() => onSort?.(field)}>
      <span className="inline-flex items-center gap-1" style={{ justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start" }}>
        {children ?? label}
        {active && (
          sortDir === "asc"
            ? <ArrowUp size={9} className="text-accent" />
            : <ArrowDown size={9} className="text-accent" />
        )}
      </span>
    </th>
  );
}

export function FundTable({ funds, onRowClick, activeFundIsin, sortBy, sortDir, onSort }: FundTableProps) {
  const { toggle, isSelected } = useSelection();

  return (
    <>
    {/* ── Mobile : liste de cartes (le tableau déborderait sur un téléphone) ── */}
    <div className="md:hidden divide-y divide-line-soft">
      {funds.map((f) => (
        <Link
          key={f.isin}
          href={`/fonds/${f.isin}`}
          className="block p-3.5 bg-paper active:bg-cream transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-ink leading-tight">{decodeHtml(f.name)}</div>
              <div className="text-label text-muted font-mono mt-0.5 truncate">
                {f.isin} · {f.gestionnaire ?? "—"}
              </div>
              <InsurerChips insurers={f.insurers} />
            </div>
            <ChevronRight size={16} className="shrink-0 text-muted mt-0.5" />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5">
            <SfdrBadge article={f.sfdr_article} />
            <SriBadge sri={f.risk_score} />
            <span className="font-mono text-label text-muted">TER {pct(f.ongoing_charges ?? f.ter)}</span>
            <span className={`font-mono text-label font-medium ${
              f.performance_1y == null ? "text-muted" : f.performance_1y >= 0 ? "text-ok" : "text-danger"
            }`}>1A {pct(f.performance_1y, true)}</span>
            <span className={`font-mono text-label font-medium ${
              f.performance_3y == null ? "text-muted" : f.performance_3y >= 0 ? "text-ok" : "text-danger"
            }`}>3A {pct(f.performance_3y, true)}</span>
            {f.aum_eur != null && (
              <span className="font-mono text-label text-muted">{fmtAumShort(f.aum_eur)}</span>
            )}
          </div>

          <div className="flex gap-1 flex-wrap mt-2">
            <EligPill label="PEA"     active={f.pea_eligible} />
            <EligPill label="PEA-PME" active={f.pea_pme_eligible ?? null} />
            <EligPill label="PER"     active={f.per_eligible} />
            <EligPill label="CTO"     active={f.cto_eligible ?? null} />
            <EligPill label="AV FR"   active={f.av_fr_eligible ?? null} />
            <EligPill label="AV Lux"  active={f.av_lux_eligible} />
          </div>
        </Link>
      ))}
    </div>

    {/* ── Desktop : tableau complet ── */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-meta border-collapse min-w-[900px]">
        <thead>
          <tr className="border-b border-line">
            <th className="w-8 px-3 py-3 whitespace-nowrap" />
            <th className="text-left px-3 py-3 text-caption uppercase tracking-widest text-muted font-semibold whitespace-nowrap">Fonds</th>
            <th className="px-3 py-3 text-caption uppercase tracking-widest text-muted font-semibold text-center whitespace-nowrap">SFDR</th>
            <th className="px-3 py-3 text-caption uppercase tracking-widest text-muted font-semibold text-center whitespace-nowrap">SRI</th>
            <SortTh field="ter" label="TER" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortTh field="performance_1y" label="Perf 1A" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortTh field="performance_3y" label="Perf 3A" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortTh field="volatility_1y" label="Vol 1A" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortTh field="aum_eur" label="Encours" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <th className="px-3 py-3 text-caption uppercase tracking-widest text-muted font-semibold whitespace-nowrap">Enveloppes</th>
            <th className="w-8 whitespace-nowrap" />
          </tr>
        </thead>
        <tbody>
          {funds.map((f) => {
            const sel = isSelected(f.isin);
            const active = f.isin === activeFundIsin;
            return (
              <tr
                key={f.isin}
                onClick={() => onRowClick?.(f)}
                className={`border-b border-dashed border-line-soft cursor-pointer transition-colors ${
                  active
                    ? "bg-accent-soft/40"
                    : sel
                    ? "bg-ok-soft/20"
                    : "bg-paper hover:bg-cream"
                }`}
              >
                {/* Checkbox */}
                <td className="px-3 py-3 relative" onClick={(e) => e.stopPropagation()}>
                  {active && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent rounded-r pointer-events-none" />
                  )}
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => toggle({
                      isin: f.isin,
                      name: f.name,
                      gestionnaire: f.gestionnaire ?? null,
                      sfdr_article: f.sfdr_article ?? null,
                      risk_score: f.risk_score ?? null,
                      performance_1y: f.performance_1y ?? null,
                      performance_3y: f.performance_3y ?? null,
                      performance_5y: f.performance_5y ?? null,
                      ongoing_charges: f.ongoing_charges ?? f.ter ?? null,
                      volatility_1y: f.volatility_1y ?? null,
                      sharpe_1y: f.sharpe_1y ?? null,
                      max_drawdown_3y: f.max_drawdown_3y ?? null,
                      morningstar_rating: f.morningstar_rating ?? null,
                      track_record_years: f.track_record_years ?? null,
                      aum_eur: f.aum_eur ?? null,
                      retrocession_cgp: f.retrocession_cgp ?? null,
                      pea_eligible: f.pea_eligible ?? null,
                      pea_pme_eligible: f.pea_pme_eligible ?? null,
                      per_eligible: f.per_eligible ?? null,
                      av_fr_eligible: f.av_fr_eligible ?? null,
                      av_lux_eligible: f.av_lux_eligible ?? null,
                      cto_eligible: f.cto_eligible ?? null,
                    })}
                    className="w-3.5 h-3.5 rounded border-line accent-brown cursor-pointer"
                  />
                </td>

                {/* Fonds */}
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-ink leading-tight truncate max-w-[250px]">{decodeHtml(f.name)}</div>
                    {f.data_completeness < 70 && (
                      <span
                        title={`Complétude : ${f.data_completeness}%`}
                        className="shrink-0 w-1.5 h-1.5 rounded-full bg-warn/50"
                      />
                    )}
                  </div>
                  <div className="text-label text-muted font-mono mt-0.5">
                    {f.isin} · {f.gestionnaire ?? "—"}
                  </div>
                  <InsurerChips insurers={f.insurers} />
                </td>

                <td className="px-3 py-3 text-center"><SfdrBadge article={f.sfdr_article} /></td>
                <td className="px-3 py-3 text-center"><SriBadge sri={f.risk_score} /></td>

                <td className="px-3 py-3 text-right font-mono text-ink-2 whitespace-nowrap">
                  {pct(f.ongoing_charges ?? f.ter)}
                </td>
                <td className={`px-3 py-3 text-right font-mono font-medium whitespace-nowrap ${
                  f.performance_1y == null ? "text-muted" :
                  f.performance_1y >= 0 ? "text-ok" : "text-danger"
                }`}>
                  {pct(f.performance_1y, true)}
                </td>
                <td className={`px-3 py-3 text-right font-mono font-medium whitespace-nowrap ${
                  f.performance_3y == null ? "text-muted" :
                  f.performance_3y >= 0 ? "text-ok" : "text-danger"
                }`}>
                  {pct(f.performance_3y, true)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-ink-2 whitespace-nowrap">
                  {pct(f.volatility_1y)}
                </td>

                <td className="px-3 py-3 text-right font-mono text-ink-2 whitespace-nowrap text-label">
                  {fmtAumShort(f.aum_eur)}
                </td>

                <td className="px-3 py-3">
                  <div className="flex gap-1 flex-wrap">
                    <EligPill label="PEA"      active={f.pea_eligible} />
                    <EligPill label="PEA-PME"  active={f.pea_pme_eligible ?? null} />
                    <EligPill label="PER"      active={f.per_eligible} />
                    <EligPill label="CTO"      active={f.cto_eligible ?? null} />
                    <EligPill label="AV FR"    active={f.av_fr_eligible ?? null} />
                    <EligPill label="AV Lux"   active={f.av_lux_eligible} />
                  </div>
                </td>

                <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <Link href={`/fonds/${f.isin}`} className="text-muted hover:text-ink transition-colors">
                    <ChevronRight size={15} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
