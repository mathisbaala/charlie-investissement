// @vitest-environment node
// Le rendu PDF charge les polices Charlie par réseau (jsDelivr) ; jsdom ne sait
// pas fetch des binaires de police → glyphes vides. On force l'environnement node
// pour que les polices s'embarquent réellement, comme dans le runtime Next.js.
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { writeFileSync } from "node:fs";
import RapportFondsPDF from "@/lib/RapportFondsPDF";
import FicheFondsPDF from "@/lib/FicheFondsPDF";

// renderToBuffer attend un ReactElement<DocumentProps> ; nos composants exposent
// des props métier (funds/fund). On cast comme dans la route API (route.ts).
type Doc = React.ReactElement<DocumentProps>;
const render = (el: React.ReactElement) => renderToBuffer(el as unknown as Doc);

const SAMPLE = [
  {
    isin: "FR0010315770",
    name: "Comgest Monde C",
    management_company: "Comgest",
    product_type: "OPCVM Actions",
    sfdr_article: 8,
    sri: 4,
    morningstar_rating: 5,
    pea_eligible: true,
    av_lux_eligible: true,
    performance_1y: 12.4,
    performance_3y: 8.1,
    performance_5y: 9.7,
    volatility_1y: 11.2,
    sharpe_1y: 1.05,
    ongoing_charges: 0.0172,
    entry_fee_max: 0.02,
    exit_fee_max: 0,
    retrocession_cgp: 0.0085,
    aum_eur: 3_240_000_000,
    inception_date: "2006-02-01",
    data_completeness: 96,
  },
  {
    isin: "LU0996182563",
    name: "Fonds Exemple Obligataire Défensif Très Long Nom Pour Test",
    gestionnaire: "Gestion Co",
    product_type: "OPCVM Obligations",
    sfdr_article: 6,
    risk_score: 2,
    per_eligible: true,
    performance_1y: -3.2,
    performance_3y: -1.1,
    performance_5y: null,
    volatility_1y: 4.8,
    sharpe_1y: null,
    ter: 0.009,
    entry_fee_max: null,
    exit_fee_max: null,
    retrocession_cgp: 0,
    aum_eur: null,
    inception_date: null,
    data_completeness: 72,
  },
];

describe("RapportFondsPDF", () => {
  it("rend un PDF valide multi-fonds (avec polices Charlie)", async () => {
    const buf = await render(React.createElement(RapportFondsPDF, { funds: SAMPLE }));
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PDF_DUMP) writeFileSync("/tmp/rapport-charlie.pdf", buf);
  }, 30_000);

  it("rend un PDF valide pour un seul fonds", async () => {
    const buf = await render(React.createElement(RapportFondsPDF, { funds: [SAMPLE[0]] }));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);

  it("rend un PDF enrichi avec courbes + composition (factsheet)", async () => {
    // Série de VL synthétique (base ~100) + composition géo/secteurs/lignes.
    const t0 = new Date("2021-01-01").getTime();
    const week = 7 * 24 * 3600 * 1000;
    const pts = Array.from({ length: 80 }, (_, i) => ({ t: t0 + i * week, v: 100 + i * 0.4 + (i % 5) }));
    const series = { FR0010315770: pts };
    const composition = {
      FR0010315770: {
        geos: [{ label: "États-Unis", weight: 0.62 }, { label: "France", weight: 0.18 }, { label: "Japon", weight: 0.2 }],
        sectors: [{ label: "Technologie", weight: 0.4 }, { label: "Santé", weight: 0.3 }, { label: "Industrie", weight: 0.3 }],
        holdings: [{ label: "Apple", weight: 0.06 }, { label: "Microsoft", weight: 0.05 }],
      },
    };
    const buf = await render(React.createElement(RapportFondsPDF, { funds: SAMPLE, series, composition }));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PDF_DUMP) writeFileSync("/tmp/rapport-charlie-rich.pdf", buf);
  }, 30_000);

  it("rend la fiche fonds seule", async () => {
    const buf = await render(React.createElement(FicheFondsPDF, { fund: SAMPLE[0] }));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PDF_DUMP) writeFileSync("/tmp/fiche-charlie.pdf", buf);
  }, 30_000);
});
