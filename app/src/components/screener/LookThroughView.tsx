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
type Data = { geo: Expo[]; sectors: Expo[]; overlaps: Overlap[] };

function Bars({ title, rows }: { title: string; rows: Expo[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.weight), 1);
  return (
    <div>
      <p className="text-caption uppercase tracking-[0.1em] text-muted font-semibold mb-2.5">{title}</p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3" role="img" aria-label={`${r.label} : ${pct(r.weight)}`}>
            <span className="text-meta text-ink-2 w-40 shrink-0 truncate" aria-hidden="true">{r.label}</span>
            <div className="flex-1 h-2 bg-paper-2 rounded-full overflow-hidden" aria-hidden="true">
              <div className="h-full bg-accent/70 rounded-full" style={{ width: `${(r.weight / max) * 100}%` }} />
            </div>
            <span className="text-meta font-mono text-ink-2 w-14 text-right shrink-0" aria-hidden="true">{pct(r.weight)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LookThroughView({ funds }: { funds: SelectedFund[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Clé stable : `funds` est un nouveau tableau à chaque render du parent ; on
  // dépend de la liste d'ISIN (string) pour ne re-fetcher QUE sur changement réel
  // de sélection. La garde `ignore` jette une réponse périmée si la sélection a
  // changé entre-temps (évite d'écraser le bon résultat par un ancien).
  const isinsKey = funds.map((f) => f.isin).join(",");

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(false);
    fetch(`/api/portfolio/lookthrough?isins=${isinsKey}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => { if (!ignore) setData(d); })
      .catch(() => { if (!ignore) { setData(null); setError(true); } })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [isinsKey]);

  // TER moyen équipondéré (depuis la sélection, déjà en %).
  const terVals = funds.map((f) => f.ongoing_charges).filter((v): v is number => v != null);
  const blendedTer = terVals.length ? terVals.reduce((a, b) => a + b, 0) / terVals.length : null;

  const nameByIsin = new Map(funds.map((f) => [f.isin, f.name]));

  const hasExpo = data && (data.geo.length > 0 || data.sectors.length > 0);
  const hasOverlap = data && data.overlaps.length > 0;

  return (
    <div className="px-6 py-5 space-y-7">
      <p className="text-label text-ink-2 leading-snug">
        Vue <span className="font-semibold">look-through</span> : exposition agrégée des fonds
        sélectionnés (équipondérés) et lignes communes à plusieurs fonds (double-emploi).
      </p>

      {blendedTer != null && (
        <div className="flex items-baseline gap-2">
          <span className="text-meta text-muted">Frais courants moyens (équipondérés)</span>
          <span className="text-title font-mono text-ink" style={{ fontFamily: "var(--font-serif)" }}>
            {pct(blendedTer)}
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-meta text-muted-2 italic">Calcul de l&apos;exposition agrégée…</p>
      ) : (
        <>
          {hasExpo && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
              <Bars title="Zones géographiques (agrégé)" rows={data!.geo} />
              <Bars title="Secteurs (agrégé)" rows={data!.sectors} />
            </div>
          )}

          {hasOverlap && (
            <div>
              <p className="text-caption uppercase tracking-[0.1em] text-muted font-semibold mb-2.5">
                Lignes communes · double-emploi
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
                      {(() => {
                        const detail = o.funds.map((x) => `${nameByIsin.get(x.isin) ?? x.isin} : ${pct(x.weight)}`).join("\n");
                        return (
                          <span className="text-caption text-muted-2" title={detail} aria-label={`jusqu'à ${pct(o.max_weight)} — ${detail.replace(/\n/g, ", ")}`}>
                            jusqu&apos;à {pct(o.max_weight)}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-caption text-muted-2 mt-2 leading-snug">
                Une même valeur détenue par plusieurs fonds concentre le risque : à vérifier
                avant d&apos;additionner les lignes d&apos;une allocation.
              </p>
            </div>
          )}

          {!hasExpo && !hasOverlap && (
            <p className="text-meta text-muted-2 italic leading-snug">
              {error
                ? "Impossible de charger l'exposition agrégée pour le moment. Réessayez."
                : "Exposition agrégée indisponible pour cette sélection."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
