"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight } from "@/components/ui/icons";
import { SfdrBadge, SriBadge } from "@/components/ui/Badge";
import { useSelection } from "@/components/SelectionProvider";
import { pct, decodeHtml } from "@/lib/format";
import type { Fund } from "@/lib/types";

interface FundTableProps {
  funds: Fund[];
  onRowClick?: (fund: Fund) => void;
  activeFundIsin?: string | null;
}

function EligPill({ label, active }: { label: string; active: boolean | null }) {
  if (!active) return null;
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-ok-soft text-ok">
      {label}
    </span>
  );
}

export function FundTable({ funds, onRowClick, activeFundIsin }: FundTableProps) {
  const { toggle, isSelected } = useSelection();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px] border-collapse min-w-[900px]">
        <thead>
          <tr className="border-b border-line">
            <th className="w-8 px-3 py-3 whitespace-nowrap" />
            <th className="text-left px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold whitespace-nowrap">Fonds</th>
            <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-center whitespace-nowrap">SFDR</th>
            <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-center whitespace-nowrap">SRI</th>
            <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-right whitespace-nowrap">TER</th>
            <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-right whitespace-nowrap">Perf 1A</th>
            <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-right whitespace-nowrap">Perf 3A</th>
            <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-right whitespace-nowrap">Vol 1A</th>
            <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold text-right whitespace-nowrap">Rétro.</th>
            <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-muted font-semibold whitespace-nowrap">Enveloppes</th>
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
                {/* Checkbox — stripe is inside this td to avoid ghost column */}
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
                  <div className="text-[11px] text-muted font-mono mt-0.5">
                    {f.isin} · {f.gestionnaire ?? "—"}
                  </div>
                </td>

                <td className="px-3 py-3 text-center"><SfdrBadge article={f.sfdr_article} /></td>
                <td className="px-3 py-3 text-center"><SriBadge sri={f.risk_score} /></td>

                <td className="px-3 py-3 text-right font-mono text-ink-2 whitespace-nowrap">
                  {pct(f.ongoing_charges ?? f.ter)}
                </td>
                <td className={`px-3 py-3 text-right font-mono font-medium whitespace-nowrap ${
                  f.performance_1y == null ? "text-muted" :
                  f.performance_1y >= 0 ? "text-ok" : "text-warn"
                }`}>
                  {pct(f.performance_1y, true)}
                </td>
                <td className={`px-3 py-3 text-right font-mono font-medium whitespace-nowrap ${
                  f.performance_3y == null ? "text-muted" :
                  f.performance_3y >= 0 ? "text-ok" : "text-warn"
                }`}>
                  {pct(f.performance_3y, true)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-ink-2 whitespace-nowrap">
                  {pct(f.volatility_1y)}
                </td>
                <td className={`px-3 py-3 text-right font-mono whitespace-nowrap font-medium ${
                  f.retrocession_cgp == null ? "text-muted-2" : "text-accent"
                }`}>
                  {f.retrocession_cgp == null ? "—" : pct(f.retrocession_cgp * 100)}
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
  );
}
