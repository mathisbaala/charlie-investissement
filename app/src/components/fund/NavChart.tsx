"use client";

import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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

function formatQuarter(dateStr: string): string {
  const d = new Date(dateStr);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `T${q} ${d.getFullYear()}`;
}

export function NavChart({ data }: NavChartProps) {
  const [period, setPeriod] = useState<string>("3A");

  const selectedPeriod = PERIODS.find((p) => p.label === period) ?? PERIODS[1];
  const filtered = filterByPeriod(data, selectedPeriod.months);

  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-muted text-sm">
        Données historiques non disponibles
      </div>
    );
  }

  // Sample to ~120 points for perf
  const step = Math.max(1, Math.floor(filtered.length / 120));
  const sampled = filtered.filter((_, i) => i % step === 0);

  return (
    <div className="space-y-3">
      {/* Period selector */}
      <div className="flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            onClick={() => setPeriod(p.label)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
              period === p.label
                ? "bg-brown text-paper"
                : "text-muted hover:text-ink-2 hover:bg-paper-2"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={sampled} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="4 4"
            stroke="oklch(0.86 0.015 70)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatQuarter}
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
            tickFormatter={(v) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              border: "1px solid oklch(0.78 0.018 68)",
              fontFamily: "var(--font-mono)",
              background: "oklch(0.998 0.003 80)",
            }}
            formatter={(v) => [(v as number).toFixed(4), "VL"]}
            labelFormatter={(l) => new Date(String(l)).toLocaleDateString("fr-FR")}
          />
          <Line
            type="monotone"
            dataKey="nav"
            stroke="oklch(0.53 0.135 45)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "oklch(0.53 0.135 45)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
