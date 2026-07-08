import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { C, FONT, perfColor, registerCharlieFonts } from "./pdf/theme";
import {
  BrandHeader,
  Chip,
  Eyebrow,
  HeroStat,
  MetricGrid,
  Row,
  SectionIntro,
  dateFr,
  fmt,
  nfEur,
} from "./pdf/components";
import { LineChartPdf, CompositionDonut, CompositionBars, corrColor, toRebasedSeries, type Series } from "./pdf/charts";
import { type Pt } from "./pdf/chartMath";
import {
  buildCorrelationMatrix,
  projectEuros,
  type PortfolioAnalysis,
  type Holding,
} from "./portfolio";
import type { Expo } from "./lookthrough";

registerCharlieFonts();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fund = Record<string, any>;

interface PortefeuillePDFProps {
  analysis: PortfolioAnalysis;
  holdings: Holding[]; // poids en % (déjà normalisés), dans l'ordre d'affichage
  fundsInfo: Record<string, Fund>;
  geoExpo: Expo[];
  sectorExpo: Expo[];
  benchmarkLabel: string;
  amount?: number;
}

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
  coverTitle: { fontFamily: FONT.sans, fontSize: 31, color: C.ink, lineHeight: 1.02, marginTop: 5 },
  coverSub: { fontFamily: FONT.sans, fontSize: 10, color: C.ink2, marginTop: 7 },
  block: { backgroundColor: C.paper, borderWidth: 0.75, borderColor: C.line, borderRadius: 9, padding: 13, marginTop: 14 },
  label: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted, marginBottom: 8 },
  twoCol: { flexDirection: "row", gap: 18, marginTop: 14 },
  // Tableau ratios / fonds
  tHead: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 6, borderBottomWidth: 1.25, borderBottomColor: C.ink },
  tHeadText: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 0.8, textTransform: "uppercase", color: C.muted },
  tRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 0.75, borderBottomColor: C.lineSoft },
  tRowAlt: { backgroundColor: C.paper },
  // Projection callout
  callout: {
    backgroundColor: C.claySoft,
    borderTopWidth: 2,
    borderTopColor: C.clay,
    borderRadius: 7,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  calloutLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 9.5, color: C.clayInk },
  calloutSub: { fontFamily: FONT.sans, fontSize: 7.5, color: "#86422A", marginTop: 3 },
  calloutValue: { fontFamily: FONT.sans, fontSize: 22, color: C.clay },
  // Corrélation
  corrCell: { borderRadius: 3, paddingVertical: 5, alignItems: "center", justifyContent: "center" },
  corrTxt: { fontFamily: FONT.mono, fontSize: 7.5 },
  corrHead: { fontFamily: FONT.sans, fontSize: 7, color: C.muted },
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
});

const DISCLAIMER =
  "Aide à la décision pour le CGP/CIF. Back-test indicatif sur données disponibles, hors frais d'enveloppe. " +
  "Ne constitue pas un conseil en investissement (MiFID II). Les performances passées ne préjugent pas des performances futures.";

function Footer({ page }: { page?: string }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.disclaimer}>{DISCLAIMER}</Text>
      <Text style={S.footerBrand}>{page ?? "Charlie · Portefeuille"}</Text>
    </View>
  );
}

const frMonth = (d: string | null | undefined): string => {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const s = x.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Fraction (0.08) → pourcentage affiché (« +8,0 % »). */
function pctFrac(v: number | null | undefined, sign = false): string {
  if (v == null) return "—";
  const p = v * 100;
  return `${sign && p > 0 ? "+" : ""}${p.toFixed(1)} %`;
}

function shortName(name: string | undefined, isin: string, max = 32): string {
  if (!name) return isin;
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

function curveToPts(curve: { d: string; v: number }[] | undefined | null): Pt[] {
  return (curve ?? [])
    .map((p) => ({ t: new Date(p.d).getTime(), v: Number(p.v) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
}

export default function PortefeuillePDF({
  analysis,
  holdings,
  fundsInfo,
  geoExpo,
  sectorExpo,
  benchmarkLabel,
  amount = 10000,
}: PortefeuillePDFProps) {
  const { ratios, meta, benchmark, names = {} } = analysis;
  const period = meta?.start && meta?.end ? `${frMonth(meta.start)} – ${frMonth(meta.end)}` : "";

  // Courbe back-test : portefeuille (clay) + benchmark (rebasés base 100).
  const pPts = curveToPts(analysis.curve);
  const bPts = curveToPts(benchmark?.curve);
  const chartSeries: Series[] = [];
  if (pPts.length >= 2) chartSeries.push(toRebasedSeries("Portefeuille", pPts, C.clay));
  if (bPts.length >= 2) chartSeries.push(toRebasedSeries(benchmarkLabel, bPts, "#8A8780"));

  // Composition (poids) — slices triées par poids décroissant.
  const compSlices = holdings
    .map((h) => ({ label: shortName(names[h.isin], h.isin, 26), weight: h.weight }))
    .filter((x) => x.weight > 0);

  // Matrice de corrélation NxN.
  const isins = holdings.map((h) => h.isin);
  const matrix = buildCorrelationMatrix(isins, analysis.correlation ?? []);

  const proj = projectEuros(ratios?.total_return, amount);

  const ratioRows = [
    { k: "Perf. annualisée", p: pctFrac(ratios?.annual_return, true), b: pctFrac(benchmark?.annual_return, true) },
    { k: "Perf. totale", p: pctFrac(ratios?.total_return, true), b: pctFrac(benchmark?.total_return, true) },
    { k: "Volatilité", p: pctFrac(ratios?.volatility), b: pctFrac(benchmark?.volatility) },
    { k: "Ratio de Sharpe", p: ratios?.sharpe?.toFixed(2) ?? "—", b: benchmark?.sharpe?.toFixed(2) ?? "—" },
    { k: "Perte maximale", p: pctFrac(ratios?.max_drawdown), b: pctFrac(benchmark?.max_drawdown) },
  ];

  return (
    <Document title={`Portefeuille Charlie · ${dateFr()}`} author="Charlie CGP" subject="Analyse de portefeuille">
      {/* ── Page 1 : Vue d'ensemble + back-test ── */}
      <Page size="A4" style={S.page}>
        <BrandHeader right={<Eyebrow>{dateFr()}</Eyebrow>} />

        <View style={S.heroCard}>
          <View style={S.heroLeft}>
            <View style={S.accentRule} />
            <Text style={S.coverEyebrow}>Analyse de portefeuille</Text>
            <Text style={S.coverTitle}>Votre allocation, passée au crible.</Text>
            <Text style={S.coverSub}>
              {holdings.length} fonds{benchmarkLabel ? ` · indice : ${benchmarkLabel}` : ""}
              {period ? ` · ${period}` : ""}
            </Text>
          </View>
          <HeroStat
            label="Performance annualisée"
            value={pctFrac(ratios?.annual_return, true)}
            sub="sur la période"
            tone={ratios?.annual_return != null && ratios.annual_return < 0 ? "neg" : "pos"}
            style={{ flex: 1, alignSelf: "stretch" }}
          />
        </View>

        <MetricGrid
          cols={4}
          items={[
            { label: "Perf. totale", value: pctFrac(ratios?.total_return, true), sub: "cumulée", color: perfColor(ratios?.total_return) },
            { label: "Volatilité", value: pctFrac(ratios?.volatility), sub: "annualisée" },
            { label: "Sharpe", value: ratios?.sharpe?.toFixed(2) ?? "—", sub: "rendement/risque" },
            { label: "Perte max.", value: pctFrac(ratios?.max_drawdown), sub: "pire repli", color: C.red },
          ]}
        />

        {/* Composition (poids) */}
        <View style={S.block}>
          <Text style={S.label}>Composition du portefeuille</Text>
          <CompositionDonut slices={compSlices} size={96} topN={9} centerLabel="fonds" />
        </View>

        {/* Back-test vs benchmark */}
        <View style={S.block}>
          <SectionIntro
            eyebrow="Back-test"
            title="Portefeuille vs indice de référence."
            desc="Évolution rebasée à 100 sur la période disponible, à pondération constante (rééquilibrage implicite)."
          />
          {chartSeries.length >= 1 ? (
            <LineChartPdf series={chartSeries} width={464} height={150} showArea={chartSeries.length === 1} />
          ) : (
            <Text style={{ fontFamily: FONT.sans, fontSize: 8, color: C.muted }}>
              Aucun des fonds n&apos;a d&apos;historique de prix exploitable pour un back-test.
            </Text>
          )}
        </View>

        <Footer page="Charlie · Portefeuille, vue d'ensemble" />
      </Page>

      {/* ── Page 2 : Ratios, projection, corrélation, exposition ── */}
      <Page size="A4" style={S.page}>
        <BrandHeader right={<Eyebrow>Analyse détaillée</Eyebrow>} />

        <SectionIntro eyebrow="Indicateurs" title="Le portefeuille face à son indice." />
        <View style={S.tHead}>
          <Text style={[{ flex: 3 }, S.tHeadText]}>Indicateur</Text>
          <Text style={[{ flex: 2, textAlign: "right" }, S.tHeadText]}>Portefeuille</Text>
          <Text style={[{ flex: 2, textAlign: "right" }, S.tHeadText]}>{shortName(benchmarkLabel, "Indice", 22)}</Text>
        </View>
        {ratioRows.map((r, i) => (
          <View key={r.k} style={[S.tRow, ...(i % 2 ? [S.tRowAlt] : [])]}>
            <Text style={{ flex: 3, fontFamily: FONT.sans, fontSize: 9, color: C.ink2 }}>{r.k}</Text>
            <Text style={{ flex: 2, fontFamily: FONT.mono, fontWeight: 500, fontSize: 9, color: C.ink, textAlign: "right" }}>{r.p}</Text>
            <Text style={{ flex: 2, fontFamily: FONT.mono, fontSize: 9, color: C.muted, textAlign: "right" }}>{r.b}</Text>
          </View>
        ))}

        {/* Projection */}
        <View style={S.callout}>
          <View>
            <Text style={S.calloutLabel}>Projection sur {nfEur(amount)} investis</Text>
            <Text style={S.calloutSub}>Valeur finale estimée à partir de la performance totale de la période</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={S.calloutValue}>{nfEur(proj.final)}</Text>
            <Text style={{ fontFamily: FONT.mono, fontSize: 9, color: proj.gain >= 0 ? C.green : C.red, marginTop: 2 }}>
              {proj.gain >= 0 ? "+" : ""}{nfEur(proj.gain)}
            </Text>
          </View>
        </View>

        {/* Corrélation */}
        {isins.length >= 2 && (
          <View style={S.block}>
            <Text style={S.label}>Corrélation entre les fonds</Text>
            <Text style={{ fontFamily: FONT.sans, fontSize: 7.5, color: C.muted, marginBottom: 9 }}>
              Plus la teinte est claire (vert), plus les fonds se diversifient ; plus elle est soutenue (clay), plus ils évoluent ensemble.
            </Text>
            {/* En-tête de colonnes (indices) */}
            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 2 }} />
              {isins.map((isin, ci) => (
                <Text key={ci} style={[S.corrHead, { flex: 1, textAlign: "center" }]}>F{ci + 1}</Text>
              ))}
            </View>
            {isins.map((isin, ri) => (
              <View key={isin} style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
                <Text style={{ flex: 2, fontFamily: FONT.sans, fontSize: 7.5, color: C.ink2 }} wrap={false}>
                  F{ri + 1} · {shortName(names[isin], isin, 24)}
                </Text>
                {matrix[ri]?.map((c, ci) => {
                  const col = corrColor(c);
                  return (
                    <View key={ci} style={{ flex: 1, paddingHorizontal: 1.5 }}>
                      <View style={[S.corrCell, { backgroundColor: col.bg }]}>
                        <Text style={[S.corrTxt, { color: col.fg }]}>{c == null ? "—" : c.toFixed(2)}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {/* Exposition agrégée */}
        {(geoExpo.length > 0 || sectorExpo.length > 0) && (
          <View style={S.twoCol}>
            {geoExpo.length > 0 && (
              <View style={{ flex: 1 }}>
                <Text style={S.label}>Exposition géographique agrégée</Text>
                <CompositionDonut slices={geoExpo} size={84} topN={5} />
              </View>
            )}
            {sectorExpo.length > 0 && (
              <View style={{ flex: 1 }}>
                <Text style={S.label}>Exposition sectorielle agrégée</Text>
                <CompositionBars slices={sectorExpo} topN={6} />
              </View>
            )}
          </View>
        )}

        <Footer page="Charlie · Portefeuille, analyse" />
      </Page>

      {/* ── Page 3 : Détail des fonds ── */}
      <Page size="A4" style={S.page}>
        <BrandHeader right={<Eyebrow>Détail des fonds</Eyebrow>} />
        <SectionIntro
          eyebrow="Composition détaillée"
          title="Les fonds qui composent l'allocation."
          desc="Poids cible, performances annualisées, frais courants et profil de risque de chaque ligne."
        />

        <View style={S.tHead}>
          <Text style={[{ flex: 3.4 }, S.tHeadText]}>Fonds</Text>
          <Text style={[{ flex: 1, textAlign: "right" }, S.tHeadText]}>Poids</Text>
          <Text style={[{ flex: 1, textAlign: "right" }, S.tHeadText]}>1 an</Text>
          <Text style={[{ flex: 1, textAlign: "right" }, S.tHeadText]}>3 ans</Text>
          <Text style={[{ flex: 1, textAlign: "right" }, S.tHeadText]}>TER</Text>
          <Text style={[{ flex: 0.8, textAlign: "right" }, S.tHeadText]}>SRI</Text>
        </View>
        {holdings.map((h, i) => {
          const f = fundsInfo[h.isin] ?? {};
          const sri = f.sri ?? f.risk_score;
          return (
            <View key={h.isin} style={[S.tRow, ...(i % 2 ? [S.tRowAlt] : [])]}>
              <View style={{ flex: 3.4, paddingRight: 6 }}>
                <Text style={{ fontFamily: FONT.sans, fontWeight: 500, fontSize: 9, color: C.ink }}>{shortName(f.name ?? names[h.isin], h.isin, 38)}</Text>
                <Text style={{ fontFamily: FONT.mono, fontSize: 6.5, color: C.muted, marginTop: 1 }}>
                  {h.isin}{f.product_type ? `  ·  ${f.product_type}` : ""}
                </Text>
              </View>
              <Text style={{ flex: 1, fontFamily: FONT.mono, fontWeight: 500, fontSize: 8.5, color: C.clay, textAlign: "right" }}>{h.weight.toFixed(0)}%</Text>
              <Text style={{ flex: 1, fontFamily: FONT.mono, fontSize: 8.5, color: perfColor(f.performance_1y), textAlign: "right" }}>{f.performance_1y != null ? `${f.performance_1y >= 0 ? "+" : ""}${f.performance_1y.toFixed(1)}%` : "—"}</Text>
              <Text style={{ flex: 1, fontFamily: FONT.mono, fontSize: 8.5, color: perfColor(f.performance_3y), textAlign: "right" }}>{f.performance_3y != null ? `${f.performance_3y >= 0 ? "+" : ""}${f.performance_3y.toFixed(1)}%` : "—"}</Text>
              <Text style={{ flex: 1, fontFamily: FONT.mono, fontSize: 8.5, color: C.ink2, textAlign: "right" }}>{fmt(f.ongoing_charges != null ? f.ongoing_charges * 100 : (f.ter != null ? f.ter * 100 : null))}</Text>
              <Text style={{ flex: 0.8, fontFamily: FONT.mono, fontSize: 8.5, color: C.ink2, textAlign: "right" }}>{sri ? `${sri}/7` : "—"}</Text>
            </View>
          );
        })}

        {meta && (meta.excluded?.length ?? 0) > 0 && (
          <Text style={{ fontFamily: FONT.sans, fontSize: 7.5, color: C.clay, marginTop: 12 }}>
            Sans historique de prix (exclus du back-test) : {meta.excluded.map((i) => names[i] ?? i).join(", ")}.
          </Text>
        )}

        {/* Rétrocession agrégée si renseignée */}
        <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
          {holdings.some((h) => (fundsInfo[h.isin]?.retrocession_cgp ?? 0) > 0) && (
            <Chip tone="gold">Certaines lignes versent une rétrocession CGP, cf. fiches détaillées</Chip>
          )}
        </View>

        <Footer page="Charlie · Portefeuille, fonds" />
      </Page>
    </Document>
  );
}
