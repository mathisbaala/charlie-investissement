import pptxgen from "pptxgenjs";
import type { AllocationPresentation } from "./allocationRationale";

// Génère un vrai fichier PowerPoint (.pptx) éditable à partir de la présentation
// d'allocation. Direction artistique reprise du modèle « Métagram / Cardif ELITE » :
// couverture bleu nuit + accent rouge corail, slides de contenu claires à titre
// bleu nuit, tableaux à en-tête sombre / lignes zébrées / chiffres indigo.
// 100 % déterministe. Marche navigateur (writeFile) et node (write nodebuffer).

// Palette exacte extraite du template.
const C = {
  navy: "1C2240", // fond couverture, en-têtes de tableau, titres
  indigo: "2E386A", // chiffres clés (poids, SFDR)
  charcoal: "2A2A3A", // texte courant des tableaux
  red: "D44D5C", // accent corail (marque)
  redDark: "B03847",
  panel: "F4F4F6", // ligne zébrée claire
  panel2: "FFFFFF",
  lavender: "DDDDEE", // texte clair secondaire sur fond sombre
  grey: "8D909F", // sous-titres, labels
  rose: "FFF0F2", // ligne mise en avant
  white: "FFFFFF",
};
const FONT = "Calibri";
const FONT_LIGHT = "Calibri Light";
const W = 13.33; // LAYOUT_WIDE

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${n.toFixed(1)} %`;
}
function sfdrText(a: number | null | undefined): string {
  return a === 8 ? "Art. 8" : a === 9 ? "Art. 9" : "Art. 6";
}

// Bandeau de bas de page (rappelé sur chaque slide).
function footer(slide: pptxgen.Slide, p: AllocationPresentation, onDark = false) {
  const left = [p.advisor, p.asOf].filter(Boolean).join("   ·   ") || "Charlie Investissement";
  slide.addText(left.toUpperCase(), {
    x: 0.5, y: 7.05, w: 9, h: 0.3, fontFace: FONT, fontSize: 8,
    color: onDark ? C.grey : C.grey, charSpacing: 1,
  });
}

// En-tête de slide de contenu : barre d'accent rouge + titre bleu nuit + sous-titre.
function contentHeader(slide: pptxgen.Slide, eyebrow: string, title: string, sub?: string) {
  slide.addShape("rect", { x: 0, y: 0, w: 0.14, h: 7.5, fill: { color: C.red } }); // liseré latéral
  slide.addText(eyebrow, { x: 0.5, y: 0.4, w: 3, h: 0.3, fontFace: FONT, fontSize: 12, color: C.red, bold: true, charSpacing: 2 });
  slide.addText(title, { x: 0.5, y: 0.68, w: 12.3, h: 0.6, fontFace: FONT_LIGHT, fontSize: 26, color: C.navy, bold: true });
  if (sub) slide.addText(sub, { x: 0.5, y: 1.28, w: 12.3, h: 0.35, fontFace: FONT, fontSize: 12, color: C.grey });
}

/** Construit le deck PowerPoint (16:9) prêt à écrire. */
export function buildAllocationDeck(p: AllocationPresentation): pptxgen {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Charlie Investissement";
  pptx.title = p.title;

  // ─── Slide 1 — couverture (fond bleu nuit) ──────────────────────────
  const s1 = pptx.addSlide();
  s1.background = { color: C.navy };
  s1.addShape("rect", { x: 0, y: 0, w: W, h: 0.16, fill: { color: C.red } }); // barre haute
  s1.addShape("rect", { x: 0, y: 7.34, w: W, h: 0.16, fill: { color: C.red } }); // barre basse
  s1.addText((p.advisor || "CHARLIE INVESTISSEMENT").toUpperCase(), { x: 0.6, y: 0.7, w: 12, h: 0.4, fontFace: FONT, fontSize: 13, color: C.red, bold: true, charSpacing: 2 });
  s1.addText("Proposition d'allocation d'actifs", { x: 0.6, y: 1.05, w: 12, h: 0.4, fontFace: FONT, fontSize: 13, color: C.lavender });
  s1.addText(p.title, { x: 0.6, y: 2.4, w: 12, h: 1.1, fontFace: FONT_LIGHT, fontSize: 40, color: C.white, bold: true });
  s1.addText(p.subtitle + (p.asOf ? `   ·   ${p.asOf}` : ""), { x: 0.6, y: 3.55, w: 12, h: 0.5, fontFace: FONT, fontSize: 15, color: C.lavender });

  const tiles: [string, string][] = [
    [String(p.headline.supports), "Supports"],
    [p.headline.weightedSri == null ? "—" : `${p.headline.weightedSri} / 7`, "SRI moyen"],
    [`~${p.headline.expectedReturnPct} %`, "Perf. cible / an"],
    [`~${p.headline.volatilityPct} %`, "Volatilité"],
  ];
  tiles.forEach(([val, lab], i) => {
    const x = 0.6 + i * 3.05;
    s1.addShape("rect", { x, y: 4.7, w: 0.5, h: 0.05, fill: { color: C.red } }); // petit liseré rouge
    s1.addText(val, { x, y: 4.85, w: 2.85, h: 0.8, fontFace: FONT_LIGHT, fontSize: 40, color: C.white, bold: true });
    s1.addText(lab.toUpperCase(), { x, y: 5.65, w: 2.85, h: 0.4, fontFace: FONT, fontSize: 11, color: C.lavender, charSpacing: 1 });
  });
  footer(s1, p, true);

  // ─── Slide 2 — contexte & objectifs ─────────────────────────────────
  const s2 = pptx.addSlide();
  s2.background = { color: C.white };
  contentHeader(s2, "01", "Contexte et objectifs");
  s2.addText(
    p.objectives.map((o) => ({ text: o, options: { bullet: { code: "2022", indent: 18 }, color: C.charcoal, fontSize: 15, paraSpaceAfter: 12 } })),
    { x: 0.7, y: 1.7, w: 12, h: 4.8, fontFace: FONT },
  );
  footer(s2, p);

  // ─── Slide 3 — répartition par classe ───────────────────────────────
  const s3 = pptx.addSlide();
  s3.background = { color: C.white };
  contentHeader(s3, "02", "Répartition stratégique par classe d'actifs");
  const classRows: pptxgen.TableRow[] = [
    ["Classe d'actifs", "Poids", "Rôle dans le portefeuille"].map((t, i) => ({
      text: t, options: { bold: true, color: C.white, fill: { color: C.navy }, fontSize: 11, align: i === 1 ? "right" : "left", valign: "middle" } as pptxgen.TableCellProps,
    })),
    ...p.classBreakdown.map((c, idx): pptxgen.TableRow => {
      const bg = idx % 2 ? C.panel : C.panel2;
      return [
        { text: c.label, options: { color: C.navy, bold: true, fontSize: 13, fill: { color: bg } } },
        { text: pct(c.weight), options: { color: C.indigo, bold: true, fontSize: 13, align: "right", fill: { color: bg } } },
        { text: c.role, options: { color: C.charcoal, fontSize: 12, fill: { color: bg } } },
      ];
    }),
  ];
  s3.addTable(classRows, { x: 0.5, y: 1.7, w: 12.3, colW: [3.4, 1.4, 7.5], rowH: 0.55, valign: "middle", fontFace: FONT, border: { type: "none" } });
  footer(s3, p);

  // ─── Slide 4 — allocation détaillée ─────────────────────────────────
  const s4 = pptx.addSlide();
  s4.background = { color: C.white };
  contentHeader(s4, "03", "Allocation détaillée", `${p.table.length} supports retenus`);
  const H = (t: string, align: "left" | "right" | "center" = "left"): pptxgen.TableCell => ({
    text: t, options: { bold: true, color: C.white, fill: { color: C.navy }, fontSize: 9, align, valign: "middle" },
  });
  const detailRows: pptxgen.TableRow[] = [
    [H("#"), H("Fonds"), H("ISIN"), H("Catégorie"), H("Poids", "right"), H("SRI", "center"), H("SFDR", "center"), H("TER", "right")],
    ...p.table.map((l, i): pptxgen.TableRow => {
      const bg = i % 2 ? C.panel : C.panel2;
      const cell = (text: string, opts: Partial<pptxgen.TextPropsOptions> = {}): pptxgen.TableCell => ({
        text, options: { fontSize: 9, color: C.charcoal, fill: { color: bg }, valign: "middle", ...opts },
      });
      return [
        cell(String(i + 1), { color: C.grey }),
        cell(l.name, { color: C.navy, bold: true }),
        cell(l.isin, { color: C.grey, fontFace: "Consolas" }),
        cell(l.category ?? "—"),
        cell(pct(l.weight), { color: C.indigo, bold: true, align: "right" }),
        cell(l.sri == null ? "—" : String(l.sri), { align: "center" }),
        cell(sfdrText(l.sfdr), { color: C.indigo, align: "center" }),
        cell(l.ter == null ? "—" : `${(l.ter * 100).toFixed(2)} %`, { align: "right" }),
      ];
    }),
  ];
  s4.addTable(detailRows, { x: 0.45, y: 1.85, w: 12.45, colW: [0.5, 3.7, 1.9, 2.65, 1.1, 0.85, 0.95, 0.8], rowH: 0.34, valign: "middle", fontFace: FONT, border: { type: "none" } });
  footer(s4, p);

  // ─── Slide 5 — profil de risque ─────────────────────────────────────
  const s5 = pptx.addSlide();
  s5.background = { color: C.white };
  contentHeader(s5, "04", "Profil de risque", `SRI moyen pondéré ~${p.riskProfile.weightedSri ?? "—"} / 7 — ${p.riskProfile.profileLabel}`);
  const maxSri = Math.max(1, ...p.riskProfile.sriDistribution.map((b) => b.weight));
  p.riskProfile.sriDistribution.forEach((b, i) => {
    const y = 1.9 + i * 0.52;
    s5.addText(`SRI ${b.sri}`, { x: 0.6, y, w: 1, h: 0.4, fontFace: FONT, fontSize: 11, color: C.grey, valign: "middle" });
    s5.addShape("rect", { x: 1.7, y: y + 0.04, w: 8, h: 0.3, fill: { color: C.panel } }); // rail
    const barW = (b.weight / maxSri) * 8;
    if (barW > 0.02)
      s5.addShape("rect", { x: 1.7, y: y + 0.04, w: barW, h: 0.3, fill: { color: b.sri <= 2 ? C.indigo : b.sri <= 4 ? C.red : C.redDark } });
    s5.addText(pct(b.weight), { x: 9.9, y, w: 1.4, h: 0.4, fontFace: FONT, fontSize: 11, color: C.charcoal, bold: true, valign: "middle" });
  });
  // Répartition SFDR (pastilles)
  s5.addText("Durabilité (SFDR)", { x: 0.6, y: 5.9, w: 4, h: 0.3, fontFace: FONT, fontSize: 12, color: C.navy, bold: true });
  p.riskProfile.sfdrDistribution.forEach((d, i) => {
    const x = 0.6 + i * 2.6;
    const col = d.article === 9 ? C.red : d.article === 8 ? C.indigo : C.grey;
    s5.addText(`Art. ${d.article}`, { x, y: 6.25, w: 1.2, h: 0.3, fontFace: FONT, fontSize: 11, color: col, bold: true });
    s5.addText(pct(d.weight), { x: x + 1.1, y: 6.25, w: 1.2, h: 0.3, fontFace: FONT, fontSize: 11, color: C.charcoal });
  });
  footer(s5, p);

  // ─── Slide 6 — justification par support ────────────────────────────
  const s6 = pptx.addSlide();
  s6.background = { color: C.white };
  contentHeader(s6, "05", "Analyse et justification par support");
  const rat: pptxgen.TextProps[] = [];
  p.perFundRationale.forEach((r, i) => {
    rat.push({ text: `${i + 1}. ${r.name}`, options: { bold: true, color: C.navy, fontSize: 11, paraSpaceBefore: 7, fontFace: FONT } });
    rat.push({ text: r.text, options: { color: C.charcoal, fontSize: 10, paraSpaceAfter: 3, fontFace: FONT } });
  });
  s6.addText(rat, { x: 0.7, y: 1.6, w: 12, h: 5.3, valign: "top" });
  footer(s6, p);

  // ─── Slide 7 — convictions (fond bleu nuit, comme la couverture) ─────
  const s7 = pptx.addSlide();
  s7.background = { color: C.navy };
  s7.addShape("rect", { x: 0, y: 0, w: 0.14, h: 7.5, fill: { color: C.red } });
  s7.addText("06", { x: 0.5, y: 0.4, w: 3, h: 0.3, fontFace: FONT, fontSize: 12, color: C.red, bold: true, charSpacing: 2 });
  s7.addText("Nos convictions de gestion", { x: 0.5, y: 0.68, w: 12, h: 0.6, fontFace: FONT_LIGHT, fontSize: 26, color: C.white, bold: true });
  const conv: pptxgen.TextProps[] = [];
  p.convictions.forEach((c) => {
    conv.push({ text: c.title, options: { bold: true, color: C.red, fontSize: 13, paraSpaceBefore: 9, fontFace: FONT } });
    conv.push({ text: c.text, options: { color: C.lavender, fontSize: 11, paraSpaceAfter: 3, fontFace: FONT } });
  });
  s7.addText(conv, { x: 0.7, y: 1.5, w: 12, h: 5.3, valign: "top" });
  footer(s7, p, true);

  // ─── Slide 8 — avertissements ───────────────────────────────────────
  const s8 = pptx.addSlide();
  s8.background = { color: C.panel };
  contentHeader(s8, "07", "Avertissements");
  s8.addText(
    p.disclaimers.map((d) => ({ text: d, options: { bullet: { code: "2022", indent: 18 }, color: C.charcoal, fontSize: 11, paraSpaceAfter: 10, fontFace: FONT } })),
    { x: 0.7, y: 1.7, w: 12, h: 4.5 },
  );
  footer(s8, p);

  return pptx;
}
