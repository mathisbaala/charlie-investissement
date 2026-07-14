// @vitest-environment node
// Rendu PDF : polices Charlie chargées par réseau — env node requis (cf.
// portefeuillePdf.test.ts). On vérifie que le document se rend en PDF valide.
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { writeFileSync } from "node:fs";
import AllocationReportPDF from "@/lib/AllocationReportPDF";
import { buildPresentation } from "@/lib/allocationRationale";
import type { AllocationResult, AllocationLine } from "@/lib/optimizer";

type Doc = React.ReactElement<DocumentProps>;
const render = (el: React.ReactElement) => renderToBuffer(el as unknown as Doc);

function line(over: Partial<AllocationLine> & { isin: string }): AllocationLine {
  return {
    name: over.isin, assetClass: "actions", category: "Actions Monde", weight: 10,
    sri: 4, sfdr: 8, ter: 0.01, expectedReturn: 0.08, volatility: 0.12, ...over,
  };
}

const RESULT: AllocationResult = {
  lines: [
    line({ isin: "LU1135865084", name: "Amundi S&P 500 ETF", category: "Actions USA", weight: 33.4, assetClass: "actions", sri: 5, sfdr: 6, ter: 0.0015, expectedReturn: 0.162, volatility: 0.17 }),
    line({ isin: "LU0115773425", name: "Fidelity Global Technology", category: "Actions Tech", weight: 21.6, assetClass: "actions", sri: 4, sfdr: 8, ter: 0.01, expectedReturn: 0.188, volatility: 0.21 }),
    line({ isin: "LU1164219682", name: "AXA WF Euro Credit TR", category: "Oblig. Crédit", weight: 17.1, assetClass: "obligations", sri: 3, sfdr: 8, ter: 0.0075, expectedReturn: 0.047, volatility: 0.05 }),
    line({ isin: "LU1694789535", name: "DNCA Alpha Bonds", category: "Oblig. Flexibles", weight: 12.9, assetClass: "obligations", sri: 2, sfdr: 8, ter: 0.01, expectedReturn: 0.035, volatility: 0.04 }),
    line({ isin: "FR0013267663", name: "Hugau Moneterme", category: "Monétaire", weight: 10, assetClass: "monetaire", sri: 1, sfdr: 8, ter: 0.001, expectedReturn: 0.033, volatility: 0.005 }),
    line({ isin: "LU1897556517", name: "Groupama Global Disruption", category: "Actions Disruption", weight: 5, assetClass: "actions", sri: 5, sfdr: 9, ter: 0.018, expectedReturn: 0.177, volatility: 0.22 }),
  ],
  method: "sharpe" as const,
  expectedReturn: 0.119, volatility: 0.109, sharpe: 0.92, weightedSri: 3.7,
  classWeights: { actions: 60, obligations: 30, monetaire: 10 },
  diversification: { effectiveHoldings: 4.3, averageCorrelation: 0.34, assetClasses: 3 },
  notes: [],
};

describe("AllocationReportPDF", () => {
  it("rend un PDF de proposition d'allocation complet", async () => {
    const presentation = buildPresentation(RESULT, {
      contractName: "Cardif ELITE",
      universeSize: 1400,
      asOfLabel: "Juillet 2026",
      advisorName: "Charlie Gestion Privée",
    });
    const buf = await render(React.createElement(AllocationReportPDF, { presentation }));
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PDF_DUMP) writeFileSync("/tmp/allocation-charlie.pdf", buf);
  }, 30_000);

  it("rend même sans conseiller ni date (dégradé honnête)", async () => {
    const presentation = buildPresentation(RESULT, { contractName: "Contrat X" });
    const buf = await render(React.createElement(AllocationReportPDF, { presentation }));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});
