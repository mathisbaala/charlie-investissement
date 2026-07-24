import { Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { C, FONT, perfColor } from "./theme";

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

// Frais stockés en fraction (canonique : 0.018 = 1,8 %) → pourcentage d'affichage.
// Conversion unit-true (toujours ×100) : gère aussi les SCPI (0.18 → 18). Cf.
// feeFracToPct (lib/format).
export function normTer(v: number | null | undefined): number | null {
  if (v == null) return null;
  return Math.round(v * 1e6) / 1e4;
}

// Valeur absente : « n.c. » (non communiqué), jamais un tiret (bannis des
// documents remis au client).
export function fmt(n: number | null | undefined, suffix = "%", d = 2): string {
  return n == null ? "n.c." : `${Number(n).toFixed(d)}${suffix}`;
}

export function perf(n: number | null | undefined): string {
  if (n == null) return "n.c.";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// fr-FR insère une espace fine insécable (U+202F) comme séparateur de milliers,
// glyphe absent de certaines de nos polices embarquées (« 14 200 € » →
// « 14□00 € »). On le remplace (ainsi que l'espace insécable) par une espace
// normale, présente partout.
export const nfEur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
    .format(v)
    .replace(/[\u202f\u00a0]/g, " ");

export const dateFr = (d?: string | number | Date) =>
  new Date(d ?? Date.now()).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

// DM Mono a un zéro barré : parfait pour aligner des colonnes de chiffres, mais
// sur une valeur nulle isolée (« 0 € », « 0,00 % », « n.c. ») le glyphe barré
// surprend dans un document client. On rebascule alors ces seules valeurs en
// Inter (zéro non barré). À appliquer en dernier dans un tableau de styles pour
// écraser le fontFamily mono.
const NIL_RE = /^[+-]?0([.,]0+)?\s*(€|%)?$/;
export function sansIfNil(value: string): Style {
  const t = value.trim();
  return t === "n.c." || NIL_RE.test(t) ? { fontFamily: FONT.sans } : {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitives visuelles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  eyebrow: {
    fontFamily: FONT.sans,
    fontWeight: 500,
    fontSize: 7.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: C.muted,
  },
  // En-tête de marque (letterhead) — vrai logo « C » + logotype Charlie
  brand: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderBottomWidth: 0.75, borderBottomColor: C.lineSoft, paddingBottom: 10, marginBottom: 18,
  },
  wordmark: { flexDirection: "row", alignItems: "center", gap: 7 },
  logoImg: { width: 18, height: 16, objectFit: "contain" },
  wordmarkText: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 15, letterSpacing: -0.2, color: C.ink },
  dot: { width: 5, height: 5, borderRadius: 5, backgroundColor: C.clay },
  // Chips / badges
  chip: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 100,
    borderWidth: 0.75,
    fontSize: 7.5,
    fontFamily: FONT.sans,
    fontWeight: 500,
  },
  // Intro de section éditoriale
  // Couleur posée à l'usage (accent lu au rendu → suit la marque du cabinet).
  introEyebrow: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7.5, letterSpacing: 1.6, textTransform: "uppercase" },
  introTitle: { fontFamily: FONT.sans, fontSize: 16, color: C.ink, marginTop: 3, lineHeight: 1.05 },
  introDesc: { fontFamily: FONT.sans, fontSize: 8.5, color: C.muted, marginTop: 3, lineHeight: 1.4, maxWidth: 360 },
  // Lignes label / valeur
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4.5,
    borderBottomWidth: 0.75,
    borderBottomColor: C.lineSoft,
  },
  rowLabel: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2 },
  rowValue: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 9, color: C.ink },
  // Grille de métriques bordée
  grid: { borderWidth: 0.75, borderColor: C.line, borderRadius: 7, flexDirection: "row", flexWrap: "wrap" },
  cell: { paddingVertical: 10, paddingHorizontal: 12 },
  cellLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted, marginBottom: 4 },
  cellValue: { fontFamily: FONT.sans, fontSize: 18, color: C.ink, lineHeight: 1 },
  cellSub: { fontFamily: FONT.sans, fontSize: 7, color: C.muted, marginTop: 3 },
  // Hero stat (gros chiffre dans panneau teinté)
  hero: { borderRadius: 9, paddingVertical: 16, paddingHorizontal: 18, justifyContent: "center" },
  heroLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.muted, marginBottom: 6 },
  heroValue: { fontFamily: FONT.sans, fontSize: 38, lineHeight: 0.95 },
  heroSub: { fontFamily: FONT.sans, fontSize: 8, color: C.muted, marginTop: 6 },
  // Barre horizontale
  barTrack: { height: 5, backgroundColor: C.lineSoft, borderRadius: 3, flexDirection: "row", overflow: "hidden" },
  barFill: { height: 5, borderRadius: 3 },
  // Mètre SRI (7 segments)
  meter: { flexDirection: "row", gap: 3, alignItems: "flex-end" },
  meterSeg: { flex: 1, borderRadius: 2 },
  // Pastilles de notation
  dots: { flexDirection: "row", gap: 3, alignItems: "center" },
  dot2: { width: 7, height: 7, borderRadius: 7 },
});

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: Style }) {
  return <Text style={style ? [s.eyebrow, style] : s.eyebrow}>{children}</Text>;
}

/** En-tête letterhead. `logo` = data URI du « C » officiel (chargé côté serveur) ;
    à défaut, on retombe sur la pastille clay historique. */
export function BrandHeader({ right, logo }: { right?: React.ReactNode; logo?: string }) {
  return (
    <View style={s.brand}>
      <View style={s.wordmark}>
        {logo ? <Image src={logo} style={s.logoImg} /> : <View style={s.dot} />}
        <Text style={s.wordmarkText}>Charlie</Text>
      </View>
      {right ?? null}
    </View>
  );
}

export function SectionIntro({
  eyebrow,
  title,
  desc,
  right,
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
      <View>
        {eyebrow ? <Text style={[s.introEyebrow, { color: C.clay }]}>{eyebrow}</Text> : null}
        <Text style={s.introTitle}>{title}</Text>
        {desc ? <Text style={s.introDesc}>{desc}</Text> : null}
      </View>
      {right ?? null}
    </View>
  );
}

type ChipTone = "neutral" | "accent" | "ok" | "gold";
export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: ChipTone }) {
  const map: Record<ChipTone, { bg: string; bd: string; fg: string }> = {
    neutral: { bg: C.paper2, bd: C.line, fg: C.ink2 },
    accent: { bg: C.claySoft, bd: "#E6B09B", fg: C.clayInk },
    ok: { bg: C.greenSoft, bd: "#CADFD2", fg: C.green },
    gold: { bg: C.goldSoft, bd: "#E6D2A4", fg: "#7A5E1E" },
  };
  const t = map[tone];
  return <Text style={[s.chip, { backgroundColor: t.bg, borderColor: t.bd, color: t.fg }]}>{children}</Text>;
}

export function Row({ label, value, tone }: { label: string; value: string; tone?: "perf" | "accent" | number }) {
  let color: string = C.ink;
  if (tone === "accent") color = C.gold;
  else if (typeof tone === "number") color = perfColor(tone);
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, { color }, sansIfNil(value)]}>{value}</Text>
    </View>
  );
}

export function HeroStat({
  label,
  value,
  sub,
  tone = "accent",
  valueColor,
  style,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg" | "accent" | "neutral";
  valueColor?: string;
  style?: Style;
}) {
  const map = {
    pos: { bg: C.greenSoft, fg: C.green },
    neg: { bg: C.redSoft, fg: C.red },
    accent: { bg: C.claySoft, fg: C.clay },
    neutral: { bg: C.paper, fg: C.ink },
  }[tone];
  return (
    <View style={[s.hero, { backgroundColor: map.bg }, style ?? {}]}>
      <Text style={s.heroLabel}>{label}</Text>
      <Text style={[s.heroValue, { color: valueColor ?? map.fg }]}>{value}</Text>
      {sub ? <Text style={s.heroSub}>{sub}</Text> : null}
    </View>
  );
}

type Metric = { label: string; value: string; sub?: string; color?: string };
// `labelMinHeight` réserve une hauteur fixe au label pour aligner les valeurs
// entre colonnes quand certains labels tiennent sur deux lignes (ex. grille KPI).
export function MetricGrid({ items, cols = 3, labelMinHeight }: { items: Metric[]; cols?: number; labelMinHeight?: number }) {
  const rows = Math.ceil(items.length / cols);
  return (
    <View style={s.grid}>
      {items.map((m, i) => {
        const isLastCol = (i + 1) % cols === 0;
        const isLastRow = Math.floor(i / cols) === rows - 1;
        return (
          <View
            key={i}
            style={[
              s.cell,
              {
                width: `${100 / cols}%`,
                borderRightWidth: isLastCol ? 0 : 0.75,
                borderRightColor: C.lineSoft,
                borderBottomWidth: isLastRow ? 0 : 0.75,
                borderBottomColor: C.lineSoft,
              },
            ]}
          >
            <Text style={[s.cellLabel, labelMinHeight ? { minHeight: labelMinHeight } : {}]}>{m.label}</Text>
            <Text style={[s.cellValue, m.color ? { color: m.color } : {}]}>{m.value}</Text>
            {m.sub ? <Text style={s.cellSub}>{m.sub}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

/** Barre horizontale signée (magnitude = |value|/max), couleur selon le signe. */
export function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  return (
    <View style={s.barTrack}>
      <View style={[s.barFill, { width: `${pct * 100}%`, backgroundColor: color ?? perfColor(value) }]} />
    </View>
  );
}

/** Mini ligne de perf : label · barre · valeur. */
export function PerfBarRow({ label, value, max }: { label: string; value: number | null; max: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <Text style={{ fontFamily: FONT.sans, fontSize: 8.5, color: C.ink2, width: 42 }}>{label}</Text>
      <View style={{ flex: 1 }}>
        {value == null ? (
          <View style={s.barTrack} />
        ) : (
          <Bar value={value} max={max} />
        )}
      </View>
      <Text style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 8.5, color: perfColor(value), width: 44, textAlign: "right" }}>
        {value == null ? "n.c." : perf(value)}
      </Text>
    </View>
  );
}

/** Mètre de risque SRI 1→7 (segment actif mis en avant, gradient vert→or→rouge). */
export function SriMeter({ value }: { value: number | null | undefined }) {
  const seg = (i: number) => (i <= 2 ? C.green : i <= 4 ? C.gold : C.red);
  return (
    <View>
      <View style={s.meter}>
        {[1, 2, 3, 4, 5, 6, 7].map((i) => {
          const active = value != null && i === Math.round(value);
          return (
            <View
              key={i}
              style={[
                s.meterSeg,
                {
                  height: active ? 16 : 9,
                  backgroundColor: value != null && i <= Math.round(value) ? seg(i) : C.lineSoft,
                  opacity: active ? 1 : value != null && i <= Math.round(value) ? 0.5 : 1,
                },
              ]}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={{ fontFamily: FONT.sans, fontSize: 6.5, color: C.muted }}>Risque faible</Text>
        <Text style={{ fontFamily: FONT.sans, fontSize: 6.5, color: C.muted }}>Risque élevé</Text>
      </View>
    </View>
  );
}

/** Notation par pastilles (Morningstar). */
export function RatingDots({ value, max = 5, color = C.gold }: { value: number; max?: number; color?: string }) {
  return (
    <View style={s.dots}>
      {Array.from({ length: max }, (_, i) => (
        <View key={i} style={[s.dot2, { backgroundColor: i < value ? color : C.lineSoft }]} />
      ))}
    </View>
  );
}
