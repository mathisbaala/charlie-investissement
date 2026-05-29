"use client";

import React, { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
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
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `T${q} ${d.getFullYear()}`;
}

function formatPct(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
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

  const step = Math.max(1, Math.floor(filtered.length / 150));
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
  const lineColor = perfPositive ? "oklch(0.52 0.14 150)" : "oklch(0.62 0.14 28)";

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {PERIODS.map((p) => {
            const pts = filterByPeriod(data, p.months);
            return (
              <button
                key={p.label}
                onClick={() => setPeriod(p.label)}
                disabled={pts.length < 2}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  period === p.label
                    ? "bg-brown text-paper"
                    : "text-muted hover:text-ink-2 hover:bg-paper-2"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {sampled.length > 1 && (
            <span className={`text-[12px] font-mono font-medium ${perfPositive ? "text-ok" : "text-warn"}`}>
              {formatPct(perfTotal)}
            </span>
          )}
          <div className="flex rounded-lg border border-line overflow-hidden text-[10px]">
            <button
              onClick={() => setMode("base100")}
              className={`px-2.5 py-1 transition-colors ${mode === "base100" ? "bg-brown text-paper" : "text-muted hover:bg-paper-2"}`}
            >
              Base 100
            </button>
            <button
              onClick={() => setMode("vl")}
              className={`px-2.5 py-1 transition-colors ${mode === "vl" ? "bg-brown text-paper" : "text-muted hover:bg-paper-2"}`}
            >
              VL
            </button>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="oklch(0.86 0.015 70)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10, fill: "oklch(0.58 0.012 60)", fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "oklch(0.58 0.012 60)", fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(v: number) => mode === "base100" ? v.toFixed(0) : v.toFixed(2)}
            domain={["auto", "auto"]}
          />
          {mode === "base100" && (
            <ReferenceLine y={100} stroke="oklch(0.78 0.018 68)" strokeDasharray="3 3" />
          )}
          <Tooltip
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              border: "1px solid oklch(0.78 0.018 68)",
              fontFamily: "var(--font-mono)",
              background: "oklch(0.998 0.003 80)",
            }}
            formatter={(v: unknown) => [
              mode === "base100"
                ? `${(v as number).toFixed(1)} (${formatPct((v as number) - 100)})`
                : (v as number).toFixed(4),
              mode === "base100" ? "Perf." : "VL",
            ]}
            labelFormatter={(l: unknown) => new Date(String(l)).toLocaleDateString("fr-FR")}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: lineColor }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
