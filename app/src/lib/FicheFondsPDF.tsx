import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { C, FONT, perfColor, registerCharlieFonts } from "./pdf/theme";
import {
  BrandHeader,
  Chip,
  Eyebrow,
  HeroStat,
  MetricGrid,
  PerfBarRow,
  RatingDots,
  Row,
  SectionIntro,
  SriMeter,
  dateFr,
  fmt,
  nfEur,
  normTer,
  perf,
} from "./pdf/components";

registerCharlieFonts();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fund = Record<string, any>;

const S = StyleSheet.create({
  page: {
    paddingHorizontal: 44,
    paddingTop: 38,
    paddingBottom: 50,
    backgroundColor: C.cream,
    fontFamily: FONT.sans,
    fontSize: 9,
    color: C.ink,
  },
  title: { fontFamily: FONT.serif, fontSize: 26, color: C.ink, lineHeight: 1.05, marginTop: 16 },
  meta: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2, marginTop: 5 },
  metaIsin: { fontFamily: FONT.mono, fontSize: 9, color: C.clay },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 12, marginBottom: 14 },
  heroRow: { flexDirection: "row", gap: 12, marginBottom: 18 },
  twoCol: { flexDirection: "row", gap: 26 },
  col: { flex: 1 },
  card: { backgroundColor: C.paper, borderWidth: 0.75, borderColor: C.line, borderRadius: 8, padding: 13, marginTop: 13 },
  cardLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted, marginBottom: 8 },
  ratingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTopWidth: 0.75, borderTopColor: C.lineSoft },
  callout: {
    backgroundColor: C.claySoft,
    borderTopWidth: 2,
    borderTopColor: C.clay,
    borderRadius: 7,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  calloutLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 9.5, color: C.clayInk },
  calloutSub: { fontFamily: FONT.sans, fontSize: 7.5, color: "#86422A", marginTop: 3 },
  calloutValue: { fontFamily: FONT.serif, fontSize: 22, color: C.clay },
  warn: { backgroundColor: C.goldSoft, borderLeftWidth: 2.5, borderLeftColor: C.gold, borderRadius: 3, paddingVertical: 7, paddingHorizontal: 10, marginTop: 12 },
  warnText: { fontFamily: FONT.sans, fontSize: 8, color: "#6F5417" },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    borderTopWidth: 0.75,
    borderTopColor: C.line,
    paddingTop: 7,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  disclaimer: { fontFamily: FONT.sans, fontSize: 6.8, color: C.muted, lineHeight: 1.4, flex: 1 },
  footerBrand: { fontFamily: FONT.serif, fontSize: 9, color: C.ink2 },
});

export default function FicheFondsPDF({ fund }: { fund: Fund }) {
  const trackRecord = fund.inception_date
    ? Math.floor((Date.now() - new Date(fund.inception_date).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : null;
  const gestionnaire = fund.management_company ?? fund.gestionnaire ?? "Société de gestion non renseignée";
  const ter = normTer(fund.ongoing_charges ?? fund.ter);
  const retroPct = fund.retrocession_cgp != null ? fund.retrocession_cgp * 100 : null;
  const hasRetro = fund.retrocession_cgp > 0;
  const sri = fund.sri ?? fund.risk_score;
  const maxPerf = Math.max(1, Math.abs(fund.performance_1y ?? 0), Math.abs(fund.performance_3y ?? 0), Math.abs(fund.performance_5y ?? 0));

  return (
    <Document title={`Fiche fonds — ${fund.name}`} author="Charlie CGP">
      <Page size="A4" style={S.page}>
        <BrandHeader right={<Eyebrow>{dateFr()}</Eyebrow>} />

        <Eyebrow style={{ color: C.clay }}>{fund.product_type ?? "Fonds"}</Eyebrow>
        <Text style={S.title}>{fund.name}</Text>
        <Text style={S.meta}>
          <Text style={S.metaIsin}>{fund.isin}</Text>
          {`   ·   ${gestionnaire}`}
        </Text>

        <View style={S.badgeRow}>
          {fund.sfdr_article && <Chip tone="ok">SFDR Art. {fund.sfdr_article}</Chip>}
          {sri && <Chip>SRI {sri}/7</Chip>}
          {fund.morningstar_rating && <Chip tone="gold">★ Morningstar {fund.morningstar_rating}/5</Chip>}
          {fund.pea_eligible && <Chip tone="accent">PEA</Chip>}
          {fund.per_eligible && <Chip tone="accent">PER</Chip>}
          {fund.av_lux_eligible && <Chip tone="accent">AV Luxembourg</Chip>}
        </View>

        <View style={S.heroRow}>
          <HeroStat
            label="Performance 1 an"
            value={perf(fund.performance_1y)}
            sub="annualisée"
            tone={fund.performance_1y != null && fund.performance_1y < 0 ? "neg" : "pos"}
            style={{ flex: 1.4 }}
          />
          <View style={{ flex: 2.6 }}>
            <MetricGrid
              cols={3}
              items={[
                { label: "Perf. 3 ans", value: perf(fund.performance_3y), sub: "annualisée", color: perfColor(fund.performance_3y) },
                { label: "TER", value: fmt(ter), sub: "frais courants" },
                { label: "Rétro. CGP", value: fmt(retroPct), sub: "part rétrocédée", color: hasRetro ? C.gold : C.ink },
              ]}
            />
          </View>
        </View>

        <View style={S.twoCol}>
          <View style={S.col}>
            <SectionIntro eyebrow="Performance" title="La trajectoire." />
            <PerfBarRow label="1 an" value={fund.performance_1y} max={maxPerf} />
            <PerfBarRow label="3 ans" value={fund.performance_3y} max={maxPerf} />
            <PerfBarRow label="5 ans" value={fund.performance_5y} max={maxPerf} />
            <Row label="Volatilité 1 an" value={fmt(fund.volatility_1y)} />
            <Row label="Ratio de Sharpe 1 an" value={fmt(fund.sharpe_1y, "", 2)} />

            <View style={S.card}>
              <Text style={S.cardLabel}>Indicateur de risque (SRI)</Text>
              <SriMeter value={sri} />
            </View>
          </View>

          <View style={S.col}>
            <SectionIntro eyebrow="Frais & structure" title="Le coût réel." />
            <Row label="Frais courants (TER)" value={fmt(ter)} />
            <Row label="Encours (AUM)" value={fund.aum_eur ? `${(fund.aum_eur / 1_000_000).toFixed(0)} M€` : "—"} />
            <Row label="Création" value={fund.inception_date ? new Date(fund.inception_date).toLocaleDateString("fr-FR") : "—"} />
            <Row label="Ancienneté" value={trackRecord ? `${trackRecord} ans` : "—"} />

            {fund.morningstar_rating ? (
              <View style={S.ratingRow}>
                <Text style={{ fontFamily: FONT.sans, fontSize: 8.5, color: C.ink2 }}>Notation Morningstar</Text>
                <RatingDots value={fund.morningstar_rating} />
              </View>
            ) : null}
          </View>
        </View>

        {hasRetro && (
          <View style={S.callout}>
            <View>
              <Text style={S.calloutLabel}>Rétrocession CGP — {fmt(retroPct)} par an</Text>
              <Text style={S.calloutSub}>Revenu estimé pour un encours de 100 000 € confié</Text>
            </View>
            <Text style={S.calloutValue}>{nfEur(100_000 * fund.retrocession_cgp)}/an</Text>
          </View>
        )}

        {fund.data_completeness < 80 && (
          <View style={S.warn}>
            <Text style={S.warnText}>Données partielles — complétude {fund.data_completeness}%. Certains champs peuvent manquer.</Text>
          </View>
        )}

        <View style={S.footer} fixed>
          <Text style={S.disclaimer}>
            Aide à la décision pour le CGP/CIF — ne constitue pas un conseil en investissement au sens MiFID II. La responsabilité du
            conseil reste intégralement avec le CGP/CIF. Les performances passées ne préjugent pas des performances futures.
          </Text>
          <Text style={S.footerBrand}>Charlie</Text>
        </View>
      </Page>
    </Document>
  );
}
