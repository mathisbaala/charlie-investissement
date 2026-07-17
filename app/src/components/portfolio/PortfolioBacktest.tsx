"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { Kpi } from "@/components/ui/Kpi";
import { X } from "@/components/ui/icons";
import { pct } from "@/lib/format";
import { FundAdder } from "@/components/portfolio/FundAdder";
import {
  normalizeWeights, serializePortfolioParams, mergeCurvesMulti,
  BENCHMARK_OPTIONS, DEFAULT_BENCHMARK, COMPARE_MAX, PORTFOLIO_PERIODS, truncateLabel,
  type Holding, type PortfolioAnalysis, type CompareFund,
} from "@/lib/portfolio";
import {
  CHART_GRID, CHART_AXIS, CHART_TOOLTIP_BORDER, CHART_BENCHMARK, CHART_PORTFOLIO, CHART_COMPARE,
} from "@/lib/chartColors";

// Back-test historique de l'allocation générée : rejoue la performance réelle des
// supports retenus (aux poids courants) face à un indice ET à des fonds de
// comparaison choisis librement (jusqu'à COMPARE_MAX), sur la période choisie
// (jusqu'à 15 ans). Chaque fonds comparé passe par le même moteur d'analyse
// (portefeuille à 1 ligne) puis sa courbe est réalignée sur la grille du
// portefeuille et rebasée à 100. N'est monté que sur données réelles (fonds du
// contrat avec historique de prix) — l'univers de démonstration n'a pas de séries.

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

// Vrai si la fenêtre a démarre nettement (45 j) après la fenêtre b : les grilles
// des deux analyses peuvent différer de quelques jours sans que ce soit signifiant.
function startsLater(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return new Date(a).getTime() - new Date(b).getTime() > 45 * 86400_000;
}

// Libellé court d'un fonds comparé (légende / tableau) : nom tronqué, sinon ISIN.
function shortName(c: CompareFund, max = 26): string {
  return truncateLabel(c.name || c.isin, max);
}

export function PortfolioBacktest({ holdings }: { holdings: Holding[] }) {
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [benchmark, setBenchmark] = useState(DEFAULT_BENCHMARK);
  const [years, setYears] = useState(5);
  const [compares, setCompares] = useState<CompareFund[]>([]);
  // Analyses des fonds comparés, clé `${isin}|${years}` (invalide d'elle-même
  // quand la période change).
  const [compareData, setCompareData] = useState<Record<string, PortfolioAnalysis>>({});
  // Profondeur maximale réellement couverte par l'historique (sonde à 15 ans) :
  // sert à griser les maturités que les données ne peuvent pas remplir, pour que
  // « le graphe ne bouge pas » ne ressemble plus à un bug.
  const [depth, setDepth] = useState<{ years: number; start: string } | null>(null);

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

  // Sonde de profondeur : une analyse à 15 ans (sans indice) révèle la fenêtre
  // maximale que l'historique des supports permet réellement.
  useEffect(() => {
    if (holdings.length === 0) return;
    let cancelled = false;
    fetch(`/api/portfolio/analyze?isins=${serial.isins}&weights=${serial.weights}&years=15`)
      .then((r) => r.json())
      .then((j: PortfolioAnalysis) => {
        if (cancelled || !j?.meta?.n_weeks || !j.meta.start) return;
        setDepth({ years: j.meta.n_weeks / 52, start: j.meta.start });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [serial.isins, serial.weights, holdings.length]);

  // Fonds comparés : une analyse « portefeuille à 1 ligne » par fonds manquant
  // pour la période courante. Les réponses déjà en cache ne sont pas re-demandées.
  useEffect(() => {
    const missing = compares.filter((c) => !(`${c.isin}|${years}` in compareData));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((c) =>
        fetch(`/api/portfolio/analyze?isins=${c.isin}&weights=100&years=${years}`)
          .then((r) => r.json())
          .catch(() => ({ error: "network" }) as PortfolioAnalysis)
          .then((j) => [`${c.isin}|${years}`, j as PortfolioAnalysis] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setCompareData((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [compares, years, compareData]);

  const ratios = analysis?.ratios;
  const meta = analysis?.meta;
  const bench = analysis?.benchmark ?? null;

  // Fonds comparés avec courbe exploitable (dans l'ordre d'ajout) ; les autres
  // restent visibles en pastille « sans historique ».
  const compareResults = compares.map((c) => {
    const a = compareData[`${c.isin}|${years}`];
    const usable = !!(a && !a.error && a.curve && a.curve.length > 0 && a.meta && a.meta.used > 0);
    return { fund: c, analysis: usable ? a : null, pending: a === undefined };
  });
  const drawn = compareResults.filter((r) => r.analysis);

  const mergedCurve = analysis
    ? mergeCurvesMulti(analysis.curve ?? [], bench?.curve, drawn.map((r) => r.analysis!.curve))
    : [];
  const ready = !!(ratios && meta && meta.used > 0);
  const period = meta?.start && meta?.end ? `${frMonth(meta.start)} à ${frMonth(meta.end)}` : "";

  // Historique couvert nettement plus court que la période demandée → on le dit
  // explicitement plutôt que de laisser croire à un vrai back-test de N ans.
  const coveredYears = meta?.n_weeks ? meta.n_weeks / 52 : null;
  const truncated = ready && coveredYears != null && coveredYears < years - 0.5;

  // dataKey → libellé lisible (tooltip + légende).
  const seriesLabel = (key: string): string => {
    if (key === "p") return "Portefeuille";
    if (key === "b") return bench?.label ?? "Indice";
    const idx = Number(key.slice(1));
    return drawn[idx] ? shortName(drawn[idx].fund) : key;
  };

  const addCompare = (isin: string, name: string) => {
    setCompares((prev) =>
      prev.length >= COMPARE_MAX || prev.some((c) => c.isin === isin)
        ? prev
        : [...prev, { isin, name }],
    );
  };
  const removeCompare = (isin: string) =>
    setCompares((prev) => prev.filter((c) => c.isin !== isin));

  const excluded = new Set([...compares.map((c) => c.isin), ...holdings.map((h) => h.isin)]);

  return (
    <Card className="px-5 py-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-label text-ink font-semibold">
          Historique du portefeuille
          {loading && ready && <span className="ml-2 text-meta text-muted font-normal">recalcul…</span>}
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-line overflow-hidden">
            {PORTFOLIO_PERIODS.map((p) => {
              // Maturité au delà de l'historique disponible : cliquable mais
              // marquée (le graphe s'arrêtera à la profondeur des données).
              const beyond = depth != null && p.y > depth.years + 0.5;
              return (
                <button
                  key={p.y}
                  onClick={() => setYears(p.y)}
                  title={beyond ? `Données disponibles depuis ${frMonth(depth!.start)} seulement` : undefined}
                  className={`text-caption px-2.5 py-1 transition-colors ${years === p.y ? "bg-brown text-paper" : beyond ? "text-muted-2 hover:bg-accent-soft" : "text-muted hover:bg-accent-soft"}`}
                >
                  {p.label}
                  {beyond && <span className="align-super text-[9px] ml-0.5">°</span>}
                </button>
              );
            })}
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
        Performance réelle aux poids courants, face à l&apos;indice et aux fonds
        comparés{period ? ` · ${period}` : ""}. Hors frais du contrat.
      </p>

      {truncated && (
        <p className="text-meta text-warn bg-warn-soft rounded-md px-3 py-2 mb-3">
          Les données ne couvrent pas {years} ans : le graphe s&apos;arrête à la
          période réellement disponible, de {frMonth(meta!.start)} à {frMonth(meta!.end)}
          {" "}(limitée par le support le plus récent du portefeuille). Les maturités
          marquées ° sont partielles.
        </p>
      )}

      {/* Fonds de comparaison : recherche + pastilles retirables. */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="w-full max-w-xs">
          <FundAdder
            onAdd={addCompare}
            existing={excluded}
            full={compares.length >= COMPARE_MAX}
            placeholder="Comparer à un fonds : ISIN ou nom"
            fullPlaceholder={`${COMPARE_MAX} fonds comparés maximum`}
          />
        </div>
        {compareResults.map((r, i) => (
          <span
            key={r.fund.isin}
            className="inline-flex items-center gap-1.5 text-caption text-ink-2 border border-line rounded-full pl-2.5 pr-1 py-0.5"
          >
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ background: r.analysis ? CHART_COMPARE[drawn.indexOf(r)] : CHART_TOOLTIP_BORDER }}
            />
            {shortName(r.fund)}
            {!r.analysis && !r.pending && (
              <span className="text-muted-2">· sans historique</span>
            )}
            <button
              onClick={() => removeCompare(r.fund.isin)}
              aria-label={`Retirer ${r.fund.name || r.fund.isin} de la comparaison`}
              className="p-0.5 rounded-full text-muted hover:text-ink hover:bg-accent-soft transition-colors"
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>

      {ready && (
        <div className={`grid grid-cols-2 md:flex md:gap-3 gap-2.5 mb-5 transition-opacity ${loading ? "opacity-40" : ""}`}>
          <Kpi label="Perf. annualisée" value={fmtPct(ratios!.annual_return, true)} tone={signTone(ratios!.annual_return)} />
          <Kpi label="Perf. totale" value={fmtPct(ratios!.total_return, true)} tone={signTone(ratios!.total_return)} />
          <Kpi label="Volatilité" value={fmtPct(ratios!.volatility)} />
          <Kpi label="Sharpe" value={ratios!.sharpe == null ? "n.d." : ratios!.sharpe.toFixed(2)} tone={signTone(ratios!.sharpe)} />
          <Kpi label="Perte max." value={fmtPct(ratios!.max_drawdown)} tone="bad" />
        </div>
      )}

      {!ready && !loading && (
        <p className="text-meta text-muted-2 py-4">
          {analysis?.error
            ? "Backtest indisponible pour ce portefeuille."
            : meta && meta.used === 0
              ? "Aucun support retenu n'a d'historique de prix suffisant : backtest indisponible."
              : "Générez un portefeuille pour lancer le backtest."}
        </p>
      )}

      {mergedCurve.length > 0 && (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={mergedCurve} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false}
              tickFormatter={(v: string) => { const d = new Date(v); return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; }}
              interval="preserveStartEnd" minTickGap={56} />
            <YAxis tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={40} />
            <Tooltip
              formatter={(v: unknown, n: unknown) => [typeof v === "number" ? v.toFixed(1) : "n.d.", seriesLabel(String(n))]}
              labelFormatter={(l: unknown) => { const d = new Date(String(l)); return isNaN(d.getTime()) ? String(l) : d.toLocaleDateString("fr-FR"); }}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${CHART_TOOLTIP_BORDER}` }} />
            <Legend formatter={(value: string) => <span style={{ fontSize: 11 }}>{seriesLabel(value)}</span>} />
            <Line type="monotone" dataKey="p" stroke={CHART_PORTFOLIO} strokeWidth={2} dot={false} />
            {bench && <Line type="monotone" dataKey="b" stroke={CHART_BENCHMARK} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />}
            {drawn.map((r, i) => (
              <Line key={r.fund.isin} type="monotone" dataKey={`c${i}`}
                stroke={CHART_COMPARE[i]} strokeWidth={1.5} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {ready && (bench || drawn.length > 0) && (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-meta tabular-nums">
            <thead>
              <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
                <th className="text-left py-2 font-semibold">Indicateur</th>
                <th className="text-right py-2 font-semibold">Portefeuille</th>
                {bench && <th className="text-right py-2 font-semibold">{bench.label}</th>}
                {drawn.map((r) => (
                  <th key={r.fund.isin} className="text-right py-2 font-semibold">{shortName(r.fund, 20)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                { k: "Perf. annualisée", get: (x: { annual_return: number | null }) => fmtPct(x.annual_return, true) },
                { k: "Perf. totale", get: (x: { total_return: number | null }) => fmtPct(x.total_return, true) },
                { k: "Volatilité", get: (x: { volatility: number | null }) => fmtPct(x.volatility) },
                { k: "Sharpe", get: (x: { sharpe: number | null }) => x.sharpe?.toFixed(2) ?? "n.d." },
                { k: "Perte max.", get: (x: { max_drawdown: number | null }) => fmtPct(x.max_drawdown) },
              ]).map((row) => (
                <tr key={row.k} className="border-b border-line-soft last:border-0">
                  <td className="py-1.5 text-ink-2">{row.k}</td>
                  <td className="py-1.5 text-right text-ink font-medium">{row.get(ratios!)}</td>
                  {bench && <td className="py-1.5 text-right text-ink-2">{row.get(bench)}</td>}
                  {drawn.map((r) => (
                    <td key={r.fund.isin} className="py-1.5 text-right text-ink-2">
                      {row.get(r.analysis!.ratios)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {/* Fonds comparé à l'historique plus court que le portefeuille : ses
              ratios portent sur SA fenêtre — on l'affiche pour ne pas comparer
              des périodes différentes en silence. */}
          {drawn.some((r) => startsLater(r.analysis!.meta.start, meta!.start)) && (
            <p className="text-caption text-muted-2 mt-2">
              {drawn
                .filter((r) => startsLater(r.analysis!.meta.start, meta!.start))
                .map((r) => `${shortName(r.fund, 20)} : ratios calculés depuis ${frMonth(r.analysis!.meta.start)}`)
                .join(" · ")}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
