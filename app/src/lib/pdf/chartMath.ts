// ─────────────────────────────────────────────────────────────────────────────
// Mathématiques pures des graphiques PDF (aucun JSX, entièrement testable).
// Projette des séries temporelles vers des coordonnées SVG, construit les
// chemins de courbe / d'aire, et calcule les segments d'un donut. Les composants
// React-PDF (charts.tsx) ne font que consommer ces sorties.
// ─────────────────────────────────────────────────────────────────────────────

export type Pt = { t: number; v: number };
export type XY = { x: number; y: number };
export type Bounds = { minT: number; maxT: number; minV: number; maxV: number };

/**
 * Rebase une série de valeurs sur base 100 (première valeur strictement positive).
 * Convention factsheet : compare des trajectoires d'échelles différentes.
 */
export function rebase100(values: number[]): number[] {
  const base = values.find((v) => Number.isFinite(v) && v > 0);
  if (base == null) return values.map(() => 100);
  return values.map((v) => (Number.isFinite(v) ? (v / base) * 100 : 100));
}

/**
 * Sous-échantillonne une série à au plus `max` points (pas régulier, garde le
 * dernier). Garde les PDF légers sans déformer la forme de la courbe.
 */
export function downsample<T>(arr: T[], max: number): T[] {
  if (max <= 0 || arr.length <= max) return arr.slice();
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/** Bornes communes (temps + valeur) sur une ou plusieurs séries. */
export function seriesBounds(series: Pt[][]): Bounds | null {
  let minT = Infinity, maxT = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const s of series) {
    for (const p of s) {
      if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
      if (p.t < minT) minT = p.t;
      if (p.t > maxT) maxT = p.t;
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
    }
  }
  if (!Number.isFinite(minT) || !Number.isFinite(minV)) return null;
  // Évite une amplitude nulle (série plate) → division par zéro.
  if (maxV - minV < 1e-9) { minV -= 1; maxV += 1; }
  if (maxT - minT < 1e-9) { maxT = minT + 1; }
  return { minT, maxT, minV, maxV };
}

/**
 * Projette une série temporelle vers les coordonnées d'un canevas SVG `w`×`h`,
 * avec marges verticales `pad`. Y inversé (0 en haut). Ignore les points hors
 * domaine de valeur (NaN).
 */
export function projectSeries(pts: Pt[], b: Bounds, w: number, h: number, pad = 6): XY[] {
  const innerH = h - pad * 2;
  const spanT = b.maxT - b.minT;
  const spanV = b.maxV - b.minV;
  return pts
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .map((p) => ({
      x: ((p.t - b.minT) / spanT) * w,
      y: pad + innerH - ((p.v - b.minV) / spanV) * innerH,
    }));
}

/** Attribut `points` d'un <Polyline> SVG (« x,y x,y … »), arrondi à 0,1. */
export function polylinePoints(pts: XY[]): string {
  return pts.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

/** Chemin d'aire fermé sous la courbe (pour un remplissage dégradé). */
export function areaPath(pts: XY[], baselineY: number): string {
  if (pts.length === 0) return "";
  const head = `M ${round(pts[0].x)} ${round(baselineY)} L ${round(pts[0].x)} ${round(pts[0].y)}`;
  const line = pts.slice(1).map((p) => `L ${round(p.x)} ${round(p.y)}`).join(" ");
  const tail = `L ${round(pts[pts.length - 1].x)} ${round(baselineY)} Z`;
  return `${head} ${line} ${tail}`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Donut ───────────────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, angleDeg: number): XY {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export type DonutSeg = { d: string; value: number; share: number };

/**
 * Segments d'anneau (donut) à partir de valeurs positives. `share` = fraction du
 * total (0-1). Le reliquat (100 % − somme) n'est pas dessiné : l'anneau peut être
 * partiel, ce qui est honnête quand la ventilation est incomplète.
 */
export function donutSegments(
  values: number[],
  opts: { cx: number; cy: number; rOuter: number; rInner: number; gap?: number },
): DonutSeg[] {
  const { cx, cy, rOuter, rInner, gap = 1.5 } = opts;
  const total = values.reduce((a, v) => a + (v > 0 ? v : 0), 0);
  if (total <= 0) return [];
  let angle = 0;
  const segs: DonutSeg[] = [];
  for (const v of values) {
    if (v <= 0) continue;
    const sweep = (v / total) * 360;
    const a0 = angle + (sweep > gap ? gap / 2 : 0);
    const a1 = angle + sweep - (sweep > gap ? gap / 2 : 0);
    const large = a1 - a0 > 180 ? 1 : 0;
    const p0 = polar(cx, cy, rOuter, a0);
    const p1 = polar(cx, cy, rOuter, a1);
    const p2 = polar(cx, cy, rInner, a1);
    const p3 = polar(cx, cy, rInner, a0);
    segs.push({
      d:
        `M ${round(p0.x)} ${round(p0.y)} ` +
        `A ${rOuter} ${rOuter} 0 ${large} 1 ${round(p1.x)} ${round(p1.y)} ` +
        `L ${round(p2.x)} ${round(p2.y)} ` +
        `A ${rInner} ${rInner} 0 ${large} 0 ${round(p3.x)} ${round(p3.y)} Z`,
      value: v,
      share: v / total,
    });
    angle += sweep;
  }
  return segs;
}

/** Échelle « jolie » de date pour l'axe X : libellés mois/année aux extrémités. */
export function axisDateLabels(minT: number, maxT: number): { start: string; end: string } {
  const f = (t: number) => {
    const d = new Date(t);
    const s = d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
    return s.replace(".", "");
  };
  return { start: f(minT), end: f(maxT) };
}
