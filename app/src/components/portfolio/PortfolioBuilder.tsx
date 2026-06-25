"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Btn } from "@/components/ui/Btn";
import { Copy, Minus, Check, ArrowLeft } from "@/components/ui/icons";
import { pct } from "@/lib/format";
import {
  parsePortfolioParams, normalizeWeights, serializePortfolioParams,
  buildCorrelationMatrix, type Holding, type PortfolioAnalysis,
} from "@/lib/portfolio";

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
}

export function PortfolioBuilder({ initialIsins, initialWeights }: Props) {
  const [holdings, setHoldings] = useState<Holding[]>(() =>
    parsePortfolioParams(initialIsins, initialWeights),
  );
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const analyze = useCallback(async (list: Holding[]) => {
    const norm = normalizeWeights(list);
    const { isins, weights } = serializePortfolioParams(norm);
    // Met à jour l'URL → le lien partageable reflète le portefeuille courant.
    window.history.replaceState(null, "", `/portefeuille?isins=${isins}&weights=${weights}`);
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolio/analyze?isins=${isins}&weights=${weights}`);
      setAnalysis(await res.json());
    } catch {
      setAnalysis({ error: "network" } as PortfolioAnalysis);
    } finally {
      setLoading(false);
    }
  }, []);

  // Analyse initiale (URL ou repli sélection).
  useEffect(() => {
    if (holdings.length > 0 && analysis === null && !loading) analyze(holdings);
  }, [holdings]); // eslint-disable-line react-hooks/exhaustive-deps

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

          <Btn variant="primary" className="w-full mt-3" onClick={() => analyze(holdings)} disabled={loading}>
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

          {ratios && meta && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <RatioCard label="Perf. annualisée" value={pct((ratios.annual_return ?? 0) * 100, true)} />
                <RatioCard label="Volatilité" value={pct((ratios.volatility ?? 0) * 100)} />
                <RatioCard label="Sharpe" value={ratios.sharpe == null ? "—" : ratios.sharpe.toFixed(2)} hint={`taux ss risque ${meta.rf_pct}%`} />
                <RatioCard label="Perte max." value={pct((ratios.max_drawdown ?? 0) * 100)} />
                <RatioCard label="Perf. totale" value={pct((ratios.total_return ?? 0) * 100, true)} />
              </div>

              {/* Courbe composite */}
              <div className="bg-paper border border-line rounded-xl p-4">
                <p className="text-caption uppercase tracking-[0.08em] text-muted font-semibold mb-1">
                  Performance du portefeuille · base 100
                </p>
                <p className="text-caption text-muted mb-3">
                  {meta.start} → {meta.end} · {meta.n_weeks} semaines · rééquilibré
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={analysis.curve} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DFDEDA" />
                    <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false}
                      tickFormatter={(v: string) => { const d = new Date(v); return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; }}
                      interval="preserveStartEnd" minTickGap={60} />
                    <YAxis tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={42} />
                    <Tooltip
                      formatter={(v: unknown) => [typeof v === "number" ? v.toFixed(1) : "—", "Niveau"]}
                      labelFormatter={(l: unknown) => { const d = new Date(String(l)); return isNaN(d.getTime()) ? String(l) : d.toLocaleDateString("fr-FR"); }}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }} />
                    <Line type="monotone" dataKey="v" stroke="#B0613F" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
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
