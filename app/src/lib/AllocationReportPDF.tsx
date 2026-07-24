import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { C, FONT, registerCharlieFonts } from "./pdf/theme";
import { SectionIntro, HeroStat, Chip, Bar, MetricGrid, SriMeter, nfEur } from "./pdf/components";
import { CompositionDonut, LineChartPdf, corrColor, SERIES, type Series } from "./pdf/charts";
import type { AllocationPresentation } from "./allocationRationale";
import type { PresentationExtras } from "./presentationExtras";

registerCharlieFonts();

// Proposition d'investissement remise au client : reprend TOUT ce que l'atelier
// Portefeuille affiche (répartitions par classe, géo et secteurs en transparence,
// projets du client, corrélation, back-test, projection) dans une mise en page
// éditoriale : couverture sombre côté client, synthèse exécutive autonome, un
// chiffre mis en valeur par section, mentions réglementaires aux bons endroits.
// 100 % déterministe : consomme buildPresentation() + les extras collectés au
// téléchargement (chaque section optionnelle disparaît si sa donnée manque).
// Convention typographique : aucun tiret de ponctuation ; séparateurs « · »,
// virgules et deux-points ; valeurs absentes notées « n.c. ».

const NC = "n.c.";

const s = StyleSheet.create({
  page: {
    backgroundColor: C.cream,
    paddingTop: 34,
    paddingBottom: 46,
    paddingHorizontal: 38,
    fontFamily: FONT.sans,
    color: C.ink,
    fontSize: 9,
  },
  // Couverture sombre (sandwich clair/sombre, DA Charlie : encre + clay)
  cover: {
    backgroundColor: C.ink,
    paddingTop: 40,
    paddingBottom: 46,
    paddingHorizontal: 44,
    fontFamily: FONT.sans,
    color: C.cream,
  },
  coverBrand: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  coverWordmark: { flexDirection: "row", alignItems: "center", gap: 9 },
  coverDot: { width: 6, height: 6, borderRadius: 6 },
  // Badge clair portant le logo : reste lisible sur la couverture sombre, même
  // si le logo du cabinet est foncé. Un peu large pour accueillir un logotype.
  coverLogoBadge: { width: 30, height: 24, borderRadius: 6, backgroundColor: C.cream, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
  coverLogoImg: { width: 24, height: 16, objectFit: "contain" },
  coverCharlie: { fontSize: 17, color: C.cream },
  // Filet de marque en pied de page intérieure
  footLogo: { width: 11, height: 10, objectFit: "contain", marginRight: 5 },
  footBrand: { flexDirection: "row", alignItems: "center" },
  coverConf: { fontSize: 7.5, letterSpacing: 1.6, textTransform: "uppercase", color: "#8F8C86" },
  coverEyebrow: { marginTop: 150, fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase", color: "#C88A6E", fontWeight: 500 },
  coverTitle: { fontSize: 30, lineHeight: 1.1, marginTop: 10, color: "#F7F5F2", fontWeight: 600, maxWidth: 420 },
  coverSub: { fontSize: 11, color: "#B5B2AC", marginTop: 10 },
  coverTiles: { flexDirection: "row", gap: 10, marginTop: 56 },
  coverTile: { flex: 1, backgroundColor: "#26241F", borderRadius: 9, paddingVertical: 14, paddingHorizontal: 14 },
  coverTileVal: { fontSize: 22, color: "#F7F5F2", fontWeight: 600 },
  coverTileLab: { fontSize: 6.8, letterSpacing: 1.2, textTransform: "uppercase", color: "#9C9891", marginTop: 5 },
  coverFoot: { position: "absolute", bottom: 26, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between" },
  coverFootText: { fontSize: 7.5, color: "#8F8C86" },

  card: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  bullet: { flexDirection: "row", marginBottom: 4 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1, color: C.ink2, lineHeight: 1.35 },
  note: { fontSize: 7.5, color: C.muted, lineHeight: 1.35, marginTop: 8 },

  // Tableau supports
  thead: { flexDirection: "row", borderBottomWidth: 1, borderColor: C.line, paddingBottom: 4, marginBottom: 3 },
  trow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderColor: C.lineSoft },
  th: { fontSize: 7.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" },
  td: { fontSize: 8, color: C.ink2 },
  cNum: { width: "4%" },
  cName: { width: "29%" },
  cIsin: { width: "15%", fontFamily: FONT.mono, fontSize: 7 },
  cCat: { width: "18%" },
  cW: { width: "8%", textAlign: "right", fontWeight: 700, color: C.ink },
  cSri: { width: "6%", textAlign: "center" },
  cSfdr: { width: "7%", textAlign: "center" },
  cNote: { width: "7%", textAlign: "center" },
  cTer: { width: "6%", textAlign: "right" },

  // Répartition par classe
  classRow: { flexDirection: "row", alignItems: "center", marginBottom: 7 },
  classSwatch: { width: 8, height: 8, borderRadius: 2, marginRight: 7 },
  classLabel: { width: 128, fontWeight: 700, fontSize: 8.5 },
  classWeight: { width: 40, textAlign: "right", fontWeight: 700, marginRight: 9, fontFamily: FONT.mono },
  classRole: { flex: 1, color: C.muted, fontSize: 7.5, lineHeight: 1.25 },

  rationale: { marginBottom: 9 },
  rationaleHead: { fontWeight: 700, marginBottom: 2 },
  rationaleText: { color: C.ink2, lineHeight: 1.4, fontSize: 8.5 },

  sriBarRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  sriBarLabel: { width: 44, fontSize: 8, color: C.muted },
  sriBarVal: { width: 40, fontSize: 8, textAlign: "right", color: C.ink2 },

  // Projets du client
  goalRow: { borderTopWidth: 0.75, borderTopColor: C.lineSoft, paddingTop: 8, marginTop: 8 },
  goalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 3 },
  goalName: { fontWeight: 700, fontSize: 9.5 },
  goalMeta: { color: C.muted, fontSize: 8, lineHeight: 1.35 },

  // Corrélation
  corrHeadCell: { fontSize: 6, color: C.muted, padding: 2, textAlign: "center" },
  corrLabel: { fontSize: 7, color: C.ink2, paddingRight: 5, paddingVertical: 2.5 },
  corrCell: { fontSize: 6.8, fontFamily: FONT.mono, textAlign: "center", paddingVertical: 2.5, borderRadius: 2, marginHorizontal: 0.75 },

  // Back-test
  btTable: { marginTop: 10 },
  btRow: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: C.lineSoft, paddingVertical: 3 },
  btLabel: { flex: 1, fontSize: 8, color: C.ink2 },
  btVal: { width: 70, fontSize: 8, textAlign: "right", fontFamily: FONT.mono },

  disc: { fontSize: 7.5, color: C.muted, marginBottom: 3, lineHeight: 1.3 },
  footer: { position: "absolute", bottom: 20, left: 38, right: 38, flexDirection: "row", justifyContent: "space-between" },
  footText: { fontSize: 7, color: C.muted },
});

function fmtPct1(n: number | null | undefined): string {
  return n == null ? NC : `${n.toFixed(1)} %`;
}
function fmtSignedPct(n: number | null | undefined): string {
  if (n == null) return NC;
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} %`;
}
function sfdrText(a: number | null | undefined): string {
  if (a === 8) return "Art. 8";
  if (a === 9) return "Art. 9";
  return "Art. 6";
}
function truncate(t: string, n: number): string {
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
function probTone(p: number): { color: string; label: string; chip: "ok" | "gold" | "accent" } {
  if (p >= 0.75) return { color: C.green, label: "en bonne voie", chip: "ok" };
  if (p >= 0.5) return { color: C.gold, label: "atteignable, à surveiller", chip: "gold" };
  return { color: C.red, label: "à repenser ensemble", chip: "accent" };
}

function Footer({ p, logo }: { p: AllocationPresentation; logo?: string }) {
  const left = [p.advisor, p.asOf, "Document confidentiel"].filter(Boolean).join("  ·  ");
  return (
    <View style={s.footer} fixed>
      <View style={s.footBrand}>
        {logo ? <Image src={logo} style={s.footLogo} /> : null}
        <Text style={s.footText}>{left}</Text>
      </View>
      <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function Cover({ p, logo, brandName }: { p: AllocationPresentation; logo?: string; brandName?: string }) {
  const tiles: [string, string][] = [
    [`~${p.headline.expectedReturnPct} %`, "Performance cible / an"],
    [`~${p.headline.volatilityPct} %`, "Volatilité attendue"],
    [p.headline.weightedSri == null ? NC : `${p.headline.weightedSri} / 7`, "Risque (SRI moyen)"],
    [String(p.headline.supports), "Supports"],
  ];
  return (
    <Page size="A4" style={s.cover}>
      <View style={s.coverBrand}>
        <View style={s.coverWordmark}>
          {logo ? (
            <View style={s.coverLogoBadge}>
              <Image src={logo} style={s.coverLogoImg} />
            </View>
          ) : (
            <View style={[s.coverDot, { backgroundColor: C.clay }]} />
          )}
          <Text style={s.coverCharlie}>{brandName || "Charlie"}</Text>
        </View>
        <Text style={s.coverConf}>Confidentiel</Text>
      </View>
      <Text style={[s.coverEyebrow, { color: C.clayOnDark }]}>Votre proposition d&apos;investissement</Text>
      <Text style={s.coverTitle}>{p.title}</Text>
      <Text style={s.coverSub}>
        {[p.subtitle, p.asOf].filter(Boolean).join("  ·  ")}
      </Text>
      <View style={s.coverTiles}>
        {tiles.map(([val, lab]) => (
          <View key={lab} style={s.coverTile}>
            <Text style={s.coverTileVal}>{val}</Text>
            <Text style={s.coverTileLab}>{lab}</Text>
          </View>
        ))}
      </View>
      <View style={s.coverFoot}>
        <Text style={s.coverFootText}>{p.advisor ?? "Charlie Investissement"}</Text>
        <Text style={s.coverFootText}>Document réservé au destinataire, ne constitue pas un conseil personnalisé</Text>
      </View>
    </Page>
  );
}

function SynthesisPage({ p, x, logo }: { p: AllocationPresentation; x?: PresentationExtras; logo?: string }) {
  const metrics = [
    { label: "Performance cible / an", value: `~${p.headline.expectedReturnPct} %`, color: C.green },
    { label: "Volatilité attendue", value: `~${p.headline.volatilityPct} %` },
    { label: "SRI moyen pondéré", value: p.headline.weightedSri == null ? NC : `${p.headline.weightedSri} / 7` },
    { label: "Frais courants moyens", value: x?.avgTer == null ? NC : `${(x.avgTer * 100).toFixed(2)} %` },
    { label: "Lignes effectives", value: x?.effectiveHoldings == null ? NC : x.effectiveHoldings.toFixed(1), sub: "diversification réelle" },
    {
      label: "Projection indicative",
      value: x?.projection ? nfEur(x.projection.projectedEur) : NC,
      sub: x?.projection ? `à ${x.projection.horizonYears} ans, non garantie` : undefined,
      color: x?.projection ? C.clay : undefined,
    },
  ];
  return (
    <Page size="A4" style={s.page}>
      <SectionIntro
        eyebrow="01"
        title="L'essentiel de votre proposition"
        right={<Chip tone="accent">{p.headline.profileLabel}</Chip>}
      />
      <View style={s.card}>
        <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
          {/* Légende masquée : la liste des classes, avec leurs rôles, est juste à côté. */}
          <View style={{ width: 110 }}>
            <CompositionDonut
              slices={p.classBreakdown.map((c) => ({ label: c.label, weight: c.weight }))}
              size={100}
              topN={7}
              centerLabel="classes"
              showLegend={false}
            />
          </View>
          <View style={{ flex: 1 }}>
            {p.classBreakdown.map((c, i) => (
              <View style={s.classRow} key={c.assetClass}>
                <View style={[s.classSwatch, { backgroundColor: SERIES[i % SERIES.length] }]} />
                <Text style={s.classLabel}>{c.label}</Text>
                <Text style={s.classWeight}>{fmtPct1(c.weight)}</Text>
                <Text style={s.classRole}>{c.role}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      <MetricGrid items={metrics} cols={3} />
      <View style={[s.card, { marginTop: 12 }]}>
        <SectionIntro title="Points clés" />
        {p.objectives.map((o, i) => (
          <View style={s.bullet} key={i}>
            <Text style={[s.bulletDot, { color: C.clay }]}>·</Text>
            <Text style={s.bulletText}>{o}</Text>
          </View>
        ))}
        <Text style={s.note}>
          Frais courants moyens pondérés des supports : {x?.avgTer == null ? NC : `${(x.avgTer * 100).toFixed(2)} % par an`},
          hors frais du contrat. Les performances passées ne préjugent pas des performances futures.
        </Text>
      </View>
      <Footer p={p} logo={logo} />
    </Page>
  );
}

function GoalsPage({ p, x, logo }: { p: AllocationPresentation; x: PresentationExtras; logo?: string }) {
  return (
    <Page size="A4" style={s.page}>
      <SectionIntro
        eyebrow="02"
        title="Vos projets et leur trajectoire"
        desc="Chaque projet est évalué avec les moyens qui lui sont affectés : rendement annuel requis et probabilité d'atteinte simulée (Monte Carlo)."
      />
      {x.projection && (
        <View style={{ marginBottom: 12 }}>
          <HeroStat
            label={`Projection à ${x.projection.horizonYears} ans`}
            value={nfEur(x.projection.projectedEur)}
            sub={`pour ${nfEur(x.projection.amountEur)} investis aujourd'hui, au rendement cible : hors frais et fiscalité, performances non garanties`}
            tone="accent"
          />
        </View>
      )}
      {x.goals.length > 0 && (
        <View style={s.card}>
          {x.goals.map((g, i) => {
            const tone = g.successProb != null ? probTone(g.successProb) : null;
            return (
              <View key={i} style={i === 0 ? undefined : s.goalRow} wrap={false}>
                <View style={s.goalHead}>
                  <Text style={s.goalName}>{g.label}</Text>
                  {/* Poids 400 forcé : le sous-ensemble Inter 500 embarqué perd
                      le « d » minuscule sur certains documents (bug de
                      subsetting fontkit) ; en 400 le glyphe est toujours sain. */}
                  {tone && g.successProb != null ? (
                    <Chip tone={tone.chip}><Text style={{ fontWeight: 400 }}>{`${Math.round(g.successProb * 100)} % de chances, ${tone.label}`}</Text></Chip>
                  ) : (
                    <Chip tone="accent"><Text style={{ fontWeight: 400 }}>hors de portée en l&apos;état, à retravailler ensemble</Text></Chip>
                  )}
                </View>
                <Text style={s.goalMeta}>
                  {nfEur(g.targetEur)} à {g.years} ans · {g.priorityLabel} · {nfEur(g.initialEur)} affectés
                  {g.monthlyEur > 0 ? ` + ${nfEur(g.monthlyEur)} par mois` : ""}
                  {g.requiredReturn != null &&
                    ` · rendement requis : ${g.requiredReturn <= 0 ? "aucun, objectif sécurisé" : `${(g.requiredReturn * 100).toFixed(1)} % par an`}`}
                </Text>
              </View>
            );
          })}
          <Text style={s.note}>
            Probabilités estimées par simulation, hors frais et fiscalité. Elles éclairent la discussion, elles ne constituent pas un engagement.
          </Text>
        </View>
      )}
      <Footer p={p} logo={logo} />
    </Page>
  );
}

function ExposurePage({ p, x, logo }: { p: AllocationPresentation; x: PresentationExtras; logo?: string }) {
  const expo = x.exposure!;
  return (
    <Page size="A4" style={s.page}>
      <SectionIntro
        eyebrow="03"
        title="Où votre portefeuille est réellement investi"
        desc="Lecture par transparence des fonds (look-through), pondérée par les poids du portefeuille."
      />
      <View style={{ flexDirection: "row", gap: 12 }}>
        {expo.geo.length > 0 && (
          <View style={[s.card, { flex: 1 }]}>
            <SectionIntro title="Répartition géographique" />
            <CompositionDonut slices={expo.geo} size={92} topN={6} keepOrder />
          </View>
        )}
        {expo.sectors.length > 0 && (
          <View style={[s.card, { flex: 1 }]}>
            <SectionIntro title="Répartition sectorielle" />
            <CompositionDonut slices={expo.sectors} size={92} topN={6} keepOrder />
          </View>
        )}
      </View>
      <Text style={s.note}>
        Répartitions calculées sur la part du portefeuille dont la composition est publiée par les sociétés de gestion ;
        les poches sans donnée n&apos;y figurent pas.
      </Text>
      <Footer p={p} logo={logo} />
    </Page>
  );
}

function TablePage({ p, logo }: { p: AllocationPresentation; logo?: string }) {
  const maxSri = Math.max(1, ...p.riskProfile.sriDistribution.map((b) => b.weight));
  return (
    <Page size="A4" style={s.page}>
      <SectionIntro eyebrow="04" title="Votre portefeuille en détail" desc={`${p.table.length} supports retenus`} />
      <View style={s.card}>
        <View style={s.thead}>
          <Text style={[s.th, s.cNum]}>#</Text>
          <Text style={[s.th, s.cName]}>Fonds</Text>
          <Text style={[s.th, s.cIsin]}>ISIN</Text>
          <Text style={[s.th, s.cCat]}>Catégorie</Text>
          <Text style={[s.th, s.cW]}>Poids</Text>
          <Text style={[s.th, s.cSri]}>SRI</Text>
          <Text style={[s.th, s.cSfdr]}>SFDR</Text>
          <Text style={[s.th, s.cNote]}>Note</Text>
          <Text style={[s.th, s.cTer]}>Frais</Text>
        </View>
        {p.table.map((l, i) => (
          <View style={s.trow} key={l.isin} wrap={false}>
            <Text style={[s.td, s.cNum]}>{i + 1}</Text>
            <Text style={[s.td, s.cName]}>{l.name}</Text>
            <Text style={[s.td, s.cIsin]}>{l.isin}</Text>
            <Text style={[s.td, s.cCat]}>{l.category ?? NC}</Text>
            <Text style={[s.td, s.cW]}>{fmtPct1(l.weight)}</Text>
            <Text style={[s.td, s.cSri]}>{l.sri ?? NC}</Text>
            <Text style={[s.td, s.cSfdr]}>{sfdrText(l.sfdr)}</Text>
            <Text style={[s.td, s.cNote]}>{l.rating == null ? NC : `${l.rating}/5`}</Text>
            <Text style={[s.td, s.cTer]}>{l.ter == null ? NC : (l.ter * 100).toFixed(2)}</Text>
          </View>
        ))}
        <Text style={s.note}>
          Le niveau de risque de chaque support (SRI, échelle de 1 à 7) provient de son document d&apos;informations clés.
          Frais : frais courants annuels du support, en pourcentage.
        </Text>
      </View>

      <View style={s.card}>
        <SectionIntro
          eyebrow="05"
          title="Profil de risque du portefeuille"
          desc={`SRI moyen pondéré ~${p.riskProfile.weightedSri ?? NC} / 7 : ${p.riskProfile.profileLabel}`}
          right={<View style={{ width: 130 }}><SriMeter value={p.riskProfile.weightedSri} /></View>}
        />
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
              {`Art. ${d.article} : ${fmtPct1(d.weight)}`}
            </Chip>
          ))}
        </View>
      </View>
      <Footer p={p} logo={logo} />
    </Page>
  );
}

function BehaviorPage({ p, x, logo }: { p: AllocationPresentation; x: PresentationExtras; logo?: string }) {
  const corr = x.correlation;
  const bt = x.backtest;
  const btSeries: Series[] = bt
    ? [
        { name: "Portefeuille", color: C.clay, points: bt.curve.filter((c) => c.p != null).map((c) => ({ t: Date.parse(c.d), v: c.p! })) },
        { name: bt.benchmarkLabel, color: C.muted, points: bt.curve.filter((c) => c.b != null).map((c) => ({ t: Date.parse(c.d), v: c.b! })) },
      ].filter((ser) => ser.points.length >= 2)
    : [];
  return (
    <Page size="A4" style={s.page}>
      <SectionIntro eyebrow="06" title="Diversification et comportement" />
      {corr && (
        <View style={s.card}>
          <SectionIntro
            title="Corrélation des supports"
            desc={
              x.effectiveHoldings != null
                ? `Plus la valeur est basse, plus deux supports se complètent. Diversification réelle : ~${x.effectiveHoldings.toFixed(1)} lignes effectives.`
                : "Plus la valeur est basse, plus deux supports se complètent."
            }
          />
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 86 }} />
            {corr.names.map((n, i) => (
              <Text key={i} style={[s.corrHeadCell, { flex: 1 }]}>{truncate(n, 10)}</Text>
            ))}
          </View>
          {corr.names.map((n, ri) => (
            <View key={ri} style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={[s.corrLabel, { width: 86 }]}>{truncate(n, 16)}</Text>
              {corr.matrix[ri]?.map((c, ci) => {
                const t = corrColor(c);
                return (
                  <Text key={ci} style={[s.corrCell, { flex: 1, backgroundColor: t.bg, color: t.fg }]}>
                    {c == null ? NC : c.toFixed(2)}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>
      )}
      {bt && btSeries.length > 0 && (
        <View style={s.card}>
          <SectionIntro
            title="Back-test de l'allocation"
            desc={`Performance réelle des supports aux poids proposés${bt.periodLabel ? `, ${bt.periodLabel}` : ""}, face à l'indice ${bt.benchmarkLabel}. Hors frais du contrat.`}
          />
          <LineChartPdf series={btSeries} width={485} height={150} />
          <View style={s.btTable}>
            <View style={[s.btRow, { borderBottomWidth: 1, borderColor: C.line }]}>
              <Text style={[s.btLabel, { color: C.muted, fontWeight: 700, textTransform: "uppercase", fontSize: 7 }]}>Indicateur</Text>
              <Text style={[s.btVal, { color: C.muted, fontWeight: 700, fontSize: 7 }]}>PORTEFEUILLE</Text>
              <Text style={[s.btVal, { color: C.muted, fontWeight: 700, fontSize: 7 }]}>{bt.benchmarkLabel.toUpperCase()}</Text>
            </View>
            {[
              { k: "Performance annualisée", p: fmtSignedPct(bt.portfolio.annual_return), b: fmtSignedPct(bt.benchmark?.annual_return) },
              { k: "Performance totale", p: fmtSignedPct(bt.portfolio.total_return), b: fmtSignedPct(bt.benchmark?.total_return) },
              { k: "Volatilité", p: bt.portfolio.volatility == null ? NC : `${(bt.portfolio.volatility * 100).toFixed(1)} %`, b: bt.benchmark?.volatility == null ? NC : `${(bt.benchmark.volatility * 100).toFixed(1)} %` },
              { k: "Perte maximale", p: bt.portfolio.max_drawdown == null ? NC : `${(bt.portfolio.max_drawdown * 100).toFixed(1)} %`, b: bt.benchmark?.max_drawdown == null ? NC : `${(bt.benchmark.max_drawdown * 100).toFixed(1)} %` },
            ].map((r) => (
              <View key={r.k} style={s.btRow}>
                <Text style={s.btLabel}>{r.k}</Text>
                <Text style={s.btVal}>{r.p}</Text>
                <Text style={s.btVal}>{r.b}</Text>
              </View>
            ))}
          </View>
          <Text style={s.note}>Les performances passées ne préjugent pas des performances futures.</Text>
        </View>
      )}
      <Footer p={p} logo={logo} />
    </Page>
  );
}

function RationalePage({ p, logo }: { p: AllocationPresentation; logo?: string }) {
  return (
    <Page size="A4" style={s.page}>
      <SectionIntro eyebrow="07" title="Analyse et justification par support" />
      <View style={s.card}>
        {p.perFundRationale.map((r, i) => (
          <View style={s.rationale} key={r.isin} wrap={false}>
            <Text style={s.rationaleHead}>{`${i + 1}. ${r.name}`}</Text>
            <Text style={s.rationaleText}>{r.text}</Text>
          </View>
        ))}
      </View>
      <View style={s.card}>
        <SectionIntro eyebrow="08" title="Nos convictions de gestion" />
        {p.convictions.map((c, i) => (
          <View style={s.rationale} key={i} wrap={false}>
            <Text style={s.rationaleHead}>{c.title}</Text>
            <Text style={s.rationaleText}>{c.text}</Text>
          </View>
        ))}
      </View>
      <Footer p={p} logo={logo} />
    </Page>
  );
}

function ClosingPage({ p, logo }: { p: AllocationPresentation; logo?: string }) {
  const steps: [string, string][] = [
    ["Nous échangeons sur cette proposition", "vos questions, vos ajustements : les poids et les supports s'adaptent en séance."],
    ["Vous validez le dossier", "documents d'informations clés (DIC) des supports, analyse de vos besoins et pièces réglementaires."],
    ["Nous mettons en place, puis nous suivons", "souscription, puis premier point de suivi ensemble dans les mois qui suivent."],
  ];
  return (
    <Page size="A4" style={s.page}>
      <SectionIntro eyebrow="09" title="Les prochaines étapes" />
      <View style={s.card}>
        {steps.map(([t, d], i) => (
          <View key={i} style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <Text style={{ fontFamily: FONT.mono, color: C.clay, fontSize: 13, width: 20 }}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: 700, marginBottom: 1.5 }}>{t}</Text>
              <Text style={{ color: C.ink2, fontSize: 8.5, lineHeight: 1.35 }}>{d}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={[s.card, { backgroundColor: C.paper2 }]}>
        <Text style={[s.th, { marginBottom: 5 }]}>Avertissements</Text>
        {p.disclaimers.map((d, i) => (
          <Text style={s.disc} key={i}>· {d}</Text>
        ))}
        <Text style={s.disc}>
          · {[p.asOf ? `Document établi en ${p.asOf}` : "Document établi à la date indiquée en pied de page", p.advisor].filter(Boolean).join(", par ")}. Strictement confidentiel, réservé au destinataire.
        </Text>
      </View>
      <Footer p={p} logo={logo} />
    </Page>
  );
}

export default function AllocationReportPDF({
  presentation,
  logo,
  brandName,
}: {
  presentation: AllocationPresentation;
  /** Logo à afficher (Charlie par défaut, ou logo PNG du cabinet si personnalisé). */
  logo?: string;
  /** Nom du cabinet, en tête de couverture à la place de « Charlie ». */
  brandName?: string;
}) {
  const p = presentation;
  const x = p.extras;
  const hasGoalsPage = !!x && (x.goals.length > 0 || x.projection != null);
  const hasExposure = !!x?.exposure && (x.exposure.geo.length > 0 || x.exposure.sectors.length > 0);
  const hasBehavior = !!x && (x.correlation != null || x.backtest != null);

  return (
    <Document title={p.title}>
      <Cover p={p} logo={logo} brandName={brandName} />
      <SynthesisPage p={p} x={x} logo={logo} />
      {hasGoalsPage && <GoalsPage p={p} x={x!} logo={logo} />}
      {hasExposure && <ExposurePage p={p} x={x!} logo={logo} />}
      <TablePage p={p} logo={logo} />
      {hasBehavior && <BehaviorPage p={p} x={x!} logo={logo} />}
      <RationalePage p={p} logo={logo} />
      <ClosingPage p={p} logo={logo} />
    </Document>
  );
}
