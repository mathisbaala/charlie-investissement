"use client";

import { pct, fmtSharpe } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

function KpiTile({ label, value, ok, accent }: { label: string; value: string; ok?: boolean | null; accent?: boolean }) {
  return (
    <div className={`flex-1 rounded-xl border px-5 py-4 text-center min-w-0 ${accent ? "bg-accent/10 border-accent/30" : "bg-paper border-line"}`}>
      <p className="text-[9.5px] uppercase tracking-widest text-muted font-semibold mb-2">{label}</p>
      <p
        className={`text-[22px] leading-none font-normal ${
          accent ? "text-accent font-semibold" : ok == null ? "text-ink" : ok ? "text-ok" : "text-warn"
        }`}
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {value}
      </p>
    </div>
  );
}

export function KpiStrip({ fund }: { fund: FundDetailHF }) {
  const perf5OrAvg = fund.performance_5y != null
    ? { label: "Perf 5A", value: pct(fund.performance_5y, true), ok: fund.performance_5y >= 0 }
    : fund.average_performance != null
    ? { label: "Perf moy.", value: pct(fund.average_performance, true), ok: fund.average_performance >= 0 }
    : null;

  const tiles: { label: string; value: string; ok?: boolean | null; accent?: boolean }[] = [
    { label: "Perf 1A", value: pct(fund.performance_1y, true), ok: fund.performance_1y == null ? null : fund.performance_1y >= 0 },
    ...(fund.performance_3y != null ? [{ label: "Perf 3A", value: pct(fund.performance_3y, true), ok: fund.performance_3y >= 0 }] : []),
    ...(perf5OrAvg ? [perf5OrAvg] : []),
    { label: "Frais courants", value: pct(fund.ongoing_charges ?? fund.ter) },
    { label: "Volatilité 1A", value: pct(fund.volatility_1y) },
    ...(fund.sharpe_1y != null ? [{ label: "Sharpe 1A", value: fmtSharpe(fund.sharpe_1y) }] : []),
  ];

  if (tiles.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {tiles.map(t => (
        <KpiTile key={t.label} label={t.label} value={t.value} ok={t.ok} accent={t.accent} />
      ))}
    </div>
  );
}
