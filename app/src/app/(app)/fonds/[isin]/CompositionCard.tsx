import React from "react";
import type { FundDetailHF, FundHoldingHF, FundBreakdownHF } from "@/lib/types";

function pctStr(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function BarRow({ label, weight, maxWeight }: { label: string; weight: number; maxWeight: number }) {
  const barPct = maxWeight > 0 ? (weight / maxWeight) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-muted shrink-0 w-36 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-paper-2 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent/70 rounded-full"
          style={{ width: `${barPct}%` }}
        />
      </div>
      <span className="text-[11px] font-mono text-ink-2 shrink-0 w-12 text-right">
        {pctStr(weight)}
      </span>
    </div>
  );
}

function HoldingRow({ holding }: { holding: FundHoldingHF }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-line-soft last:border-0">
      <span className="text-[10px] text-muted-2 font-mono w-4 shrink-0">{holding.rank}</span>
      <span className="flex-1 text-[11px] text-ink-2 truncate">{holding.position_name}</span>
      {holding.country && (
        <span className="text-[10px] text-muted shrink-0">{holding.country}</span>
      )}
      <span className="text-[11px] font-mono text-ink shrink-0 w-12 text-right font-medium">
        {pctStr(holding.weight)}
      </span>
    </div>
  );
}

export function CompositionCard({ fund }: { fund: FundDetailHF }) {
  const { holdings, sectors, geos } = fund;
  const hasHoldings = holdings.length > 0;
  const hasSectors  = sectors.length > 0;
  const hasGeos     = geos.length > 0;

  if (!hasHoldings && !hasSectors && !hasGeos) return null;

  const maxSectorW = hasSectors ? Math.max(...sectors.map(s => s.weight)) : 0;
  const maxGeoW    = hasGeos    ? Math.max(...geos.map(g => g.weight))    : 0;

  return (
    <div className="bg-paper rounded-2xl border border-line px-6 py-5 col-span-2">
      <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-5">
        Composition du portefeuille
      </h3>

      <div className="grid grid-cols-3 gap-8">
        {/* Top holdings */}
        {hasHoldings && (
          <div className="col-span-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-2 mb-3 font-medium">
              Top {holdings.length} positions
            </p>
            <div>
              {holdings.map(h => (
                <HoldingRow key={h.rank} holding={h} />
              ))}
            </div>
          </div>
        )}

        {/* Sector breakdown */}
        {hasSectors && (
          <div className={hasHoldings ? "col-span-1" : "col-span-2"}>
            <p className="text-[10px] uppercase tracking-wider text-muted-2 mb-3 font-medium">
              Secteurs
            </p>
            <div className="space-y-2">
              {sectors.slice(0, 10).map(s => (
                <BarRow key={s.label} label={s.label} weight={s.weight} maxWeight={maxSectorW} />
              ))}
            </div>
          </div>
        )}

        {/* Geo breakdown */}
        {hasGeos && (
          <div className={!hasHoldings && !hasSectors ? "col-span-3" : "col-span-1"}>
            <p className="text-[10px] uppercase tracking-wider text-muted-2 mb-3 font-medium">
              Zones géographiques
            </p>
            <div className="space-y-2">
              {geos.slice(0, 10).map(g => (
                <BarRow key={g.label} label={g.label} weight={g.weight} maxWeight={maxGeoW} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
