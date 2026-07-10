import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { C, FONT, registerCharlieFonts } from "./pdf/theme";
import { BrandHeader, SectionIntro, HeroStat, Chip, Bar } from "./pdf/components";
import type { AllocationPresentation } from "./allocationRationale";

registerCharlieFonts();

// Présentation d'allocation au format « proposition client » (modèle Métagram /
// Cardif ELITE) : couverture + objectifs, répartition par classe, tableau détaillé
// des supports, justification par fonds, profil de risque (SRI/SFDR), convictions,
// avertissements MIF II. Rendu via le design system PDF partagé (pdf/theme+components).
// 100 % déterministe : consomme la structure produite par buildPresentation().

const CLASS_COLOR: Record<string, string> = {
  Actions: C.clay,
  "Obligations / Crédit": C.gold,
  "Monétaire": C.muted,
  "Allocations flexibles": C.ink2,
  "Immobilier (SCPI / SCI)": C.green,
  "Crypto-actifs": "#6B4E9A",
  "Fonds Euros": "#2E6B8F",
};

const s = StyleSheet.create({
  page: {
    backgroundColor: C.cream,
    paddingTop: 34,
    paddingBottom: 42,
    paddingHorizontal: 38,
    fontFamily: FONT.sans,
    color: C.ink,
    fontSize: 9,
  },
  card: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  h1: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 10, color: C.muted, marginBottom: 16 },
  bullet: { flexDirection: "row", marginBottom: 4 },
  bulletDot: { width: 10, color: C.clay },
  bulletText: { flex: 1, color: C.ink2, lineHeight: 1.35 },
  // Tableau supports
  thead: { flexDirection: "row", borderBottomWidth: 1, borderColor: C.line, paddingBottom: 4, marginBottom: 3 },
  trow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderColor: C.lineSoft },
  th: { fontSize: 7.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" },
  td: { fontSize: 8, color: C.ink2 },
  cNum: { width: "5%" },
  cName: { width: "32%" },
  cIsin: { width: "16%", fontFamily: FONT.mono, fontSize: 7 },
  cCat: { width: "19%" },
  cW: { width: "9%", textAlign: "right", fontWeight: 700, color: C.ink },
  cSri: { width: "7%", textAlign: "center" },
  cSfdr: { width: "7%", textAlign: "center" },
  cTer: { width: "5%", textAlign: "right" },
  classRow: { flexDirection: "row", alignItems: "center", marginBottom: 7 },
  classSwatch: { width: 8, height: 8, borderRadius: 2, marginRight: 7 },
  classLabel: { width: 150, fontWeight: 700 },
  classWeight: { width: 42, textAlign: "right", fontWeight: 700, marginRight: 10 },
  classRole: { flex: 1, color: C.muted, fontSize: 8 },
  rationale: { marginBottom: 9 },
  rationaleHead: { fontWeight: 700, marginBottom: 2 },
  rationaleText: { color: C.ink2, lineHeight: 1.4, fontSize: 8.5 },
  sriBarRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  sriBarLabel: { width: 44, fontSize: 8, color: C.muted },
  sriBarVal: { width: 40, fontSize: 8, textAlign: "right", color: C.ink2 },
  disc: { fontSize: 7.5, color: C.muted, marginBottom: 3, lineHeight: 1.3 },
  footer: { position: "absolute", bottom: 20, left: 38, right: 38, flexDirection: "row", justifyContent: "space-between" },
  footText: { fontSize: 7, color: C.muted },
});

function fmtPct1(n: number | null | undefined): string {
  return n == null ? "—" : `${n.toFixed(1)} %`;
}
function sfdrText(a: number | null | undefined): string {
  if (a === 8) return "Art. 8";
  if (a === 9) return "Art. 9";
  return "Art. 6";
}

function Footer({ p }: { p: AllocationPresentation }) {
  const left = [p.advisor, p.asOf].filter(Boolean).join("  ·  ");
  return (
    <View style={s.footer} fixed>
      <Text style={s.footText}>{left || "Charlie Investissement"}</Text>
      <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

export default function AllocationReportPDF({ presentation }: { presentation: AllocationPresentation }) {
  const p = presentation;
  const maxSri = Math.max(1, ...p.riskProfile.sriDistribution.map((b) => b.weight));

  return (
    <Document title={p.title}>
      {/* Page 1 — couverture, objectifs, répartition par classe */}
      <Page size="A4" style={s.page}>
        <BrandHeader right={<Chip tone="accent">{p.headline.profileLabel}</Chip>} />

        <Text style={s.h1}>{p.title}</Text>
        <Text style={s.sub}>{p.subtitle}</Text>

        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
          <HeroStat label="Supports" value={String(p.headline.supports)} tone="neutral" style={{ flex: 1 }} />
          <HeroStat label="SRI moyen" value={p.headline.weightedSri == null ? "—" : `${p.headline.weightedSri} / 7`} tone="accent" style={{ flex: 1 }} />
          <HeroStat label="Perf. cible / an" value={`~${p.headline.expectedReturnPct} %`} tone="pos" style={{ flex: 1 }} />
          <HeroStat label="Volatilité" value={`~${p.headline.volatilityPct} %`} tone="neutral" style={{ flex: 1 }} />
        </View>

        <View style={s.card}>
          <SectionIntro eyebrow="01" title="Contexte et objectifs" />
          {p.objectives.map((o, i) => (
            <View style={s.bullet} key={i}>
              <Text style={s.bulletDot}>•</Text>
              <Text style={s.bulletText}>{o}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <SectionIntro eyebrow="02" title="Répartition stratégique par classe d'actifs" />
          {p.classBreakdown.map((c) => (
            <View style={s.classRow} key={c.assetClass}>
              <View style={[s.classSwatch, { backgroundColor: CLASS_COLOR[c.label] ?? C.ink2 }]} />
              <Text style={s.classLabel}>{c.label}</Text>
              <Text style={s.classWeight}>{fmtPct1(c.weight)}</Text>
              <Text style={s.classRole}>{c.role}</Text>
            </View>
          ))}
        </View>

        <Footer p={p} />
      </Page>

      {/* Page 2 — tableau détaillé des supports */}
      <Page size="A4" style={s.page}>
        <SectionIntro eyebrow="03" title="Allocation détaillée" desc={`${p.table.length} supports retenus`} />
        <View style={s.card}>
          <View style={s.thead}>
            <Text style={[s.th, s.cNum]}>#</Text>
            <Text style={[s.th, s.cName]}>Fonds</Text>
            <Text style={[s.th, s.cIsin]}>ISIN</Text>
            <Text style={[s.th, s.cCat]}>Catégorie</Text>
            <Text style={[s.th, s.cW]}>Poids</Text>
            <Text style={[s.th, s.cSri]}>SRI</Text>
            <Text style={[s.th, s.cSfdr]}>SFDR</Text>
            <Text style={[s.th, s.cTer]}>TER</Text>
          </View>
          {p.table.map((l, i) => (
            <View style={s.trow} key={l.isin} wrap={false}>
              <Text style={[s.td, s.cNum]}>{i + 1}</Text>
              <Text style={[s.td, s.cName]}>{l.name}</Text>
              <Text style={[s.td, s.cIsin]}>{l.isin}</Text>
              <Text style={[s.td, s.cCat]}>{l.category ?? "—"}</Text>
              <Text style={[s.td, s.cW]}>{fmtPct1(l.weight)}</Text>
              <Text style={[s.td, s.cSri]}>{l.sri ?? "—"}</Text>
              <Text style={[s.td, s.cSfdr]}>{sfdrText(l.sfdr)}</Text>
              <Text style={[s.td, s.cTer]}>{l.ter == null ? "—" : `${(l.ter * 100).toFixed(2)}`}</Text>
            </View>
          ))}
        </View>

        {/* Profil de risque : distribution SRI pondérée */}
        <View style={s.card}>
          <SectionIntro eyebrow="04" title="Profil de risque" desc={`SRI moyen pondéré ~${p.riskProfile.weightedSri ?? "—"} / 7 — ${p.riskProfile.profileLabel}`} />
          {p.riskProfile.sriDistribution.map((b) => (
            <View style={s.sriBarRow} key={b.sri}>
              <Text style={s.sriBarLabel}>SRI {b.sri}</Text>
              <View style={{ flex: 1 }}>
                <Bar value={b.weight} max={maxSri} color={b.sri <= 2 ? C.green : b.sri <= 4 ? C.gold : C.clay} />
              </View>
              <Text style={s.sriBarVal}>{fmtPct1(b.weight)}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
            {p.riskProfile.sfdrDistribution.map((d) => (
              <Chip key={String(d.article)} tone={d.article === 9 ? "ok" : d.article === 8 ? "accent" : "neutral"}>
                {`Art. ${d.article} — ${fmtPct1(d.weight)}`}
              </Chip>
            ))}
          </View>
        </View>

        <Footer p={p} />
      </Page>

      {/* Page 3 — justification par support + convictions + disclaimers */}
      <Page size="A4" style={s.page}>
        <SectionIntro eyebrow="05" title="Analyse et justification par support" />
        <View style={s.card}>
          {p.perFundRationale.map((r, i) => (
            <View style={s.rationale} key={r.isin} wrap={false}>
              <Text style={s.rationaleHead}>{`${i + 1}. ${r.name}`}</Text>
              <Text style={s.rationaleText}>{r.text}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <SectionIntro eyebrow="06" title="Nos convictions de gestion" />
          {p.convictions.map((c, i) => (
            <View style={s.rationale} key={i} wrap={false}>
              <Text style={s.rationaleHead}>{c.title}</Text>
              <Text style={s.rationaleText}>{c.text}</Text>
            </View>
          ))}
        </View>

        <View style={[s.card, { backgroundColor: C.paper2 }]}>
          <Text style={[s.th, { marginBottom: 5 }]}>Avertissements</Text>
          {p.disclaimers.map((d, i) => (
            <Text style={s.disc} key={i}>• {d}</Text>
          ))}
        </View>

        <Footer p={p} />
      </Page>
    </Document>
  );
}
