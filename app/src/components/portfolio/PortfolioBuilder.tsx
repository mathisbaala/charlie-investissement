"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { PageShell, PageHeader } from "@/components/ui/Page";
import { Copy, Check, X } from "@/components/ui/icons";
import { pct } from "@/lib/format";
import {
  parsePortfolioParams, normalizeWeights, serializePortfolioParams,
  buildCorrelationMatrix, projectEuros, mergeCurves,
  BENCHMARK_OPTIONS, DEFAULT_BENCHMARK,
  type Holding, type PortfolioAnalysis,
} from "@/lib/portfolio";

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const SESSION_KEY = "charlie_comparison";
const NUM_INPUT = "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const PERIODS = [{ y: 1, label: "1 an" }, { y: 3, label: "3 ans" }, { y: 5, label: "5 ans" }, { y: 10, label: "Max" }];

function shortName(name: string | undefined, isin: string): string {
  if (!name) return isin;
  return name.length > 40 ? name.slice(0, 38) + "…" : name;
}

// Mois en toutes lettres, capitalisé : « 2021-04-19 » → « Avril 2021 ».
function frMonth(d: string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const s = x.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function corrStyle(c: number | null): React.CSSProperties {
  if (c == null) return { background: "transparent", color: "#B9B7B2" };
  const x = Math.max(-1, Math.min(1, c));
  if (x >= 0) return { background: `oklch(0.62 ${0.15 * x} 40 / ${0.10 + 0.55 * x})`, color: x > 0.6 ? "#fff" : "#3A3A37" };
  const a = -x;
  return { background: `oklch(0.70 ${0.13 * a} 150 / ${0.10 + 0.45 * a})`, color: "#3A3A37" };
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" | null }) {
  return (
    <div className="md:flex-1 rounded-xl border border-line bg-paper px-3 py-3 md:px-5 md:py-4 text-center min-w-0">
      <p className="text-caption uppercase tracking-widest text-muted font-semibold mb-1.5 truncate">{label}</p>
      <p
        className={`text-title md:text-title-lg leading-none ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-danger" : "text-ink"}`}
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {value}
      </p>
    </div>
  );
}

const fmtPct = (v: number | null | undefined, sign = false) => pct(v == null ? null : v * 100, sign);
const signTone = (v: number | null | undefined) => (v == null ? null : v >= 0 ? "ok" : "bad");

interface Props {
  initialIsins: string;
  initialWeights: string;
  initialBenchmark: string;
  initialYears: string;
}

export function PortfolioBuilder({ initialIsins, initialWeights, initialBenchmark, initialYears }: Props) {
  const [holdings, setHoldings] = useState<Holding[]>(() => parsePortfolioParams(initialIsins, initialWeights));
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [benchmark, setBenchmark] = useState(initialBenchmark || DEFAULT_BENCHMARK);
  const [years, setYears] = useState(() => {
    const y = Number(initialYears);
    return [1, 3, 5, 10].includes(y) ? y : 5;
  });

  const [amount, setAmount] = useState(10000);

  useEffect(() => {
    if (holdings.length > 0) return;
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const funds = JSON.parse(saved) as { isin: string }[];
        if (funds.length) {
          const eq = 100 / funds.length;
          setHoldings(funds.map((f) => ({ isin: f.isin, weight: eq })));
        }
      }
    } catch { /* sessionStorage indispo */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const analyze = useCallback(async (list: Holding[], bench: string, yrs: number) => {
    const { isins, weights } = serializePortfolioParams(normalizeWeights(list));
    const qs = `isins=${isins}&weights=${weights}&benchmark=${bench}&years=${yrs}`;
    window.history.replaceState(null, "", `/portefeuille?${qs}`);
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolio/analyze?${qs}`);
      setAnalysis(await res.json());
    } catch {
      setAnalysis({ error: "network" } as PortfolioAnalysis);
    } finally {
      setLoading(false);
    }
  }, []);

  // Recalcul AUTOMATIQUE (débounce) à chaque changement de poids / fonds / indice / période.
  const serial = useMemo(() => serializePortfolioParams(normalizeWeights(holdings)), [holdings]);
  useEffect(() => {
    if (holdings.length === 0) return;
    const t = setTimeout(() => analyze(holdings, benchmark, years), 400);
    return () => clearTimeout(t);
  }, [serial.isins, serial.weights, benchmark, years]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = useMemo(() => holdings.reduce((a, h) => a + (h.weight > 0 ? h.weight : 0), 0), [holdings]);
  const setWeight = (isin: string, w: number) =>
    setHoldings((prev) => prev.map((h) => (h.isin === isin ? { ...h, weight: w } : h)));
  const remove = (isin: string) => setHoldings((prev) => prev.filter((h) => h.isin !== isin));
  const copyLink = () => navigator.clipboard?.writeText(window.location.href).then(() => {
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  });

  const names = analysis?.names ?? {};
  const ratios = analysis?.ratios;
  const meta = analysis?.meta;
  const bench = analysis?.benchmark ?? null;
  const matrix = analysis ? buildCorrelationMatrix(holdings.map((h) => h.isin), analysis.correlation ?? []) : [];
  const mergedCurve = analysis ? mergeCurves(analysis.curve ?? [], bench?.curve) : [];
  const proj = projectEuros(ratios?.total_return, amount);
  const benchProj = bench ? projectEuros(bench.total_return, amount) : null;
  const ready = !!(ratios && meta && meta.used > 0);
  const period = meta?.start && meta?.end ? `${frMonth(meta.start)} – ${frMonth(meta.end)}` : "";

  if (holdings.length === 0) {
    return (
      <PageShell>
        <PageHeader title="Portefeuille" />
        <Card className="px-6 py-16 text-center">
          <p className="text-body text-ink-2">
            Sélectionnez des fonds depuis la recherche pour composer un portefeuille pondéré :
            performance, risque, corrélation et back-test.
          </p>
          <Link href="/recherche" className="inline-block mt-6"><Btn variant="primary">Sélectionner des fonds</Btn></Link>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Portefeuille"
        action={
          <Btn variant="outline" size="sm" onClick={copyLink}>
            {copied ? <><Check size={13} /> Lien copié</> : <><Copy size={13} /> Copier le lien</>}
          </Btn>
        }
      />

      {/* Bandeau KPI */}
      {ready && (
        <div className="grid grid-cols-2 md:flex md:gap-3 gap-2.5">
          <Kpi label="Perf. annualisée" value={fmtPct(ratios!.annual_return, true)} tone={signTone(ratios!.annual_return)} />
          <Kpi label="Perf. totale" value={fmtPct(ratios!.total_return, true)} tone={signTone(ratios!.total_return)} />
          <Kpi label="Volatilité" value={fmtPct(ratios!.volatility)} />
          <Kpi label="Sharpe" value={ratios!.sharpe == null ? "—" : ratios!.sharpe.toFixed(2)} tone={signTone(ratios!.sharpe)} />
          <Kpi label="Perte max." value={fmtPct(ratios!.max_drawdown)} tone="bad" />
        </div>
      )}

      {meta && meta.used === 0 && !loading && (
        <Card className="px-6 py-6 text-meta text-ink-2">
          Aucun des fonds n'a d'historique de prix : analyse indisponible. Ajoutez des fonds cotés (OPCVM, ETF, fonds euros).
        </Card>
      )}
      {analysis?.error && (
        <Card className="px-6 py-6 text-meta text-danger">Analyse indisponible pour ce portefeuille.</Card>
      )}

      <div className="grid lg:grid-cols-[400px_1fr] gap-5">

        {/* Composition */}
        <Card className="px-5 py-5 h-fit">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-subhead text-ink" style={{ fontFamily: "var(--font-serif)" }}>Composition</h2>
            <button
              onClick={() => setHoldings(normalizeWeights(holdings))}
              className={`text-meta ${Math.abs(sum - 100) < 0.5 ? "text-muted hover:text-ink" : "text-accent font-medium"} transition-colors`}
            >
              {Math.abs(sum - 100) < 0.5 ? "Équilibré 100 %" : `Normaliser (${sum.toFixed(0)} %)`}
            </button>
          </div>

          <div className="space-y-3.5">
            {holdings.map((h) => {
              const wPct = sum > 0 ? (Math.max(0, h.weight) / sum) * 100 : 0;
              return (
                <div key={h.isin}>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 min-w-0 text-meta text-ink truncate">{shortName(names[h.isin], h.isin)}</p>
                    <input
                      type="number" min={0} max={100} value={Math.round(h.weight * 10) / 10}
                      onChange={(e) => setWeight(h.isin, Number(e.target.value))}
                      className={`w-14 text-right text-meta tabular-nums border border-line rounded-md px-1.5 py-1 bg-paper focus:outline-none focus:border-accent ${NUM_INPUT}`}
                    />
                    <span className="text-meta text-muted w-3">%</span>
                    <button onClick={() => remove(h.isin)} className="text-muted hover:text-danger transition-colors" aria-label="Retirer">
                      <X size={13} />
                    </button>
                  </div>
                  <div className="h-1.5 bg-line-soft rounded-full mt-1.5 overflow-hidden">
                    <div className="h-full bg-accent rounded-full" style={{ width: `${wPct}%` }} />
                  </div>
                  <p className="text-caption text-muted-2 mt-1 font-mono">{h.isin}</p>
                </div>
              );
            })}
          </div>

          {meta && (meta.excluded?.length ?? 0) > 0 && (
            <p className="text-caption text-clay mt-4 pt-3 border-t border-line-soft">
              Sans historique (exclus) : {meta.excluded.map((i) => names[i] ?? i).join(", ")}.
            </p>
          )}
        </Card>

        {/* Back-test */}
        <div className="space-y-5 min-w-0">
          <Card className="px-5 py-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <h2 className="text-subhead text-ink" style={{ fontFamily: "var(--font-serif)" }}>Back-test</h2>
              <div className="flex items-center gap-2">
                {/* Sélecteur de période */}
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
                  className="text-meta border border-line rounded-md px-2 py-1 bg-paper focus:outline-none focus:border-accent"
                >
                  {BENCHMARK_OPTIONS.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
                </select>
              </div>
            </div>
            {period && <p className="text-caption text-muted mb-3">{period}</p>}
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={mergedCurve} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#DFDEDA" />
                <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false}
                  tickFormatter={(v: string) => { const d = new Date(v); return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; }}
                  interval="preserveStartEnd" minTickGap={56} />
                <YAxis tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={40} />
                <Tooltip
                  formatter={(v: unknown, n: unknown) => [typeof v === "number" ? v.toFixed(1) : "—", n === "p" ? "Portefeuille" : (bench?.label ?? "Indice")]}
                  labelFormatter={(l: unknown) => { const d = new Date(String(l)); return isNaN(d.getTime()) ? String(l) : d.toLocaleDateString("fr-FR"); }}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }} />
                <Legend formatter={(value: string) => <span style={{ fontSize: 11 }}>{value === "p" ? "Portefeuille" : (bench?.label ?? "Indice")}</span>} />
                <Line type="monotone" dataKey="p" stroke="#B0613F" strokeWidth={2} dot={false} />
                {bench && <Line type="monotone" dataKey="b" stroke="#8A8780" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />}
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {ready && bench && (
            <Card className="px-5 py-5">
              <table className="w-full text-meta tabular-nums">
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
                    { k: "Sharpe", p: ratios!.sharpe?.toFixed(2) ?? "—", b: bench.sharpe?.toFixed(2) ?? "—" },
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

              <div className="flex items-center justify-between gap-3 flex-wrap mt-4 pt-4 border-t border-line">
                <label className="text-caption uppercase tracking-widest text-muted font-semibold flex items-center gap-2">
                  Projection
                  <input type="number" min={0} step={1000} value={amount}
                    onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                    className={`w-24 text-right text-meta tabular-nums border border-line rounded-md px-2 py-0.5 bg-paper focus:outline-none focus:border-accent normal-case tracking-normal ${NUM_INPUT}`} />
                  €
                </label>
                <div className="text-meta tabular-nums text-right">
                  <span className="text-ink font-medium">{EUR.format(proj.final)}</span>
                  <span className={proj.gain >= 0 ? "text-ok ml-1.5" : "text-danger ml-1.5"}>({proj.gain >= 0 ? "+" : ""}{EUR.format(proj.gain)})</span>
                  {benchProj && <span className="text-muted ml-2">indice {EUR.format(benchProj.final)}</span>}
                </div>
              </div>
            </Card>
          )}

          {ready && holdings.length >= 2 && (
            <Card className="px-5 py-5 overflow-x-auto">
              <h2 className="text-subhead text-ink mb-3" style={{ fontFamily: "var(--font-serif)" }}>Corrélation</h2>
              <table className="border-collapse text-caption tabular-nums">
                <thead>
                  <tr>
                    <th className="p-1.5" />
                    {holdings.map((h, i) => <th key={h.isin} className="p-1.5 text-muted font-semibold" title={names[h.isin] ?? h.isin}>F{i + 1}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, ri) => (
                    <tr key={h.isin}>
                      <td className="p-1.5 text-ink-2 whitespace-nowrap pr-3" title={names[h.isin] ?? h.isin}>
                        <span className="text-muted font-semibold mr-1.5">F{ri + 1}</span>{shortName(names[h.isin], h.isin)}
                      </td>
                      {matrix[ri]?.map((c, ci) => (
                        <td key={ci} className="p-1.5 text-center rounded w-12" style={corrStyle(c)}>{c == null ? "—" : c.toFixed(2)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}
