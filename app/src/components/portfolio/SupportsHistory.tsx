"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { pct } from "@/lib/format";
import {
  alignCompareCurve, trailingReturn, calendarYearReturns,
  BENCHMARK_OPTIONS, DEFAULT_BENCHMARK,
  type Holding, type PortfolioAnalysis, type PortfolioBenchmark, type PortfolioCurvePoint,
} from "@/lib/portfolio";

// Historique PAR SUPPORT de l'allocation générée : sous le backtest agrégé, une
// carte toujours visible (pas d'onglet) avec le graphe base 100 de chaque support
// face à l'indice choisi, puis le tableau des perfs par horizon et par année.
//
// Contrairement au backtest agrégé (fenêtre commune bornée par le support le plus
// récent), chaque support est tracé sur SON propre historique : changer la
// maturité change réellement la profondeur du graphe, chaque courbe démarrant là
// où ses données commencent. La grille de dates vient du support le plus profond,
// dont l'appel porte aussi la courbe de l'indice (même fenêtre). La légende est
// cliquable : masquer/réafficher un support pour jouer avec le graphe.

const PERIODS = [
  { y: 1, label: "1 an" }, { y: 3, label: "3 ans" }, { y: 5, label: "5 ans" },
  { y: 10, label: "10 ans" }, { y: 15, label: "15 ans" },
];

// Palette catégorielle validée (dataviz) sur le fond papier : ordre FIXE, jamais
// recyclé — au delà de 8 supports, les suivants ne sont pas tracés (ils restent
// dans le tableau). L'identité ne repose pas que sur la couleur : légende + tableau.
const SERIES = [
  "#2a78d6", "#1baf7a", "#eda100", "#008300",
  "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
];
const MAX_LINES = SERIES.length;

// Horizons glissants du tableau (jours) — seuls ceux couverts par au moins un
// support sont affichés.
const HORIZONS: { days: number; label: string }[] = [
  { days: 7, label: "1 sem" },
  { days: 30, label: "1 mois" },
  { days: 91, label: "3 mois" },
  { days: 182, label: "6 mois" },
  { days: 365, label: "1 an" },
  { days: 1095, label: "3 ans" },
  { days: 1826, label: "5 ans" },
  { days: 3652, label: "10 ans" },
];
const MAX_CALENDAR_YEARS = 6;

const fmtPct = (v: number | null | undefined, sign = false) => pct(v == null ? null : v * 100, sign);

function shortName(name: string, max = 30): string {
  const n = name.trim();
  return n.length > max ? `${n.slice(0, max - 1)}…` : n;
}

export function SupportsHistory({ holdings }: { holdings: Holding[] }) {
  const [years, setYears] = useState(5);
  const [benchmark, setBenchmark] = useState(DEFAULT_BENCHMARK);
  // Analyses par support, clé `${isin}|${years}|${benchmark}` (chaque appel porte
  // aussi la courbe de l'indice sur la fenêtre du support).
  const [fundData, setFundData] = useState<Record<string, PortfolioAnalysis>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const key = (isin: string) => `${isin}|${years}|${benchmark}`;

  // Fan out : une analyse « portefeuille à 1 ligne » par support manquant.
  useEffect(() => {
    const missing = holdings.filter((h) => !(key(h.isin) in fundData));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((h) =>
        fetch(`/api/portfolio/analyze?isins=${h.isin}&weights=100&years=${years}&benchmark=${benchmark}`)
          .then((r) => r.json())
          .catch(() => ({ error: "network" }) as PortfolioAnalysis)
          .then((j) => [key(h.isin), j as PortfolioAnalysis] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setFundData((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, years, benchmark, fundData]);

  // Séries par support, dans l'ordre des poids : la couleur suit le support
  // (position dans `holdings`), stable même quand on masque des lignes.
  const series = holdings.map((h, i) => {
    const a = fundData[key(h.isin)];
    const usable = !!(a && !a.error && a.curve && a.curve.length > 1 && a.meta && a.meta.used > 0);
    return {
      isin: h.isin,
      name: a?.names?.[h.isin] ?? h.isin,
      curve: usable ? a.curve : ([] as PortfolioCurvePoint[]),
      totalReturn: usable ? (a.ratios?.total_return ?? null) : null,
      benchmark: usable ? (a.benchmark ?? null) : null,
      color: i < MAX_LINES ? SERIES[i] : null,
    };
  });
  const drawable = series.filter((s) => s.curve.length > 1 && s.color);
  const pending = holdings.some((h) => !(key(h.isin) in fundData));
  const skipped = series.filter((s) => s.curve.length > 1).length - drawable.length;

  // Grille du graphe : le support à l'historique le plus profond (sa fenêtre est
  // la plus large) ; sa réponse fournit aussi l'indice sur cette même fenêtre.
  const donor = drawable.reduce<(typeof drawable)[number] | null>(
    (acc, s) => (!acc || s.curve.length > acc.curve.length ? s : acc), null);
  const grid = useMemo(() => (donor ? donor.curve.map((pt) => pt.d) : []), [donor]);
  const bench: PortfolioBenchmark | null = donor?.benchmark ?? null;

  const visible = drawable.filter((s) => !hidden.has(s.isin));

  const chartData = useMemo(() => {
    const rows: Record<string, string | number | null>[] = grid.map((d) => ({ d }));
    visible.forEach((s) => {
      const aligned = alignCompareCurve(grid, s.curve);
      rows.forEach((row, ri) => { row[s.isin] = aligned[ri]; });
    });
    if (bench?.curve?.length) {
      const aligned = alignCompareCurve(grid, bench.curve);
      rows.forEach((row, ri) => { row.__bench = aligned[ri]; });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, fundData, hidden, benchmark]);

  const toggle = (isin: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(isin)) next.delete(isin);
      else next.add(isin);
      return next;
    });

  // Tableau : tous les supports (tracés ou non) + l'indice sur la fenêtre du donneur.
  const tableSeries = [
    ...series.map((s) => ({ key: s.isin, name: s.name, color: s.curve.length > 1 ? s.color : null, curve: s.curve })),
    ...(bench?.curve?.length ? [{ key: "__bench", name: bench.label, color: "#8A8780", curve: bench.curve }] : []),
  ];
  const horizonCols = HORIZONS.filter(
    (h) => h.days <= years * 366 && tableSeries.some((s) => trailingReturn(s.curve, h.days) != null),
  );
  const yearCols = useMemo(() => {
    const all = new Set<string>();
    for (const s of tableSeries) for (const y of Object.keys(calendarYearReturns(s.curve))) all.add(y);
    return Array.from(all).sort().slice(-MAX_CALENDAR_YEARS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundData, benchmark, years]);

  const seriesLabel = (dataKey: string): string => {
    if (dataKey === "__bench") return bench?.label ?? "Indice";
    const s = series.find((x) => x.isin === dataKey);
    return s ? shortName(s.name) : dataKey;
  };

  if (holdings.length === 0) return null;

  return (
    <Card className="px-5 py-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-label text-ink font-semibold">
          Historique des supports
          {pending && <span className="ml-2 text-meta text-muted font-normal">chargement…</span>}
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
      <p className="text-meta text-muted mb-4">
        Chaque support rebasé à 100 sur son propre historique, face à l&apos;indice
        (pointillé). Cliquer un support dans la légende pour le masquer ou le réafficher.
      </p>

      {/* Maturité demandée plus profonde que le support le plus ancien : on le dit
          en avertissement visible, sinon le graphe semble ignorer le sélecteur. */}
      {donor && grid.length > 1 &&
        new Date(grid[grid.length - 1]).getTime() - new Date(grid[0]).getTime() <
          (years - 0.5) * 365 * 86400_000 && (
        <p className="text-meta text-warn bg-warn-soft rounded-md px-3 py-2 mb-3">
          Les données ne couvrent pas {years} ans : le support le plus ancien du
          portefeuille n&apos;a des valeurs que depuis{" "}
          {new Date(grid[0]).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}.
        </p>
      )}

      {visible.length + (bench ? 1 : 0) > 0 && grid.length > 1 && (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DFDEDA" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#999895" }} tickLine={false}
              tickFormatter={(v: string) => { const d = new Date(v); return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; }}
              interval="preserveStartEnd" minTickGap={56} />
            <YAxis tick={{ fontSize: 10, fill: "#999895" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={40} />
            <Tooltip
              formatter={(v: unknown, n: unknown) => [typeof v === "number" ? v.toFixed(1) : "n.d.", seriesLabel(String(n))]}
              labelFormatter={(l: unknown) => { const d = new Date(String(l)); return isNaN(d.getTime()) ? String(l) : d.toLocaleDateString("fr-FR"); }}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #C9C7C2" }} />
            {visible.map((s) => (
              <Line key={s.isin} type="monotone" dataKey={s.isin}
                stroke={s.color!} strokeWidth={2} dot={false} />
            ))}
            {bench && <Line type="monotone" dataKey="__bench" stroke="#8A8780" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Légende cliquable : pastille couleur + nom + perf totale sur la fenêtre
          du support. Support masqué → grisé. */}
      {drawable.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 mt-3 mb-1">
          {drawable.map((s) => {
            const off = hidden.has(s.isin);
            return (
              <button
                key={s.isin}
                onClick={() => toggle(s.isin)}
                aria-pressed={!off}
                title={off ? "Réafficher ce support" : "Masquer ce support"}
                className={`flex items-baseline gap-2 min-w-0 text-left rounded-md px-1 -mx-1 py-0.5 transition-opacity hover:bg-paper-2 ${off ? "opacity-40" : ""}`}
              >
                <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 self-center" style={{ background: s.color! }} />
                <span className="min-w-0">
                  <span className="block text-meta text-ink truncate">{s.name}</span>
                  <span className="block text-caption text-muted">{fmtPct(s.totalReturn, true)}</span>
                </span>
              </button>
            );
          })}
          {bench && (
            <div className="flex items-baseline gap-2 min-w-0 px-1 py-0.5">
              <span className="inline-block w-2.5 h-0.5 shrink-0 self-center" style={{ background: "#8A8780" }} />
              <span className="min-w-0">
                <span className="block text-meta text-ink-2 truncate">{bench.label}</span>
                <span className="block text-caption text-muted">{fmtPct(bench.total_return, true)}</span>
              </span>
            </div>
          )}
        </div>
      )}

      {skipped > 0 && (
        <p className="text-caption text-muted-2 mt-2">
          {skipped} support{skipped > 1 ? "s" : ""} non tracé{skipped > 1 ? "s" : ""} (8 lignes
          maximum pour rester lisible) ; le tableau ci dessous couvre tout le portefeuille.
        </p>
      )}

      {!pending && drawable.length === 0 && (
        <p className="text-meta text-muted-2 py-4">
          Aucun support n&apos;a d&apos;historique de prix exploitable sur cette période.
        </p>
      )}

      {/* Tableau : perfs par horizon glissant puis par année civile. */}
      {tableSeries.some((s) => s.curve.length > 1) && (
        <div className="overflow-x-auto mt-5">
          <table className="w-full text-meta tabular-nums whitespace-nowrap">
            <thead>
              <tr className="text-caption text-muted uppercase tracking-widest border-b border-line">
                <th className="text-left py-2 pr-3 font-semibold">Support</th>
                {horizonCols.map((h) => (
                  <th key={h.days} className="text-right py-2 pl-3 font-semibold">{h.label}</th>
                ))}
                {yearCols.map((y) => (
                  <th key={y} className="text-right py-2 pl-3 font-semibold">{y}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableSeries.map((s) => {
                const cal = calendarYearReturns(s.curve);
                return (
                  <tr key={s.key} className="border-b border-line-soft last:border-0">
                    <td className="py-1.5 pr-3 text-ink-2 max-w-56">
                      <span className="flex items-center gap-2 min-w-0">
                        {s.color
                          ? <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
                          : <span className="inline-block w-2 h-2 shrink-0" />}
                        <span className="truncate">{shortName(s.name, 36)}</span>
                      </span>
                    </td>
                    {horizonCols.map((h) => (
                      <td key={h.days} className="py-1.5 pl-3 text-right text-ink">
                        {fmtPct(trailingReturn(s.curve, h.days), true)}
                      </td>
                    ))}
                    {yearCols.map((y) => (
                      <td key={y} className="py-1.5 pl-3 text-right text-ink-2">
                        {y in cal ? fmtPct(cal[y], true) : "n.d."}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
