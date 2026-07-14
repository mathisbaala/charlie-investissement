// @vitest-environment node
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAllocationDeck } from "@/lib/allocationPptx";
import { buildPresentation } from "@/lib/allocationRationale";
import type { AllocationResult, AllocationLine } from "@/lib/optimizer";

function line(over: Partial<AllocationLine> & { isin: string }): AllocationLine {
  return {
    name: over.isin, assetClass: "actions", category: "Actions Monde", weight: 10,
    sri: 4, sfdr: 8, ter: 0.01, expectedReturn: 0.08, volatility: 0.12, ...over,
  };
}

const RESULT: AllocationResult = {
  lines: [
    line({ isin: "LU1135865084", name: "Amundi S&P 500 UCITS ETF", category: "Actions USA", weight: 33.4, assetClass: "actions", sri: 5, sfdr: 6, ter: 0.0015 }),
    line({ isin: "LU1164219682", name: "AXA WF Euro Credit TR", category: "Oblig. Crédit", weight: 30, assetClass: "obligations", sri: 3 }),
    line({ isin: "FR0013267663", name: "Hugau Moneterme", category: "Monétaire", weight: 10, assetClass: "monetaire", sri: 1 }),
    line({ isin: "LU1897556517", name: "Groupama Global Disruption", category: "Actions Disruption", weight: 26.6, assetClass: "actions", sri: 5, sfdr: 9 }),
  ],
  method: "sharpe" as const,
  expectedReturn: 0.119, volatility: 0.109, sharpe: 0.92, weightedSri: 3.7,
  classWeights: { actions: 60, obligations: 30, monetaire: 10 },
  diversification: { effectiveHoldings: 3.4, averageCorrelation: 0.3, assetClasses: 3 },
  notes: [],
};

describe("buildAllocationDeck", () => {
  it("génère un fichier PowerPoint valide (.pptx = ZIP, signature PK)", async () => {
    const presentation = buildPresentation(RESULT, {
      contractName: "Cardif Elite Lux",
      universeSize: 1400,
      asOfLabel: "Juillet 2026",
      advisorName: "Charlie Gestion Privée",
    });
    const pptx = buildAllocationDeck(presentation);
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

    expect(buf.length).toBeGreaterThan(2000);
    // .pptx est une archive ZIP → commence par « PK\x03\x04 ».
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K

    if (process.env.DEMO) {
      const outDir = resolve(process.cwd(), "..", "..");
      writeFileSync(resolve(outDir, "Demo_Allocation_Charlie.pptx"), buf);
    }
  }, 30_000);

  it("gère les champs optionnels nuls sans planter", async () => {
    const presentation = buildPresentation(
      { ...RESULT, weightedSri: null, lines: RESULT.lines.map((l) => ({ ...l, sri: null, ter: null, category: null })) },
      { contractName: "X" },
    );
    const pptx = buildAllocationDeck(presentation);
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    expect(buf[0]).toBe(0x50);
  }, 30_000);
});
