"use client";

import React, { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import { X } from "@/components/ui/icons";
import { useSelection, SelectedFund } from "@/components/SelectionProvider";
import { pct, fmtAum } from "@/lib/format";

interface Row {
  label: string;
  key: keyof SelectedFund;
  format: (v: unknown) => string;
  best?: "high" | "low";
  bool?: true;
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
      { label: "TER",           key: "ongoing_charges",    format: (v) => pct(v as number), best: "low" },
      { label: "Rétrocession",  key: "retrocession_cgp",   format: (v) => v == null ? "—" : pct((v as number) * 100), best: "high" },
      { label: "Encours",       key: "aum_eur",            format: (v) => fmtAum(v as number) },
      { label: "Track record",  key: "track_record_years", format: (v) => v == null ? "—" : `${v} ans` },
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
  {
    section: "Éligibilités",
    rows: [
      { label: "PEA",         key: "pea_eligible",     format: (v) => v == null ? "—" : v ? "✓" : "×", bool: true },
      { label: "PEA-PME",     key: "pea_pme_eligible", format: (v) => v == null ? "—" : v ? "✓" : "×", bool: true },
      { label: "PER",         key: "per_eligible",     format: (v) => v == null ? "—" : v ? "✓" : "×", bool: true },
      { label: "AV France",   key: "av_fr_eligible",   format: (v) => v == null ? "—" : v ? "✓" : "×", bool: true },
      { label: "AV Lux.",     key: "av_lux_eligible",  format: (v) => v == null ? "—" : v ? "✓" : "×", bool: true },
      { label: "CTO",         key: "cto_eligible",     format: (v) => v == null ? "—" : v ? "✓" : "×", bool: true },
    ],
  },
];

const FUND_COLORS = ["#6b4a2e", "#2d7d5a", "#b97c2a", "#3d5a8a"];

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

// ─── NAV chart ────────────────────────────────────────────────────────────────

interface NavPoint { nav_date: string; nav_value: number }

type ChartRow = Record<string, string | number | null>;

function shortenName(name: string, maxLen = 24): string {
  return name.length > maxLen ? name.slice(0, maxLen - 1) + "…" : name;
}

async function fetchNav(isin: string): Promise<NavPoint[]> {
  const from = new Date();
  from.setFullYear(from.getFullYear() - 3);
  const fromStr = from.toISOString().split("T")[0];
  const res = await fetch(`/api/fonds/${isin}/nav?from=${fromStr}&limit=1000`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data ?? []) as NavPoint[];
}

function buildChartData(navs: Record<string, NavPoint[]>, funds: SelectedFund[]): ChartRow[] {
  const allDates = Array.from(
    new Set(funds.flatMap((f) => (navs[f.isin] ?? []).map((p) => p.nav_date)))
  ).sort();

  return allDates.map((date) => {
    const row: ChartRow = { date };
    funds.forEach((f, i) => {
      const pts = navs[f.isin] ?? [];
      const base = pts[0]?.nav_value;
      const pt = pts.find((p) => p.nav_date === date);
      row[`f${i}`] = base && pt ? Math.round(((pt.nav_value / base) * 100) * 100) / 100 : null;
    });
    return row;
  });
}

function NavChart({ funds }: { funds: SelectedFund[] }) {
  const [navs, setNavs] = useState<Record<string, NavPoint[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(funds.map((f) => fetchNav(f.isin).then((pts) => [f.isin, pts] as const)))
      .then((entries) => {
        if (!cancelled) {
          setNavs(Object.fromEntries(entries));
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [funds.map((f) => f.isin).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasData = funds.some((f) => (navs[f.isin] ?? []).length > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[220px] text-muted">
        <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-[220px] text-meta text-muted italic">
        Historique de valeur liquidative indisponible pour ces fonds.
      </div>
    );
  }

  const chartData = buildChartData(navs, funds);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e0d5" />
        <XAxis
          dataKey="date"
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
          }}
          tick={{ fontSize: 10, fill: "#9b8f84" }}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={60}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#9b8f84" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}`}
          domain={["auto", "auto"]}
          width={40}
        />
        <Tooltip
          formatter={(value: unknown, name: unknown) => [
            typeof value === "number" ? `${value.toFixed(1)}` : "—",
            String(name),
          ]}
          labelFormatter={(label: unknown) => {
            const d = new Date(String(label));
            return isNaN(d.getTime()) ? String(label) : d.toLocaleDateString("fr-FR");
          }}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e8e0d5" }}
        />
        <Legend
          formatter={(value: string) => <span style={{ fontSize: 11 }}>{value}</span>}
        />
        {funds.map((f, i) => (
          (navs[f.isin] ?? []).length > 0 && (
            <Line
              key={f.isin}
              type="monotone"
              dataKey={`f${i}`}
              name={shortenName(f.name)}
              stroke={FUND_COLORS[i]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

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
          <h2 className="text-title-lg text-ink" style={{ fontFamily: "var(--font-serif)" }}>
            Comparer{" "}
            <em className="text-accent" style={{ fontStyle: "italic" }}>
              {selected.length} fonds.
            </em>
          </h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-auto flex-1">

          {/* NAV chart */}
          <div className="px-6 pt-5 pb-3">
            <p className="text-caption uppercase tracking-[0.1em] text-muted font-semibold mb-3">
              Performance relative · base 100 · 3 ans
            </p>
            <NavChart funds={selected} />
          </div>

          <div className="border-t border-dashed border-line-soft mx-6" />

          {/* Comparison table */}
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="w-40 px-6 py-4" />
                {selected.map((f, i) => (
                  <th key={f.isin} className="text-left px-4 py-4 align-bottom">
                    <div
                      className="w-3 h-3 rounded-full mb-1.5"
                      style={{ backgroundColor: FUND_COLORS[i] }}
                    />
                    <p
                      className="text-body-lg font-medium text-ink leading-tight"
                      style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
                    >
                      {f.name}
                    </p>
                    <p className="text-caption text-muted font-mono uppercase tracking-wider mt-1">
                      {f.isin}{f.gestionnaire ? ` · ${f.gestionnaire}` : ""}
                    </p>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {ROWS.map(({ section, rows }) => (
                <React.Fragment key={section}>
                  <tr>
                    <td colSpan={selected.length + 1} className="px-6 pt-5 pb-2">
                      <span className="text-caption uppercase tracking-[0.1em] text-muted font-semibold">
                        {section}
                      </span>
                    </td>
                  </tr>
                  {rows.map((row) => {
                    const { bestIdx, worstIdx } = getBestWorstIdx(row, selected);
                    return (
                      <tr key={row.key} className="border-b border-dashed border-line-soft">
                        <td className="px-6 py-3 text-meta text-ink-2 w-40 shrink-0">
                          {row.label}
                        </td>
                        {selected.map((f, idx) => {
                          const raw = f[row.key];
                          const isBest  = idx === bestIdx;
                          const isWorst = idx === worstIdx;
                          const isTrue  = row.bool && raw === true;
                          const isFalse = row.bool && raw === false;
                          return (
                            <td
                              key={f.isin}
                              className={`px-4 py-3 text-body font-mono font-medium ${
                                isTrue
                                  ? "text-ok"
                                  : isFalse
                                  ? "text-muted-2"
                                  : isBest
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
