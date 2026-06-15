import React from "react";
import type { FundDetailHF, FundHoldingHF, FundBreakdownHF } from "@/lib/types";
import { Card } from "@/components/ui/Card";

function pctStr(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

// Palette "Charlie earth tones" — assez disctincte pour 10 tranches
const PALETTE = [
  "#8B7355", "#6B9E9F", "#C4956A", "#7A8E6B", "#9E7A8B",
  "#5A7A8B", "#B8956A", "#6B7A5A", "#8B6B6B", "#6B8B7A",
];

function DonutChart({ items, size = 72 }: { items: FundBreakdownHF[]; size?: number }) {
  const total = items.reduce((s, x) => s + x.weight, 0);
  if (total === 0) return null;

  const cx = size / 2, cy = size / 2;
  const r  = size * 0.42;
  const ri = size * 0.26;

  let angle = -90;
  const paths: React.ReactNode[] = [];

  items.forEach((item, i) => {
    const frac = item.weight / total;
    if (frac < 0.005) return;
    const start = angle;
    const end   = angle + frac * 360;
    angle = end;

    const toRad = (d: number) => (d * Math.PI) / 180;
    const x1 = cx + r * Math.cos(toRad(start));
    const y1 = cy + r * Math.sin(toRad(start));
    const x2 = cx + r * Math.cos(toRad(end));
    const y2 = cy + r * Math.sin(toRad(end));
    const xi1 = cx + ri * Math.cos(toRad(start));
    const yi1 = cy + ri * Math.sin(toRad(start));
    const xi2 = cx + ri * Math.cos(toRad(end));
    const yi2 = cy + ri * Math.sin(toRad(end));
    const large = frac > 0.5 ? 1 : 0;

    paths.push(
      <path
        key={i}
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ri} ${ri} 0 ${large} 0 ${xi1} ${yi1} Z`}
        fill={PALETTE[i % PALETTE.length]}
        opacity={0.9}
      />
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {paths}
    </svg>
  );
}

function LegendRow({ label, weight, color }: { label: string; weight: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-caption text-muted flex-1 truncate">{label}</span>
      <span className="text-caption font-mono text-ink-2 shrink-0">{pctStr(weight)}</span>
    </div>
  );
}

function BreakdownPanel({
  title, items, showDonut = true,
}: {
  title: string; items: FundBreakdownHF[]; showDonut?: boolean;
}) {
  if (items.length === 0) return null;
  const top = items.slice(0, 8);

  return (
    <div>
      <p className="text-caption uppercase tracking-wider text-muted-2 mb-3 font-semibold">{title}</p>
      {showDonut ? (
        <div className="flex gap-3 items-start">
          <DonutChart items={top} size={72} />
          <div className="flex-1 min-w-0 space-y-1">
            {top.map((s, i) => (
              <LegendRow key={s.label} label={s.label} weight={s.weight} color={PALETTE[i % PALETTE.length]} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {top.map((s, i) => (
            <LegendRow key={s.label} label={s.label} weight={s.weight} color={PALETTE[i % PALETTE.length]} />
          ))}
        </div>
      )}
    </div>
  );
}

function HoldingRow({ holding, rank }: { holding: FundHoldingHF; rank: number }) {
  const barPct = Math.min(holding.weight * 100 / 15, 100);
  return (
    <div className="flex items-center gap-2.5 py-1 border-b border-line-soft last:border-0">
      <span className="text-caption text-muted-2 font-mono w-4 shrink-0 text-right">{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="text-label text-ink-2 truncate leading-tight">{holding.position_name}</div>
        <div
          className="mt-0.5 h-[3px] rounded-full bg-accent/25"
          style={{ width: `${barPct}%` }}
        />
      </div>
      <span className="text-label font-mono text-ink shrink-0 font-medium">{pctStr(holding.weight)}</span>
    </div>
  );
}

export function CompositionCard({ fund }: { fund: FundDetailHF }) {
  const { holdings, sectors, geos } = fund;
  const hasHoldings = holdings.length > 0;
  const hasSectors  = sectors.length > 0;
  const hasGeos     = geos.length > 0;

  if (!hasHoldings && !hasSectors && !hasGeos) return null;

  const colCount = [hasHoldings, hasSectors || hasGeos].filter(Boolean).length;

  return (
    <Card className="px-4 py-4 md:px-6 md:py-5 md:col-span-2">
      <h3 className="text-label uppercase tracking-widest text-muted font-semibold mb-5">
        Composition du portefeuille
      </h3>

      <div className={`grid gap-6 md:gap-8 ${colCount >= 2 ? "grid-cols-1 md:grid-cols-[1fr_1fr]" : "grid-cols-1"}`}>
        {/* Top holdings */}
        {hasHoldings && (
          <div>
            <p className="text-caption uppercase tracking-wider text-muted-2 mb-3 font-semibold">
              Top {holdings.length} positions
            </p>
            <div>
              {holdings.map((h, i) => (
                <HoldingRow key={h.rank} holding={h} rank={i + 1} />
              ))}
            </div>
          </div>
        )}

        {/* Breakdown panels (sectors + geos) */}
        {(hasSectors || hasGeos) && (
          <div className={`space-y-6 ${!hasHoldings ? "col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 space-y-0" : ""}`}>
            <BreakdownPanel title="Répartition sectorielle" items={sectors} showDonut={hasSectors} />
            <BreakdownPanel title="Zones géographiques"     items={geos}    showDonut={hasGeos} />
          </div>
        )}
      </div>
    </Card>
  );
}
