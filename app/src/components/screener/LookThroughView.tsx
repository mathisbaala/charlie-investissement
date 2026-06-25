"use client";

import React, { useEffect, useState } from "react";
import { pct } from "@/lib/format";
import type { SelectedFund } from "@/components/SelectionProvider";

type Expo = { label: string; weight: number };
type Overlap = {
  name: string;
  ticker: string | null;
  count: number;
  funds: { isin: string; weight: number }[];
  max_weight: number;
};
type Data = {
  geoByFund: Record<string, Expo[]>;
  sectorsByFund: Record<string, Expo[]>;
  overlaps: Overlap[];
};

function short(name: string): string {
  return name.length > 16 ? name.slice(0, 15) + "…" : name;
}

// Ombrage léger de la cellule proportionnel au poids (lecture rapide des écarts).
function cellShade(w: number | null): React.CSSProperties {
  if (w == null) return {};
  const a = Math.min(0.5, w / 120);
  return { background: `oklch(0.62 0.12 40 / ${a})` };
}

// Matrice fond par fond : lignes = zones / secteurs, colonnes = fonds. Aucune
// agrégation : chaque fonds garde son exposition propre.
function Matrix({ title, byFund, funds }: { title: string; byFund: Record<string, Expo[]>; funds: SelectedFund[] }) {
  const labelMax = new Map<string, number>();
  for (const f of funds) for (const e of byFund[f.isin] ?? []) labelMax.set(e.label, Math.max(labelMax.get(e.label) ?? 0, e.weight));
  const labels = [...labelMax.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([l]) => l);
  if (!labels.length) return null;
  const wOf = (isin: string, label: string) => (byFund[isin] ?? []).find((e) => e.label === label)?.weight ?? null;

  return (
    <div className="overflow-x-auto">
      <p className="text-caption uppercase tracking-[0.1em] text-muted font-semibold mb-2.5">{title}</p>
      <table className="w-full text-meta tabular-nums border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className="text-left py-1.5" />
            {funds.map((f) => (
              <th key={f.isin} className="py-1.5 px-2 text-right font-medium text-ink-2 text-caption whitespace-nowrap" title={f.name}>
                {short(f.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label) => (
            <tr key={label} className="border-b border-line-soft last:border-0">
              <td className="py-1.5 pr-3 text-ink-2 whitespace-nowrap">{label}</td>
              {funds.map((f) => {
                const w = wOf(f.isin, label);
                return (
                  <td key={f.isin} className="py-1.5 px-2 text-right rounded-sm" style={cellShade(w)}>
                    {w == null ? <span className="text-muted-2">—</span> : pct(w)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LookThroughView({ funds }: { funds: SelectedFund[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const isinsKey = funds.map((f) => f.isin).join(",");

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(false);
    fetch(`/api/portfolio/lookthrough?isins=${isinsKey}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => { if (!ignore) setData(d); })
      .catch(() => { if (!ignore) { setData(null); setError(true); } })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [isinsKey]);

  const nameByIsin = new Map(funds.map((f) => [f.isin, f.name]));
  const hasGeo = data && funds.some((f) => (data.geoByFund[f.isin] ?? []).length > 0);
  const hasSec = data && funds.some((f) => (data.sectorsByFund[f.isin] ?? []).length > 0);
  const hasOverlap = data && data.overlaps.length > 0;

  return (
    <div className="px-6 py-5 space-y-7">
      {loading ? (
        <p className="text-meta text-muted-2">Chargement…</p>
      ) : (
        <>
          {hasGeo && <Matrix title="Zones géographiques" byFund={data!.geoByFund} funds={funds} />}
          {hasSec && <Matrix title="Secteurs" byFund={data!.sectorsByFund} funds={funds} />}

          {hasOverlap && (
            <div>
              <p className="text-caption uppercase tracking-[0.1em] text-muted font-semibold mb-2.5">
                Lignes communes
              </p>
              <div className="space-y-1.5">
                {data!.overlaps.map((o) => (
                  <div key={(o.ticker ?? o.name)} className="flex items-center justify-between gap-3 border-b border-line-soft pb-1.5 last:border-0">
                    <div className="min-w-0">
                      <span className="text-meta text-ink-2 font-medium">{o.name}</span>
                      {o.ticker && <span className="text-caption text-muted-2 font-mono ml-2">{o.ticker}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-caption px-2 py-0.5 rounded-full font-medium border bg-warn-soft text-warn border-warn/20">
                        {o.count} fonds
                      </span>
                      <span
                        className="text-caption text-muted-2"
                        title={o.funds.map((x) => `${nameByIsin.get(x.isin) ?? x.isin} : ${pct(x.weight)}`).join("\n")}
                      >
                        jusqu&apos;à {pct(o.max_weight)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasGeo && !hasSec && !hasOverlap && (
            <p className="text-meta text-muted-2">
              {error ? "Données indisponibles pour le moment." : "Pas de composition disponible pour ces fonds."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
