"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { donutSegments } from "@/lib/pdf/chartMath";
import type { Expo, ExpoRow } from "@/lib/lookthrough";
import { aggregateExposure } from "@/lib/presentationExtras";

// Répartitions géographique et sectorielle du portefeuille, par transparence
// des fonds (look-through), PONDÉRÉES PAR LES POIDS COURANTS — y compris les
// poids simulés que le conseiller ajuste dans le bloc risque/rendement juste
// au-dessus : les compositions par fonds sont chargées une fois (elles ne
// dépendent que des ISIN), l'agrégation est recalculée à chaque changement de
// poids, les camemberts suivent donc les curseurs en direct.

// Anneaux : tons terre de la charte (variante des SERIES du PDF, chroma relevé
// pour l'écran — lisibilité et écarts daltonisme validés sur fond papier).
// « Autres » porte un gris neutre : c'est un reliquat, pas une catégorie.
const SLICE_COLORS = ["#9F4325", "#2E6E9E", "#A2791F", "#1E7A4F", "#6B4E8C"] as const;
const OTHER_COLOR = "#8A867C";
const OTHER_LABEL = "Autres";

const sliceColor = (e: Expo, i: number) =>
  e.label === OTHER_LABEL ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length];

const fmtPct = (w: number) =>
  `${w.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;

/** Camembert (anneau) + légende d'une exposition agrégée (poids en %). */
function ExposureDonut({ title, expo, missingPct }: { title: string; expo: Expo[]; missingPct: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (expo.length === 0) return null;
  const size = 148;
  const r = size / 2;
  const segs = donutSegments(expo.map((e) => e.weight), { cx: r, cy: r, rOuter: r, rInner: r * 0.62, gap: 2 });
  const active = hover != null ? expo[hover] : null;
  return (
    <div className="flex-1 min-w-[250px] max-w-md">
      <h3 className="text-meta font-semibold text-ink mb-3">{title}</h3>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={title}>
            {segs.map((s, i) => (
              <path
                key={i}
                d={s.d}
                fill={sliceColor(expo[i], i)}
                opacity={hover == null || hover === i ? 1 : 0.35}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${expo[i].label} : ${fmtPct(expo[i].weight)}`}</title>
              </path>
            ))}
          </svg>
          {active && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
              <span className="text-label font-semibold text-ink tabular-nums">{fmtPct(active.weight)}</span>
              <span className="text-caption text-muted leading-tight">{active.label}</span>
            </div>
          )}
        </div>
        <ul className="flex-1 min-w-0 space-y-1.5">
          {expo.map((e, i) => (
            <li
              key={e.label}
              className="flex items-baseline gap-2 text-caption"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                className="w-2.5 h-2.5 rounded-[3px] shrink-0 self-center"
                style={{ background: sliceColor(e, i) }}
              />
              <span className="text-ink-2 truncate">{e.label}</span>
              <span className="text-muted tabular-nums ml-auto pl-2 shrink-0">{fmtPct(e.weight)}</span>
            </li>
          ))}
        </ul>
      </div>
      {missingPct > 0.5 && (
        <p className="text-caption text-muted-2 mt-2 leading-snug">
          Hors {fmtPct(missingPct)} du portefeuille sans donnée de composition.
        </p>
      )}
    </div>
  );
}

export function PortfolioExposure({ lines }: { lines: { isin: string; weight: number }[] }) {
  const [rows, setRows] = useState<{ geo: ExpoRow[]; sectors: ExpoRow[] } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Les compositions ne dépendent que de l'ENSEMBLE des fonds : pas de re-fetch
  // quand seuls les poids bougent (curseurs de simulation).
  const isinsKey = useMemo(
    () => Array.from(new Set(lines.map((l) => l.isin))).sort().join(","),
    [lines],
  );

  // Même garde de montage que CabinetForm : en mode strict React (dev), le
  // composant est monté/démonté/remonté — sans remise à true, la réponse du
  // fetch serait ignorée pour toujours.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isinsKey) return;
    setStatus("loading");
    try {
      fetch(`/api/portfolio/exposure?isins=${encodeURIComponent(isinsKey)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http"))))
        .then((j: { geo?: ExpoRow[]; sectors?: ExpoRow[] }) => {
          if (!mountedRef.current) return;
          setRows({ geo: j.geo ?? [], sectors: j.sectors ?? [] });
          setStatus("ready");
        })
        .catch(() => { if (mountedRef.current) setStatus("error"); });
    } catch {
      setStatus("error");
    }
  }, [isinsKey]);

  // Agrégation pondérée par les poids courants, recalculée à chaque ajustement
  // des poids simulés (même brique que les exports PDF / PowerPoint).
  const { geo, sectors } = useMemo(
    () => (rows ? aggregateExposure(rows, lines) : { geo: [], sectors: [] }),
    [rows, lines],
  );

  // Part du portefeuille sans donnée, PAR ventilation (un fonds peut avoir sa
  // géo mais pas ses secteurs) : affichée sous le camembert concerné.
  const missingPct = (expoRows: ExpoRow[]): number => {
    const have = new Set(expoRows.map((r) => r.isin));
    const missing = lines.filter((l) => !have.has(l.isin)).reduce((s, l) => s + l.weight, 0);
    return Math.round(missing * 10) / 10;
  };

  // Rien d'exploitable (fonds hors base, erreur réseau) → pas de carte vide.
  if (status === "error") return null;
  if (status === "ready" && geo.length === 0 && sectors.length === 0) return null;

  return (
    <Card className="px-5 py-5">
      <h2 className="text-label text-ink font-semibold mb-1">Répartition du portefeuille</h2>
      <p className="text-meta text-muted mb-4">
        Par transparence des fonds (look-through), pondérée par les poids
        ci-dessus — les camemberts suivent vos ajustements.
      </p>
      {status === "loading" ? (
        <p className="text-meta text-muted-2">Chargement des compositions…</p>
      ) : (
        <div className="flex flex-wrap gap-x-12 gap-y-6">
          <ExposureDonut title="Répartition géographique" expo={geo} missingPct={missingPct(rows!.geo)} />
          <ExposureDonut title="Répartition sectorielle" expo={sectors} missingPct={missingPct(rows!.sectors)} />
        </div>
      )}
    </Card>
  );
}
