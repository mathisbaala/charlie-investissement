"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { Kpi } from "@/components/ui/Kpi";
import { pct } from "@/lib/format";
import {
  normalizeWeights, serializePortfolioParams, mergeCurves,
  BENCHMARK_OPTIONS, DEFAULT_BENCHMARK,
  type Holding, type PortfolioAnalysis,
} from "@/lib/portfolio";

// Back-test historique de l'allocation générée : rejoue la performance réelle des
// supports retenus (aux poids courants) face à un indice, sur la période choisie.
// C'est la brique reprise de l'ancien onglet Portefeuille, greffée sous
// l'allocation optimisée. N'est monté que sur données réelles (fonds du contrat
// avec historique de prix) — l'univers de démonstration n'a pas de séries.

const PERIODS = [{ y: 1, label: "1 an" }, { y: 3, label: "3 ans" }, { y: 5, label: "5 ans" }, { y: 10, label: "Max" }];

const fmtPct = (v: number | null | undefined, sign = false) => pct(v == null ? null : v * 100, sign);
const signTone = (v: number | null | undefined) => (v == null ? null : v >= 0 ? "ok" : "bad");

// Mois en toutes lettres, capitalisé : « 2021-04-19 » → « Avril 2021 ».
function frMonth(d: string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const s = x.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function PortfolioBacktest({ holdings }: { holdings: Holding[] }) {
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [benchmark, setBenchmark] = useState(DEFAULT_BENCHMARK);
  const [years, setYears] = useState(5);

  // Signature stable des poids/ISIN : ne relance le back-test que si l'allocation
  // change réellement (les curseurs de Markowitz remontent ici via `holdings`).
  const serial = useMemo(() => serializePortfolioParams(normalizeWeights(holdings)), [holdings]);

  useEffect(() => {
    if (holdings.length === 0) return;
    const qs = `isins=${serial.isins}&weights=${serial.weights}&benchmark=${benchmark}&years=${years}`;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/portfolio/analyze?${qs}`)
        .then((r) => r.json())
        .then((j) => { if (!cancelled) setAnalysis(j); })
        .catch(() => { if (!cancelled) setAnalysis({ error: "network" } as PortfolioAnalysis); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [serial.isins, serial.weights, benchmark, years, holdings.length]);

  const ratios = analysis?.ratios;
  const meta = analysis?.meta;
  const bench = analysis?.benchmark ?? null;
  const mergedCurve = analysis ? mergeCurves(analysis.curve ?? [], bench?.curve) : [];
  const ready = !!(ratios && meta && meta.used > 0);
  const period = meta?.start && meta?.end ? `${frMonth(meta.start)} à ${frMonth(meta.end)}` : "";

  return (
    <Card className="px-5 py-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-label text-ink font-semibold">
          Back-test historique
          {loading && ready && <span className="ml-2 text-meta text-muted font-normal">recalcul…</span>}
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-line overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.y}
                onClick={() => setYears(p.y)}
                className={`text-caption px-2.5 py-1 transition-colors ${years === p.y ? "bg-brown text-paper" : "text-muted hover:bg-accent-soft"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value)}
            aria-label="Indice de référence"
            className="text-meta border border-line rounded-md px-2 py-1 bg-paper focus:outline-none focus:border-accent"
          >
            {BENCHMARK_OPTIONS.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
          </select>
        </div>
      </div>
      <p className="text-meta text-muted mb-3">
        Performance réelle aux poids courants, face à l&apos;indice{period ? ` · ${period}` : ""}. Hors frais du contrat.
      </p>

      {ready && (
        <div className={`grid grid-cols-2 md:flex md:gap-3 gap-2.5 mb-5 transition-opacity ${loading ? "opacity-40" : ""}`}>
          <Kpi label="Perf. annualisée" value={fmtPct(ratios!.annual_return, true)} tone={signTone(ratios!.annual_return)} />
          <Kpi label="Perf. totale" value={fmtPct(ratios!.total_return, true)} tone={signTone(ratios!.total_return)} />
          <Kpi label="Volatilité" value={fmtPct(ratios!.volatility)} />
          <Kpi label="Sharpe" value={ratios!.sharpe == null ? "-" : ratios!.sharpe.toFixed(2)} tone={signTone(ratios!.sharpe)} />
          <Kpi label="Perte max." value={fmtPct(ratios!.max_drawdown)} tone="bad" />
        </div>
      )}

      {!ready && !loading && (
        <p className="text-meta text-muted-2 py-4">
          {analysis?.error
            ? "Back-test indisponible pour ce portefeuille."
            : meta && meta.used === 0
              ? "Aucun support retenu n'a d'historique de prix suffisant : back-test indisponible."
              : "Générez un portefeuille pour lancer le back-test."}
        </p>
      )}

      {mergedCurve.length > 0 && (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={mergedCurve} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DFDEDA" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false}
              tickFormatter={(v: string) => { const d = new Date(v); return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; }}
              interval="preserveStartEnd" minTickGap={56} />
            <YAxis tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={40} />
            <Tooltip
              formatter={(v: unknown, n: unknown) => [typeof v === "number" ? v.toFixed(1) : "-", n === "p" ? "Portefeuille" : (bench?.label ?? "Indice")]}
              labelFormatter={(l: unknown) => { const d = new Date(String(l)); return isNaN(d.getTime()) ? String(l) : d.toLocaleDateString("fr-FR"); }}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }} />
            <Legend formatter={(value: string) => <span style={{ fontSize: 11 }}>{value === "p" ? "Portefeuille" : (bench?.label ?? "Indice")}</span>} />
            <Line type="monotone" dataKey="p" stroke="#B0613F" strokeWidth={2} dot={false} />
            {bench && <Line type="monotone" dataKey="b" stroke="#8A8780" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />}
          </LineChart>
        </ResponsiveContainer>
      )}

      {ready && bench && (
        <table className="w-full text-meta tabular-nums mt-4">
          <thead>
            <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
              <th className="text-left py-2 font-semibold">Indicateur</th>
              <th className="text-right py-2 font-semibold">Portefeuille</th>
              <th className="text-right py-2 font-semibold">{bench.label}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { k: "Perf. annualisée", p: fmtPct(ratios!.annual_return, true), b: fmtPct(bench.annual_return, true) },
              { k: "Perf. totale", p: fmtPct(ratios!.total_return, true), b: fmtPct(bench.total_return, true) },
              { k: "Volatilité", p: fmtPct(ratios!.volatility), b: fmtPct(bench.volatility) },
              { k: "Sharpe", p: ratios!.sharpe?.toFixed(2) ?? "-", b: bench.sharpe?.toFixed(2) ?? "-" },
              { k: "Perte max.", p: fmtPct(ratios!.max_drawdown), b: fmtPct(bench.max_drawdown) },
            ].map((r) => (
              <tr key={r.k} className="border-b border-line-soft last:border-0">
                <td className="py-1.5 text-ink-2">{r.k}</td>
                <td className="py-1.5 text-right text-ink font-medium">{r.p}</td>
                <td className="py-1.5 text-right text-ink-2">{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
