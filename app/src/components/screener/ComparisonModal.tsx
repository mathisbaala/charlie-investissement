"use client";

import React from "react";
import { X } from "@/components/ui/icons";
import { useSelection, SelectedFund } from "@/components/SelectionProvider";
import { pct, fmtAum } from "@/lib/format";

interface Row {
  label: string;
  key: keyof SelectedFund;
  format: (v: unknown) => string;
  best?: "high" | "low";
}

const ROWS: { section: string; rows: Row[] }[] = [
  {
    section: "Performance",
    rows: [
      { label: "Perf 1A", key: "performance_1y", format: (v) => pct(v as number, true), best: "high" },
      { label: "Perf 3A", key: "performance_3y", format: (v) => pct(v as number, true), best: "high" },
      { label: "Perf 5A", key: "performance_5y", format: (v) => pct(v as number, true), best: "high" },
    ],
  },
  {
    section: "Risque",
    rows: [
      { label: "Volatilité 1A", key: "volatility_1y", format: (v) => pct(v as number), best: "low" },
      { label: "Sharpe 1A",     key: "sharpe_1y",     format: (v) => v == null ? "—" : (v as number).toFixed(2), best: "high" },
      { label: "Max DD",        key: "max_drawdown_3y",format: (v) => pct(v as number), best: "high" },
    ],
  },
  {
    section: "Frais & taille",
    rows: [
      { label: "TER",           key: "ongoing_charges", format: (v) => pct(v as number), best: "low" },
      { label: "Encours",       key: "aum_eur",         format: (v) => fmtAum(v as number) },
      { label: "Track record",  key: "track_record_years", format: (v) => v == null ? "—" : `${v} ans` },
    ],
  },
  {
    section: "Classification",
    rows: [
      { label: "SFDR", key: "sfdr_article", format: (v) => v == null ? "—" : `Art. ${v}` },
      { label: "SRI",  key: "risk_score",   format: (v) => v == null ? "—" : `${v}/7` },
      { label: "Morningstar", key: "morningstar_rating", format: (v) => v == null ? "—" : "★".repeat(v as number) },
    ],
  },
];

interface ComparisonModalProps {
  onClose: () => void;
}

export function ComparisonModal({ onClose }: ComparisonModalProps) {
  const { selected } = useSelection();

  function getBest(row: Row, funds: SelectedFund[]): { best: string; worst: string } {
    if (!row.best) return { best: "", worst: "" };
    const vals = funds.map((f) => f[row.key] as number | null).filter((v): v is number => v != null);
    if (vals.length < 2) return { best: "", worst: "" };
    const sorted = [...vals].sort((a, b) => a - b);
    const bestVal  = row.best === "high" ? sorted[sorted.length - 1] : sorted[0];
    const worstVal = row.best === "high" ? sorted[0] : sorted[sorted.length - 1];
    return { best: String(bestVal), worst: String(worstVal) };
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="c-pop relative bg-paper border border-line rounded-xl w-full max-w-[1180px] max-h-[90vh] flex flex-col overflow-hidden shadow-[0_16px_48px_oklch(0.22_0.012_60_/_0.24)]">
        {/* Head */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
          <h2 className="text-[22px] text-ink" style={{ fontFamily: "var(--font-serif)" }}>
            Comparer{" "}
            <em className="text-accent not-italic">{selected.length} fonds<em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>.</em></em>
          </h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1 px-6 py-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left text-[10px] uppercase tracking-widest text-muted font-semibold pb-3 w-36">Métrique</th>
                {selected.map((f) => (
                  <th key={f.isin} className="text-left pb-3 px-3">
                    <div className="text-[13px] font-medium text-ink leading-tight truncate max-w-[200px]">{f.name}</div>
                    <div className="text-[11px] text-muted font-mono mt-0.5">{f.isin}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(({ section, rows }) => (
                <React.Fragment key={section}>
                  <tr>
                    <td colSpan={selected.length + 1} className="pt-5 pb-1.5">
                      <span className="text-[10px] uppercase tracking-widest text-muted font-semibold">{section}</span>
                    </td>
                  </tr>
                  {rows.map((row) => {
                    const { best, worst } = getBest(row, selected);
                    return (
                      <tr key={row.key} className="border-t border-line-soft">
                        <td className="py-2.5 pr-4 text-[12px] text-ink-2">{row.label}</td>
                        {selected.map((f) => {
                          const raw = f[row.key];
                          const str = String(raw ?? "");
                          const isBest  = best  && str === best;
                          const isWorst = worst && str === worst;
                          return (
                            <td
                              key={f.isin}
                              className={`py-2.5 px-3 text-[12px] font-mono ${
                                isBest  ? "text-ok bg-ok-soft/60 rounded" :
                                isWorst ? "text-warn bg-warn-soft/60 rounded" :
                                "text-ink"
                              }`}
                            >
                              {row.format(raw)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
