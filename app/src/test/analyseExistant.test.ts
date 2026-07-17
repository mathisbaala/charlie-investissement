import { describe, it, expect } from "vitest";
import {
  overCorrelatedPairs, averageCorrelation, medianTer, expensiveLines,
  concentrationAlerts, weightedSri, buildRecommendations,
} from "@/lib/analyseExistant";

const CORR = [
  { a: "AAA", b: "BBB", c: 0.95 },
  { a: "AAA", b: "CCC", c: 0.4 },
  { a: "BBB", b: "CCC", c: null },
];

describe("overCorrelatedPairs", () => {
  it("retient les paires au-dessus du seuil, triées", () => {
    const pairs = overCorrelatedPairs(CORR);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ a: "AAA", b: "BBB", rho: 0.95 });
  });
  it("rend [] sous le seuil ou sans données", () => {
    expect(overCorrelatedPairs([{ a: "A", b: "B", c: 0.5 }])).toHaveLength(0);
    expect(overCorrelatedPairs([])).toHaveLength(0);
  });
});

describe("averageCorrelation", () => {
  it("moyenne les paires renseignées (ignore les null)", () => {
    expect(averageCorrelation(CORR)).toBeCloseTo((0.95 + 0.4) / 2);
  });
  it("rend null sans paire exploitable", () => {
    expect(averageCorrelation([{ a: "A", b: "B", c: null }])).toBeNull();
  });
});

describe("medianTer", () => {
  it("médiane impaire et paire", () => {
    expect(medianTer([
      { isin: "A", name: "A", ter: 1, weight: 10 },
      { isin: "B", name: "B", ter: 2, weight: 10 },
      { isin: "C", name: "C", ter: 4, weight: 10 },
    ])).toBe(2);
    expect(medianTer([
      { isin: "A", name: "A", ter: 1, weight: 10 },
      { isin: "B", name: "B", ter: 3, weight: 10 },
    ])).toBe(2);
  });
  it("rend null si aucun TER connu", () => {
    expect(medianTer([{ isin: "A", name: "A", ter: null, weight: 10 }])).toBeNull();
  });
});

describe("expensiveLines", () => {
  const lines = [
    { isin: "A", name: "Cher", ter: 2.4, weight: 20 },
    { isin: "B", name: "Ok", ter: 0.9, weight: 40 },
    { isin: "C", name: "Ok2", ter: 1.0, weight: 30 },
    { isin: "D", name: "Cher mais minuscule", ter: 3.0, weight: 1 },
  ];
  it("détecte les lignes chères et pondérées (pas les minuscules)", () => {
    const out = expensiveLines(lines);
    // Médiane des 4 TER connus (0.9, 1.0, 2.4, 3.0) = 1.7 ; A dépasse de
    // > 0,5 pt avec un poids suffisant, D est écarté (poids < 3 %).
    expect(out.map((l) => l.isin)).toEqual(["A"]);
    expect(out[0].median).toBeCloseTo(1.7);
    expect(out[0].surcost).toBeCloseTo((2.4 - 1.7) * 0.2);
  });
  it("rend [] quand tout est homogène ou sans TER", () => {
    expect(expensiveLines([{ isin: "A", name: "A", ter: 1, weight: 50 }])).toHaveLength(0);
    expect(expensiveLines([{ isin: "A", name: "A", ter: null, weight: 50 }])).toHaveLength(0);
  });
});

describe("concentrationAlerts", () => {
  it("alerte zone > 60 % et secteur > 35 %, triées par dépassement relatif", () => {
    const out = concentrationAlerts(
      [{ label: "États-Unis", weight: 72 }],
      [{ label: "Technologie", weight: 38 }],
    );
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe("États-Unis");
    expect(out[0].scope).toBe("zone");
  });
  it("silencieux sous les seuils", () => {
    expect(concentrationAlerts(
      [{ label: "Europe", weight: 55 }],
      [{ label: "Santé", weight: 20 }],
    )).toHaveLength(0);
  });
});

describe("weightedSri", () => {
  it("pondère par les poids et arrondit à 0,1", () => {
    expect(weightedSri([
      { sri: 6, weight: 0.5 },
      { sri: 2, weight: 0.5 },
    ])).toBe(4);
  });
  it("rend null sans SRI connu", () => {
    expect(weightedSri([{ sri: null, weight: 1 }])).toBeNull();
  });
});

describe("buildRecommendations", () => {
  it("assemble corrélation + concentration + frais, triées par impact, plafonnées", () => {
    const recos = buildRecommendations({
      correlation: CORR,
      names: { AAA: "Fonds Alpha", BBB: "Fonds Beta" },
      geo: [{ label: "États-Unis", weight: 75 }],
      sectors: [],
      fees: [
        { isin: "A", name: "Cher", ter: 2.5, weight: 30 },
        { isin: "B", name: "Ok", ter: 0.8, weight: 40 },
        { isin: "C", name: "Ok2", ter: 0.9, weight: 30 },
      ],
    });
    expect(recos.length).toBeGreaterThanOrEqual(3);
    expect(recos.length).toBeLessThanOrEqual(5);
    const kinds = recos.map((r) => r.kind);
    expect(kinds).toContain("correlation");
    expect(kinds).toContain("concentration");
    expect(kinds).toContain("frais");
    // Le détail corrélation nomme les fonds (pas les ISIN bruts).
    const corr = recos.find((r) => r.kind === "correlation")!;
    expect(corr.detail).toContain("Fonds Alpha");
  });
  it("rend [] sur un portefeuille sain", () => {
    const recos = buildRecommendations({
      correlation: [{ a: "A", b: "B", c: 0.3 }],
      names: {},
      geo: [{ label: "Europe", weight: 40 }],
      sectors: [{ label: "Santé", weight: 15 }],
      fees: [
        { isin: "A", name: "A", ter: 0.9, weight: 50 },
        { isin: "B", name: "B", ter: 1.0, weight: 50 },
      ],
    });
    expect(recos).toHaveLength(0);
  });
});
