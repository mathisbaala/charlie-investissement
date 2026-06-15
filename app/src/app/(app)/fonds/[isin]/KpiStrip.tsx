"use client";

import { pct, fmtSharpe } from "@/lib/format";
import type { FundDetailHF } from "@/lib/types";

function KpiTile({ label, value, ok, accent }: { label: string; value: string; ok?: boolean | null; accent?: boolean }) {
  return (
    <div className={`md:flex-1 rounded-xl border px-3 py-3 md:px-5 md:py-4 text-center min-w-0 ${accent ? "bg-accent/10 border-accent/30" : "bg-paper border-line"}`}>
      <p className="text-caption md:text-caption uppercase tracking-widest text-muted font-semibold mb-1.5 md:mb-2 truncate">{label}</p>
      <p
        className={`text-title md:text-title-lg leading-none font-normal ${
          accent ? "text-accent font-semibold" : ok == null ? "text-ink" : ok ? "text-ok" : "text-danger"
        }`}
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {value}
      </p>
    </div>
  );
}

export function KpiStrip({ fund }: { fund: FundDetailHF }) {
  // Garde-fou : ne jamais afficher une perf sur une période plus longue que
  // l'ancienneté du fonds (un fonds de 6 mois n'a pas de perf 3A/5A). Quand
  // l'ancienneté est inconnue, on laisse passer (rien à invalider).
  const tr = fund.track_record_years;
  const hasPeriod = (years: number) => tr == null || tr >= years - 0.25;

  const show1 = fund.performance_1y != null && hasPeriod(1);
  const show3 = fund.performance_3y != null && hasPeriod(3);
  const show5 = fund.performance_5y != null && hasPeriod(5);

  const perf5 = show5
    ? { label: "Perf 5A", value: pct(fund.performance_5y!, true), ok: fund.performance_5y! >= 0 }
    : null;

  const tiles: { label: string; value: string; ok?: boolean | null; accent?: boolean }[] = [
    ...(show1 ? [{ label: "Perf 1A", value: pct(fund.performance_1y!, true), ok: fund.performance_1y! >= 0 }] : []),
    ...(show3 ? [{ label: "Perf 3A", value: pct(fund.performance_3y!, true), ok: fund.performance_3y! >= 0 }] : []),
    ...(perf5 ? [perf5] : []),
    { label: "Frais courants", value: pct(fund.ongoing_charges ?? fund.ter) },
    { label: "Volatilité 1A", value: pct(fund.volatility_1y) },
    ...(fund.sharpe_1y != null ? [{ label: "Sharpe 1A", value: fmtSharpe(fund.sharpe_1y) }] : []),
  ];

  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2.5 md:flex md:gap-3 md:overflow-x-auto pb-1">
      {tiles.map(t => (
        <KpiTile key={t.label} label={t.label} value={t.value} ok={t.ok} accent={t.accent} />
      ))}
    </div>
  );
}
