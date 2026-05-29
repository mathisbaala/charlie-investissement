import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const S = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1a1a1a" },
  // Cover
  coverTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  coverSub: { fontSize: 11, color: "#6b7280", marginBottom: 32 },
  coverDate: { fontSize: 9, color: "#9ca3af", marginBottom: 24 },
  // Summary table
  tableHeader: { flexDirection: "row", backgroundColor: "#f3f4f6", paddingVertical: 6, paddingHorizontal: 4, marginBottom: 2 },
  tableRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  colName: { flex: 3, fontSize: 9 },
  colSm: { flex: 1, fontSize: 9, textAlign: "center" },
  colMd: { flex: 1.2, fontSize: 9, textAlign: "right" },
  headerText: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#6b7280" },
  // Fund pages
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#6b7280", marginBottom: 10 },
  badge: { backgroundColor: "#dbeafe", color: "#1d4ed8", padding: "3 8", borderRadius: 4, marginRight: 6, fontSize: 9 },
  badgeRow: { flexDirection: "row", marginBottom: 14, flexWrap: "wrap" },
  sectionTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: "#e5e7eb", paddingBottom: 3, marginTop: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#f9fafb" },
  label: { color: "#6b7280" },
  value: { fontFamily: "Helvetica-Bold" },
  grid: { flexDirection: "row", gap: 20 },
  col: { flex: 1 },
  disclaimer: { fontSize: 7.5, color: "#9ca3af", marginTop: 20, borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingTop: 6 },
  pageNum: { fontSize: 8, color: "#9ca3af", textAlign: "right", marginBottom: 8 },
  warning: { backgroundColor: "#fef3c7", padding: "5 8", marginBottom: 10, fontSize: 8.5, color: "#92400e" },
});

function fmt(n: number | null, suffix = "%", d = 2): string {
  return n == null ? "—" : `${Number(n).toFixed(d)}${suffix}`;
}

function perf(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FundPage({ fund, index, total }: { fund: Record<string, any>; index: number; total: number }) {
  const trackRecord = fund.inception_date
    ? Math.floor((Date.now() - new Date(fund.inception_date).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : null;
  const gestionnaire = fund.management_company ?? fund.gestionnaire ?? "Société de gestion non renseignée";

  return (
    <Page size="A4" style={S.page}>
      <Text style={S.pageNum}>Fonds {index + 1} / {total}</Text>

      {fund.data_completeness < 80 && (
        <View style={S.warning}>
          <Text>Données partielles — complétude {fund.data_completeness}%.</Text>
        </View>
      )}

      <Text style={S.title}>{fund.name}</Text>
      <Text style={S.subtitle}>{fund.isin} · {gestionnaire}</Text>

      <View style={S.badgeRow}>
        {fund.sfdr_article && <Text style={S.badge}>SFDR Art.{fund.sfdr_article}</Text>}
        {(fund.sri ?? fund.risk_score) && <Text style={S.badge}>SRI {fund.sri ?? fund.risk_score}/7</Text>}
        {fund.morningstar_rating && <Text style={S.badge}>★ Morningstar {fund.morningstar_rating}/5</Text>}
        {fund.pea_eligible && <Text style={S.badge}>PEA</Text>}
        {fund.pea_pme_eligible && <Text style={S.badge}>PEA-PME</Text>}
        {fund.per_eligible && <Text style={S.badge}>PER</Text>}
        {fund.av_fr_eligible && <Text style={S.badge}>AV France</Text>}
        {fund.av_lux_eligible && <Text style={S.badge}>AV Luxembourg</Text>}
        {fund.cto_eligible && <Text style={S.badge}>CTO</Text>}
      </View>

      <View style={S.grid}>
        <View style={S.col}>
          <Text style={S.sectionTitle}>Performances</Text>
          <View style={S.row}><Text style={S.label}>1 an</Text><Text style={S.value}>{fmt(fund.performance_1y)}</Text></View>
          <View style={S.row}><Text style={S.label}>3 ans</Text><Text style={S.value}>{fmt(fund.performance_3y)}</Text></View>
          <View style={S.row}><Text style={S.label}>5 ans</Text><Text style={S.value}>{fmt(fund.performance_5y)}</Text></View>
          <View style={S.row}><Text style={S.label}>Volatilité 1Y</Text><Text style={S.value}>{fmt(fund.volatility_1y)}</Text></View>
          <View style={S.row}><Text style={S.label}>Sharpe 1Y</Text><Text style={S.value}>{fmt(fund.sharpe_1y, "", 2)}</Text></View>
        </View>
        <View style={S.col}>
          <Text style={S.sectionTitle}>Frais</Text>
          <View style={S.row}><Text style={S.label}>Frais courants (TER)</Text><Text style={S.value}>{fmt(fund.ongoing_charges ?? fund.ter)}</Text></View>
          <View style={S.row}><Text style={S.label}>Frais d'entrée max</Text><Text style={S.value}>{fund.entry_fee_max != null ? fmt(fund.entry_fee_max * 100) : "—"}</Text></View>
          <View style={S.row}><Text style={S.label}>Rétrocession CGP</Text><Text style={S.value}>{fund.retrocession_cgp != null ? fmt(fund.retrocession_cgp * 100) : "—"}</Text></View>
          <View style={S.row}><Text style={S.label}>Encours</Text><Text style={S.value}>{fund.aum_eur ? `${(fund.aum_eur / 1_000_000).toFixed(0)} M€` : "—"}</Text></View>
          <View style={S.row}><Text style={S.label}>Création</Text><Text style={S.value}>{fund.inception_date ? new Date(fund.inception_date).toLocaleDateString("fr-FR") : "—"}</Text></View>
          <View style={S.row}><Text style={S.label}>Track record</Text><Text style={S.value}>{trackRecord ? `${trackRecord} ans` : "—"}</Text></View>
          <View style={S.row}><Text style={S.label}>Type</Text><Text style={S.value}>{fund.product_type ?? "—"}</Text></View>
        </View>
      </View>

      <Text style={S.disclaimer}>
        Document généré par Charlie CGP le {new Date().toLocaleDateString("fr-FR")}.
        Ce document est une aide à la décision et ne constitue pas un conseil en investissement au sens MiFID II.
        La responsabilité du conseil reste intégralement avec le CGP/CIF. Les performances passées ne préjugent pas des performances futures.
      </Text>
    </Page>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function RapportFondsPDF({ funds }: { funds: Record<string, any>[] }) {
  return (
    <Document>
      {/* Page de synthèse */}
      <Page size="A4" style={S.page}>
        <Text style={S.coverTitle}>Rapport de comparaison</Text>
        <Text style={S.coverSub}>{funds.length} fonds analysés</Text>
        <Text style={S.coverDate}>Généré par Charlie CGP le {new Date().toLocaleDateString("fr-FR")}</Text>

        {/* Tableau de synthèse */}
        <View style={S.tableHeader}>
          <Text style={[S.colName, S.headerText]}>Fonds</Text>
          <Text style={[S.colSm, S.headerText]}>SFDR</Text>
          <Text style={[S.colSm, S.headerText]}>SRI</Text>
          <Text style={[S.colMd, S.headerText]}>TER</Text>
          <Text style={[S.colMd, S.headerText]}>Perf 1Y</Text>
          <Text style={[S.colMd, S.headerText]}>Perf 3Y</Text>
          <Text style={[S.colMd, S.headerText]}>Perf 5Y</Text>
        </View>
        {funds.map((f) => (
          <View key={f.isin} style={S.tableRow}>
            <View style={S.colName}>
              <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold" }}>{String(f.name).slice(0, 55)}</Text>
              <Text style={{ fontSize: 7.5, color: "#9ca3af" }}>{f.isin}</Text>
            </View>
            <Text style={S.colSm}>{f.sfdr_article ? `Art.${f.sfdr_article}` : "—"}</Text>
            <Text style={S.colSm}>{(f.sri ?? f.risk_score) ? `${f.sri ?? f.risk_score}/7` : "—"}</Text>
            <Text style={S.colMd}>{fmt(f.ongoing_charges)}</Text>
            <Text style={S.colMd}>{perf(f.performance_1y)}</Text>
            <Text style={S.colMd}>{perf(f.performance_3y)}</Text>
            <Text style={S.colMd}>{perf(f.performance_5y)}</Text>
          </View>
        ))}

        <Text style={S.disclaimer}>
          Ce document est une aide à la décision pour le CGP et ne constitue pas un conseil en investissement au sens MiFID II.
          Les performances passées ne préjugent pas des performances futures.
        </Text>
      </Page>

      {/* Une page par fonds */}
      {funds.map((fund, i) => (
        <FundPage key={fund.isin} fund={fund} index={i} total={funds.length} />
      ))}
    </Document>
  );
}
