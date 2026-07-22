"use client";

// Restitution d'un résultat de calculateur : tuiles KPI, tableaux (barème,
// scénarios), graphiques (barres/donut), hypothèses et références légales.
// Aucune interprétation ici : les blocs arrivent typés et formatés du compute().

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { Kpi } from "@/components/ui/Kpi";
import { eur } from "@/lib/calculators/types";
import type { CalcChart, CalcResult } from "@/lib/calculators/types";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_TOOLTIP_BORDER,
  CHART_FUND_SERIES,
} from "@/lib/chartColors";

const TOOLTIP_STYLE = {
  backgroundColor: "#FFFFFF",
  border: `1px solid ${CHART_TOOLTIP_BORDER}`,
  borderRadius: 8,
  fontSize: 12,
};

function Chart({ chart }: { chart: CalcChart }) {
  const data = chart.items.map((it, i) => ({ ...it, fill: CHART_FUND_SERIES[i % CHART_FUND_SERIES.length] }));
  return (
    <Card className="p-4">
      {chart.title && <p className="text-meta font-medium text-ink mb-3">{chart.title}</p>}
      <ResponsiveContainer width="100%" height={220}>
        {chart.type === "donut" ? (
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={55} outerRadius={85} paddingAngle={2}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} stroke="none" />
              ))}
            </Pie>
            <Tooltip formatter={(v: unknown) => eur(Number(v ?? 0))} contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: CHART_AXIS, fontSize: 11 }}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fill: CHART_AXIS, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => (Math.abs(v) >= 1_000_000 ? `${v / 1_000_000} M€` : `${Math.round(v / 1000)} k€`)}
            />
            <Tooltip formatter={(v: unknown) => eur(Number(v ?? 0))} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={72}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
      {chart.type === "donut" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
          {data.map((d, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-meta text-ink-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
              {d.label} · {eur(d.value)}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

export function CalcResultView({ result }: { result: CalcResult }) {
  return (
    <div className="mt-4 space-y-4">
      {/* Bandeau KPI */}
      <div className="flex flex-col md:flex-row gap-3">
        {result.kpis.map((k) => (
          <Kpi key={k.label} label={k.label} value={k.value} tone={k.tone ?? null} />
        ))}
      </div>

      {/* Tableaux (barème, échéanciers, scénarios) */}
      {result.tables?.map((t, i) => (
        <Card key={i} className="p-4 overflow-x-auto">
          {t.title && <p className="text-meta font-medium text-ink mb-3">{t.title}</p>}
          <table className="w-full text-meta">
            <thead>
              <tr className="text-left text-muted">
                {t.columns.map((c) => (
                  <th key={c} className="font-medium pb-2 pr-4 whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, ri) => (
                <tr key={ri} className="border-t border-line-soft">
                  {r.map((cell, ci) => (
                    <td key={ci} className={`py-2 pr-4 ${ci === 0 ? "text-ink-2" : "text-ink tabular-nums"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {/* Graphiques */}
      {result.charts && result.charts.length > 0 && (
        <div className={`grid gap-4 ${result.charts.length > 1 ? "md:grid-cols-2" : ""}`}>
          {result.charts.map((c, i) => (
            <Chart key={i} chart={c} />
          ))}
        </div>
      )}

      {/* Hypothèses et références */}
      {(result.notes?.length || result.refs?.length) && (
        <Card className="p-4">
          {result.notes?.map((n, i) => (
            <p key={i} className="text-meta text-muted mb-1.5 last:mb-0">
              — {n}
            </p>
          ))}
          {result.refs && result.refs.length > 0 && (
            <p className="text-caption uppercase tracking-widest text-muted font-semibold mt-3">
              {result.refs.join(" · ")}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
