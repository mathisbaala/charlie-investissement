import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { C, FONT, perfColor, registerCharlieFonts } from "./pdf/theme";
import {
  BrandHeader,
  Chip,
  Eyebrow,
  Row,
  SectionTitle,
  Stat,
  dateFr,
  fmt,
  normTer,
  perf,
} from "./pdf/components";

registerCharlieFonts();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fund = Record<string, any>;

const S = StyleSheet.create({
  page: {
    paddingHorizontal: 44,
    paddingTop: 40,
    paddingBottom: 52,
    backgroundColor: C.cream,
    fontFamily: FONT.sans,
    fontSize: 9,
    color: C.ink,
  },
  title: { fontFamily: FONT.serif, fontSize: 26, color: C.ink, lineHeight: 1.06, marginTop: 18 },
  meta: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2, marginTop: 5 },
  metaIsin: { fontFamily: FONT.mono, fontSize: 9, color: C.clay },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 13 },
  statRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  grid: { flexDirection: "row", gap: 22, marginTop: 18 },
  col: { flex: 1 },
  warn: {
    backgroundColor: C.goldSoft,
    borderLeftWidth: 2.5,
    borderLeftColor: C.gold,
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginTop: 12,
  },
  warnText: { fontFamily: FONT.sans, fontSize: 8, color: "#6F5417" },
  footer: {
    position: "absolute",
    bottom: 28,
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

  return (
    <Document title={`Fiche fonds — ${fund.name}`} author="Charlie CGP">
      <Page size="A4" style={S.page}>
        <BrandHeader right={<Eyebrow>{dateFr()}</Eyebrow>} />

        {fund.data_completeness < 80 && (
          <View style={S.warn}>
            <Text style={S.warnText}>
              Données partielles — complétude {fund.data_completeness}%. Certains champs peuvent manquer.
            </Text>
          </View>
        )}

        <Eyebrow style={{ color: C.clay }}>{fund.product_type ?? "Fonds"}</Eyebrow>
        <Text style={S.title}>{fund.name}</Text>
        <Text style={S.meta}>
          <Text style={S.metaIsin}>{fund.isin}</Text>
          {`   ·   ${gestionnaire}`}
        </Text>

        <View style={S.badgeRow}>
          {fund.sfdr_article && <Chip tone="ok">SFDR Art. {fund.sfdr_article}</Chip>}
          {(fund.sri ?? fund.risk_score) && <Chip>SRI {fund.sri ?? fund.risk_score}/7</Chip>}
          {fund.morningstar_rating && <Chip tone="gold">★ Morningstar {fund.morningstar_rating}/5</Chip>}
          {fund.pea_eligible && <Chip tone="accent">PEA</Chip>}
          {fund.per_eligible && <Chip tone="accent">PER</Chip>}
          {fund.av_lux_eligible && <Chip tone="accent">AV Luxembourg</Chip>}
        </View>

        <View style={S.statRow}>
          <Stat label="Perf. 1 an" value={perf(fund.performance_1y)} sub="annualisée" color={perfColor(fund.performance_1y)} />
          <Stat label="Perf. 3 ans" value={perf(fund.performance_3y)} sub="annualisée" color={perfColor(fund.performance_3y)} />
          <Stat label="TER" value={fmt(ter)} sub="frais courants" />
          <Stat label="Rétro. CGP" value={fmt(retroPct)} sub="part rétrocédée" color={retroPct ? C.gold : C.ink} />
        </View>

        <View style={S.grid}>
          <View style={S.col}>
            <SectionTitle>Performances</SectionTitle>
            <Row label="1 an" value={fmt(fund.performance_1y)} tone={fund.performance_1y} />
            <Row label="3 ans" value={fmt(fund.performance_3y)} tone={fund.performance_3y} />
            <Row label="5 ans" value={fmt(fund.performance_5y)} tone={fund.performance_5y} />
            <Row label="Volatilité 1 an" value={fmt(fund.volatility_1y)} />
            <Row label="Ratio de Sharpe 1 an" value={fmt(fund.sharpe_1y, "", 2)} />
          </View>
          <View style={S.col}>
            <SectionTitle>Frais & caractéristiques</SectionTitle>
            <Row label="Frais courants (TER)" value={fmt(ter)} />
            <Row label="Encours (AUM)" value={fund.aum_eur ? `${(fund.aum_eur / 1_000_000).toFixed(0)} M€` : "—"} />
            <Row label="Création" value={fund.inception_date ? new Date(fund.inception_date).toLocaleDateString("fr-FR") : "—"} />
            <Row label="Ancienneté" value={trackRecord ? `${trackRecord} ans` : "—"} />
          </View>
        </View>

        <View style={S.footer} fixed>
          <Text style={S.disclaimer}>
            Aide à la décision pour le CGP/CIF — ne constitue pas un conseil en investissement au sens MiFID II.
            La responsabilité du conseil reste intégralement avec le CGP/CIF. Les performances passées ne préjugent pas des
            performances futures.
          </Text>
          <Text style={S.footerBrand}>Charlie</Text>
        </View>
      </Page>
    </Document>
  );
}
