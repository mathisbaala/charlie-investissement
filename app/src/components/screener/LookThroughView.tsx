"use client";

import React, { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { pct } from "@/lib/format";
import type { SelectedFund } from "@/components/SelectionProvider";

// Même palette que le graphe de performance (ComparisonModal) → un fonds garde
// sa couleur partout dans l'onglet Comparé.
const FUND_COLORS = ["#9F4325", "#2d7d5a", "#b97c2a", "#3d5a8a"];

type Expo = { label: string; weight: number };
type Overlap = {
  name: string;
  ticker: string | null;
  count: number;
  funds: { isin: string; weight: number }[];
  max_weight: number;
};
type Data = {
  geoByFund: Record<string, Expo[]>;
  sectorsByFund: Record<string, Expo[]>;
  overlaps: Overlap[];
};

function short(name: string): string {
  return name.length > 22 ? name.slice(0, 21) + "…" : name;
}

// Graphe à barres groupées : une ligne par zone/secteur, une barre colorée par
// fonds (comparaison visuelle directe). Top 8 par poids max sur la sélection.
function GroupedBars({ title, byFund, funds }: { title: string; byFund: Record<string, Expo[]>; funds: SelectedFund[] }) {
  const labelMax = new Map<string, number>();
  for (const f of funds) for (const e of byFund[f.isin] ?? []) labelMax.set(e.label, Math.max(labelMax.get(e.label) ?? 0, e.weight));
  const labels = [...labelMax.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l]) => l);
  if (!labels.length) return null;

  const rows = labels.map((label) => {
    const row: Record<string, number | string> = { label };
    for (const f of funds) row[f.isin] = byFund[f.isin]?.find((e) => e.label === label)?.weight ?? 0;
    return row;
  });
  const nameByIsin = new Map(funds.map((f) => [f.isin, f.name]));

  return (
    <div>
      <p className="text-caption uppercase tracking-[0.1em] text-muted font-semibold mb-3">{title}</p>
      <ResponsiveContainer width="100%" height={labels.length * 34 + 44}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 20, left: 4, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid horizontal={false} stroke="#EDEBE6" />
          <XAxis type="number" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
          <YAxis type="category" dataKey="label" width={132} tick={{ fontSize: 11, fill: "#6B6A66" }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "oklch(0 0 0 / 0.04)" }}
            formatter={(v: unknown, n: unknown) => [pct(Number(v)), short(nameByIsin.get(String(n)) ?? String(n))]}
            contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }}
          />
          <Legend formatter={(value: string) => <span style={{ fontSize: 11 }}>{short(nameByIsin.get(value) ?? value)}</span>} />
          {funds.map((f, i) => (
            <Bar key={f.isin} dataKey={f.isin} name={f.isin} fill={FUND_COLORS[i % FUND_COLORS.length]} radius={[0, 3, 3, 0]} maxBarSize={13} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LookThroughView({ funds }: { funds: SelectedFund[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const isinsKey = funds.map((f) => f.isin).join(",");

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(false);
    fetch(`/api/portfolio/lookthrough?isins=${isinsKey}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => { if (!ignore) setData(d); })
      .catch(() => { if (!ignore) { setData(null); setError(true); } })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [isinsKey]);

  const nameByIsin = new Map(funds.map((f) => [f.isin, f.name]));
  const hasGeo = data && funds.some((f) => (data.geoByFund[f.isin] ?? []).length > 0);
  const hasSec = data && funds.some((f) => (data.sectorsByFund[f.isin] ?? []).length > 0);
  const hasOverlap = data && data.overlaps.length > 0;

  return (
    <div className="px-6 py-5 space-y-7">
      {loading ? (
        <p className="text-meta text-muted-2">Chargement…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
            {hasGeo && <GroupedBars title="Zones géographiques" byFund={data!.geoByFund} funds={funds} />}
            {hasSec && <GroupedBars title="Secteurs" byFund={data!.sectorsByFund} funds={funds} />}
          </div>

          {hasOverlap && (
            <div>
              <p className="text-caption uppercase tracking-[0.1em] text-muted font-semibold mb-2.5">Lignes communes</p>
              <div className="flex flex-wrap gap-1.5">
                {data!.overlaps.map((o) => (
                  <span
                    key={(o.ticker ?? o.name)}
                    className="inline-flex items-center gap-1.5 text-caption border border-line rounded-full px-2.5 py-1 bg-paper-2"
                    title={o.funds.map((x) => `${nameByIsin.get(x.isin) ?? x.isin} : ${pct(x.weight)}`).join("\n")}
                  >
                    <span className="text-ink-2 font-medium">{o.name.length > 28 ? o.name.slice(0, 27) + "…" : o.name}</span>
                    <span className="text-warn font-mono">×{o.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {!hasGeo && !hasSec && !hasOverlap && (
            <p className="text-meta text-muted-2">
              {error ? "Données indisponibles pour le moment." : "Pas de composition disponible pour ces fonds."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
