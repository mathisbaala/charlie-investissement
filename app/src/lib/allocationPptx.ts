import pptxgen from "pptxgenjs";
import { roleSentence, type AllocationPresentation } from "./allocationRationale";
import type { PresentationExtras } from "./presentationExtras";
import { frMonthLabel } from "./presentationExtras";

// Deck PowerPoint remis au client, généré dans le navigateur. Direction
// artistique Charlie (encre, lin, accent clay, tons terre), structure moderne :
// couverture sombre côté client, sommaire numéroté, un chiffre mis en valeur
// par slide, camemberts natifs (répartition par classe, géo, secteurs), projets
// du client, corrélation, back-test, prochaines étapes. Chaque section
// optionnelle disparaît si sa donnée manque. 100 % déterministe.
// Typographie : aucun tiret de ponctuation, séparateurs « · », virgules,
// deux-points ; valeurs absentes notées « n.c. ».

const NC = "n.c.";

// Palette Charlie (hex sans « # », équivalents des tokens de l'app).
const C = {
  ink: "1B1A18",
  ink2: "3B3A38",
  cream: "F5F3F0",
  paper: "FCFCF9",
  paper2: "EDEBE7",
  line: "C9C7C2",
  muted: "7C7A76",
  clay: "8F4A31",
  clayBright: "C88A6E", // accent lisible sur fond sombre
  claySoft: "EFCBBB",
  green: "1E7A4F",
  gold: "9A7B33",
  red: "A83A2A",
  darkPanel: "26241F",
  darkText: "F7F5F2",
  darkMuted: "9C9891",
};
// Séries des camemberts : tons terre validés (contraste + daltonisme), gris
// neutre réservé au reliquat « Autres ».
const SLICES = ["9F4325", "2E6E9E", "A2791F", "1E7A4F", "6B4E8C", "8A867C"];
const sliceColors = (labels: string[]) =>
  labels.map((l, i) => (l === "Autres" ? "8A867C" : SLICES[i % (SLICES.length - 1)]));

const FONT = "Calibri";
const W = 13.33; // LAYOUT_WIDE
const H = 7.5;

function pct(n: number | null | undefined): string {
  return n == null ? NC : `${n.toFixed(1)} %`;
}
function signedPct(n: number | null | undefined): string {
  return n == null ? NC : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} %`;
}
function eur(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR").replace(/[  ]/g, " ")} €`;
}
function sfdrText(a: number | null | undefined): string {
  return a === 8 ? "Art. 8" : a === 9 ? "Art. 9" : "Art. 6";
}
function truncate(t: string, n: number): string {
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function footer(slide: pptxgen.Slide, p: AllocationPresentation, onDark = false) {
  const left = [p.advisor, p.asOf, "Document confidentiel"].filter(Boolean).join("   ·   ");
  slide.addText(left, {
    x: 0.6, y: 7.08, w: 12.1, h: 0.3, fontFace: FONT, fontSize: 8,
    color: onDark ? C.darkMuted : C.muted, charSpacing: 1,
  });
}

/** En-tête de slide : « 01 · SECTION » en clay, titre message, sous-titre. Pas de liseré. */
function header(slide: pptxgen.Slide, eyebrow: string, title: string, sub?: string, onDark = false) {
  slide.addText(eyebrow.toUpperCase(), {
    x: 0.6, y: 0.42, w: 12.1, h: 0.3, fontFace: FONT, fontSize: 11,
    color: onDark ? C.clayBright : C.clay, bold: true, charSpacing: 2,
  });
  slide.addText(title, {
    x: 0.6, y: 0.72, w: 12.1, h: 0.6, fontFace: FONT, fontSize: 25,
    color: onDark ? C.darkText : C.ink, bold: true,
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.6, y: 1.32, w: 12.1, h: 0.35, fontFace: FONT, fontSize: 12,
      color: onDark ? C.darkMuted : C.muted,
    });
  }
}

/** Construit le deck PowerPoint (16:9) prêt à écrire. `logo` = data URI du « C »
    Charlie (facultatif) : posé sur un badge clair pour rester lisible sur la
    couverture sombre. */
export function buildAllocationDeck(p: AllocationPresentation, logo?: string): pptxgen {
  const x: PresentationExtras | undefined = p.extras;
  const hasGoals = !!x && (x.goals.length > 0 || x.projection != null);
  const hasExposure = !!x?.exposure && (x.exposure.geo.length > 0 || x.exposure.sectors.length > 0);
  const hasCorr = !!x?.correlation;
  const hasBt = !!x?.backtest && x.backtest.curve.length > 1;

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = p.advisor ?? "Charlie";
  pptx.title = p.title;

  // ─── 1. Couverture (sombre, côté client) ────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.ink };
    if (logo) {
      // Badge clair (le « C » est noir, invisible sur fond sombre sans support).
      s.addShape("roundRect", { x: 0.62, y: 0.42, w: 0.5, h: 0.5, fill: { color: C.cream }, rectRadius: 0.08 });
      s.addImage({ data: logo, x: 0.71, y: 0.52, w: 0.32, h: 0.28, sizing: { type: "contain", w: 0.32, h: 0.28 } });
      s.addText("Charlie", { x: 1.24, y: 0.42, w: 3, h: 0.5, fontFace: FONT, fontSize: 17, color: C.darkText, margin: 0, valign: "middle" });
    } else {
      s.addShape("ellipse", { x: 0.62, y: 0.62, w: 0.13, h: 0.13, fill: { color: C.clay } });
      s.addText("Charlie", { x: 0.82, y: 0.42, w: 3, h: 0.5, fontFace: FONT, fontSize: 17, color: C.darkText, margin: 0 });
    }
    s.addText("CONFIDENTIEL", { x: 9.7, y: 0.5, w: 3, h: 0.35, fontFace: FONT, fontSize: 9, color: C.darkMuted, charSpacing: 2, align: "right" });

    s.addText("VOTRE PROPOSITION D'INVESTISSEMENT", { x: 0.62, y: 2.15, w: 12, h: 0.35, fontFace: FONT, fontSize: 12, color: C.clayBright, bold: true, charSpacing: 2.5, margin: 0 });
    s.addText(p.title, { x: 0.62, y: 2.5, w: 11.5, h: 1.05, fontFace: FONT, fontSize: 38, color: C.darkText, bold: true, margin: 0 });
    s.addText([p.subtitle, p.asOf].filter(Boolean).join("   ·   "), { x: 0.62, y: 3.55, w: 11.5, h: 0.4, fontFace: FONT, fontSize: 14, color: C.darkMuted, margin: 0 });

    const tiles: [string, string][] = [
      [`~${p.headline.expectedReturnPct} %`, "PERFORMANCE CIBLE / AN"],
      [`~${p.headline.volatilityPct} %`, "VOLATILITÉ ATTENDUE"],
      [p.headline.weightedSri == null ? NC : `${p.headline.weightedSri} / 7`, "RISQUE, SRI MOYEN"],
      [String(p.headline.supports), "SUPPORTS"],
    ];
    tiles.forEach(([val, lab], i) => {
      const tx = 0.62 + i * 3.1;
      s.addShape("roundRect", { x: tx, y: 4.75, w: 2.9, h: 1.55, fill: { color: C.darkPanel }, rectRadius: 0.08 });
      s.addText(val, { x: tx + 0.2, y: 4.95, w: 2.5, h: 0.7, fontFace: FONT, fontSize: 30, color: C.darkText, bold: true, margin: 0 });
      s.addText(lab, { x: tx + 0.2, y: 5.68, w: 2.5, h: 0.35, fontFace: FONT, fontSize: 8.5, color: C.darkMuted, charSpacing: 1.2, margin: 0 });
    });
    footer(s, p, true);
  }

  // ─── 2. Sommaire ────────────────────────────────────────────────────────────
  {
    const items: [string, string][] = [
      ["L'essentiel de votre proposition", "Allocation cible, rôle de chaque poche et chiffres clés."],
    ];
    if (hasGoals) items.push(["Vos projets et leur trajectoire", "Probabilité d'atteinte de chaque projet avec les moyens affectés."]);
    if (hasExposure) items.push(["Où votre portefeuille est investi", "Répartitions géographique et sectorielle, par transparence des fonds."]);
    items.push(["Votre portefeuille en détail", "Les supports retenus, leurs poids, leur risque et leurs frais."]);
    items.push(["Profil de risque", "Répartition du risque (SRI) et durabilité (SFDR)."]);
    if (hasCorr || hasBt) items.push(["Diversification et comportement", "Complémentarité des supports et comportement passé de l'allocation."]);
    items.push(["Analyse par support et convictions", "Pourquoi chaque fonds a sa place dans ce portefeuille."]);
    items.push(["Prochaines étapes", "Ce que nous validons ensemble, et ce que nous prenons en charge."]);

    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "Sommaire", "Ce que couvre cette présentation");
    const colW = 5.9;
    items.forEach(([t, d], i) => {
      const col = i < Math.ceil(items.length / 2) ? 0 : 1;
      const row = col === 0 ? i : i - Math.ceil(items.length / 2);
      const ix = 0.62 + col * (colW + 0.5);
      const iy = 1.95 + row * 1.18;
      s.addText(String(i + 1).padStart(2, "0"), { x: ix, y: iy, w: 0.7, h: 0.5, fontFace: FONT, fontSize: 20, color: C.clay, bold: true, margin: 0 });
      s.addText(t, { x: ix + 0.75, y: iy, w: colW - 0.75, h: 0.35, fontFace: FONT, fontSize: 14, color: C.ink, bold: true, margin: 0 });
      s.addText(d, { x: ix + 0.75, y: iy + 0.34, w: colW - 0.75, h: 0.6, fontFace: FONT, fontSize: 10.5, color: C.muted, margin: 0 });
    });
    footer(s, p);
  }

  // ─── 3. Synthèse exécutive ──────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "01 · Synthèse", "L'essentiel de votre proposition");

    const labels = p.classBreakdown.map((c) => c.label);
    s.addChart("doughnut", [{ name: "Allocation", labels, values: p.classBreakdown.map((c) => c.weight) }], {
      x: 0.4, y: 2.0, w: 4.3, h: 3.6,
      chartColors: sliceColors(labels),
      holeSize: 62,
      showLegend: false,
      showTitle: false,
      showValue: false,
      dataBorder: { pt: 1.5, color: C.cream },
    });

    const rows: pptxgen.TableRow[] = [
      ["Classe d'actifs", "Poids", "Rôle dans le portefeuille"].map((t, i) => ({
        text: t,
        options: { bold: true, color: C.darkText, fill: { color: C.ink }, fontSize: 10, align: i === 1 ? "right" : "left", valign: "middle" } as pptxgen.TableCellProps,
      })),
      ...p.classBreakdown.map((c, idx): pptxgen.TableRow => {
        const bg = idx % 2 ? C.paper2 : C.paper;
        return [
          { text: c.label, options: { color: C.ink, bold: true, fontSize: 11, fill: { color: bg } } },
          { text: pct(c.weight), options: { color: C.clay, bold: true, fontSize: 11, align: "right", fill: { color: bg } } },
          { text: c.role, options: { color: C.ink2, fontSize: 10, fill: { color: bg } } },
        ];
      }),
    ];
    s.addTable(rows, { x: 4.9, y: 2.0, w: 8.0, colW: [2.3, 1.0, 4.7], rowH: 0.44, valign: "middle", fontFace: FONT, border: { type: "none" } });

    const stats: [string, string][] = [
      [x?.avgTer == null ? NC : `${(x.avgTer * 100).toFixed(2)} %`, "FRAIS COURANTS MOYENS / AN"],
      [x?.effectiveHoldings == null ? NC : x.effectiveHoldings.toFixed(1), "LIGNES EFFECTIVES"],
      [x?.projection ? eur(x.projection.projectedEur) : NC, x?.projection ? `PROJECTION À ${x.projection.horizonYears} ANS, NON GARANTIE` : "PROJECTION"],
    ];
    stats.forEach(([val, lab], i) => {
      const tx = 0.62 + i * 4.15;
      s.addShape("roundRect", { x: tx, y: 5.85, w: 3.95, h: 1.0, fill: { color: C.paper }, line: { color: C.line, width: 0.75 }, rectRadius: 0.06 });
      s.addText(val, { x: tx + 0.18, y: 5.95, w: 3.6, h: 0.45, fontFace: FONT, fontSize: 17, color: C.ink, bold: true, margin: 0 });
      s.addText(lab, { x: tx + 0.18, y: 6.42, w: 3.6, h: 0.3, fontFace: FONT, fontSize: 7.5, color: C.muted, charSpacing: 1, margin: 0 });
    });
    footer(s, p);
  }

  // ─── 4. Projets du client ───────────────────────────────────────────────────
  if (hasGoals && x) {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "02 · Projets", "Vos projets et leur trajectoire",
      "Rendement requis et probabilité d'atteinte simulée, avec les moyens affectés à chaque projet.");

    let y = 1.95;
    if (x.projection) {
      s.addShape("roundRect", { x: 0.62, y, w: 12.1, h: 1.0, fill: { color: C.claySoft }, rectRadius: 0.06 });
      s.addText(
        `${eur(x.projection.amountEur)} investis aujourd'hui ≈ ${eur(x.projection.projectedEur)} à ${x.projection.horizonYears} ans`,
        { x: 0.85, y: y + 0.08, w: 11.6, h: 0.5, fontFace: FONT, fontSize: 16, color: "5E2411", bold: true, margin: 0 },
      );
      s.addText("Projection indicative au rendement cible, hors frais et fiscalité, performances non garanties.",
        { x: 0.85, y: y + 0.55, w: 11.6, h: 0.35, fontFace: FONT, fontSize: 9.5, color: "5E2411", margin: 0 });
      y += 1.25;
    }
    // Le bandeau projection occupe une rangée : 3 projets max avec lui, 4 sans
    // (au-delà, la slide déborderait sous le pied de page).
    x.goals.slice(0, x.projection ? 3 : 4).forEach((g) => {
      const tone = g.successProb == null ? C.red : g.successProb >= 0.75 ? C.green : g.successProb >= 0.5 ? C.gold : C.red;
      const status = g.successProb == null
        ? "hors de portée en l'état, à retravailler ensemble"
        : `${Math.round(g.successProb * 100)} % de chances${g.successProb >= 0.75 ? ", en bonne voie" : g.successProb >= 0.5 ? ", à surveiller" : ", à repenser ensemble"}`;
      s.addShape("roundRect", { x: 0.62, y, w: 12.1, h: 1.05, fill: { color: C.paper }, line: { color: C.line, width: 0.75 }, rectRadius: 0.06 });
      s.addText(g.label, { x: 0.85, y: y + 0.08, w: 7, h: 0.4, fontFace: FONT, fontSize: 13, color: C.ink, bold: true, margin: 0 });
      s.addText(status, { x: 7.4, y: y + 0.1, w: 5.1, h: 0.4, fontFace: FONT, fontSize: 11, color: tone, bold: true, align: "right", margin: 0 });
      s.addText(
        `${eur(g.targetEur)} à ${g.years} ans · ${g.priorityLabel} · ${eur(g.initialEur)} affectés` +
        (g.monthlyEur > 0 ? ` + ${eur(g.monthlyEur)} par mois` : "") +
        (g.requiredReturn != null ? ` · rendement requis : ${g.requiredReturn <= 0 ? "aucun, objectif sécurisé" : `${(g.requiredReturn * 100).toFixed(1)} % par an`}` : ""),
        { x: 0.85, y: y + 0.5, w: 11.6, h: 0.4, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0 },
      );
      y += 1.2;
    });
    s.addText("Probabilités estimées par simulation Monte Carlo, hors frais et fiscalité : elles éclairent la discussion, elles ne constituent pas un engagement.",
      { x: 0.62, y: 6.55, w: 12.1, h: 0.35, fontFace: FONT, fontSize: 8.5, color: C.muted, margin: 0 });
    footer(s, p);
  }

  // ─── 5. Répartitions géo / secteurs ─────────────────────────────────────────
  if (hasExposure && x?.exposure) {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "03 · Transparence", "Où votre portefeuille est réellement investi",
      "Lecture par transparence des fonds (look-through), pondérée par les poids du portefeuille.");

    const drawDonut = (title: string, expo: { label: string; weight: number }[], cx: number) => {
      if (expo.length === 0) return;
      s.addText(title, { x: cx, y: 1.95, w: 5.8, h: 0.35, fontFace: FONT, fontSize: 14, color: C.ink, bold: true, margin: 0 });
      const labels = expo.map((e) => e.label);
      s.addChart("doughnut", [{ name: title, labels, values: expo.map((e) => e.weight) }], {
        x: cx, y: 2.35, w: 2.9, h: 2.9,
        chartColors: sliceColors(labels),
        holeSize: 62,
        showLegend: false,
        showTitle: false,
        showValue: false,
        dataBorder: { pt: 1.5, color: C.cream },
      });
      expo.forEach((e, i) => {
        const ly = 2.5 + i * 0.42;
        s.addShape("roundRect", { x: cx + 3.05, y: ly + 0.06, w: 0.16, h: 0.16, fill: { color: sliceColors(labels)[i] }, rectRadius: 0.03 });
        s.addText(truncate(e.label, 24), { x: cx + 3.3, y: ly, w: 1.9, h: 0.3, fontFace: FONT, fontSize: 10, color: C.ink2, margin: 0 });
        s.addText(pct(e.weight), { x: cx + 5.0, y: ly, w: 0.85, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, align: "right", margin: 0 });
      });
    };
    drawDonut("Répartition géographique", x.exposure.geo, 0.62);
    drawDonut("Répartition sectorielle", x.exposure.sectors, 7.0);

    s.addText("Répartitions calculées sur la part du portefeuille dont la composition est publiée par les sociétés de gestion.",
      { x: 0.62, y: 6.55, w: 12.1, h: 0.35, fontFace: FONT, fontSize: 8.5, color: C.muted, margin: 0 });
    footer(s, p);
  }

  // ─── 6. Portefeuille détaillé ───────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "04 · Détail", "Votre portefeuille en détail", `${p.table.length} supports retenus · niveau de risque SRI de 1 à 7, tel qu'indiqué dans le document d'informations clés de chaque support.`);
    const Hcell = (t: string, align: "left" | "right" | "center" = "left"): pptxgen.TableCell => ({
      text: t, options: { bold: true, color: C.darkText, fill: { color: C.ink }, fontSize: 9, align, valign: "middle" },
    });
    const rows: pptxgen.TableRow[] = [
      [Hcell("#"), Hcell("Fonds"), Hcell("ISIN"), Hcell("Catégorie"), Hcell("Poids", "right"), Hcell("SRI", "center"), Hcell("SFDR", "center"), Hcell("Note", "center"), Hcell("Frais", "right")],
      ...p.table.map((l, i): pptxgen.TableRow => {
        const bg = i % 2 ? C.paper2 : C.paper;
        const cell = (text: string, opts: Partial<pptxgen.TextPropsOptions> = {}): pptxgen.TableCell => ({
          text, options: { fontSize: 9, color: C.ink2, fill: { color: bg }, valign: "middle", ...opts },
        });
        return [
          cell(String(i + 1), { color: C.muted }),
          cell(l.name, { color: C.ink, bold: true }),
          cell(l.isin, { color: C.muted }),
          cell(l.category ?? NC),
          cell(pct(l.weight), { color: C.clay, bold: true, align: "right" }),
          cell(l.sri == null ? NC : String(l.sri), { align: "center" }),
          cell(sfdrText(l.sfdr), { align: "center" }),
          cell(l.rating == null ? NC : `${l.rating}/5`, { align: "center" }),
          cell(l.ter == null ? NC : `${(l.ter * 100).toFixed(2)} %`, { align: "right" }),
        ];
      }),
    ];
    s.addTable(rows, { x: 0.45, y: 2.0, w: 12.45, colW: [0.5, 3.3, 1.8, 2.4, 1.05, 0.8, 0.9, 0.9, 0.8], rowH: 0.36, valign: "middle", fontFace: FONT, border: { type: "none" } });
    footer(s, p);
  }

  // ─── 7. Profil de risque ────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "05 · Risque", "Un niveau de risque aligné sur votre profil",
      `SRI moyen pondéré ~${p.riskProfile.weightedSri ?? NC} / 7 : ${p.riskProfile.profileLabel}.`);
    const maxSri = Math.max(1, ...p.riskProfile.sriDistribution.map((b) => b.weight));
    p.riskProfile.sriDistribution.forEach((b, i) => {
      const y = 2.05 + i * 0.52;
      s.addText(`SRI ${b.sri}`, { x: 0.62, y, w: 1, h: 0.4, fontFace: FONT, fontSize: 11, color: C.muted, valign: "middle", margin: 0 });
      s.addShape("roundRect", { x: 1.75, y: y + 0.06, w: 8, h: 0.28, fill: { color: C.paper2 }, rectRadius: 0.05 });
      const barW = (b.weight / maxSri) * 8;
      if (barW > 0.04) {
        s.addShape("roundRect", { x: 1.75, y: y + 0.06, w: barW, h: 0.28, fill: { color: b.sri <= 2 ? C.green : b.sri <= 4 ? C.gold : C.clay }, rectRadius: 0.05 });
      }
      s.addText(pct(b.weight), { x: 9.95, y, w: 1.4, h: 0.4, fontFace: FONT, fontSize: 11, color: C.ink2, bold: true, valign: "middle", margin: 0 });
    });
    s.addText("Durabilité (SFDR)", { x: 0.62, y: 6.0, w: 4, h: 0.3, fontFace: FONT, fontSize: 12, color: C.ink, bold: true, margin: 0 });
    p.riskProfile.sfdrDistribution.forEach((d, i) => {
      const dx = 0.62 + i * 2.7;
      const col = d.article === 9 ? C.green : d.article === 8 ? C.clay : C.muted;
      s.addText(`Art. ${d.article}`, { x: dx, y: 6.35, w: 1.2, h: 0.3, fontFace: FONT, fontSize: 11, color: col, bold: true, margin: 0 });
      s.addText(pct(d.weight), { x: dx + 0.95, y: 6.35, w: 1.3, h: 0.3, fontFace: FONT, fontSize: 11, color: C.ink2, margin: 0 });
    });
    footer(s, p);
  }

  // ─── 8. Diversification : corrélation ───────────────────────────────────────
  if (hasCorr && x?.correlation) {
    const corr = x.correlation;
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "06 · Diversification", "Des supports qui se complètent",
      x.effectiveHoldings != null
        ? `Plus la valeur est basse, plus deux supports se complètent · diversification réelle : ~${x.effectiveHoldings.toFixed(1)} lignes effectives.`
        : "Plus la valeur est basse, plus deux supports se complètent.");
    const n = corr.names.length;
    const rows: pptxgen.TableRow[] = [
      [
        { text: "", options: { fill: { color: C.cream } } },
        ...corr.names.map((name): pptxgen.TableCell => ({
          text: truncate(name, 12), options: { fontSize: 7.5, color: C.muted, fill: { color: C.cream }, align: "center", valign: "middle" },
        })),
      ],
      ...corr.names.map((name, ri): pptxgen.TableRow => [
        { text: truncate(name, 18), options: { fontSize: 8.5, color: C.ink2, fill: { color: C.cream }, valign: "middle" } },
        ...(corr.matrix[ri] ?? []).map((c): pptxgen.TableCell => {
          // Dégradé terre : positif → clay, négatif → vert, comme l'app.
          const v = c ?? 0;
          const bg = c == null ? C.cream : v >= 0.65 ? "C98063" : v >= 0.35 ? "E3B4A0" : v >= 0.05 ? "F1D8CC" : v > -0.05 ? "EDEBE7" : "D7E5DC";
          const fg = c != null && v >= 0.65 ? "FFFFFF" : C.ink2;
          return { text: c == null ? NC : c.toFixed(2), options: { fontSize: 8.5, color: fg, fill: { color: bg }, align: "center", valign: "middle" } };
        }),
      ]),
    ];
    const cellW = Math.min(1.15, 9.6 / n);
    s.addTable(rows, {
      x: 0.62, y: 2.1, w: 2.6 + cellW * n,
      colW: [2.6, ...Array.from({ length: n }, () => cellW)],
      rowH: 0.42, fontFace: FONT, border: { pt: 1, color: C.cream },
    });
    footer(s, p);
  }

  // ─── 9. Back-test ───────────────────────────────────────────────────────────
  if (hasBt && x?.backtest) {
    const bt = x.backtest;
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "07 · Historique", "Comment cette allocation s'est comportée",
      `Performance réelle des supports aux poids proposés${bt.periodLabel ? `, ${bt.periodLabel}` : ""}, face à l'indice ${bt.benchmarkLabel}, base 100. Hors frais du contrat.`);

    const labels = bt.curve.map((c) => frMonthLabel(c.d));
    s.addChart(
      "line",
      [
        { name: "Portefeuille", labels, values: bt.curve.map((c) => c.p) as number[] },
        { name: bt.benchmarkLabel, labels, values: bt.curve.map((c) => c.b) as number[] },
      ],
      {
        x: 0.62, y: 2.0, w: 8.0, h: 4.3,
        chartColors: [C.clay, C.muted],
        lineSize: 2,
        lineSmooth: true,
        lineDataSymbol: "none",
        showTitle: false,
        showLegend: true,
        legendPos: "b",
        legendFontSize: 9,
        catAxisLabelColor: C.muted,
        catAxisLabelFontSize: 8,
        catAxisLineShow: false,
        catAxisMaxVal: undefined,
        valAxisLabelColor: C.muted,
        valAxisLabelFontSize: 8,
        valGridLine: { color: C.line, size: 0.5, style: "solid" },
        catGridLine: { style: "none" },
        chartColorsOpacity: 100,
      },
    );

    const rows: pptxgen.TableRow[] = [
      ["Indicateur", "Portefeuille", bt.benchmarkLabel].map((t, i): pptxgen.TableCell => ({
        text: t, options: { bold: true, color: C.darkText, fill: { color: C.ink }, fontSize: 9, align: i === 0 ? "left" : "right", valign: "middle" },
      })),
      ...([
        ["Perf. annualisée", signedPct(bt.portfolio.annual_return), signedPct(bt.benchmark?.annual_return)],
        ["Perf. totale", signedPct(bt.portfolio.total_return), signedPct(bt.benchmark?.total_return)],
        ["Volatilité", bt.portfolio.volatility == null ? NC : `${(bt.portfolio.volatility * 100).toFixed(1)} %`, bt.benchmark?.volatility == null ? NC : `${(bt.benchmark.volatility * 100).toFixed(1)} %`],
        ["Perte maximale", bt.portfolio.max_drawdown == null ? NC : `${(bt.portfolio.max_drawdown * 100).toFixed(1)} %`, bt.benchmark?.max_drawdown == null ? NC : `${(bt.benchmark.max_drawdown * 100).toFixed(1)} %`],
      ].map(([k, a, b], i): pptxgen.TableRow => {
        const bg = i % 2 ? C.paper2 : C.paper;
        return [
          { text: k, options: { fontSize: 9.5, color: C.ink2, fill: { color: bg } } },
          { text: a, options: { fontSize: 9.5, color: C.ink, bold: true, align: "right", fill: { color: bg } } },
          { text: b, options: { fontSize: 9.5, color: C.ink2, align: "right", fill: { color: bg } } },
        ];
      })),
    ];
    s.addTable(rows, { x: 9.0, y: 2.0, w: 3.9, colW: [1.7, 1.1, 1.1], rowH: 0.42, fontFace: FONT, border: { type: "none" }, valign: "middle" });

    s.addText("Les performances passées ne préjugent pas des performances futures.",
      { x: 0.62, y: 6.55, w: 12.1, h: 0.35, fontFace: FONT, fontSize: 8.5, color: C.muted, bold: true, margin: 0 });
    footer(s, p);
  }

  // ─── 10. Analyse par support : une carte par fonds, jamais un pavé ──────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "08 · Analyse", "Pourquoi chaque support a sa place",
      "Le rôle de chaque fonds en un coup d'œil : le détail complet figure dans le rapport PDF.");
    const items = p.table.slice(0, 8);
    const cols = 2;
    const rows = Math.ceil(items.length / cols);
    const gapX = 0.3;
    const gapY = 0.18;
    const cardW = (12.1 - gapX) / cols;
    const top = 1.8;
    const cardH = Math.min(1.6, (6.95 - top - (rows - 1) * gapY) / rows);
    items.forEach((l, i) => {
      const cx = 0.62 + (i % cols) * (cardW + gapX);
      const cy = top + Math.floor(i / cols) * (cardH + gapY);
      s.addShape("roundRect", { x: cx, y: cy, w: cardW, h: cardH, fill: { color: C.paper }, line: { color: C.line, width: 0.75 }, rectRadius: 0.06 });
      s.addText(truncate(l.name, 44), { x: cx + 0.18, y: cy + 0.09, w: cardW - 1.35, h: 0.3, fontFace: FONT, fontSize: 10.5, bold: true, color: C.ink, margin: 0 });
      s.addText(pct(l.weight), { x: cx + cardW - 1.15, y: cy + 0.09, w: 0.97, h: 0.3, fontFace: FONT, fontSize: 10.5, bold: true, color: C.clay, align: "right", margin: 0 });
      const meta = [
        l.category,
        l.sri != null ? `SRI ${l.sri}` : null,
        sfdrText(l.sfdr),
        `~${(l.expectedReturn * 100).toFixed(1)} % / an attendu, volatilité ~${(l.volatility * 100).toFixed(1)} %`,
      ].filter(Boolean).join("  ·  ");
      s.addText(meta, { x: cx + 0.18, y: cy + 0.38, w: cardW - 0.36, h: 0.25, fontFace: FONT, fontSize: 8, color: C.muted, margin: 0 });
      s.addText(roleSentence(l), { x: cx + 0.18, y: cy + 0.62, w: cardW - 0.36, h: cardH - 0.7, fontFace: FONT, fontSize: 9, color: C.ink2, valign: "top", margin: 0 });
    });
    footer(s, p);
  }

  // ─── 11. Convictions (sombre) : panneaux 2×2 ────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.ink };
    header(s, "09 · Convictions", "Nos convictions de gestion", undefined, true);
    const items = p.convictions.slice(0, 4);
    const cols = 2;
    const gapX = 0.3;
    const gapY = 0.25;
    const cardW = (12.1 - gapX) / cols;
    const cardH = 2.3;
    items.forEach((c, i) => {
      const cx = 0.62 + (i % cols) * (cardW + gapX);
      const cy = 1.7 + Math.floor(i / cols) * (cardH + gapY);
      s.addShape("roundRect", { x: cx, y: cy, w: cardW, h: cardH, fill: { color: C.darkPanel }, rectRadius: 0.06 });
      s.addText(truncate(c.title, 58), { x: cx + 0.22, y: cy + 0.14, w: cardW - 0.44, h: 0.35, fontFace: FONT, fontSize: 12.5, bold: true, color: C.clayBright, margin: 0 });
      s.addText(c.text, { x: cx + 0.22, y: cy + 0.52, w: cardW - 0.44, h: cardH - 0.68, fontFace: FONT, fontSize: 9.5, color: "D8D5CF", valign: "top", margin: 0 });
    });
    footer(s, p, true);
  }

  // ─── 12. Prochaines étapes + avertissements ─────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    header(s, "10 · Et maintenant", "Les prochaines étapes");
    const steps: [string, string][] = [
      ["Nous échangeons sur cette proposition", "vos questions, vos ajustements : les poids et les supports s'adaptent en séance."],
      ["Vous validez le dossier", "documents d'informations clés (DIC) des supports, analyse de vos besoins et pièces réglementaires."],
      ["Nous mettons en place, puis nous suivons", "souscription, puis premier point de suivi ensemble dans les mois qui suivent."],
    ];
    steps.forEach(([t, d], i) => {
      const sx = 0.62 + i * 4.15;
      s.addShape("roundRect", { x: sx, y: 2.05, w: 3.95, h: 1.9, fill: { color: C.paper }, line: { color: C.line, width: 0.75 }, rectRadius: 0.06 });
      s.addText(String(i + 1), { x: sx + 0.22, y: 2.2, w: 0.7, h: 0.55, fontFace: FONT, fontSize: 26, color: C.clay, bold: true, margin: 0 });
      s.addText(t, { x: sx + 0.22, y: 2.75, w: 3.5, h: 0.55, fontFace: FONT, fontSize: 12.5, color: C.ink, bold: true, margin: 0 });
      s.addText(d, { x: sx + 0.22, y: 3.3, w: 3.5, h: 0.6, fontFace: FONT, fontSize: 9.5, color: C.muted, margin: 0 });
    });
    s.addText(
      p.disclaimers.map((d, i) => ({
        text: d,
        // breakLine obligatoire : sans lui, pptxgenjs colle tous les runs en un
        // seul paragraphe (pavé illisible).
        options: { bullet: { code: "00B7", indent: 12 }, breakLine: i < p.disclaimers.length - 1, color: C.muted, fontSize: 9, paraSpaceAfter: 6, fontFace: FONT },
      })),
      { x: 0.7, y: 4.4, w: 12, h: 2.1 },
    );
    footer(s, p);
  }

  return pptx;
}
