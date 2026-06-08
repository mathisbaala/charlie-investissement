import { Text, View, StyleSheet } from "@react-pdf/renderer";
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

export function fmt(n: number | null | undefined, suffix = "%", d = 2): string {
  return n == null ? "—" : `${Number(n).toFixed(d)}${suffix}`;
}

export function perf(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export const nfEur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

export const dateFr = (d?: string | number | Date) =>
  new Date(d ?? Date.now()).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

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
  // En-tête de marque (haut de page)
  brand: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  wordmark: { flexDirection: "row", alignItems: "center", gap: 8 },
  wordmarkText: { fontFamily: FONT.serif, fontSize: 16, color: C.ink },
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
  // Titres de section
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 9 },
  sectionRule: { flex: 1, height: 0.75, backgroundColor: C.line },
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
  // Cartes stat
  stat: {
    flex: 1,
    backgroundColor: C.paper,
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 7,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  statLabel: {
    fontFamily: FONT.sans,
    fontWeight: 500,
    fontSize: 7,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: C.muted,
    marginBottom: 5,
  },
  statValue: { fontFamily: FONT.serif, fontSize: 21, color: C.ink, lineHeight: 1 },
  statSub: { fontFamily: FONT.sans, fontSize: 7.5, color: C.muted, marginTop: 4 },
});

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: Style }) {
  return <Text style={style ? [s.eyebrow, style] : s.eyebrow}>{children}</Text>;
}

export function BrandHeader({ right }: { right?: React.ReactNode }) {
  return (
    <View style={s.brand}>
      <View style={s.wordmark}>
        <View style={s.dot} />
        <Text style={s.wordmarkText}>Charlie</Text>
        <Eyebrow style={{ color: C.muted }}>CGP</Eyebrow>
      </View>
      {right ?? null}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.sectionHead}>
      <Eyebrow style={{ color: C.clay }}>{children}</Eyebrow>
      <View style={s.sectionRule} />
    </View>
  );
}

type ChipTone = "neutral" | "accent" | "ok" | "gold";
export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: ChipTone }) {
  const map: Record<ChipTone, { bg: string; bd: string; fg: string }> = {
    neutral: { bg: C.paper2, bd: C.line, fg: C.ink2 },
    accent: { bg: C.claySoft, bd: "#E0C3AE", fg: C.clayInk },
    ok: { bg: C.greenSoft, bd: "#CADFD2", fg: C.green },
    gold: { bg: C.goldSoft, bd: "#E6D2A4", fg: "#7A5E1E" },
  };
  const t = map[tone];
  return (
    <Text style={[s.chip, { backgroundColor: t.bg, borderColor: t.bd, color: t.fg }]}>{children}</Text>
  );
}

export function Row({ label, value, tone }: { label: string; value: string; tone?: "perf" | "accent" | number }) {
  let color: string = C.ink;
  if (tone === "accent") color = C.gold;
  else if (typeof tone === "number") color = perfColor(tone);
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, { color }]}>{value}</Text>
    </View>
  );
}

export function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, color ? { color } : {}]}>{value}</Text>
      {sub ? <Text style={s.statSub}>{sub}</Text> : null}
    </View>
  );
}
