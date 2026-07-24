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

// ─── Extras de l'atelier : toutes les sections optionnelles présentes ─────────

import JSZip from "jszip";
import type { PresentationExtras } from "@/lib/presentationExtras";

const EXTRAS: PresentationExtras = {
  exposure: {
    geo: [
      { label: "États-Unis", weight: 40 },
      { label: "France", weight: 35 },
      { label: "Autres", weight: 25 },
    ],
    sectors: [
      { label: "Technologie", weight: 30 },
      { label: "Industrie", weight: 25 },
      { label: "Autres", weight: 45 },
    ],
  },
  goals: [
    {
      label: "Retraite", targetEur: 100_000, years: 10, initialEur: 50_000,
      monthlyEur: 200, priorityLabel: "Vital", requiredReturn: 0.031, successProb: 0.82,
    },
    {
      label: "Études des enfants", targetEur: 60_000, years: 6, initialEur: 5_000,
      monthlyEur: 100, priorityLabel: "Important", requiredReturn: null, successProb: null,
    },
  ],
  correlation: {
    names: ["Amundi S&P 500 UCITS ETF", "AXA WF Euro Credit TR", "Hugau Moneterme"],
    matrix: [
      [1, 0.24, null],
      [0.24, 1, -0.05],
      [null, -0.05, 1],
    ],
  },
  projection: { amountEur: 100_000, horizonYears: 8, projectedEur: 145_000 },
  backtest: {
    periodLabel: "Juin 2021 à Juin 2026",
    benchmarkLabel: "MSCI World",
    curve: Array.from({ length: 60 }, (_, i) => ({
      d: `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
      p: 100 + i * 0.8,
      b: 100 + i * 0.6,
    })),
    portfolio: { total_return: 0.48, annual_return: 0.081, volatility: 0.11, sharpe: 0.7, max_drawdown: -0.18 },
    benchmark: { total_return: 0.36, annual_return: 0.063, volatility: 0.13, sharpe: 0.5, max_drawdown: -0.22 },
  },
  effectiveHoldings: 3.4,
  avgTer: 0.009,
};

describe("buildAllocationDeck avec extras (sections de l'atelier)", () => {
  it("intègre répartitions, projets, corrélation et back-test, sans aucun tiret de ponctuation", async () => {
    const presentation = {
      ...buildPresentation(RESULT, {
        contractName: "Cardif Elite Lux",
        asOfLabel: "Juillet 2026",
        advisorName: "Charlie Gestion Privée",
      }),
      extras: EXTRAS,
    };
    const pptx = buildAllocationDeck(presentation);
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    expect(buf[0]).toBe(0x50);

    // Textes de toutes les slides (balises <a:t>).
    const zip = await JSZip.loadAsync(buf);
    const slideNames = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    const texts: string[] = [];
    for (const name of slideNames) {
      const xml = await zip.files[name].async("string");
      for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) texts.push(m[1]);
    }
    const all = texts.join("\n");

    // Les nouvelles sections sont là.
    expect(all).toContain("Répartition géographique");
    expect(all).toContain("Répartition sectorielle");
    expect(all).toContain("Retraite");
    expect(all).toContain("hors de portée");
    expect(all).toContain("lignes effectives");
    expect(all).toContain("MSCI World");
    expect(all).toContain("performances passées");
    expect(all).toContain("SOMMAIRE");

    // Aucun tiret de ponctuation dans les textes : ni cadratin, ni demi-cadratin,
    // ni « - » isolé (les traits d'union de mots composés restent permis).
    expect(all).not.toMatch(/[—–]/);
    expect(all).not.toMatch(/(^|\s)-(\s|$)/m);

    if (process.env.DEMO) {
      const outDir = resolve(process.cwd(), "..", "..");
      writeFileSync(resolve(outDir, "Demo_Allocation_Charlie_Extras.pptx"), buf);
    }
  }, 30_000);
});

// ─── Marque du cabinet : le deck prend la couleur passée ──────────────────────

async function slidesXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const parts = await Promise.all(names.map((n) => zip.files[n].async("string")));
  return parts.join("\n");
}

describe("buildAllocationDeck — couleur de marque", () => {
  const pres = () => buildPresentation(RESULT, { contractName: "X", advisorName: "Cabinet" });

  it("teinte le deck à la couleur du cabinet quand un accent est fourni", async () => {
    const buf = (await buildAllocationDeck(pres(), undefined, "#2a5067").write({ outputType: "nodebuffer" })) as Buffer;
    expect((await slidesXml(buf)).toLowerCase()).toContain("2a5067");
  }, 30_000);

  it("garde l'accent clay Charlie par défaut (sans marque)", async () => {
    const buf = (await buildAllocationDeck(pres()).write({ outputType: "nodebuffer" })) as Buffer;
    expect((await slidesXml(buf)).toLowerCase()).toContain("8f4a31");
  }, 30_000);

  it("ignore un accent invalide et retombe sur le défaut", async () => {
    const buf = (await buildAllocationDeck(pres(), undefined, "pas-une-couleur").write({ outputType: "nodebuffer" })) as Buffer;
    expect((await slidesXml(buf)).toLowerCase()).toContain("8f4a31");
  }, 30_000);
});
