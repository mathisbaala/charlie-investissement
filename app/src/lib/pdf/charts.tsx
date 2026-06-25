import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { Svg, Path, Polyline, Line, Defs, LinearGradient, Stop, Rect } from "@react-pdf/renderer";
import { C, FONT, perfColor } from "./theme";
import {
  type Pt,
  seriesBounds,
  projectSeries,
  polylinePoints,
  areaPath,
  donutSegments,
  axisDateLabels,
  downsample,
} from "./chartMath";

// Palette de séries (courbes / donut). Accent clay en tête, puis tons terre
// distincts et lisibles en impression. Étendue/réutilisée par tous les charts.
export const SERIES = ["#9F4325", "#3B6B8C", "#9A7B33", "#1E7A4F", "#6B4E8C", "#A83A2A"] as const;

const s = StyleSheet.create({
  chartFrame: { borderRadius: 7, overflow: "hidden" },
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  axisLabel: { fontFamily: FONT.sans, fontSize: 6.5, color: C.muted },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 7 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatch: { width: 8, height: 3, borderRadius: 2 },
  legendText: { fontFamily: FONT.sans, fontSize: 7.5, color: C.ink2 },
  legendVal: { fontFamily: FONT.mono, fontSize: 7.5, color: C.muted },
  // Donut
  donutWrap: { flexDirection: "row", alignItems: "center", gap: 14 },
  donutCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  donutCenterVal: { fontFamily: FONT.serif, fontSize: 13, color: C.ink },
  donutCenterLbl: { fontFamily: FONT.sans, fontSize: 6, letterSpacing: 0.8, textTransform: "uppercase", color: C.muted },
  // Barres de composition
  compRow: { marginBottom: 6 },
  compHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2.5 },
  compLabel: { fontFamily: FONT.sans, fontSize: 8, color: C.ink2 },
  compVal: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 8, color: C.ink },
  compTrack: { height: 4.5, backgroundColor: C.lineSoft, borderRadius: 3, overflow: "hidden" },
  compFill: { height: 4.5, borderRadius: 3 },
});

export type Series = { name: string; points: Pt[]; color?: string; perf?: number | null };

/**
 * Courbe de performance base 100, mono ou multi-séries, avec aire dégradée sous
 * la première série et grille horizontale légère. Les séries doivent déjà être
 * rebasées (cf. chartMath.rebase100) et partager la même échelle de valeur.
 */
export function LineChartPdf({
  series,
  width,
  height,
  showArea = true,
}: {
  series: Series[];
  width: number;
  height: number;
  showArea?: boolean;
}) {
  const clean = series
    .map((ser) => ({ ...ser, points: downsample(ser.points, 130) }))
    .filter((ser) => ser.points.length >= 2);
  const bounds = seriesBounds(clean.map((ser) => ser.points));
  if (!bounds) {
    return (
      <View style={[s.chartFrame, { width, height, backgroundColor: C.paper, alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ fontFamily: FONT.sans, fontSize: 8, color: C.muted }}>Historique de prix indisponible</Text>
      </View>
    );
  }
  const dates = axisDateLabels(bounds.minT, bounds.maxT);
  const projected = clean.map((ser) => ({
    ...ser,
    xy: projectSeries(ser.points, bounds, width, height),
  }));
  // Lignes de grille à 25/50/75 % de la hauteur utile.
  const gridY = [0.25, 0.5, 0.75].map((f) => 6 + (height - 12) * f);

  return (
    <View>
      <Svg width={width} height={height} style={s.chartFrame}>
        <Defs>
          <LinearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={projected[0]?.color ?? SERIES[0]} stopOpacity={0.18} />
            <Stop offset="1" stopColor={projected[0]?.color ?? SERIES[0]} stopOpacity={0.01} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={C.paper} />
        {gridY.map((y, i) => (
          <Line key={i} x1={0} y1={y} x2={width} y2={y} stroke={C.lineSoft} strokeWidth={0.5} />
        ))}
        {showArea && projected[0] && (
          <Path d={areaPath(projected[0].xy, height - 6)} fill="url(#curveFill)" />
        )}
        {projected.map((ser, i) => (
          <Polyline
            key={i}
            points={polylinePoints(ser.xy)}
            fill="none"
            stroke={ser.color ?? SERIES[i % SERIES.length]}
            strokeWidth={i === 0 ? 1.6 : 1.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </Svg>
      <View style={s.axisRow}>
        <Text style={s.axisLabel}>{dates.start}</Text>
        <Text style={s.axisLabel}>base 100</Text>
        <Text style={s.axisLabel}>{dates.end}</Text>
      </View>
      {clean.length > 1 && (
        <View style={s.legendRow}>
          {clean.map((ser, i) => (
            <View key={i} style={s.legendItem}>
              <View style={[s.legendSwatch, { backgroundColor: ser.color ?? SERIES[i % SERIES.length] }]} />
              <Text style={s.legendText}>{ser.name.length > 30 ? ser.name.slice(0, 29) + "…" : ser.name}</Text>
              {ser.perf != null && (
                <Text style={[s.legendVal, { color: perfColor(ser.perf) }]}>
                  {ser.perf >= 0 ? "+" : ""}{ser.perf.toFixed(1)}%
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export type Slice = { label: string; weight: number };

/**
 * Donut de composition + légende. Les poids sont normalisés à 100 % de la part
 * connue (robuste à l'échelle fraction/%); on affiche le top puis un « Autres ».
 */
export function CompositionDonut({
  slices,
  size = 92,
  topN = 5,
  centerLabel,
}: {
  slices: Slice[];
  size?: number;
  topN?: number;
  centerLabel?: string;
}) {
  const sorted = slices.filter((x) => x.weight > 0).sort((a, b) => b.weight - a.weight);
  const top = sorted.slice(0, topN);
  const restW = sorted.slice(topN).reduce((a, x) => a + x.weight, 0);
  const display = restW > 0 ? [...top, { label: "Autres", weight: restW }] : top;
  const total = display.reduce((a, x) => a + x.weight, 0);
  if (total <= 0) {
    return <Text style={{ fontFamily: FONT.sans, fontSize: 8, color: C.muted }}>Composition non communiquée</Text>;
  }
  const r = size / 2;
  const segs = donutSegments(display.map((d) => d.weight), { cx: r, cy: r, rOuter: r, rInner: r * 0.62 });
  const colorOf = (i: number) => (display[i].label === "Autres" ? C.line : SERIES[i % SERIES.length]);

  return (
    <View style={s.donutWrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {segs.map((seg, i) => (
            <Path key={i} d={seg.d} fill={colorOf(i)} />
          ))}
        </Svg>
        {centerLabel && (
          <View style={[s.donutCenter, { width: size, height: size }]}>
            <Text style={s.donutCenterVal}>{display.length}</Text>
            <Text style={s.donutCenterLbl}>{centerLabel}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        {display.map((d, i) => (
          <View key={i} style={[s.legendItem, { justifyContent: "space-between", marginBottom: 3 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flex: 1 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colorOf(i) }} />
              <Text style={s.legendText}>{d.label.length > 22 ? d.label.slice(0, 21) + "…" : d.label}</Text>
            </View>
            <Text style={s.legendVal}>{((d.weight / total) * 100).toFixed(0)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Barres de composition horizontales (normalisées à 100 % de la part connue). */
export function CompositionBars({ slices, topN = 6, color = C.clay }: { slices: Slice[]; topN?: number; color?: string }) {
  const sorted = slices.filter((x) => x.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, topN);
  const total = sorted.reduce((a, x) => a + x.weight, 0);
  if (total <= 0) {
    return <Text style={{ fontFamily: FONT.sans, fontSize: 8, color: C.muted }}>Non communiqué</Text>;
  }
  const max = Math.max(...sorted.map((x) => x.weight));
  return (
    <View>
      {sorted.map((d, i) => {
        const sharePct = (d.weight / total) * 100;
        return (
          <View key={i} style={s.compRow}>
            <View style={s.compHead}>
              <Text style={s.compLabel}>{d.label.length > 26 ? d.label.slice(0, 25) + "…" : d.label}</Text>
              <Text style={s.compVal}>{sharePct.toFixed(0)}%</Text>
            </View>
            <View style={s.compTrack}>
              <View style={[s.compFill, { width: `${(d.weight / max) * 100}%`, backgroundColor: color }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Couleur d'une cellule de corrélation (hex), alignée sur l'UI (rouge↔vert). */
export function corrColor(c: number | null): { bg: string; fg: string } {
  if (c == null) return { bg: C.paper, fg: C.muted };
  const x = Math.max(-1, Math.min(1, c));
  if (x >= 0) {
    // Corrélation positive → teinte clay (concentration de risque).
    return { bg: mix("#FFFFFF", C.clay, 0.12 + 0.5 * x), fg: x > 0.62 ? "#FFFFFF" : C.ink };
  }
  // Corrélation négative → teinte verte (diversification).
  return { bg: mix("#FFFFFF", C.green, 0.12 + 0.45 * -x), fg: C.ink };
}

/** Interpolation linéaire simple entre deux couleurs hex. */
function mix(a: string, b: string, t: number): string {
  const pa = hex(a), pb = hex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${[r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
function hex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
