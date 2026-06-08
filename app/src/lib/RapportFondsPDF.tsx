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
    paddingTop: 40,
    paddingBottom: 52,
    backgroundColor: C.cream,
    fontFamily: FONT.sans,
    fontSize: 9,
    color: C.ink,
  },
  // Cover
  accentRule: { width: 34, height: 2.5, backgroundColor: C.clay, marginBottom: 14, marginTop: 26 },
  coverTitle: { fontFamily: FONT.serif, fontSize: 34, color: C.ink, lineHeight: 1.05 },
  coverSub: { fontFamily: FONT.sans, fontSize: 10.5, color: C.ink2, marginTop: 8, marginBottom: 26 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 28 },
  // Table
  tHead: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: 7,
    borderBottomWidth: 1.25,
    borderBottomColor: C.ink,
  },
  tHeadText: {
    fontFamily: FONT.sans,
    fontWeight: 500,
    fontSize: 7,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: C.muted,
  },
  tRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 0.75,
    borderBottomColor: C.lineSoft,
  },
  tRowAlt: { backgroundColor: C.paper },
  colName: { flex: 3.2, paddingRight: 6 },
  fundName: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 9.5, color: C.ink },
  fundIsin: { fontFamily: FONT.mono, fontSize: 7, color: C.muted, marginTop: 2 },
  colSm: { flex: 1.1, fontFamily: FONT.mono, fontSize: 8.5, color: C.ink2, textAlign: "center" },
  colMd: { flex: 1.3, fontFamily: FONT.mono, fontWeight: 500, fontSize: 8.5, textAlign: "right" },
  // Fund page
  fundTitle: { fontFamily: FONT.serif, fontSize: 25, color: C.ink, lineHeight: 1.06, marginTop: 2 },
  fundMeta: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2, marginTop: 5 },
  fundMetaIsin: { fontFamily: FONT.mono, fontSize: 9, color: C.clay },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 13, marginBottom: 6 },
  grid: { flexDirection: "row", gap: 22, marginTop: 16 },
  col: { flex: 1 },
  // Callout rétro
  callout: {
    backgroundColor: C.claySoft,
    borderWidth: 0.75,
    borderColor: "#E0C3AE",
    borderRadius: 7,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  calloutLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 9, color: C.clayInk },
  calloutSub: { fontFamily: FONT.sans, fontSize: 7.5, color: "#8A5A3C", marginTop: 3 },
  calloutValue: { fontFamily: FONT.serif, fontSize: 20, color: C.clay },
  // Warning
  warn: {
    backgroundColor: C.goldSoft,
    borderLeftWidth: 2.5,
    borderLeftColor: C.gold,
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 14,
  },
  warnText: { fontFamily: FONT.sans, fontSize: 8, color: "#6F5417" },
  // Footer
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
    alignItems: "flex-start",
    gap: 16,
  },
  disclaimer: { fontFamily: FONT.sans, fontSize: 6.8, color: C.muted, lineHeight: 1.4, flex: 1 },
  footerBrand: { fontFamily: FONT.serif, fontSize: 9, color: C.ink2 },
});

const DISCLAIMER =
  "Aide à la décision pour le CGP/CIF — ne constitue pas un conseil en investissement au sens MiFID II. " +
  "La responsabilité du conseil reste intégralement avec le CGP/CIF. Les performances passées ne préjugent pas des performances futures.";

function Footer({ page }: { page?: string }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.disclaimer}>{DISCLAIMER}</Text>
      <Text style={S.footerBrand}>{page ?? "Charlie"}</Text>
    </View>
  );
}

function median(xs: number[]): number | null {
  const v = xs.filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function mean(xs: number[]): number | null {
  const v = xs.filter((n) => n != null && Number.isFinite(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function CoverPage({ funds }: { funds: Fund[] }) {
  const single = funds.length === 1;
  const medTer = median(funds.map((f) => normTer(f.ongoing_charges ?? f.ter) as number));
  const avgPerf = mean(funds.map((f) => f.performance_1y as number));
  const avgRetro = mean(funds.map((f) => (f.retrocession_cgp != null ? f.retrocession_cgp * 100 : (null as unknown as number))));

  return (
    <Page size="A4" style={S.page}>
      <BrandHeader right={<Eyebrow>{dateFr()}</Eyebrow>} />

      <View style={S.accentRule} />
      <Eyebrow style={{ color: C.clay }}>{single ? "Fiche de fonds" : "Analyse comparative"}</Eyebrow>
      <Text style={S.coverTitle}>{single ? "Rapport de fonds" : "Rapport de comparaison"}</Text>
      <Text style={S.coverSub}>
        {funds.length} fonds {single ? "analysé" : "analysés"} · sélection du {dateFr()}
      </Text>

      <View style={S.statRow}>
        <Stat label="Fonds" value={String(funds.length)} sub={single ? "fiche détaillée" : "comparés"} />
        <Stat label="TER médian" value={fmt(medTer)} sub="frais courants" />
        <Stat label="Perf. 1 an moy." value={perf(avgPerf)} sub="annualisée" color={perfColor(avgPerf)} />
        <Stat label="Rétro. CGP moy." value={fmt(avgRetro)} sub="part rétrocédée" color={avgRetro ? C.gold : C.ink} />
      </View>

      <SectionTitle>Synthèse</SectionTitle>
      <View style={S.tHead}>
        <Text style={[S.colName, S.tHeadText]}>Fonds</Text>
        <Text style={[S.colSm, S.tHeadText, { textAlign: "center" }]}>SFDR</Text>
        <Text style={[S.colSm, S.tHeadText, { textAlign: "center" }]}>SRI</Text>
        <Text style={[S.colMd, S.tHeadText, { textAlign: "right" }]}>TER</Text>
        <Text style={[S.colMd, S.tHeadText, { textAlign: "right" }]}>Rétro. CGP</Text>
        <Text style={[S.colMd, S.tHeadText, { textAlign: "right" }]}>Perf 1A</Text>
        <Text style={[S.colMd, S.tHeadText, { textAlign: "right" }]}>Perf 3A</Text>
      </View>
      {funds.map((f, i) => (
        <View key={f.isin} style={[S.tRow, ...(i % 2 ? [S.tRowAlt] : [])]}>
          <View style={S.colName}>
            <Text style={S.fundName}>{String(f.name).slice(0, 46)}</Text>
            <Text style={S.fundIsin}>{f.isin}</Text>
          </View>
          <Text style={S.colSm}>{f.sfdr_article ? `Art.${f.sfdr_article}` : "—"}</Text>
          <Text style={S.colSm}>{(f.sri ?? f.risk_score) ? `${f.sri ?? f.risk_score}/7` : "—"}</Text>
          <Text style={[S.colMd, { color: C.ink }]}>{fmt(normTer(f.ongoing_charges ?? f.ter))}</Text>
          <Text style={[S.colMd, { color: f.retrocession_cgp > 0 ? C.gold : C.ink2 }]}>
            {f.retrocession_cgp != null ? fmt(f.retrocession_cgp * 100) : "—"}
          </Text>
          <Text style={[S.colMd, { color: perfColor(f.performance_1y) }]}>{perf(f.performance_1y)}</Text>
          <Text style={[S.colMd, { color: perfColor(f.performance_3y) }]}>{perf(f.performance_3y)}</Text>
        </View>
      ))}

      <Footer />
    </Page>
  );
}

function FundPage({ fund, index, total }: { fund: Fund; index: number; total: number }) {
  const trackRecord = fund.inception_date
    ? Math.floor((Date.now() - new Date(fund.inception_date).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : null;
  const gestionnaire = fund.management_company ?? fund.gestionnaire ?? "Société de gestion non renseignée";
  const ter = normTer(fund.ongoing_charges ?? fund.ter);
  const retroPct = fund.retrocession_cgp != null ? fund.retrocession_cgp * 100 : null;
  const hasRetro = fund.retrocession_cgp > 0;

  return (
    <Page size="A4" style={S.page}>
      <BrandHeader right={<Eyebrow>{`Fonds ${index + 1} / ${total}`}</Eyebrow>} />

      {fund.data_completeness < 80 && (
        <View style={S.warn}>
          <Text style={S.warnText}>
            Données partielles — complétude {fund.data_completeness}%. Certains champs peuvent manquer.
          </Text>
        </View>
      )}

      <Eyebrow style={{ color: C.clay }}>{fund.product_type ?? "Fonds"}</Eyebrow>
      <Text style={S.fundTitle}>{fund.name}</Text>
      <Text style={S.fundMeta}>
        <Text style={S.fundMetaIsin}>{fund.isin}</Text>
        {`   ·   ${gestionnaire}`}
      </Text>

      <View style={S.badgeRow}>
        {fund.sfdr_article && <Chip tone="ok">SFDR Art. {fund.sfdr_article}</Chip>}
        {(fund.sri ?? fund.risk_score) && <Chip>SRI {fund.sri ?? fund.risk_score}/7</Chip>}
        {fund.morningstar_rating && <Chip tone="gold">★ Morningstar {fund.morningstar_rating}/5</Chip>}
        {fund.pea_eligible && <Chip tone="accent">PEA</Chip>}
        {fund.pea_pme_eligible && <Chip tone="accent">PEA-PME</Chip>}
        {fund.per_eligible && <Chip tone="accent">PER</Chip>}
        {fund.av_fr_eligible && <Chip tone="accent">AV France</Chip>}
        {fund.av_lux_eligible && <Chip tone="accent">AV Luxembourg</Chip>}
        {fund.cto_eligible && <Chip tone="accent">CTO</Chip>}
      </View>

      <View style={[S.statRow, { marginTop: 16, marginBottom: 4 }]}>
        <Stat label="Perf. 1 an" value={perf(fund.performance_1y)} sub="annualisée" color={perfColor(fund.performance_1y)} />
        <Stat label="Perf. 3 ans" value={perf(fund.performance_3y)} sub="annualisée" color={perfColor(fund.performance_3y)} />
        <Stat label="TER" value={fmt(ter)} sub="frais courants" />
        <Stat label="Rétro. CGP" value={fmt(retroPct)} sub="part rétrocédée" color={hasRetro ? C.gold : C.ink} />
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
          <Row label="Frais d'entrée max" value={fund.entry_fee_max != null ? fmt(fund.entry_fee_max * 100) : "—"} />
          <Row label="Commission de sortie max" value={fund.exit_fee_max != null ? fmt(fund.exit_fee_max * 100) : "—"} />
          <Row label="Encours (AUM)" value={fund.aum_eur ? `${(fund.aum_eur / 1_000_000).toFixed(0)} M€` : "—"} />
          <Row label="Création" value={fund.inception_date ? new Date(fund.inception_date).toLocaleDateString("fr-FR") : "—"} />
          <Row label="Ancienneté" value={trackRecord ? `${trackRecord} ans` : "—"} />
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

      <Footer page={`${fund.isin}`} />
    </Page>
  );
}

export default function RapportFondsPDF({ funds }: { funds: Fund[] }) {
  return (
    <Document
      title={`Rapport fonds Charlie — ${dateFr()}`}
      author="Charlie CGP"
      subject="Analyse comparative de fonds"
    >
      <CoverPage funds={funds} />
      {funds.map((fund, i) => (
        <FundPage key={fund.isin} fund={fund} index={i} total={funds.length} />
      ))}
    </Document>
  );
}
