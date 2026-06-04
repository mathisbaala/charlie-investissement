"use client";

import { useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";
import type { NavPointHF } from "@/lib/types";

const PERIODS = [
  { label: "1A",  months: 12 },
  { label: "3A",  months: 36 },
  { label: "5A",  months: 60 },
  { label: "Max", months: 9999 },
];

interface NavChartProps {
  data: NavPointHF[];
}

function filterByPeriod(data: NavPointHF[], months: number): NavPointHF[] {
  if (months === 9999 || !data.length) return data;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return data.filter((d) => new Date(d.date) >= cutoff);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}`;
}

function formatPct(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}

// Custom tooltip
function CustomTooltip({ active, payload, label, mode }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  mode: "vl" | "base100";
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div className="bg-paper border border-line rounded-lg px-3 py-2 shadow-sm text-[11px] font-mono">
      <p className="text-muted mb-0.5">{label ? new Date(label).toLocaleDateString("fr-FR") : ""}</p>
      <p className="text-ink font-medium">
        {mode === "base100"
          ? `${val.toFixed(1)} (${formatPct(val - 100)})`
          : val.toFixed(4)}
      </p>
    </div>
  );
}

export function NavChart({ data }: NavChartProps) {
  const [period, setPeriod] = useState<string>("3A");
  const [mode, setMode] = useState<"vl" | "base100">("base100");

  const selectedPeriod = PERIODS.find((p) => p.label === period) ?? PERIODS[1];
  const filtered = useMemo(() => filterByPeriod(data, selectedPeriod.months), [data, selectedPeriod.months]);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-muted text-sm">
        Données historiques non disponibles
      </div>
    );
  }

  const step = Math.max(1, Math.floor(filtered.length / 200));
  const sampled = filtered.filter((_, i) => i % step === 0);

  const base = sampled[0]?.nav ?? 1;
  const last = sampled[sampled.length - 1]?.nav ?? base;
  const perfTotal = ((last - base) / base) * 100;
  const perfPositive = perfTotal >= 0;

  const chartData = sampled.map((p) => ({
    date: p.date,
    nav: p.nav,
    indexed: parseFloat(((p.nav / base) * 100).toFixed(2)),
  }));

  const dataKey = mode === "vl" ? "nav" : "indexed";
  const lineColor = perfPositive ? "#16a34a" : "#dc2626";
  const gradientId = `gradient-${mode}-${perfPositive ? "ok" : "warn"}`;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-0.5 bg-paper-2 border border-line rounded-lg p-0.5">
          {PERIODS.map((p) => {
            const pts = filterByPeriod(data, p.months);
            return (
              <button
                key={p.label}
                onClick={() => setPeriod(p.label)}
                disabled={pts.length < 2}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                  period === p.label
                    ? "bg-paper text-ink shadow-sm border border-line"
                    : "text-muted hover:text-ink-2"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {sampled.length > 1 && (
            <span className={`text-[13px] font-mono font-semibold ${perfPositive ? "text-ok" : "text-warn"}`}>
              {formatPct(perfTotal)}
            </span>
          )}
          <div className="flex bg-paper-2 border border-line rounded-lg p-0.5 text-[10px]">
            <button
              onClick={() => setMode("base100")}
              className={`px-2.5 py-1 rounded-md transition-all ${mode === "base100" ? "bg-paper text-ink shadow-sm border border-line" : "text-muted hover:text-ink-2"}`}
            >
              Base 100
            </button>
            <button
              onClick={() => setMode("vl")}
              className={`px-2.5 py-1 rounded-md transition-all ${mode === "vl" ? "bg-paper text-ink shadow-sm border border-line" : "text-muted hover:text-ink-2"}`}
            >
              VL
            </button>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.12} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="0"
            stroke="oklch(0.90 0.010 70)"
            vertical={false}
            strokeWidth={1}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10, fill: "oklch(0.60 0.010 60)", fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "oklch(0.60 0.010 60)", fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(v: number) => mode === "base100" ? v.toFixed(0) : v.toFixed(2)}
            domain={["auto", "auto"]}
          />
          {mode === "base100" && (
            <ReferenceLine y={100} stroke="oklch(0.80 0.015 68)" strokeDasharray="4 2" strokeWidth={1} />
          )}
          <Tooltip
            content={(props) => (
              <CustomTooltip
                active={props.active}
                payload={props.payload as unknown as { value: number }[]}
                label={props.label as string}
                mode={mode}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={lineColor}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
