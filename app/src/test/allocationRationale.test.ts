import { describe, it, expect } from "vitest";
import {
  profileFromSri,
  fundRationale,
  sriDistribution,
  sfdrDistribution,
  buildPresentation,
} from "../lib/allocationRationale";
import type { AllocationResult, AllocationLine } from "../lib/optimizer";

function line(over: Partial<AllocationLine> & { isin: string }): AllocationLine {
  return {
    name: over.isin,
    assetClass: "actions",
    category: null,
    weight: 10,
    sri: 4,
    sfdr: 8,
    ter: 0.01,
    expectedReturn: 0.08,
    volatility: 0.12,
    ...over,
  };
}

function result(): AllocationResult {
  const lines: AllocationLine[] = [
    line({ isin: "EQ1", name: "ETF S&P 500", category: "Actions USA", weight: 35, assetClass: "actions", sri: 5, sfdr: 6, ter: 0.0015, expectedReturn: 0.14, volatility: 0.17 }),
    line({ isin: "BD1", name: "Crédit IG", category: "Obligations Crédit", weight: 30, assetClass: "obligations", sri: 3, sfdr: 8, ter: 0.006, expectedReturn: 0.04, volatility: 0.05 }),
    line({ isin: "FE1", name: "Fonds Euros", category: "Fonds Euros", weight: 25, assetClass: "fonds_euros", sri: null, sfdr: 6, ter: 0, expectedReturn: 0.03, volatility: 0.005 }),
    line({ isin: "CR1", name: "Bitcoin ETP", category: "Crypto-actifs", weight: 10, assetClass: "crypto", sri: 7, sfdr: 6, ter: 0.02, expectedReturn: 0.3, volatility: 0.7 }),
  ];
  return {
    lines,
    method: "sharpe" as const,
    expectedReturn: 0.078,
    volatility: 0.09,
    sharpe: 0.64,
    weightedSri: 4.1,
    classWeights: { actions: 35, obligations: 30, fonds_euros: 25, crypto: 10 },
    diversification: { effectiveHoldings: 3.4, averageCorrelation: 0.15, assetClasses: 4 },
    notes: [],
  };
}

describe("profileFromSri", () => {
  it("mappe le SRI moyen sur un profil", () => {
    expect(profileFromSri(2)).toBe("Prudent");
    expect(profileFromSri(3)).toBe("Modéré");
    expect(profileFromSri(4)).toBe("Équilibré");
    expect(profileFromSri(5)).toBe("Dynamique");
    expect(profileFromSri(6.5)).toBe("Offensif");
  });
  it("renvoie « Sur mesure » si SRI inconnu", () => {
    expect(profileFromSri(null)).toBe("Sur mesure");
  });
});

describe("fundRationale", () => {
  it("mentionne la catégorie, le rôle, le couple rendement/risque et le poids", () => {
    const txt = fundRationale(
      line({ isin: "EQ1", name: "ETF S&P 500", category: "Actions USA", weight: 35, expectedReturn: 0.14, volatility: 0.17, sri: 5 }),
    );
    expect(txt).toContain("Actions USA");
    expect(txt).toMatch(/14 %/);
    expect(txt).toMatch(/17 %/);
    expect(txt).toMatch(/SRI 5/);
    expect(txt).toMatch(/35 %/);
    expect(txt.toLowerCase()).toContain("conviction"); // poids ≥ 15
  });
  it("détecte l'ETF comme gestion indicielle", () => {
    const txt = fundRationale(line({ isin: "X", category: "ETF Actions Monde", weight: 5 }));
    expect(txt.toLowerCase()).toContain("indicielle");
    expect(txt.toLowerCase()).toContain("mesurée"); // poids < 7
  });
  it("signale l'Article 9 SFDR", () => {
    const txt = fundRationale(line({ isin: "X", sfdr: 9 }));
    expect(txt).toContain("Article 9");
  });
  it("décrit le fonds euros comme socle défensif", () => {
    const txt = fundRationale(line({ isin: "FE", assetClass: "fonds_euros", sri: null, weight: 20 }));
    expect(txt.toLowerCase()).toContain("défensif");
  });
});

describe("sriDistribution", () => {
  it("répartit les poids dans les buckets 1–7 et ignore les SRI nuls", () => {
    const dist = sriDistribution(result().lines);
    expect(dist).toHaveLength(7);
    expect(dist[4].weight).toBeCloseTo(35, 1); // SRI 5 → ETF 35%
    expect(dist[2].weight).toBeCloseTo(30, 1); // SRI 3 → crédit 30%
    expect(dist[6].weight).toBeCloseTo(10, 1); // SRI 7 → crypto 10%
    const total = dist.reduce((s, b) => s + b.weight, 0);
    expect(total).toBeCloseTo(75, 1); // fonds euros SRI null exclu (25%)
  });
});

describe("sfdrDistribution", () => {
  it("regroupe par article, « n/a » compté en Article 6", () => {
    const dist = sfdrDistribution(result().lines);
    const art8 = dist.find((d) => d.article === 8)!;
    const art6 = dist.find((d) => d.article === 6)!;
    expect(art8.weight).toBeCloseTo(30, 1);
    expect(art6.weight).toBeCloseTo(70, 1); // ETF + fonds euros + crypto
    const total = dist.reduce((s, d) => s + d.weight, 0);
    expect(total).toBeCloseTo(100, 1);
  });
});

describe("buildPresentation", () => {
  it("génère toutes les sections du template", () => {
    const p = buildPresentation(result(), {
      contractName: "Cardif ELITE",
      universeSize: 1400,
      asOfLabel: "Février 2026",
      advisorName: "Métagram Gestion Privée",
    });
    expect(p.title).toContain("Cardif ELITE");
    expect(p.headline.supports).toBe(4);
    expect(p.headline.profileLabel).toBe("Équilibré");
    expect(p.objectives.length).toBeGreaterThanOrEqual(4);
    expect(p.classBreakdown[0].weight).toBeGreaterThanOrEqual(p.classBreakdown[1].weight); // trié
    expect(p.perFundRationale).toHaveLength(4);
    expect(p.perFundRationale.every((r) => r.text.length > 0)).toBe(true);
    expect(p.convictions.length).toBeGreaterThanOrEqual(3);
    expect(p.riskProfile.sfdrDistribution.length).toBeGreaterThan(0);
    expect(p.disclaimers.some((d) => d.includes("MIF II"))).toBe(true);
  });

  it("déduit le profil depuis le SRI si non fourni", () => {
    const p = buildPresentation(result(), { contractName: "X" });
    expect(p.headline.profileLabel).toBe("Équilibré");
  });

  it("est déterministe", () => {
    const a = buildPresentation(result(), { contractName: "X" });
    const b = buildPresentation(result(), { contractName: "X" });
    expect(a).toEqual(b);
  });
});
