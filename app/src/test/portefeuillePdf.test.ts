// @vitest-environment node
// Rendu PDF : polices Charlie chargées par réseau (jsDelivr) — env node requis
// (jsdom ne fetch pas les binaires de police). Cf. rapportPdf.test.ts.
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { writeFileSync } from "node:fs";
import PortefeuillePDF from "@/lib/PortefeuillePDF";
import type { PortfolioAnalysis } from "@/lib/portfolio";

type Doc = React.ReactElement<DocumentProps>;
const render = (el: React.ReactElement) => renderToBuffer(el as unknown as Doc);

const t0 = new Date("2021-01-01").getTime();
const month = 30 * 24 * 3600 * 1000;
const curve = Array.from({ length: 48 }, (_, i) => ({ d: new Date(t0 + i * month).toISOString().slice(0, 10), v: 100 + i * 0.8 }));
const benchCurve = Array.from({ length: 48 }, (_, i) => ({ d: new Date(t0 + i * month).toISOString().slice(0, 10), v: 100 + i * 0.6 }));

const ANALYSIS: PortfolioAnalysis = {
  meta: { requested: 3, used: 3, excluded: [], start: curve[0].d, end: curve[curve.length - 1].d, n_weeks: 200, rf_pct: 2 },
  ratios: { total_return: 0.42, annual_return: 0.089, volatility: 0.112, sharpe: 0.74, max_drawdown: -0.18 },
  curve,
  funds: [],
  correlation: [
    { a: "FR0010315770", b: "LU0996182563", c: 0.42 },
    { a: "FR0010315770", b: "IE00B4L5Y983", c: 0.78 },
    { a: "LU0996182563", b: "IE00B4L5Y983", c: -0.12 },
  ],
  benchmark: {
    code: "msci_world", label: "MSCI World", total_return: 0.36, annual_return: 0.078,
    volatility: 0.13, sharpe: 0.6, max_drawdown: -0.22, curve: benchCurve,
  },
  names: {
    FR0010315770: "Comgest Monde C",
    LU0996182563: "Fonds Obligataire Défensif",
    IE00B4L5Y983: "iShares Core MSCI World ETF",
  },
};

const HOLDINGS = [
  { isin: "FR0010315770", weight: 50 },
  { isin: "LU0996182563", weight: 30 },
  { isin: "IE00B4L5Y983", weight: 20 },
];

const FUNDS_INFO = {
  FR0010315770: { name: "Comgest Monde C", product_type: "OPCVM Actions", ongoing_charges: 0.0172, sri: 4, performance_1y: 12.4, performance_3y: 8.1, retrocession_cgp: 0.0085 },
  LU0996182563: { name: "Fonds Obligataire Défensif", product_type: "OPCVM Obligations", ter: 0.009, risk_score: 2, performance_1y: -3.2, performance_3y: -1.1, retrocession_cgp: 0 },
  IE00B4L5Y983: { name: "iShares Core MSCI World ETF", product_type: "ETF", ongoing_charges: 0.002, sri: 5, performance_1y: 18.0, performance_3y: 11.2, retrocession_cgp: 0 },
};

describe("PortefeuillePDF", () => {
  it("rend un PDF de portefeuille complet", async () => {
    const buf = await render(
      React.createElement(PortefeuillePDF, {
        analysis: ANALYSIS,
        holdings: HOLDINGS,
        fundsInfo: FUNDS_INFO,
        geoExpo: [{ label: "États-Unis", weight: 58 }, { label: "Europe", weight: 24 }, { label: "Japon", weight: 18 }],
        sectorExpo: [{ label: "Technologie", weight: 32 }, { label: "Santé", weight: 21 }, { label: "Industrie", weight: 19 }],
        benchmarkLabel: "MSCI World",
      }),
    );
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PDF_DUMP) writeFileSync("/tmp/portefeuille-charlie.pdf", buf);
  }, 30_000);

  it("rend sans benchmark ni exposition (dégradé honnête)", async () => {
    const buf = await render(
      React.createElement(PortefeuillePDF, {
        analysis: { ...ANALYSIS, benchmark: null },
        holdings: HOLDINGS,
        fundsInfo: FUNDS_INFO,
        geoExpo: [],
        sectorExpo: [],
        benchmarkLabel: "—",
      }),
    );
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});
