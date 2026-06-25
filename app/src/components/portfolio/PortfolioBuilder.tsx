"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { PageShell, PageHeader } from "@/components/ui/Page";
import { TypingPrompt } from "@/components/screener/TypingPrompt";
import { FundAdder } from "@/components/portfolio/FundAdder";
import { X, Search, Download } from "@/components/ui/icons";
import { pct } from "@/lib/format";
import { addSearch } from "@/lib/searches";
import {
  parsePortfolioParams, normalizeWeights, serializePortfolioParams, appendHolding,
  buildCorrelationMatrix, projectEuros, mergeCurves,
  BENCHMARK_OPTIONS, DEFAULT_BENCHMARK,
  type Holding, type PortfolioAnalysis,
} from "@/lib/portfolio";

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const SESSION_KEY = "charlie_comparison";
const NUM_INPUT = "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const PERIODS = [{ y: 1, label: "1 an" }, { y: 3, label: "3 ans" }, { y: 5, label: "5 ans" }, { y: 10, label: "Max" }];
// Taille maximale d'un portefeuille analysable (la corrélation reste lisible, le
// back-test composite reste rapide). Au-delà, l'ajout inline est désactivé.
const MAX_HOLDINGS = 20;

function shortName(name: string | undefined, isin: string): string {
  if (!name) return isin;
  return name.length > 40 ? name.slice(0, 38) + "…" : name;
}

// En-tête de colonne de la matrice de corrélation : nom court (le nom complet
// reste au survol). Garde les colonnes lisibles sans recourir à des codes F1/F2.
function colName(name: string | undefined, isin: string): string {
  if (!name) return isin;
  return name.length > 16 ? name.slice(0, 15) + "…" : name;
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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [holdings, setHoldings] = useState<Holding[]>(() => parsePortfolioParams(initialIsins, initialWeights));
  // Noms des fonds ajoutés inline, pour affichage immédiat avant que l'analyse
  // (qui porte `names`) ne revienne. L'analyse reste l'autorité (cf. `names` plus bas).
  const [localNames, setLocalNames] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
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

  // Ajout direct d'un fonds (ISIN/nom déjà connus). Poids = moyenne des poids
  // actuels (le nouveau fonds pèse comme les autres ; le bouton « Normaliser »
  // ramène à 100 % si besoin) — jamais 0, sinon il serait ignoré par l'analyse.
  const addHolding = (isin: string, name: string) => {
    setLocalNames((n) => ({ ...n, [isin]: name }));
    setHoldings((prev) => appendHolding(prev, isin, MAX_HOLDINGS));
  };

  // Recherche en langage naturel → renvoie vers le screener, où l'on sélectionne
  // les fonds à ajouter au portefeuille (pas de screener recréé dans la page).
  const handleSearch = () => {
    const q = query.trim();
    if (!q) { router.push("/recherche"); return; }
    addSearch({ query: q, chips: [], count: 0 });
    router.push("/recherche?q=" + encodeURIComponent(q));
  };
  const searchBar = (
    <div className="bg-paper rounded-xl border border-line shadow-sm px-5 py-3 flex items-center gap-3 focus-within:border-accent/50 transition-colors">
      <Search size={16} className="text-muted shrink-0" />
      <TypingPrompt value={query} onChange={setQuery} onSubmit={handleSearch} className="flex-1" />
      <Btn variant="primary" size="sm" onClick={handleSearch}>Rechercher</Btn>
    </div>
  );

  // L'analyse est l'autorité sur les noms ; `localNames` ne comble que le délai
  // entre l'ajout inline et le retour de l'analyse (l'analyse, en dernier, gagne).
  const names = { ...localNames, ...(analysis?.names ?? {}) };
  const heldIsins = useMemo(() => new Set(holdings.map((h) => h.isin)), [holdings]);
  const ratios = analysis?.ratios;
  const meta = analysis?.meta;
  const bench = analysis?.benchmark ?? null;
  const matrix = analysis ? buildCorrelationMatrix(holdings.map((h) => h.isin), analysis.correlation ?? []) : [];
  const mergedCurve = analysis ? mergeCurves(analysis.curve ?? [], bench?.curve) : [];
  const proj = projectEuros(ratios?.total_return, amount);
  const ready = !!(ratios && meta && meta.used > 0);
  const period = meta?.start && meta?.end ? `${frMonth(meta.start)} – ${frMonth(meta.end)}` : "";
  // Téléchargement du PDF complet du portefeuille : reflète l'état courant (mêmes
  // params que le lien synchronisé). <a> et non <Link> : route API, pas une page
  // (un <Link> déclencherait le prefetch RSC → 400).
  const pdfHref = `/api/portfolio/pdf?isins=${serial.isins}&weights=${serial.weights}&benchmark=${benchmark}&years=${years}`;

  if (holdings.length === 0) {
    return (
      <PageShell>
        <PageHeader title="Portefeuille" />
        {searchBar}
        <p className="text-meta text-muted mt-4 mb-3">
          Cherchez un fonds, sélectionnez-le dans la recherche, puis revenez, ou ajoutez-le
          directement ci-dessous si vous connaissez son ISIN ou son nom.
        </p>
        <FundAdder onAdd={addHolding} existing={heldIsins} />
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Portefeuille"
        action={
          <a href={pdfHref} target="_blank" rel="noopener">
            <Btn variant="outline" size="sm">
              <Download size={13} /> Télécharger le PDF
            </Btn>
          </a>
        }
      />

      {/* Recherche pour ajouter des fonds (→ screener) */}
      {searchBar}

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

          <div className="mt-4">
            <FundAdder onAdd={addHolding} existing={heldIsins} full={holdings.length >= MAX_HOLDINGS} />
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
                    {holdings.map((h) => <th key={h.isin} className="p-1.5 text-muted font-medium font-normal text-left whitespace-nowrap" title={names[h.isin] ?? h.isin}>{colName(names[h.isin], h.isin)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, ri) => (
                    <tr key={h.isin}>
                      <td className="p-1.5 text-ink-2 whitespace-nowrap pr-3" title={names[h.isin] ?? h.isin}>
                        {shortName(names[h.isin], h.isin)}
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
