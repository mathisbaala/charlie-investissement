"use client";

import React from "react";
import { pct, fmtSharpe } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

function KpiTile({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  return (
    <div className="flex-1 bg-paper rounded-xl border border-line px-5 py-4 text-center min-w-0">
      <p className="text-[9.5px] uppercase tracking-widest text-muted font-semibold mb-2">{label}</p>
      <p
        className={`text-[22px] leading-none font-normal ${
          ok == null ? "text-ink" : ok ? "text-ok" : "text-warn"
        }`}
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {value}
      </p>
    </div>
  );
}

export function KpiStrip({ fund }: { fund: FundDetailHF }) {
  const tiles = [
    { label: "Perf 1A", value: pct(fund.performance_1y, true), ok: fund.performance_1y == null ? null : fund.performance_1y >= 0 },
    fund.performance_3y != null ? { label: "Perf 3A", value: pct(fund.performance_3y, true), ok: fund.performance_3y >= 0 } : null,
    fund.performance_5y != null ? { label: "Perf 5A", value: pct(fund.performance_5y, true), ok: fund.performance_5y >= 0 } : null,
    { label: "Frais courants", value: pct(fund.ongoing_charges ?? fund.ter), ok: null },
    { label: "Volatilité 1A", value: pct(fund.volatility_1y), ok: null },
    fund.sharpe_1y != null ? { label: "Sharpe 1A", value: fmtSharpe(fund.sharpe_1y), ok: null } : null,
  ].filter(Boolean) as { label: string; value: string; ok: boolean | null }[];

  if (tiles.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {tiles.map(t => (
        <KpiTile key={t.label} label={t.label} value={t.value} ok={t.ok} />
      ))}
    </div>
  );
}
