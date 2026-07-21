import { Document, Page, Text, View, StyleSheet, Svg, Path, Polyline, Line } from "@react-pdf/renderer";
import { C, FONT, registerCharlieFonts } from "./pdf/theme";
import { BrandHeader, Eyebrow, HeroStat, MetricGrid, Row, Bar, dateFr, nfEur, fmt, sansIfNil } from "./pdf/components";
import type { FraisReport, FraisTrajectoirePoint } from "./feeSimulator";

registerCharlieFonts();

// ── Documents de FRAIS de l'onglet Frais. 100 % déterministe (aucun appel IA) :
// pure mise en page d'un calcul (buildFraisReport). Deux régimes :
//   • mode "client"  — information sur les coûts et frais remise AVANT
//     souscription (ex ante), pensée pour la conformité DDA (art. 29) /
//     MiFID II (art. 24-4) / PRIIPs.
//   • mode "cabinet" — même socle + détail de la rémunération du cabinet, à
//     usage interne, à ne pas remettre en l'état au client.
// Parti pris design : épuré, aéré, sans texte décoratif. Le chiffre parle ; on
// n'écrit que ce qui a une valeur (donnée, repère de lecture, mention légale).

export interface FraisPdfHypotheses {
  versementInitial: number; versementAnnuel: number; duree: number; partUC: number;
  rendementUC: number; rendementFE: number;
  contratEntree: number; contratGestionUC: number; contratGestionFE: number; contratSortie: number;
  ucEntree: number; ucGestion: number; ucSortie: number;
  retroCgp: number; commissionCabinet: number;
}

export interface FraisPdfProps {
  mode: "client" | "cabinet";
  clientRef: string | null;
  hypotheses: FraisPdfHypotheses;
  report: FraisReport;
  /** Data URI du logo Charlie (« C ») chargé côté serveur. */
  logo?: string;
}

const S = StyleSheet.create({
  page: {
    paddingHorizontal: 46, paddingTop: 34, paddingBottom: 58,
    backgroundColor: C.cream, fontFamily: FONT.sans, fontSize: 9, color: C.ink,
  },
  // ── Hero (page 1) ──
  hero: { flexDirection: "row", gap: 22, alignItems: "stretch", marginBottom: 14 },
  heroLeft: { flex: 1.55, justifyContent: "center" },
  eyebrow: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7.5, letterSpacing: 1.6, textTransform: "uppercase", color: C.clay },
  title: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 25, color: C.ink, lineHeight: 1.02, marginTop: 6 },
  meta: { fontFamily: FONT.sans, fontSize: 8.5, color: C.ink2, marginTop: 9 },
  metaSub: { fontFamily: FONT.sans, fontSize: 8, color: C.muted, marginTop: 3 },
  // ── En-tête de section (épuré : filet clay + titre) ──
  secHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 11 },
  secTick: { width: 3, height: 13, backgroundColor: C.clay, borderRadius: 2 },
  secTitle: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 12.5, color: C.ink, flex: 1 },
  secMeta: { fontFamily: FONT.sans, fontSize: 8, color: C.muted },
  section: { marginTop: 18 },
  // ── Cartes / textes ──
  card: { backgroundColor: C.paper, borderWidth: 0.75, borderColor: C.line, borderRadius: 10, padding: 15 },
  cardLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted, marginBottom: 9 },
  note: { fontFamily: FONT.sans, fontSize: 7.6, color: C.muted, marginTop: 9, lineHeight: 1.5 },
  // ── Ventilation (barres) ──
  natRow: { marginBottom: 10 },
  natHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 },
  natName: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2 },
  natRight: { flexDirection: "row", alignItems: "baseline", gap: 7 },
  natVal: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 9, color: C.ink },
  natPct: { fontFamily: FONT.sans, fontSize: 7.5, color: C.muted, minWidth: 26, textAlign: "right" },
  natTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", borderTopWidth: 1, borderTopColor: C.line, paddingTop: 9, marginTop: 3 },
  natTotalName: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 9.5, color: C.ink },
  natTotalVal: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 10.5, color: C.clay },
  // ── Graphe effet des coûts ──
  chartWrap: { backgroundColor: C.paper, borderWidth: 0.75, borderColor: C.line, borderRadius: 10, padding: 15 },
  chartTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
  chartScale: { fontFamily: FONT.mono, fontSize: 8, color: C.muted },
  legend: { flexDirection: "row", gap: 15, marginTop: 11 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch: { width: 13, height: 2.5, borderRadius: 2 },
  legendText: { fontFamily: FONT.sans, fontSize: 7.5, color: C.ink2 },
  gapCallout: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: C.goldSoft, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 14, marginTop: 11,
  },
  gapLabel: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 9, color: "#7A5E1E" },
  gapSub: { fontFamily: FONT.sans, fontSize: 7.4, color: "#8A6E2E", marginTop: 2 },
  gapValue: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 17, color: C.gold },
  // ── Tableaux ──
  tHead: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 6, borderBottomWidth: 1.25, borderBottomColor: C.ink },
  tHeadText: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 0.8, textTransform: "uppercase", color: C.muted },
  tRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 0.75, borderBottomColor: C.lineSoft },
  tTotal: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line },
  cName: { flex: 3, paddingRight: 6 },
  cNum: { flex: 1.2, fontFamily: FONT.mono, fontSize: 8.5, textAlign: "right", color: C.ink2 },
  cNumStrong: { flex: 1.2, fontFamily: FONT.mono, fontWeight: 500, fontSize: 8.5, textAlign: "right", color: C.ink },
  rowName: { fontFamily: FONT.sans, fontSize: 9, color: C.ink },
  rowIsin: { fontFamily: FONT.mono, fontSize: 7, color: C.muted, marginTop: 2 },
  // ── Callout rémunération (cabinet) ──
  callout: {
    backgroundColor: C.claySoft, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, marginTop: 16,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  calloutLabel: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 10, color: C.clayInk },
  calloutSub: { fontFamily: FONT.sans, fontSize: 7.5, color: "#86422A", marginTop: 3, maxWidth: 320 },
  calloutValue: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 21, color: C.clay },
  // ── Pied de page ──
  footer: {
    position: "absolute", bottom: 24, left: 46, right: 46, borderTopWidth: 0.75, borderTopColor: C.lineSoft,
    paddingTop: 7, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
  },
  disclaimer: { fontFamily: FONT.sans, fontSize: 6.3, color: C.muted, lineHeight: 1.42, flex: 1 },
  footerBrand: { fontFamily: FONT.sans, fontWeight: 600, fontSize: 8.5, color: C.ink2 },
});

const DISCLAIMER_CLIENT =
  "Information sur les coûts et frais établie à titre indicatif avant souscription (ex ante), conformément à la DDA " +
  "(art. 29 de la directive (UE) 2016/97) et à MiFID II (art. 24-4). Coûts présentés de façon agrégée, en euros et en " +
  "pourcentage. Les projections reposent sur les hypothèses saisies, supposées constantes ; elles ne constituent ni une " +
  "garantie ni un engagement. Les performances passées ne préjugent pas des performances futures. Hors fiscalité et " +
  "prélèvements sociaux. Document à conserver.";

const DISCLAIMER_CABINET =
  "Document interne d'aide à la décision — usage cabinet, à ne pas remettre en l'état au client. Estimations de " +
  "rémunération sur la base des hypothèses saisies. Rétrocession et commission sont des tranches des frais déjà " +
  "supportés par le client, sans double comptage : le montant perçu doit figurer, à l'euro près, dans l'information " +
  "ex post annuelle (art. 325-14 du RGAMF).";

function Footer({ mode }: { mode: "client" | "cabinet" }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.disclaimer}>{mode === "client" ? DISCLAIMER_CLIENT : DISCLAIMER_CABINET}</Text>
      <Text style={S.footerBrand}>Charlie</Text>
    </View>
  );
}

// En-tête de section : filet clay + titre court + repère facultatif à droite.
function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={S.secHead}>
      <View style={S.secTick} />
      <Text style={S.secTitle}>{title}</Text>
      {meta ? <Text style={S.secMeta}>{meta}</Text> : null}
    </View>
  );
}

// ── Effet cumulé des coûts sur le rendement ──────────────────────────────────
// Exigence MiFID II (art. 50 du Règlement délégué (UE) 2017/565) : l'écart, dans
// le temps, entre la trajectoire brute (sans frais) et la valeur nette. L'aire
// dorée matérialise le manque à gagner qui s'accumule par composition.
function CostCurve({ traj, annees }: { traj: FraisTrajectoirePoint[]; annees: number }) {
  const W = 503, H = 128, padL = 2, padR = 2, padT = 8, padB = 6;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const yMax = Math.max(...traj.map((p) => p.valeurSansFrais), 1);
  const xMax = annees || 1;
  const X = (a: number) => padL + (a / xMax) * plotW;
  const Y = (v: number) => padT + plotH - (Math.max(0, v) / yMax) * plotH;
  const pts = (sel: (p: FraisTrajectoirePoint) => number) =>
    traj.map((p) => `${X(p.annee).toFixed(1)},${Y(sel(p)).toFixed(1)}`).join(" ");
  const brut = pts((p) => p.valeurSansFrais);
  const net = pts((p) => p.valeurNette);
  const vers = pts((p) => p.versements);
  const top = traj.map((p) => `${X(p.annee).toFixed(1)},${Y(p.valeurSansFrais).toFixed(1)}`);
  const bot = [...traj].reverse().map((p) => `${X(p.annee).toFixed(1)},${Y(p.valeurNette).toFixed(1)}`);
  const area = `M ${top.join(" L ")} L ${bot.join(" L ")} Z`;
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 128 }}>
      <Line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} strokeWidth={0.75} stroke={C.line} />
      <Path d={area} fill={C.gold} fillOpacity={0.18} />
      <Polyline points={vers} fill="none" stroke={C.muted} strokeWidth={0.75} strokeDasharray="1 2.5" strokeOpacity={0.7} />
      <Polyline points={brut} fill="none" stroke={C.ink2} strokeWidth={1} strokeDasharray="3 2" />
      <Polyline points={net} fill="none" stroke={C.clay} strokeWidth={1.75} />
    </Svg>
  );
}

function CostIllustration({ report }: { report: FraisReport }) {
  const { final, trajectoire } = report;
  return (
    <View style={S.section} wrap={false}>
      <SectionHead title="Effet des frais dans le temps" meta={`sur ${final.annees} ans`} />
      <View style={S.chartWrap}>
        <View style={S.chartTop}>
          <Text style={S.chartScale}>{nfEur(Math.max(final.valeurSansFrais, final.valeurNette))}</Text>
          <View style={S.legend}>
            <View style={S.legendItem}><View style={[S.legendSwatch, { backgroundColor: C.clay }]} /><Text style={S.legendText}>Après frais</Text></View>
            <View style={S.legendItem}><View style={[S.legendSwatch, { backgroundColor: C.ink2 }]} /><Text style={S.legendText}>Sans frais</Text></View>
            <View style={S.legendItem}><View style={[S.legendSwatch, { backgroundColor: C.gold, height: 7, opacity: 0.5 }]} /><Text style={S.legendText}>Coût des frais</Text></View>
          </View>
        </View>
        <CostCurve traj={trajectoire} annees={final.annees} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 3 }}>
          <Text style={{ fontFamily: FONT.sans, fontSize: 6.8, color: C.muted }}>souscription</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 6.8, color: C.muted }}>{final.annees} ans</Text>
        </View>
      </View>
      <View style={S.gapCallout}>
        <View>
          <Text style={S.gapLabel}>Manque à gagner sur {final.annees} ans</Text>
          <Text style={S.gapSub}>réduction de rendement d'environ {report.reductionRendement.toFixed(1)} %/an</Text>
        </View>
        <Text style={S.gapValue}>{nfEur(final.manqueAGagner)}</Text>
      </View>
    </View>
  );
}

// ── Ventilation par NATURE ───────────────────────────────────────────────────
function Nature({ report }: { report: FraisReport }) {
  const { nature } = report;
  const total = nature.total > 0 ? nature.total : 1;
  const lignes = [
    { nom: "Frais d'entrée (contrat + supports)", montant: nature.entree },
    { nom: "Frais de gestion de l'enveloppe", montant: nature.gestionEnveloppe },
    { nom: "Frais courants des supports", montant: nature.fraisCourants },
    { nom: "Frais de sortie", montant: nature.sortie },
    ...(nature.honoraires > 0 ? [{ nom: "Honoraires de conseil (en sus)", montant: nature.honoraires }] : []),
  ];
  return (
    <View wrap={false}>
      <SectionHead title="Nature des frais" meta={`sur ${report.final.annees} ans`} />
      <View style={S.card}>
        {lignes.map((l) => (
          <View key={l.nom} style={S.natRow}>
            <View style={S.natHead}>
              <Text style={S.natName}>{l.nom}</Text>
              <View style={S.natRight}>
                <Text style={[S.natVal, sansIfNil(nfEur(l.montant))]}>{nfEur(l.montant)}</Text>
                <Text style={S.natPct}>{Math.round((l.montant / total) * 100)} %</Text>
              </View>
            </View>
            <Bar value={l.montant} max={total} color={C.clay} />
          </View>
        ))}
        <View style={S.natTotal}>
          <Text style={S.natTotalName}>Coût total</Text>
          <Text style={S.natTotalVal}>{nfEur(nature.total)}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Qui perçoit les frais (transparence sur le conseil) ──────────────────────
function Transparence({ report }: { report: FraisReport }) {
  const { repart, nature, final } = report;
  const total = final.coutTotalClient > 0 ? final.coutTotalClient : 1;
  const lignes: { nom: string; montant: number; mine?: boolean }[] = [
    { nom: "Assureur — enveloppe assurance-vie", montant: repart.assureur },
    { nom: "Sociétés de gestion — supports", montant: repart.societeGestion },
    { nom: "Conseil — votre conseiller", montant: final.revenuCabinet, mine: true },
  ];
  return (
    <View style={S.section} wrap={false}>
      <SectionHead title="Qui perçoit vos frais" />
      <View style={S.card}>
        {lignes.map((l) => (
          <View key={l.nom} style={S.natRow}>
            <View style={S.natHead}>
              <Text style={l.mine ? [S.natName, { fontWeight: 600, color: C.gold }] : S.natName}>{l.nom}</Text>
              <View style={S.natRight}>
                <Text style={[S.natVal, sansIfNil(nfEur(l.montant))]}>{nfEur(l.montant)}</Text>
                <Text style={S.natPct}>{Math.round((l.montant / total) * 100)} %</Text>
              </View>
            </View>
            <Bar value={l.montant} max={total} color={l.mine ? C.gold : C.clay} />
          </View>
        ))}
        <Text style={S.note}>
          Ces sommes ne s'ajoutent pas aux frais : elles en font partie. Votre conseiller perçoit {nfEur(nature.dontConseil)} sur
          {" "}{report.final.annees} ans — le détail chiffré peut vous être communiqué à tout moment.
        </Text>
      </View>
    </View>
  );
}

// Hypothèses de la projection.
function Hypotheses({ h }: { h: FraisPdfHypotheses }) {
  return (
    <View style={S.section} wrap={false}>
      <SectionHead title="Hypothèses" />
      <MetricGrid
        cols={3}
        items={[
          { label: "Versement initial", value: nfEur(h.versementInitial), sub: h.versementAnnuel > 0 ? `+ ${nfEur(h.versementAnnuel)} / an` : "versement unique" },
          { label: "Durée", value: `${h.duree} ans`, sub: `part UC ${Math.round(h.partUC)} %` },
          { label: "Rendement retenu", value: `${h.rendementUC.toFixed(1)} %`, sub: `fonds euros ${h.rendementFE.toFixed(1)} %` },
        ]}
      />
      <View style={{ flexDirection: "row", gap: 24, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={S.cardLabel}>Frais du contrat</Text>
          <Row label="Entrée / versement" value={fmt(h.contratEntree)} />
          <Row label="Gestion UC (par an)" value={fmt(h.contratGestionUC)} />
          <Row label="Gestion fonds euros (par an)" value={fmt(h.contratGestionFE)} />
          <Row label="Sortie / rachat" value={fmt(h.contratSortie)} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={S.cardLabel}>Frais des supports</Text>
          <Row label="Entrée" value={fmt(h.ucEntree)} />
          <Row label="Frais courants (par an)" value={fmt(h.ucGestion)} />
          <Row label="Sortie" value={fmt(h.ucSortie)} />
        </View>
      </View>
    </View>
  );
}

// Projection par horizon. Le mode cabinet ajoute la colonne « Rému cabinet ».
function Projections({ report, mode }: { report: FraisReport; mode: "client" | "cabinet" }) {
  return (
    <View wrap={false}>
      <SectionHead title="Projection par horizon" />
      <View style={S.tHead}>
        <Text style={[S.cName, S.tHeadText]}>Horizon</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Valeur nette</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Gain net</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Coût cumulé</Text>
        {mode === "cabinet" && <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Rému cabinet</Text>}
      </View>
      {report.horizons.map((h) => (
        <View key={h.annees} style={S.tRow}>
          <Text style={[S.cName, S.rowName]}>{h.annees} ans</Text>
          <Text style={[S.cNumStrong, sansIfNil(nfEur(h.valeurNette))]}>{nfEur(h.valeurNette)}</Text>
          <Text style={[S.cNum, { color: h.gainNet >= 0 ? C.green : C.red }]}>
            {h.gainNet >= 0 ? "+" : ""}{nfEur(h.gainNet)}
          </Text>
          <Text style={[S.cNum, sansIfNil(nfEur(h.coutTotalClient))]}>{nfEur(h.coutTotalClient)}</Text>
          {mode === "cabinet" && (
            <Text style={[S.cNum, { color: C.gold }, sansIfNil(nfEur(h.revenuCabinet))]}>{nfEur(h.revenuCabinet)}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// Détail par support (cabinet uniquement).
function DetailSupports({ report }: { report: FraisReport }) {
  if (report.supports.length === 0) return null;
  const totalRetro = report.supports.reduce((a, s) => a + s.retroAnnuelle, 0);
  const totalComm = report.supports.reduce((a, s) => a + s.commissionUpfront, 0);
  return (
    <View wrap={false}>
      <SectionHead title="Détail par support" />
      <View style={S.tHead}>
        <Text style={[S.cName, S.tHeadText]}>Support</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Montant</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Frais cour.</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Rétro</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Rétro / an</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Commission</Text>
      </View>
      {report.supports.map((s) => (
        <View key={s.isin} style={S.tRow}>
          <View style={S.cName}>
            <Text style={S.rowName}>{s.name.slice(0, 40)}</Text>
            <Text style={S.rowIsin}>{s.isin}</Text>
          </View>
          <Text style={[S.cNum, sansIfNil(nfEur(s.montant))]}>{nfEur(s.montant)}</Text>
          <Text style={[S.cNum, sansIfNil(fmt(s.ter))]}>{fmt(s.ter)}</Text>
          <Text style={[S.cNum, sansIfNil(fmt(s.effRetro))]}>{fmt(s.effRetro)}</Text>
          <Text style={[S.cNumStrong, { color: C.gold }, sansIfNil(nfEur(s.retroAnnuelle))]}>{nfEur(s.retroAnnuelle)}</Text>
          <Text style={[S.cNum, { color: C.gold }, sansIfNil(nfEur(s.commissionUpfront))]}>{nfEur(s.commissionUpfront)}</Text>
        </View>
      ))}
      <View style={S.tTotal}>
        <Text style={[S.cName, S.rowName, { fontWeight: 600 }]}>Total</Text>
        <Text style={S.cNum} /><Text style={S.cNum} /><Text style={S.cNum} />
        <Text style={[S.cNumStrong, { color: C.gold }]}>{nfEur(totalRetro)}</Text>
        <Text style={[S.cNumStrong, { color: C.gold }]}>{nfEur(totalComm)}</Text>
      </View>
    </View>
  );
}

export default function FraisPDF({ mode, clientRef, hypotheses, report, logo }: FraisPdfProps) {
  const { final } = report;
  const isCabinet = mode === "cabinet";
  // Agrégats issus du moteur (source unique) : le revenu cabinet TOTAL et le coût
  // total client incluent déjà les honoraires — plus aucun recalcul ici.
  const honoraireCumule = final.honoraireCumule;
  const revenuTotal = final.revenuCabinet;
  const titleDoc = isCabinet ? "Frais & rémunération" : "Vos frais, en toute clarté";
  const eyebrowDoc = isCabinet ? "Analyse cabinet · usage interne" : "Information sur les coûts et frais";
  const metaLine = clientRef ? `${clientRef} · ${dateFr()}` : dateFr();
  const baseLine = `${nfEur(hypotheses.versementInitial)}${hypotheses.versementAnnuel > 0 ? ` puis ${nfEur(hypotheses.versementAnnuel)}/an` : ""} · ${hypotheses.duree} ans · ${Math.round(hypotheses.partUC)} % UC / ${100 - Math.round(hypotheses.partUC)} % fonds euros`;

  return (
    <Document
      title={`${titleDoc} · Charlie · ${dateFr()}`}
      author="Charlie"
      subject={isCabinet ? "Analyse de rémunération (usage cabinet)" : "Information sur les coûts et frais (ex ante)"}
    >
      {/* ── Page 1 : synthèse + effet des coûts ── */}
      <Page size="A4" style={S.page}>
        <BrandHeader logo={logo} right={<Eyebrow>{dateFr()}</Eyebrow>} />

        <View style={S.hero}>
          <View style={S.heroLeft}>
            <Text style={S.eyebrow}>{eyebrowDoc}</Text>
            <Text style={S.title}>{titleDoc}</Text>
            <Text style={S.meta}>{metaLine}</Text>
            <Text style={S.metaSub}>{baseLine}</Text>
          </View>
          <HeroStat
            label={`Coût total sur ${final.annees} ans`}
            value={nfEur(final.coutTotalClient)}
            sub={honoraireCumule > 0
              ? `dont ${nfEur(honoraireCumule)} d'honoraires`
              : report.coutTotalPctVersements != null ? `soit ${report.coutTotalPctVersements.toFixed(1)} % des versements` : "tous frais, sortie incluse"}
            tone="neutral"
            valueColor={C.clay}
            style={{ flex: 1, alignSelf: "stretch", borderWidth: 0.75, borderColor: C.line }}
          />
        </View>

        <MetricGrid
          cols={4}
          labelMinHeight={17}
          items={[
            { label: "Coût la 1re année", value: nfEur(report.coutPremiereAnnee), sub: "entrée + gestion" },
            { label: "Coût récurrent / an", value: nfEur(report.coutRecurrentMoyen), sub: "gestion + supports" },
            { label: "Réduction de rendement", value: `${report.reductionRendement.toFixed(1)} %`, sub: "par an", color: C.gold },
            { label: `Valeur nette à ${final.annees} ans`, value: nfEur(final.valeurNette), sub: `gain ${final.gainNet >= 0 ? "+" : ""}${nfEur(final.gainNet)}`, color: final.gainNet >= 0 ? C.green : C.red },
          ]}
        />

        <CostIllustration report={report} />

        <Footer mode={mode} />
      </Page>

      {/* ── Page 2 : nature des frais + qui les perçoit ── */}
      <Page size="A4" style={S.page}>
        <BrandHeader logo={logo} right={<Eyebrow>{isCabinet ? "Frais & rémunération" : "Nature & transparence"}</Eyebrow>} />

        <Nature report={report} />
        <Transparence report={report} />

        {isCabinet && (
          <View style={S.callout}>
            <View>
              <Text style={S.calloutLabel}>
                {honoraireCumule > 0 ? "Revenu cabinet total" : "Votre rémunération"} sur {final.annees} ans
              </Text>
              <Text style={S.calloutSub}>
                Rétrocessions {nfEur(final.retroCgpCumulee)} · commission {nfEur(final.commCabinetCumulee)}
                {final.contractFeeCumulee > 0 ? ` · part gestion ${nfEur(final.contractFeeCumulee)}` : ""}
                {honoraireCumule > 0 ? ` · honoraires ${nfEur(honoraireCumule)}` : ""}
              </Text>
            </View>
            <Text style={S.calloutValue}>{nfEur(revenuTotal)}</Text>
          </View>
        )}

        <Footer mode={mode} />
      </Page>

      {/* ── Page 3 : projection + hypothèses ── */}
      <Page size="A4" style={S.page}>
        <BrandHeader logo={logo} right={<Eyebrow>Projection & hypothèses</Eyebrow>} />

        <Projections report={report} mode={mode} />
        <Hypotheses h={hypotheses} />

        <Footer mode={mode} />
      </Page>

      {/* ── Page 4 (cabinet) : détail par support ── */}
      {isCabinet && report.supports.length > 0 && (
        <Page size="A4" style={S.page}>
          <BrandHeader logo={logo} right={<Eyebrow>Rémunération cabinet</Eyebrow>} />
          <DetailSupports report={report} />
          <Text style={S.note}>
            Rappel de conformité : le montant des rétrocessions perçues doit être communiqué au client, à l'euro près,
            dans l'information ex post annuelle (art. 325-14 du RGAMF).
          </Text>
          <Footer mode={mode} />
        </Page>
      )}
    </Document>
  );
}
