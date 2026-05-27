"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface Props {
  perf1y: number | null;
  perf3y: number | null;
  perf5y: number | null;
  volatility1y?: number | null;
  sharpe1y?: number | null;
}

export default function PerformanceChart({ perf1y, perf3y, perf5y }: Props) {
  const data = [
    { label: "1 an", value: perf1y },
    { label: "3 ans", value: perf3y },
    { label: "5 ans", value: perf5y },
  ].filter((d): d is { label: string; value: number } => d.value != null);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-400">
        Données de performance non disponibles
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          formatter={(v) => [`${Number(v).toFixed(2)}%`, "Performance"]}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}
        />
        <ReferenceLine y={0} stroke="#d1d5db" strokeWidth={1} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? "#22c55e" : "#ef4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
