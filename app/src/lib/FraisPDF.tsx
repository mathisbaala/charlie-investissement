import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { C, FONT, registerCharlieFonts } from "./pdf/theme";
import { BrandHeader, Eyebrow, HeroStat, MetricGrid, Row, Bar, SectionIntro, dateFr, nfEur, fmt } from "./pdf/components";
import type { FraisReport } from "./feeSimulator";

registerCharlieFonts();

// ── Document de FRAIS remis au client (mode "client") ou de RÉMUNÉRATION à usage
// interne du cabinet (mode "cabinet"). 100 % déterministe (aucun appel IA) : ce
// n'est que de la mise en page d'un calcul. Le mode "client" est pensé pour la
// transparence DDA/MIF II — il AFFICHE la rétrocession de conseil ; le mode
// "cabinet" ajoute le détail de la rémunération, à ne pas remettre en l'état.

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
}

const S = StyleSheet.create({
  page: {
    paddingHorizontal: 44, paddingTop: 38, paddingBottom: 56,
    backgroundColor: C.cream, fontFamily: FONT.sans, fontSize: 9, color: C.ink,
  },
  hero: {
    flexDirection: "row", backgroundColor: C.paper, borderWidth: 0.75, borderColor: C.line,
    borderRadius: 11, padding: 22, gap: 20, alignItems: "center", marginBottom: 16,
  },
  heroLeft: { flex: 1.7 },
  accentRule: { width: 32, height: 2.5, backgroundColor: C.clay, marginBottom: 12 },
  eyebrow: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 8, letterSpacing: 1.8, textTransform: "uppercase", color: C.clay },
  title: { fontFamily: FONT.sans, fontSize: 26, color: C.ink, lineHeight: 1.04, marginTop: 5 },
  sub: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2, marginTop: 7, lineHeight: 1.4 },
  section: { marginTop: 16 },
  card: { backgroundColor: C.paper, borderWidth: 0.75, borderColor: C.line, borderRadius: 9, padding: 14, marginTop: 10 },
  cardLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 1.1, textTransform: "uppercase", color: C.muted, marginBottom: 9 },
  // Ventilation
  ventRow: { marginBottom: 9 },
  ventHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
  ventName: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2 },
  ventNameMine: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 9, color: C.gold },
  ventVal: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 9, color: C.ink },
  ventPct: { fontFamily: FONT.sans, fontSize: 7.5, color: C.muted, marginLeft: 6 },
  // Table
  tHead: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 6, borderBottomWidth: 1.25, borderBottomColor: C.ink },
  tHeadText: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 7, letterSpacing: 0.8, textTransform: "uppercase", color: C.muted },
  tRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 0.75, borderBottomColor: C.lineSoft },
  tTotal: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderTopWidth: 1, borderTopColor: C.line },
  cName: { flex: 3, paddingRight: 6 },
  cNum: { flex: 1.2, fontFamily: FONT.mono, fontSize: 8.5, textAlign: "right", color: C.ink2 },
  cNumStrong: { flex: 1.2, fontFamily: FONT.mono, fontWeight: 500, fontSize: 8.5, textAlign: "right", color: C.ink },
  rowName: { fontFamily: FONT.sans, fontSize: 9, color: C.ink },
  rowIsin: { fontFamily: FONT.mono, fontSize: 7, color: C.muted, marginTop: 2 },
  // Callout rémunération (cabinet)
  callout: {
    backgroundColor: C.claySoft, borderTopWidth: 2, borderTopColor: C.clay, borderRadius: 8,
    paddingVertical: 12, paddingHorizontal: 16, marginTop: 12,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  calloutLabel: { fontFamily: FONT.sans, fontWeight: 500, fontSize: 10, color: C.clayInk },
  calloutSub: { fontFamily: FONT.sans, fontSize: 7.5, color: "#86422A", marginTop: 3 },
  calloutValue: { fontFamily: FONT.sans, fontSize: 20, color: C.clay },
  footer: {
    position: "absolute", bottom: 26, left: 44, right: 44, borderTopWidth: 0.75, borderTopColor: C.line,
    paddingTop: 7, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
  },
  disclaimer: { fontFamily: FONT.sans, fontSize: 6.6, color: C.muted, lineHeight: 1.4, flex: 1 },
  footerBrand: { fontFamily: FONT.sans, fontSize: 9, color: C.ink2 },
});

const DISCLAIMER_CLIENT =
  "Document d'information sur les frais établi à titre indicatif par votre conseiller. Les projections reposent " +
  "sur les hypothèses de rendement et de frais indiquées ci-dessus ; elles ne constituent ni une garantie, ni un " +
  "engagement contractuel. Conformément à la réglementation (DDA / MIF II), les frais de conseil perçus par votre " +
  "conseiller (rétrocessions et commission) sont présentés au titre de la transparence. Les performances passées ne " +
  "préjugent pas des performances futures. Hors fiscalité et prélèvements sociaux.";

const DISCLAIMER_CABINET =
  "Document interne d'aide à la décision — usage cabinet, à ne pas remettre en l'état au client. Estimations de " +
  "rémunération sur la base des hypothèses saisies (encours, durée, taux de rétrocession et commission). La " +
  "rétrocession et la commission sont des TRANCHES des frais déjà supportés par le client, sans double comptage. " +
  "Ne constitue pas un conseil en investissement au sens MIF II ; la responsabilité du conseil reste au CGP/CIF.";

function Footer({ mode }: { mode: "client" | "cabinet" }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.disclaimer}>{mode === "client" ? DISCLAIMER_CLIENT : DISCLAIMER_CABINET}</Text>
      <Text style={S.footerBrand}>Charlie</Text>
    </View>
  );
}

// Bloc d'hypothèses : la base de la projection, indispensable à un document
// sérieux (le client/cabinet doit pouvoir refaire le calcul).
function Hypotheses({ h }: { h: FraisPdfHypotheses }) {
  return (
    <View style={S.section}>
      <Text style={S.cardLabel}>Hypothèses de l'étude</Text>
      <MetricGrid
        cols={3}
        items={[
          { label: "Versement initial", value: nfEur(h.versementInitial), sub: h.versementAnnuel > 0 ? `+ ${nfEur(h.versementAnnuel)} / an` : "versement unique" },
          { label: "Durée", value: `${h.duree} ans`, sub: `part UC ${Math.round(h.partUC)} %` },
          { label: "Rendement retenu", value: `${h.rendementUC.toFixed(1)} %`, sub: `fonds euros ${h.rendementFE.toFixed(1)} %` },
        ]}
      />
      <View style={{ flexDirection: "row", gap: 22, marginTop: 10 }}>
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

// Ventilation « où va chaque euro de frais » (DDA : la part conseil est affichée).
function Ventilation({ report }: { report: FraisReport }) {
  const { repart, final } = report;
  const total = final.totalFrais > 0 ? final.totalFrais : 1;
  const lignes: { nom: string; montant: number; mine?: boolean }[] = [
    { nom: "Assureur (enveloppe)", montant: repart.assureur },
    { nom: "Société de gestion (supports)", montant: repart.societeGestion },
    { nom: "Conseil — votre cabinet", montant: repart.cabinet, mine: true },
  ];
  return (
    <View style={S.card}>
      <Text style={S.cardLabel}>Où va le coût, sur {final.annees} ans</Text>
      {lignes.map((l) => (
        <View key={l.nom} style={S.ventRow}>
          <View style={S.ventHead}>
            <Text style={l.mine ? S.ventNameMine : S.ventName}>{l.nom}</Text>
            <Text>
              <Text style={S.ventVal}>{nfEur(l.montant)}</Text>
              <Text style={S.ventPct}>{Math.round((l.montant / total) * 100)} %</Text>
            </Text>
          </View>
          <Bar value={l.montant} max={total} color={l.mine ? C.gold : C.clay} />
        </View>
      ))}
    </View>
  );
}

// Projection par horizon. Le mode cabinet ajoute la colonne « Rému cabinet ».
function Projections({ report, mode }: { report: FraisReport; mode: "client" | "cabinet" }) {
  return (
    <View style={S.section}>
      <Text style={S.cardLabel}>Projection par horizon</Text>
      <View style={S.tHead}>
        <Text style={[S.cName, S.tHeadText]}>Horizon</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Valeur nette</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Gain net</Text>
        <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Total frais</Text>
        {mode === "cabinet" && <Text style={[S.cNum, S.tHeadText, { textAlign: "right" }]}>Rému cabinet</Text>}
      </View>
      {report.horizons.map((h) => (
        <View key={h.annees} style={S.tRow}>
          <Text style={[S.cName, S.rowName]}>{h.annees} ans</Text>
          <Text style={S.cNumStrong}>{nfEur(h.valeurNette)}</Text>
          <Text style={[S.cNum, { color: h.gainNet >= 0 ? C.green : C.red }]}>
            {h.gainNet >= 0 ? "+" : ""}{nfEur(h.gainNet)}
          </Text>
          <Text style={S.cNum}>{nfEur(h.totalFrais)}</Text>
          {mode === "cabinet" && (
            <Text style={[S.cNum, { color: C.gold }]}>{nfEur(h.retroCgpCumulee + h.commCabinetCumulee)}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// Détail par support (cabinet uniquement) : qui rapporte quoi.
function DetailSupports({ report }: { report: FraisReport }) {
  if (report.supports.length === 0) return null;
  const totalRetro = report.supports.reduce((a, s) => a + s.retroAnnuelle, 0);
  const totalComm = report.supports.reduce((a, s) => a + s.commissionUpfront, 0);
  return (
    <View style={S.section}>
      <SectionIntro eyebrow="Rémunération" title="Le détail par support." desc="Rétrocession récurrente et commission d'entrée, ligne par ligne, au montant alloué." />
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
          <Text style={S.cNum}>{nfEur(s.montant)}</Text>
          <Text style={S.cNum}>{fmt(s.ter)}</Text>
          <Text style={S.cNum}>{fmt(s.effRetro)}</Text>
          <Text style={[S.cNumStrong, { color: C.gold }]}>{nfEur(s.retroAnnuelle)}</Text>
          <Text style={[S.cNum, { color: C.gold }]}>{nfEur(s.commissionUpfront)}</Text>
        </View>
      ))}
      <View style={S.tTotal}>
        <Text style={[S.cName, S.rowName, { fontWeight: 500 }]}>Total</Text>
        <Text style={S.cNum} /><Text style={S.cNum} /><Text style={S.cNum} />
        <Text style={[S.cNumStrong, { color: C.gold }]}>{nfEur(totalRetro)}</Text>
        <Text style={[S.cNumStrong, { color: C.gold }]}>{nfEur(totalComm)}</Text>
      </View>
    </View>
  );
}

export default function FraisPDF({ mode, clientRef, hypotheses, report }: FraisPdfProps) {
  const { final, partFraisGainBrut, remuTotale } = report;
  const isCabinet = mode === "cabinet";
  const titleDoc = isCabinet ? "Frais & rémunération" : "Vos frais, en transparence";
  const eyebrowDoc = isCabinet ? "Analyse cabinet — usage interne" : "Information sur les frais";
  const subDoc = clientRef
    ? `Établi pour ${clientRef} · ${dateFr()}`
    : `Établi le ${dateFr()}`;

  return (
    <Document
      title={`${titleDoc} · Charlie · ${dateFr()}`}
      author="Charlie CGP"
      subject={isCabinet ? "Analyse de rémunération (usage cabinet)" : "Document d'information sur les frais"}
    >
      <Page size="A4" style={S.page}>
        <BrandHeader right={<Eyebrow>{dateFr()}</Eyebrow>} />

        <View style={S.hero}>
          <View style={S.heroLeft}>
            <View style={S.accentRule} />
            <Text style={S.eyebrow}>{eyebrowDoc}</Text>
            <Text style={S.title}>{titleDoc}</Text>
            <Text style={S.sub}>{subDoc}</Text>
          </View>
          <HeroStat
            label={`Coût total sur ${final.annees} ans`}
            value={nfEur(final.totalFrais)}
            sub="tous frais, sortie incluse"
            tone="neutral"
            style={{ flex: 1, alignSelf: "stretch" }}
          />
        </View>

        <MetricGrid
          cols={3}
          items={[
            { label: `Valeur nette à ${final.annees} ans`, value: nfEur(final.valeurNette), sub: "ce que perçoit le client" },
            { label: "Gain net client", value: `${final.gainNet >= 0 ? "+" : ""}${nfEur(final.gainNet)}`, sub: "après tous frais", color: final.gainNet >= 0 ? C.green : C.red },
            { label: "Manque à gagner", value: nfEur(final.manqueAGagner), sub: "coût des frais dans le temps", color: C.gold },
          ]}
        />

        <View style={S.section}>
          <SectionIntro
            eyebrow="Transparence"
            title="Où va le coût de la structure."
            desc={isCabinet
              ? "Les trois destinataires du coût total. La part conseil = votre rémunération (rétrocessions + commission)."
              : "Les frais se répartissent entre trois acteurs. La part conseil rémunère l'accompagnement de votre conseiller."}
          />
          <Ventilation report={report} />
          {partFraisGainBrut != null && (
            <Text style={{ fontFamily: FONT.sans, fontSize: 7.5, color: C.muted, marginTop: 6 }}>
              Les frais représentent {partFraisGainBrut.toFixed(1)} % du gain brut (avant frais) à {final.annees} ans.
            </Text>
          )}
        </View>

        {isCabinet && (
          <View style={S.callout}>
            <View>
              <Text style={S.calloutLabel}>Votre rémunération sur {final.annees} ans</Text>
              <Text style={S.calloutSub}>
                Rétrocessions {nfEur(final.retroCgpCumulee)} · commission d'entrée {nfEur(final.commCabinetCumulee)}
              </Text>
            </View>
            <Text style={S.calloutValue}>{nfEur(remuTotale)}</Text>
          </View>
        )}

        <Projections report={report} mode={mode} />
        <Hypotheses h={hypotheses} />

        <Footer mode={mode} />
      </Page>

      {isCabinet && report.supports.length > 0 && (
        <Page size="A4" style={S.page}>
          <BrandHeader right={<Eyebrow>Rémunération cabinet</Eyebrow>} />
          <DetailSupports report={report} />
          <Footer mode={mode} />
        </Page>
      )}
    </Document>
  );
}
