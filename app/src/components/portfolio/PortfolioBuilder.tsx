"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Btn } from "@/components/ui/Btn";
import { Copy, Minus, Check, ArrowLeft } from "@/components/ui/icons";
import { pct } from "@/lib/format";
import {
  parsePortfolioParams, normalizeWeights, serializePortfolioParams,
  buildCorrelationMatrix, projectEuros, mergeCurves,
  BENCHMARK_OPTIONS, DEFAULT_BENCHMARK,
  type Holding, type PortfolioAnalysis,
} from "@/lib/portfolio";

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const SESSION_KEY = "charlie_comparison";

function shortName(name: string | undefined, isin: string): string {
  if (!name) return isin;
  return name.length > 38 ? name.slice(0, 36) + "…" : name;
}

// Couleur de cellule de corrélation : vert (décorrélant) → neutre → clay (concentré).
function corrStyle(c: number | null): React.CSSProperties {
  if (c == null) return { background: "transparent", color: "#B9B7B2" };
  const x = Math.max(-1, Math.min(1, c));
  if (x >= 0) {
    return {
      background: `oklch(0.62 ${0.15 * x} 40 / ${0.10 + 0.55 * x})`,
      color: x > 0.6 ? "#fff" : "#3A3A37",
    };
  }
  const a = -x;
  return {
    background: `oklch(0.70 ${0.13 * a} 150 / ${0.10 + 0.45 * a})`,
    color: "#3A3A37",
  };
}

function RatioCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-paper border border-line rounded-lg px-4 py-3">
      <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold">{label}</p>
      <p className="text-title-lg text-ink mt-1" style={{ fontFamily: "var(--font-serif)" }}>{value}</p>
      {hint && <p className="text-caption text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

interface Props {
  initialIsins: string;
  initialWeights: string;
  initialBenchmark: string;
}

export function PortfolioBuilder({ initialIsins, initialWeights, initialBenchmark }: Props) {
  const [holdings, setHoldings] = useState<Holding[]>(() =>
    parsePortfolioParams(initialIsins, initialWeights),
  );
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [benchmark, setBenchmark] = useState(initialBenchmark || DEFAULT_BENCHMARK);
  const [amount, setAmount] = useState(10000);

  // Repli : si l'URL est vide, reprendre la sélection du screener (équipondérée).
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

  const analyze = useCallback(async (list: Holding[], bench: string) => {
    const norm = normalizeWeights(list);
    const { isins, weights } = serializePortfolioParams(norm);
    const qs = `isins=${isins}&weights=${weights}&benchmark=${bench}`;
    // Met à jour l'URL → le lien partageable reflète le portefeuille courant.
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

  // Analyse initiale (URL ou repli sélection).
  useEffect(() => {
    if (holdings.length > 0 && analysis === null && !loading) analyze(holdings, benchmark);
  }, [holdings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changement de benchmark → ré-analyse immédiate (sans recliquer « Analyser »).
  const onBenchmarkChange = (code: string) => {
    setBenchmark(code);
    if (holdings.length > 0) analyze(holdings, code);
  };

  const sum = useMemo(
    () => holdings.reduce((a, h) => a + (h.weight > 0 ? h.weight : 0), 0),
    [holdings],
  );

  const setWeight = (isin: string, w: number) =>
    setHoldings((prev) => prev.map((h) => (h.isin === isin ? { ...h, weight: w } : h)));
  const remove = (isin: string) =>
    setHoldings((prev) => prev.filter((h) => h.isin !== isin));

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const names = analysis?.names ?? {};

  // ─── État vide ──────────────────────────────────────────────────────────────
  if (holdings.length === 0) {
    return (
      <div className="max-w-[760px] mx-auto px-6 py-16 text-center">
        <h1 className="text-title-xl text-ink" style={{ fontFamily: "var(--font-serif)" }}>
          Construire un <em className="text-accent not-italic" style={{ fontStyle: "italic" }}>portefeuille.</em>
        </h1>
        <p className="text-body text-ink-2 mt-3">
          Sélectionnez des fonds depuis la recherche, puis composez un portefeuille pondéré
          pour en voir la performance, les ratios et la corrélation entre fonds.
        </p>
        <Link href="/recherche" className="inline-block mt-6">
          <Btn variant="primary">Aller à la recherche</Btn>
        </Link>
      </div>
    );
  }

  const ratios = analysis?.ratios;
  const meta = analysis?.meta;
  const matrix = analysis
    ? buildCorrelationMatrix(holdings.map((h) => h.isin), analysis.correlation ?? [])
    : [];
  const bench = analysis?.benchmark ?? null;
  const mergedCurve = analysis ? mergeCurves(analysis.curve ?? [], bench?.curve) : [];
  const proj = projectEuros(ratios?.total_return, amount);
  const benchProj = bench ? projectEuros(bench.total_return, amount) : null;
  const outperf =
    ratios?.annual_return != null && bench?.annual_return != null
      ? ratios.annual_return - bench.annual_return
      : null;

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
      <Link href="/recherche" className="inline-flex items-center gap-1.5 text-meta text-muted hover:text-ink transition-colors mb-4">
        <ArrowLeft size={14} /> Recherche
      </Link>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="text-title-xl text-ink" style={{ fontFamily: "var(--font-serif)" }}>
          Portefeuille <em className="text-accent not-italic" style={{ fontStyle: "italic" }}>{holdings.length} fonds.</em>
        </h1>
        <Btn variant="outline" size="sm" onClick={copyLink}>
          {copied ? <><Check size={13} /> Lien copié</> : <><Copy size={13} /> Copier le lien</>}
        </Btn>
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-6 mt-6">

        {/* ─── Éditeur de pondération ─── */}
        <div className="bg-cream border border-line rounded-xl p-4 h-fit">
          <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold mb-3">Pondération</p>
          <div className="space-y-2">
            {holdings.map((h) => (
              <div key={h.isin} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-meta text-ink truncate">{shortName(names[h.isin], h.isin)}</p>
                  <p className="text-caption text-muted font-mono">{h.isin}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number" min={0} max={100} value={Math.round(h.weight * 10) / 10}
                    onChange={(e) => setWeight(h.isin, Number(e.target.value))}
                    className="w-16 text-right text-meta border border-line rounded-md px-2 py-1 bg-paper focus:outline-none focus:border-accent"
                  />
                  <span className="text-meta text-muted">%</span>
                  <button onClick={() => remove(h.isin)} className="text-muted hover:text-clay transition-colors ml-1" aria-label="Retirer">
                    <Minus size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-dashed border-line-soft">
            <span className={`text-meta ${Math.abs(sum - 100) < 0.5 ? "text-muted" : "text-clay"}`}>
              Total {sum.toFixed(0)} %
            </span>
            <Btn variant="ghost" size="sm" onClick={() => setHoldings(normalizeWeights(holdings))}>
              Normaliser à 100 %
            </Btn>
          </div>

          <Btn variant="primary" className="w-full mt-3" onClick={() => analyze(holdings, benchmark)} disabled={loading}>
            {loading ? "Analyse…" : "Analyser le portefeuille"}
          </Btn>

          {meta && (meta.excluded?.length ?? 0) > 0 && (
            <p className="text-caption text-clay mt-3">
              {meta.excluded.length} fonds sans historique de prix exclus du calcul
              (back-test / corrélation indisponibles) : {meta.excluded.map((i) => names[i] ?? i).join(", ")}.
            </p>
          )}
        </div>

        {/* ─── Résultats ─── */}
        <div className="space-y-6">
          {analysis?.error && (
            <div className="bg-paper border border-line rounded-xl p-6 text-meta text-clay">
              Analyse indisponible pour ce portefeuille.
            </div>
          )}

          {meta && meta.used === 0 && !loading && (
            <div className="bg-paper border border-line rounded-xl p-6 text-meta text-ink-2">
              Aucun des fonds sélectionnés n'a d'historique de prix : back-test et
              corrélation indisponibles. Ajoutez des fonds cotés (OPCVM, ETF, fonds euros)
              pour analyser le portefeuille.
            </div>
          )}

          {ratios && meta && meta.used > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <RatioCard label="Perf. annualisée" value={pct((ratios.annual_return ?? 0) * 100, true)} />
                <RatioCard label="Volatilité" value={pct((ratios.volatility ?? 0) * 100)} />
                <RatioCard label="Sharpe" value={ratios.sharpe == null ? "—" : ratios.sharpe.toFixed(2)} hint={`taux ss risque ${meta.rf_pct}%`} />
                <RatioCard label="Perte max." value={pct((ratios.max_drawdown ?? 0) * 100)} />
                <RatioCard label="Perf. totale" value={pct((ratios.total_return ?? 0) * 100, true)} />
              </div>

              {/* Back-test : courbe portefeuille vs benchmark */}
              <div className="bg-paper border border-line rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
                  <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold">
                    Back-test · base 100
                  </p>
                  <label className="text-caption text-muted flex items-center gap-1.5">
                    Comparer à
                    <select
                      value={benchmark}
                      onChange={(e) => onBenchmarkChange(e.target.value)}
                      className="text-meta border border-line rounded-md px-2 py-1 bg-paper focus:outline-none focus:border-accent"
                    >
                      {BENCHMARK_OPTIONS.map((b) => (
                        <option key={b.code} value={b.code}>{b.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-caption text-muted mb-3">
                  {meta.start} → {meta.end} · {meta.n_weeks} semaines · rééquilibré
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={mergedCurve} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DFDEDA" />
                    <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false}
                      tickFormatter={(v: string) => { const d = new Date(v); return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; }}
                      interval="preserveStartEnd" minTickGap={60} />
                    <YAxis tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={42} />
                    <Tooltip
                      formatter={(v: unknown, n: unknown) => [typeof v === "number" ? v.toFixed(1) : "—", n === "p" ? "Portefeuille" : (bench?.label ?? "Indice")]}
                      labelFormatter={(l: unknown) => { const d = new Date(String(l)); return isNaN(d.getTime()) ? String(l) : d.toLocaleDateString("fr-FR"); }}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }} />
                    <Legend formatter={(value: string) => <span style={{ fontSize: 11 }}>{value === "p" ? "Portefeuille" : (bench?.label ?? "Indice")}</span>} />
                    <Line type="monotone" dataKey="p" stroke="#B0613F" strokeWidth={2} dot={false} />
                    {bench && <Line type="monotone" dataKey="b" stroke="#8A8780" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />}
                  </LineChart>
                </ResponsiveContainer>

                {/* Comparaison + projection en euros */}
                <div className="grid sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-dashed border-line-soft">
                  <div>
                    <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold mb-2">Comparaison (annualisé)</p>
                    <div className="flex items-center justify-between text-meta py-0.5">
                      <span className="text-ink-2">Portefeuille</span>
                      <span className="text-ink font-medium">{pct((ratios?.annual_return ?? 0) * 100, true)}/an</span>
                    </div>
                    {bench && (
                      <div className="flex items-center justify-between text-meta py-0.5">
                        <span className="text-ink-2">{bench.label}</span>
                        <span className="text-ink font-medium">{pct((bench.annual_return ?? 0) * 100, true)}/an</span>
                      </div>
                    )}
                    {outperf != null && (
                      <div className="flex items-center justify-between text-meta py-0.5 mt-1 pt-1 border-t border-line-soft">
                        <span className="text-muted">Sur/sous-performance</span>
                        <span className={outperf >= 0 ? "text-clay font-semibold" : "text-ink-2 font-semibold"}>
                          {pct(outperf * 100, true)}/an
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-caption uppercase tracking-[0.08em] text-muted font-semibold mb-2 flex items-center gap-2">
                      Projection
                      <input
                        type="number" min={0} step={1000} value={amount}
                        onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                        className="w-24 text-right text-meta border border-line rounded-md px-2 py-0.5 bg-paper focus:outline-none focus:border-accent normal-case tracking-normal"
                      />
                      € investis
                    </label>
                    <div className="flex items-center justify-between text-meta py-0.5">
                      <span className="text-ink-2">Portefeuille</span>
                      <span className="text-ink font-medium">
                        {EUR.format(proj.final)} <span className={proj.gain >= 0 ? "text-clay" : "text-muted"}>({proj.gain >= 0 ? "+" : ""}{EUR.format(proj.gain)})</span>
                      </span>
                    </div>
                    {benchProj && (
                      <div className="flex items-center justify-between text-meta py-0.5">
                        <span className="text-ink-2">{bench?.label}</span>
                        <span className="text-ink-2">{EUR.format(benchProj.final)}</span>
                      </div>
                    )}
                    <p className="text-caption text-muted mt-1.5">Performance passée, sans garantie sur l'avenir.</p>
                  </div>
                </div>
              </div>

              {/* Matrice de corrélation */}
              {holdings.length >= 2 && (
                <div className="bg-paper border border-line rounded-xl p-4 overflow-x-auto">
                  <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold mb-1">
                    Corrélation entre fonds
                  </p>
                  <p className="text-caption text-muted mb-3">
                    Proche de 1 = évoluent ensemble (peu diversifiant) · proche de 0 ou négatif = se compensent.
                  </p>
                  <table className="border-collapse text-caption">
                    <thead>
                      <tr>
                        <th className="p-1.5" />
                        {holdings.map((h, i) => (
                          <th key={h.isin} className="p-1.5 text-muted font-semibold align-bottom" title={names[h.isin] ?? h.isin}>F{i + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map((h, ri) => (
                        <tr key={h.isin}>
                          <td className="p-1.5 text-ink-2 whitespace-nowrap pr-3" title={names[h.isin] ?? h.isin}>
                            <span className="text-muted font-semibold mr-1.5">F{ri + 1}</span>
                            {shortName(names[h.isin], h.isin)}
                          </td>
                          {matrix[ri]?.map((c, ci) => (
                            <td key={ci} className="p-1.5 text-center rounded" style={corrStyle(c)}>
                              {c == null ? "—" : c.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Détail par fonds */}
              <div className="bg-paper border border-line rounded-xl p-4">
                <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold mb-3">Détail par fonds</p>
                <table className="w-full text-meta">
                  <thead>
                    <tr className="text-caption text-muted uppercase tracking-[0.06em] border-b border-line">
                      <th className="text-left py-2 font-semibold">Fonds</th>
                      <th className="text-right py-2 font-semibold">Poids</th>
                      <th className="text-right py-2 font-semibold">Volatilité</th>
                      <th className="text-right py-2 font-semibold">Perf. période</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analysis.funds ?? []).map((f) => (
                      <tr key={f.isin} className="border-b border-line-soft last:border-0">
                        <td className="py-2 text-ink truncate max-w-[280px]">{shortName(names[f.isin], f.isin)}</td>
                        <td className="py-2 text-right text-ink-2">{(f.weight * 100).toFixed(0)} %</td>
                        <td className="py-2 text-right text-ink-2">{pct((f.volatility ?? 0) * 100)}</td>
                        <td className="py-2 text-right text-ink-2">{pct((f.total_return ?? 0) * 100, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {loading && !ratios && (
            <div className="flex items-center justify-center h-[260px] text-muted">
              <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
