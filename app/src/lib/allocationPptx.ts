import pptxgen from "pptxgenjs";
import type { AllocationPresentation } from "./allocationRationale";

// Génère un vrai fichier PowerPoint (.pptx) éditable à partir de la présentation
// d'allocation, au format du modèle Métagram / Cardif ELITE. 100 % déterministe.
// Fonctionne côté navigateur (writeFile) ET côté node (write nodebuffer, pour les
// tests). Palette alignée sur le design Charlie (hex sans « # »).

const CLR = {
  cream: "F5F3F0",
  paper: "FCFCF9",
  ink: "1B1A18",
  ink2: "3B3A38",
  muted: "7C7A76",
  line: "C9C7C2",
  clay: "8F4A31",
  claySoft: "EFCBBB",
  green: "1E7A4F",
  gold: "9A7B33",
};

const CLASS_COLOR: Record<string, string> = {
  Actions: CLR.clay,
  "Obligations / Crédit": CLR.gold,
  "Monétaire": CLR.muted,
  "Allocations flexibles": CLR.ink2,
  "Immobilier (SCPI / SCI)": CLR.green,
  "Crypto-actifs": "6B4E9A",
  "Fonds Euros": "2E6B8F",
};

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${n.toFixed(1)} %`;
}
function sfdrText(a: number | null | undefined): string {
  return a === 8 ? "Art. 8" : a === 9 ? "Art. 9" : "Art. 6";
}

// Bandeau de pied de page (repris sur chaque slide).
function footer(slide: pptxgen.Slide, p: AllocationPresentation) {
  const left = [p.advisor, p.asOf].filter(Boolean).join("  ·  ") || "Charlie Investissement";
  slide.addText(left, { x: 0.4, y: 7.05, w: 9, h: 0.3, fontSize: 8, color: CLR.muted });
}

function header(slide: pptxgen.Slide, eyebrow: string, title: string) {
  slide.addText(eyebrow, { x: 0.5, y: 0.35, w: 2, h: 0.3, fontSize: 11, color: CLR.clay, bold: true });
  slide.addText(title, { x: 0.5, y: 0.6, w: 12, h: 0.6, fontSize: 24, color: CLR.ink, bold: true });
}

/** Construit le deck PowerPoint (16:9) prêt à écrire. */
export function buildAllocationDeck(p: AllocationPresentation): pptxgen {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
  pptx.author = "Charlie Investissement";
  pptx.title = p.title;

  // ─── Slide 1 — couverture ───────────────────────────────────────────
  const s1 = pptx.addSlide();
  s1.background = { color: CLR.cream };
  s1.addText(p.advisor || "Charlie Investissement", { x: 0.6, y: 0.6, w: 12, h: 0.4, fontSize: 14, color: CLR.muted, bold: true });
  s1.addText(p.title, { x: 0.6, y: 2.1, w: 12, h: 1, fontSize: 34, color: CLR.ink, bold: true });
  s1.addText(p.subtitle + (p.asOf ? `  ·  ${p.asOf}` : ""), { x: 0.6, y: 3.1, w: 12, h: 0.5, fontSize: 16, color: CLR.muted });

  const tiles: [string, string][] = [
    [String(p.headline.supports), "Supports"],
    [p.headline.weightedSri == null ? "—" : `${p.headline.weightedSri}/7`, "SRI moyen"],
    [`~${p.headline.expectedReturnPct}%`, "Perf. cible / an"],
    [`~${p.headline.volatilityPct}%`, "Volatilité"],
  ];
  tiles.forEach(([val, lab], i) => {
    const x = 0.6 + i * 3.05;
    s1.addShape(pptx.ShapeType.roundRect, { x, y: 4.4, w: 2.8, h: 1.5, fill: { color: CLR.paper }, line: { color: CLR.line, width: 1 }, rectRadius: 0.08 });
    s1.addText(val, { x, y: 4.6, w: 2.8, h: 0.8, fontSize: 28, color: CLR.clay, bold: true, align: "center" });
    s1.addText(lab, { x, y: 5.35, w: 2.8, h: 0.4, fontSize: 12, color: CLR.muted, align: "center" });
  });
  footer(s1, p);

  // ─── Slide 2 — contexte & objectifs ─────────────────────────────────
  const s2 = pptx.addSlide();
  s2.background = { color: CLR.cream };
  header(s2, "01", "Contexte et objectifs");
  s2.addText(
    p.objectives.map((o) => ({ text: o, options: { bullet: { code: "2022" }, color: CLR.ink2, fontSize: 14, paraSpaceAfter: 8 } })),
    { x: 0.6, y: 1.5, w: 12, h: 4.5 },
  );
  footer(s2, p);

  // ─── Slide 3 — répartition par classe ───────────────────────────────
  const s3 = pptx.addSlide();
  s3.background = { color: CLR.cream };
  header(s3, "02", "Répartition par classe d'actifs");
  const classRows: pptxgen.TableRow[] = [
    [
      { text: "Classe d'actifs", options: { bold: true, color: CLR.muted, fontSize: 11 } },
      { text: "Poids", options: { bold: true, color: CLR.muted, fontSize: 11, align: "right" } },
      { text: "Rôle dans le portefeuille", options: { bold: true, color: CLR.muted, fontSize: 11 } },
    ],
    ...p.classBreakdown.map((c): pptxgen.TableRow => [
      { text: c.label, options: { color: CLASS_COLOR[c.label] ?? CLR.ink, bold: true, fontSize: 13 } },
      { text: pct(c.weight), options: { color: CLR.ink, bold: true, fontSize: 13, align: "right" } },
      { text: c.role, options: { color: CLR.ink2, fontSize: 12 } },
    ]),
  ];
  s3.addTable(classRows, { x: 0.6, y: 1.6, w: 12.1, colW: [3.3, 1.3, 7.5], border: { type: "solid", color: CLR.line, pt: 0.5 }, rowH: 0.5, valign: "middle" });
  footer(s3, p);

  // ─── Slide 4 — allocation détaillée ─────────────────────────────────
  const s4 = pptx.addSlide();
  s4.background = { color: CLR.cream };
  header(s4, "03", "Allocation détaillée");
  const th = (t: string, align: "left" | "right" | "center" = "left") => ({ text: t, options: { bold: true, color: CLR.muted, fontSize: 9, align } });
  const detailRows: pptxgen.TableRow[] = [
    [th("#"), th("Fonds"), th("ISIN"), th("Catégorie"), th("Poids", "right"), th("SRI", "center"), th("SFDR", "center"), th("TER", "right")],
    ...p.table.map((l, i): pptxgen.TableRow => [
      { text: String(i + 1), options: { fontSize: 9, color: CLR.muted } },
      { text: l.name, options: { fontSize: 9, color: CLR.ink } },
      { text: l.isin, options: { fontSize: 8, color: CLR.muted, fontFace: "Courier New" } },
      { text: l.category ?? "—", options: { fontSize: 9, color: CLR.ink2 } },
      { text: pct(l.weight), options: { fontSize: 9, color: CLR.ink, bold: true, align: "right" } },
      { text: l.sri == null ? "—" : String(l.sri), options: { fontSize: 9, color: CLR.ink2, align: "center" } },
      { text: sfdrText(l.sfdr), options: { fontSize: 9, color: CLR.ink2, align: "center" } },
      { text: l.ter == null ? "—" : `${(l.ter * 100).toFixed(2)}%`, options: { fontSize: 9, color: CLR.ink2, align: "right" } },
    ]),
  ];
  s4.addTable(detailRows, { x: 0.4, y: 1.5, w: 12.5, colW: [0.5, 3.6, 1.9, 2.6, 1.1, 0.9, 1.0, 0.9], border: { type: "solid", color: CLR.line, pt: 0.5 }, rowH: 0.32, valign: "middle" });
  footer(s4, p);

  // ─── Slide 5 — profil de risque ─────────────────────────────────────
  const s5 = pptx.addSlide();
  s5.background = { color: CLR.cream };
  header(s5, "04", "Profil de risque");
  s5.addText(`SRI moyen pondéré ~${p.riskProfile.weightedSri ?? "—"} / 7 — ${p.riskProfile.profileLabel}`, { x: 0.6, y: 1.4, w: 12, h: 0.4, fontSize: 13, color: CLR.ink2 });
  const maxSri = Math.max(1, ...p.riskProfile.sriDistribution.map((b) => b.weight));
  p.riskProfile.sriDistribution.forEach((b, i) => {
    const y = 2.0 + i * 0.5;
    s5.addText(`SRI ${b.sri}`, { x: 0.6, y, w: 1, h: 0.4, fontSize: 11, color: CLR.muted });
    const barW = (b.weight / maxSri) * 8;
    if (barW > 0.01)
      s5.addShape(pptx.ShapeType.rect, { x: 1.7, y: y + 0.05, w: barW, h: 0.28, fill: { color: b.sri <= 2 ? CLR.green : b.sri <= 4 ? CLR.gold : CLR.clay } });
    s5.addText(pct(b.weight), { x: 9.9, y, w: 1.2, h: 0.4, fontSize: 11, color: CLR.ink2 });
  });
  const sfdrLine = p.riskProfile.sfdrDistribution.map((d) => `Art. ${d.article} : ${pct(d.weight)}`).join("     ");
  s5.addText(`Durabilité (SFDR) —  ${sfdrLine}`, { x: 0.6, y: 6.0, w: 12, h: 0.4, fontSize: 12, color: CLR.ink2 });
  footer(s5, p);

  // ─── Slide 6 — justification par support ────────────────────────────
  const s6 = pptx.addSlide();
  s6.background = { color: CLR.cream };
  header(s6, "05", "Analyse et justification par support");
  const rat: pptxgen.TextProps[] = [];
  p.perFundRationale.forEach((r, i) => {
    rat.push({ text: `${i + 1}. ${r.name}`, options: { bold: true, color: CLR.ink, fontSize: 11, paraSpaceBefore: 6 } });
    rat.push({ text: r.text, options: { color: CLR.ink2, fontSize: 10, paraSpaceAfter: 4 } });
  });
  s6.addText(rat, { x: 0.6, y: 1.4, w: 12.1, h: 5.4, valign: "top" });
  footer(s6, p);

  // ─── Slide 7 — convictions ──────────────────────────────────────────
  const s7 = pptx.addSlide();
  s7.background = { color: CLR.cream };
  header(s7, "06", "Nos convictions de gestion");
  const conv: pptxgen.TextProps[] = [];
  p.convictions.forEach((c) => {
    conv.push({ text: c.title, options: { bold: true, color: CLR.clay, fontSize: 13, paraSpaceBefore: 8 } });
    conv.push({ text: c.text, options: { color: CLR.ink2, fontSize: 11, paraSpaceAfter: 4 } });
  });
  s7.addText(conv, { x: 0.6, y: 1.4, w: 12.1, h: 5.4, valign: "top" });
  footer(s7, p);

  // ─── Slide 8 — avertissements ───────────────────────────────────────
  const s8 = pptx.addSlide();
  s8.background = { color: CLR.paper };
  header(s8, "07", "Avertissements");
  s8.addText(
    p.disclaimers.map((d) => ({ text: d, options: { bullet: { code: "2022" }, color: CLR.muted, fontSize: 11, paraSpaceAfter: 8 } })),
    { x: 0.6, y: 1.6, w: 12, h: 4.5 },
  );
  footer(s8, p);

  return pptx;
}
