import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { C, FONT, perfColor, registerCharlieFonts } from "./pdf/theme";
import { perfNetteClient, CONTRACT_FEE_DEFAULTS } from "./format";
import { officialLabelsOf } from "./sustainability";
import {
  Bar,
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
import { LineChartPdf, CompositionDonut, CompositionBars, SERIES, toRebasedSeries, type Series } from "./pdf/charts";
import { type Pt } from "./pdf/chartMath";
import type { FundComposition } from "./pdf/pdfData";

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
  // Cover hero
  heroCard: {
    flexDirection: "row",
    backgroundColor: C.paper,
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 11,
    padding: 22,
    gap: 20,
    alignItems: "center",
    marginBottom: 16,
  },
  heroLeft: { flex: 1.7 },
  accentRule: { width: 32, height: 2.5, backgroundColor: C.clay, marginBottom: 12 },
  coverEyebrow: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 8, letterSpacing: 1.8, textTransform: "uppercase", color: C.clay },
  coverTitle: { fontFamily: FONT.sans, fontSize: 33, color: C.ink, lineHeight: 1.02, marginTop: 5 },
  coverSub: { fontFamily: FONT.sans, fontSize: 10, color: C.ink2, marginTop: 7 },
  // Table
  tHead: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 7, borderBottomWidth: 1.25, borderBottomColor: C.ink },
  tHeadText: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 1, textTransform: "uppercase", color: C.muted },
  tRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: 0.75, borderBottomColor: C.lineSoft },
  tRowAlt: { backgroundColor: C.paper },
  colName: { flex: 3, paddingRight: 6 },
  fundName: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 9.5, color: C.ink },
  fundIsin: { fontFamily: FONT.mono, fontSize: 7, color: C.muted, marginTop: 2 },
  colSm: { flex: 1, fontFamily: FONT.mono, fontSize: 8.5, color: C.ink2, textAlign: "center" },
  colMd: { flex: 1.15, fontFamily: FONT.mono, fontWeight: 500, fontSize: 8.5, textAlign: "right" },
  colPerf: { flex: 2, paddingLeft: 12 },
  // Fund page
  fundTitle: { fontFamily: FONT.sans, fontSize: 25, color: C.ink, lineHeight: 1.05, marginTop: 2 },
  fundMeta: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2, marginTop: 5 },
  fundMetaIsin: { fontFamily: FONT.mono, fontSize: 9, color: C.clay },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 9, marginBottom: 9 },
  heroRow: { flexDirection: "row", gap: 12, marginBottom: 10 },
  twoCol: { flexDirection: "row", gap: 22 },
  col: { flex: 1 },
  card: { backgroundColor: C.paper, borderWidth: 0.75, borderColor: C.line, borderRadius: 8, padding: 11, marginTop: 10 },
  cardLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted, marginBottom: 8 },
  ratingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 9, borderTopWidth: 0.75, borderTopColor: C.lineSoft },
  // Chart block
  chartBlock: { backgroundColor: C.paper, borderWidth: 0.75, borderColor: C.line, borderRadius: 9, padding: 10, marginBottom: 9 },
  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 9 },
  perfChips: { flexDirection: "row", gap: 6 },
  perfChip: { alignItems: "center", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, backgroundColor: C.paper2 },
  perfChipLbl: { fontFamily: FONT.sans, fontSize: 6.5, color: C.muted, letterSpacing: 0.4 },
  perfChipVal: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 9, marginTop: 1 },
  // Holdings strip
  holdStrip: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 },
  holdChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.paper2, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  holdName: { fontFamily: FONT.sans, fontSize: 7.5, color: C.ink2 },
  holdW: { fontFamily: FONT.mono, fontSize: 7.5, color: C.muted },
  // Callout rétro
  callout: {
    backgroundColor: C.claySoft,
    borderTopWidth: 2,
    borderTopColor: C.clay,
    borderRadius: 7,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginTop: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  calloutLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 9.5, color: C.clayInk },
  calloutSub: { fontFamily: FONT.sans, fontSize: 7.5, color: "#86422A", marginTop: 3 },
  calloutValue: { fontFamily: FONT.sans, fontSize: 19, color: C.clay },
  callout2: { marginTop: 6, paddingVertical: 7 },
  // Footer
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
    alignItems: "flex-start",
    gap: 16,
  },
  disclaimer: { fontFamily: FONT.sans, fontSize: 6.8, color: C.muted, lineHeight: 1.4, flex: 1 },
  footerBrand: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2 },
  compLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted, marginBottom: 7 },
});

const DISCLAIMER =
  "Aide à la décision pour le CGP/CIF. Ne constitue pas un conseil en investissement au sens MiFID II. " +
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

function CoverPage({ funds, series }: { funds: Fund[]; series: Record<string, Pt[]> }) {
  const single = funds.length === 1;
  const medTer = median(funds.map((f) => normTer(f.ongoing_charges ?? f.ter) as number));
  const avgPerf = mean(funds.map((f) => f.performance_1y as number));
  const avgRetro = mean(funds.map((f) => (f.retrocession_cgp != null ? f.retrocession_cgp * 100 : (null as unknown as number))));
  const maxPerf = Math.max(1, ...funds.map((f) => Math.abs(f.performance_1y ?? 0)));

  // Courbe comparative base 100 : une série par fonds disposant d'un historique.
  const chartSeries: Series[] = funds
    .filter((f) => (series[f.isin]?.length ?? 0) >= 2)
    .map((f, i) => toRebasedSeries(String(f.name), series[f.isin], SERIES[i % SERIES.length]));

  return (
    <Page size="A4" style={S.page}>
      <BrandHeader right={<Eyebrow>{dateFr()}</Eyebrow>} />

      {/* Hero card */}
      <View style={S.heroCard}>
        <View style={S.heroLeft}>
          <View style={S.accentRule} />
          <Text style={S.coverEyebrow}>{single ? "Fiche de fonds" : "Analyse comparative"}</Text>
          <Text style={S.coverTitle}>{single ? "Rapport de fonds" : "Rapport de comparaison"}</Text>
          <Text style={S.coverSub}>
            {funds.length} fonds {single ? "analysé" : "analysés"} · sélection du {dateFr()}
          </Text>
        </View>
        <HeroStat
          label={single ? "Performance 1 an" : "Perf. 1 an moyenne"}
          value={perf(avgPerf)}
          sub="annualisée"
          tone={avgPerf != null && avgPerf < 0 ? "neg" : "pos"}
          style={{ flex: 1, alignSelf: "stretch" }}
        />
      </View>

      <MetricGrid
        cols={3}
        items={[
          { label: "Fonds", value: String(funds.length), sub: single ? "fiche détaillée" : "comparés" },
          { label: "TER médian", value: fmt(medTer), sub: "frais courants" },
          { label: "Rétro. CGP moyenne", value: fmt(avgRetro), sub: "part rétrocédée", color: avgRetro ? C.gold : C.ink },
        ]}
      />

      {/* Courbe comparative (visuel central) — uniquement multi-fonds avec historique. */}
      {chartSeries.length > 1 && (
        <View style={[S.chartBlock, { marginTop: 18, marginBottom: 0 }]}>
          <SectionIntro
            eyebrow="Trajectoire"
            title="Performance comparée, base 100."
            desc="Évolution rebasée à 100 sur la période disponible, pour voir qui mène et avec quelle régularité."
          />
          <LineChartPdf series={chartSeries} width={464} height={150} showArea={false} />
        </View>
      )}

      <View style={{ height: 20 }} />
      <SectionIntro
        eyebrow="Synthèse"
        title="Le comparatif des fonds."
        desc="Performances annualisées, frais courants et rétrocession CGP, alignés pour une lecture immédiate."
      />

      <View style={S.tHead}>
        <Text style={[S.colName, S.tHeadText]}>Fonds</Text>
        <Text style={[S.colSm, S.tHeadText, { textAlign: "center" }]}>SFDR</Text>
        <Text style={[S.colSm, S.tHeadText, { textAlign: "center" }]}>SRI</Text>
        <Text style={[S.colMd, S.tHeadText, { textAlign: "right" }]}>TER</Text>
        <Text style={[S.colMd, S.tHeadText, { textAlign: "right" }]}>Rétro.</Text>
        <Text style={[S.colPerf, S.tHeadText]}>Performance 1 an</Text>
      </View>
      {funds.map((f, i) => (
        <View key={f.isin} style={[S.tRow, ...(i % 2 ? [S.tRowAlt] : [])]}>
          <View style={S.colName}>
            <Text style={S.fundName}>{String(f.name).slice(0, 42)}</Text>
            <Text style={S.fundIsin}>{f.isin}</Text>
          </View>
          <Text style={S.colSm}>{f.sfdr_article ? `Art.${f.sfdr_article}` : "—"}</Text>
          <Text style={S.colSm}>{(f.sri ?? f.risk_score) ? `${f.sri ?? f.risk_score}/7` : "—"}</Text>
          <Text style={[S.colMd, { color: C.ink }]}>{fmt(normTer(f.ongoing_charges ?? f.ter))}</Text>
          <Text style={[S.colMd, { color: f.retrocession_cgp > 0 ? C.gold : C.ink2 }]}>
            {f.retrocession_cgp != null ? fmt(f.retrocession_cgp * 100) : "—"}
          </Text>
          <View style={S.colPerf}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 8.5, color: perfColor(f.performance_1y) }}>
                {perf(f.performance_1y)}
              </Text>
              <Text style={{ fontFamily: FONT.sans, fontSize: 7, color: C.muted }}>
                3A {perf(f.performance_3y)}
              </Text>
            </View>
            {f.performance_1y != null && <Bar value={f.performance_1y} max={maxPerf} />}
          </View>
        </View>
      ))}

      <Footer />
    </Page>
  );
}

function PerfChip({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <View style={S.perfChip}>
      <Text style={S.perfChipLbl}>{label}</Text>
      <Text style={[S.perfChipVal, { color: perfColor(value) }]}>{perf(value)}</Text>
    </View>
  );
}

function FundPage({
  fund,
  index,
  total,
  series,
  comp,
}: {
  fund: Fund;
  index: number;
  total: number;
  series?: Pt[];
  comp?: FundComposition;
}) {
  const trackRecord = fund.inception_date
    ? Math.floor((Date.now() - new Date(fund.inception_date).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : null;
  const gestionnaire = fund.management_company ?? fund.gestionnaire ?? "Société de gestion non renseignée";
  const ter = normTer(fund.ongoing_charges ?? fund.ter);
  const retroPct = fund.retrocession_cgp != null ? fund.retrocession_cgp * 100 : null;
  const hasRetro = fund.retrocession_cgp > 0;
  const sri = fund.sri ?? fund.risk_score;
  const maxPerf = Math.max(1, Math.abs(fund.performance_1y ?? 0), Math.abs(fund.performance_3y ?? 0), Math.abs(fund.performance_5y ?? 0));

  const hasCurve = (series?.length ?? 0) >= 2;
  const curveSeries: Series[] = hasCurve ? [toRebasedSeries(String(fund.name), series!, C.clay)] : [];
  const hasGeo = (comp?.geos?.length ?? 0) > 0;
  const hasSectors = (comp?.sectors?.length ?? 0) > 0;
  const hasHoldings = (comp?.holdings?.length ?? 0) > 0;
  const hasComposition = hasGeo || hasSectors;

  return (
    <Page size="A4" style={S.page}>
      <BrandHeader right={<Eyebrow>{`Fonds ${index + 1} / ${total}`}</Eyebrow>} />

      <Eyebrow style={{ color: C.clay }}>{fund.product_type ?? "Fonds"}</Eyebrow>
      <Text style={S.fundTitle}>{fund.name}</Text>
      <Text style={S.fundMeta}>
        <Text style={S.fundMetaIsin}>{fund.isin}</Text>
        {`   ·   ${gestionnaire}`}
      </Text>

      <View style={S.badgeRow}>
        {fund.sfdr_article && <Chip tone="ok">SFDR Art. {fund.sfdr_article}</Chip>}
        {officialLabelsOf(fund.labels).map((l) => (
          <Chip key={l.key} tone="ok">{l.label}</Chip>
        ))}
        {sri && <Chip>SRI {sri}/7</Chip>}
        {fund.morningstar_rating && <Chip tone="gold">★ Morningstar {fund.morningstar_rating}/5</Chip>}
        {fund.pea_eligible && <Chip tone="accent">PEA</Chip>}
        {fund.pea_pme_eligible && <Chip tone="accent">PEA-PME</Chip>}
        {fund.per_eligible && <Chip tone="accent">PER</Chip>}
        {fund.av_fr_eligible && <Chip tone="accent">AV France</Chip>}
        {fund.av_lux_eligible && <Chip tone="accent">AV Luxembourg</Chip>}
        {fund.cto_eligible && <Chip tone="accent">CTO</Chip>}
      </View>

      {/* Hero : grand chiffre + métriques clés */}
      <View style={S.heroRow}>
        <HeroStat
          label="Performance 1 an"
          value={perf(fund.performance_1y)}
          sub="annualisée"
          tone={fund.performance_1y != null && fund.performance_1y < 0 ? "neg" : "pos"}
          style={{ flex: 1.4, paddingVertical: 11 }}
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

      {/* Courbe de performance (visuel) — sinon repli sur des barres de perf. */}
      {hasCurve ? (
        <View style={S.chartBlock}>
          <View style={S.chartHead}>
            <View>
              <Text style={S.compLabel}>Performance (base 100)</Text>
              <Text style={{ fontFamily: FONT.sans, fontSize: 7.5, color: C.muted }}>Évolution de la valeur liquidative sur la période disponible</Text>
            </View>
            <View style={S.perfChips}>
              <PerfChip label="1 AN" value={fund.performance_1y} />
              <PerfChip label="3 ANS" value={fund.performance_3y} />
              <PerfChip label="5 ANS" value={fund.performance_5y} />
            </View>
          </View>
          <LineChartPdf series={curveSeries} width={464} height={62} />
        </View>
      ) : (
        <View style={S.chartBlock}>
          <Text style={S.compLabel}>Performance annualisée</Text>
          <PerfBarRow label="1 an" value={fund.performance_1y} max={maxPerf} />
          <PerfBarRow label="3 ans" value={fund.performance_3y} max={maxPerf} />
          <PerfBarRow label="5 ans" value={fund.performance_5y} max={maxPerf} />
        </View>
      )}

      <View style={S.twoCol}>
        {/* Colonne gauche : composition (si dispo) sinon risque détaillé */}
        <View style={S.col}>
          {hasComposition ? (
            <>
              {hasGeo && (
                <View>
                  <Text style={S.compLabel}>Répartition géographique</Text>
                  <CompositionDonut slices={comp!.geos} size={72} topN={4} />
                </View>
              )}
              {hasSectors && (
                <View style={{ marginTop: hasGeo ? 10 : 0 }}>
                  <Text style={S.compLabel}>Secteurs</Text>
                  <CompositionBars slices={comp!.sectors} topN={4} />
                </View>
              )}
            </>
          ) : (
            <>
              <SectionIntro eyebrow="Risque" title="La volatilité." />
              <PerfBarRow label="1 an" value={fund.performance_1y} max={maxPerf} />
              <PerfBarRow label="3 ans" value={fund.performance_3y} max={maxPerf} />
              <PerfBarRow label="5 ans" value={fund.performance_5y} max={maxPerf} />
            </>
          )}
          <Row label="Volatilité 1 an" value={fmt(fund.volatility_1y)} />
          <Row label="Ratio de Sharpe 1 an" value={fmt(fund.sharpe_1y, "", 2)} />
          {fund.max_drawdown_3y != null && <Row label="Perte max. 3 ans" value={fmt(fund.max_drawdown_3y)} tone="perf" />}
        </View>

        {/* Colonne droite : frais & structure */}
        <View style={S.col}>
          <SectionIntro eyebrow="Frais & structure" title="Le coût réel." />
          <Row label="Frais courants (TER)" value={fmt(ter)} />
          <Row label="Frais d'entrée max" value={fund.entry_fee_max != null ? fmt(fund.entry_fee_max * 100) : "—"} />
          <Row label="Commission de sortie max" value={fund.exit_fee_max != null ? fmt(fund.exit_fee_max * 100) : "—"} />
          {/* Perf nette client : VL (déjà nette du fonds) moins frais de gestion du
              contrat AV (hypothèse standard). Pas de double comptage du TER/rétro. */}
          <Row
            label="Perf. nette 3 ans (AV, est.)"
            value={fund.performance_3y != null ? perf(perfNetteClient(fund.performance_3y, CONTRACT_FEE_DEFAULTS["AV-FR"])) : "—"}
          />
          {fund.sustainable_investment_pct != null && (
            <Row label="Investissement durable" value={fmt(fund.sustainable_investment_pct)} />
          )}
          {fund.taxonomy_alignment_pct != null && (
            <Row label="Aligné taxonomie UE" value={fmt(fund.taxonomy_alignment_pct)} />
          )}
          <Row label="Encours (AUM)" value={fund.aum_eur ? `${(fund.aum_eur / 1_000_000).toFixed(0)} M€` : "—"} />
          <Row label="Création" value={fund.inception_date ? new Date(fund.inception_date).toLocaleDateString("fr-FR") : "—"} />
          <Row label="Ancienneté" value={trackRecord ? `${trackRecord} ans` : "—"} />

          {fund.morningstar_rating ? (
            <View style={S.ratingRow}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 8.5, color: C.ink2 }}>Notation Morningstar</Text>
              <RatingDots value={fund.morningstar_rating} />
            </View>
          ) : null}

          <View style={{ marginTop: 11 }}>
            <Text style={S.cardLabel}>Indicateur de risque (SRI)</Text>
            <SriMeter value={sri} />
          </View>

          {fund.benchmark_index && (fund.alpha_3y != null || fund.alpha_1y != null) && (
            <View style={S.card}>
              <Text style={S.cardLabel}>
                {fund.benchmark_is_category ? "Alpha vs indice de catégorie" : "Performance vs indice"}
              </Text>
              <Row label="Indice" value={String(fund.benchmark_index).slice(0, 28)} />
              <Row label="Alpha 1 an" value={fund.alpha_1y != null ? perf(fund.alpha_1y) : "—"} tone={fund.alpha_1y} />
              <Row label="Alpha 3 ans (ann.)" value={fund.alpha_3y != null ? perf(fund.alpha_3y) : "—"} tone={fund.alpha_3y} />
            </View>
          )}
        </View>
      </View>

      {/* Principales positions (transparence) */}
      {hasHoldings && (
        <View style={{ marginTop: 6 }}>
          <Text style={S.compLabel}>Principales positions</Text>
          <View style={S.holdStrip}>
            {comp!.holdings.slice(0, 6).map((h, i) => (
              <View key={i} style={S.holdChip}>
                <Text style={S.holdName}>{h.label.length > 24 ? h.label.slice(0, 23) + "…" : h.label}</Text>
                <Text style={S.holdW}>{(h.weight <= 1 ? h.weight * 100 : h.weight).toFixed(1)}%</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {hasRetro && (
        <View style={[S.callout, S.callout2]}>
          <View>
            <Text style={S.calloutLabel}>Rétrocession CGP : {fmt(retroPct)} par an</Text>
            <Text style={S.calloutSub}>Revenu estimé pour un encours de 100 000 € confié</Text>
          </View>
          <Text style={S.calloutValue}>{nfEur(100_000 * fund.retrocession_cgp)}/an</Text>
        </View>
      )}

      <Footer page={`${fund.isin}`} />
    </Page>
  );
}

export default function RapportFondsPDF({
  funds,
  series = {},
  composition = {},
}: {
  funds: Fund[];
  series?: Record<string, Pt[]>;
  composition?: Record<string, FundComposition>;
}) {
  return (
    <Document title={`Rapport fonds Charlie · ${dateFr()}`} author="Charlie CGP" subject="Analyse comparative de fonds">
      <CoverPage funds={funds} series={series} />
      {funds.map((fund, i) => (
        <FundPage key={fund.isin} fund={fund} index={i} total={funds.length} series={series[fund.isin]} comp={composition[fund.isin]} />
      ))}
    </Document>
  );
}
