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
      { label: "Volatilité 1A", key: "volatility_1y",    format: (v) => pct(v as number),  best: "low" },
      { label: "Sharpe 1A",     key: "sharpe_1y",        format: (v) => v == null ? "—" : (v as number).toFixed(2), best: "high" },
      { label: "Max DD 3A",     key: "max_drawdown_3y",  format: (v) => pct(v as number),  best: "high" },
    ],
  },
  {
    section: "Frais & taille",
    rows: [
      { label: "TER",          key: "ongoing_charges",    format: (v) => pct(v as number), best: "low" },
      { label: "Encours",      key: "aum_eur",            format: (v) => fmtAum(v as number) },
      { label: "Track record", key: "track_record_years", format: (v) => v == null ? "—" : `${v} ans` },
    ],
  },
  {
    section: "Classification",
    rows: [
      { label: "SFDR",        key: "sfdr_article",       format: (v) => v == null ? "—" : `Art. ${v}` },
      { label: "SRI",         key: "risk_score",         format: (v) => v == null ? "—" : `${v}/7` },
      { label: "Morningstar", key: "morningstar_rating", format: (v) => v == null ? "—" : "★".repeat(v as number) },
    ],
  },
];

function getBestWorstIdx(row: Row, funds: SelectedFund[]): { bestIdx: number; worstIdx: number } {
  if (!row.best) return { bestIdx: -1, worstIdx: -1 };
  const indexed = funds
    .map((f, i) => ({ val: f[row.key] as number | null, i }))
    .filter((x): x is { val: number; i: number } => x.val != null);
  if (indexed.length < 2) return { bestIdx: -1, worstIdx: -1 };
  const sorted = [...indexed].sort((a, b) => a.val - b.val);
  const bestIdx  = row.best === "high" ? sorted[sorted.length - 1].i : sorted[0].i;
  const worstIdx = row.best === "high" ? sorted[0].i : sorted[sorted.length - 1].i;
  return { bestIdx, worstIdx };
}

interface ComparisonModalProps {
  onClose: () => void;
}

export function ComparisonModal({ onClose }: ComparisonModalProps) {
  const { selected } = useSelection();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="c-pop relative bg-cream border border-line rounded-xl w-full max-w-[1180px] max-h-[90vh] flex flex-col overflow-hidden shadow-[0_16px_48px_oklch(0.22_0.012_60_/_0.24)]">

        {/* Head */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
          <h2 className="text-[22px] text-ink" style={{ fontFamily: "var(--font-serif)" }}>
            Comparer{" "}
            <em className="text-accent" style={{ fontStyle: "italic" }}>
              {selected.length} fonds.
            </em>
          </h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full border-collapse">
            {/* Fund name headers */}
            <thead>
              <tr className="border-b border-line">
                <th className="w-40 px-6 py-4" />
                {selected.map((f) => (
                  <th key={f.isin} className="text-left px-4 py-4 align-bottom">
                    <p
                      className="text-[15px] font-medium text-ink leading-tight"
                      style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
                    >
                      {f.name}
                    </p>
                    <p className="text-[10px] text-muted font-mono uppercase tracking-wider mt-1">
                      {f.isin}{f.gestionnaire ? ` · ${f.gestionnaire}` : ""}
                    </p>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {ROWS.map(({ section, rows }) => (
                <React.Fragment key={section}>
                  {/* Section header */}
                  <tr>
                    <td
                      colSpan={selected.length + 1}
                      className="px-6 pt-5 pb-2"
                    >
                      <span className="text-[10px] uppercase tracking-[0.1em] text-muted font-semibold">
                        {section}
                      </span>
                    </td>
                  </tr>

                  {/* Data rows */}
                  {rows.map((row) => {
                    const { bestIdx, worstIdx } = getBestWorstIdx(row, selected);
                    return (
                      <tr key={row.key} className="border-b border-dashed border-line-soft">
                        {/* Label */}
                        <td className="px-6 py-3 text-[12px] text-ink-2 w-40 shrink-0">
                          {row.label}
                        </td>

                        {/* Fund values */}
                        {selected.map((f, idx) => {
                          const raw = f[row.key];
                          const isBest  = idx === bestIdx;
                          const isWorst = idx === worstIdx;
                          return (
                            <td
                              key={f.isin}
                              className={`px-4 py-3 text-[13px] font-mono font-medium ${
                                isBest
                                  ? "bg-ok-soft text-ok"
                                  : isWorst
                                  ? "bg-warn-soft text-warn"
                                  : "text-ink-2"
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
