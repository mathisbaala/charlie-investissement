import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1a1a1a" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#6b7280", marginBottom: 12 },
  badge: { backgroundColor: "#dbeafe", color: "#1d4ed8", padding: "3 8", borderRadius: 4, marginRight: 6, fontSize: 9 },
  badgeRow: { flexDirection: "row", marginBottom: 16 },
  sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: "#e5e7eb", paddingBottom: 4, marginTop: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  label: { color: "#6b7280" },
  value: { fontFamily: "Helvetica-Bold" },
  grid: { flexDirection: "row", gap: 20 },
  col: { flex: 1 },
  disclaimer: { fontSize: 8, color: "#9ca3af", marginTop: 24, borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingTop: 8 },
  warning: { backgroundColor: "#fef3c7", padding: "6 10", marginBottom: 12, fontSize: 9, color: "#92400e" },
});

function fmt(n: number | null, suffix = "%", d = 2): string {
  return n == null ? "—" : `${Number(n).toFixed(d)}${suffix}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function FicheFondsPDF({ fund }: { fund: Record<string, any> }) {
  const trackRecord = fund.inception_date
    ? Math.floor((Date.now() - new Date(fund.inception_date).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {fund.data_completeness < 80 && (
          <View style={styles.warning}>
            <Text>Données partielles — complétude {fund.data_completeness}%. Certains champs peuvent être manquants.</Text>
          </View>
        )}

        <Text style={styles.title}>{fund.name}</Text>
        <Text style={styles.subtitle}>
          {fund.isin} · {fund.management_company ?? "Société de gestion non renseignée"}
        </Text>

        <View style={styles.badgeRow}>
          {fund.sfdr_article && <Text style={styles.badge}>SFDR Art.{fund.sfdr_article}</Text>}
          {fund.sri && <Text style={styles.badge}>SRI {fund.sri}/7</Text>}
          {fund.morningstar_rating && <Text style={styles.badge}>Morningstar {fund.morningstar_rating}/5</Text>}
        </View>

        <View style={styles.grid}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Performances</Text>
            <View style={styles.row}><Text style={styles.label}>1 an</Text><Text style={styles.value}>{fmt(fund.performance_1y)}</Text></View>
            <View style={styles.row}><Text style={styles.label}>3 ans</Text><Text style={styles.value}>{fmt(fund.performance_3y)}</Text></View>
            <View style={styles.row}><Text style={styles.label}>5 ans</Text><Text style={styles.value}>{fmt(fund.performance_5y)}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Volatilité 1Y</Text><Text style={styles.value}>{fmt(fund.volatility_1y)}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Sharpe 1Y</Text><Text style={styles.value}>{fmt(fund.sharpe_1y, "", 2)}</Text></View>
          </View>

          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Caractéristiques</Text>
            <View style={styles.row}><Text style={styles.label}>TER / Frais</Text><Text style={styles.value}>{fmt(fund.ongoing_charges)}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Encours</Text><Text style={styles.value}>{fund.aum_eur ? `${(fund.aum_eur / 1_000_000).toFixed(0)} M€` : "—"}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Création</Text><Text style={styles.value}>{fund.inception_date ? new Date(fund.inception_date).toLocaleDateString("fr-FR") : "—"}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Track record</Text><Text style={styles.value}>{trackRecord ? `${trackRecord} ans` : "—"}</Text></View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Éligibilités</Text>
        <View style={styles.badgeRow}>
          {fund.is_pea_eligible && <Text style={styles.badge}>PEA</Text>}
          {fund.is_av_eligible && <Text style={styles.badge}>AV France</Text>}
          {fund.is_per_eligible && <Text style={styles.badge}>PER</Text>}
          {fund.is_av_lux_eligible && <Text style={styles.badge}>AV Luxembourg</Text>}
        </View>

        <Text style={styles.disclaimer}>
          Document généré par Charlie CGP le {new Date().toLocaleDateString("fr-FR")}.
          Ce document est une aide à la décision pour le CGP et ne constitue pas un conseil en investissement au sens MiFID II.
          La responsabilité du conseil reste intégralement avec le CGP/CIF. Les performances passées ne préjugent pas des performances futures.
        </Text>
      </Page>
    </Document>
  );
}
