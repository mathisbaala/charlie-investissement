import { describe, it, expect } from "vitest";
import {
  selectionScore,
  allocateSlots,
  selectFunds,
  normalizeTargets,
  projectWeights,
  portfolioStats,
  maximizeSharpe,
  buildGroups,
  weightedAverage,
  optimizeAllocation,
  DEFAULT_CONSTRAINTS,
  type FundInput,
  type AssetClass,
} from "../lib/optimizer";

function fund(over: Partial<FundInput> & { isin: string }): FundInput {
  return {
    name: over.isin,
    assetClass: "actions",
    expectedReturn: 0.06,
    volatility: 0.12,
    sri: 4,
    ter: 0.01,
    dataCompleteness: 80,
    ...over,
  };
}

// Univers jouet couvrant 3 classes, avec des profils risque/rendement variés.
function universe(): FundInput[] {
  return [
    fund({ isin: "EQ1", assetClass: "actions", expectedReturn: 0.12, volatility: 0.18, sri: 5 }),
    fund({ isin: "EQ2", assetClass: "actions", expectedReturn: 0.1, volatility: 0.16, sri: 5 }),
    fund({ isin: "EQ3", assetClass: "actions", expectedReturn: 0.08, volatility: 0.2, sri: 6 }),
    fund({ isin: "BD1", assetClass: "obligations", expectedReturn: 0.04, volatility: 0.05, sri: 2 }),
    fund({ isin: "BD2", assetClass: "obligations", expectedReturn: 0.035, volatility: 0.06, sri: 3 }),
    fund({ isin: "CR1", assetClass: "crypto", expectedReturn: 0.3, volatility: 0.7, sri: 7 }),
  ];
}

// corrélation neutre (0 hors diagonale) sauf indication.
const zeroCorr = () => 0;

describe("selectionScore", () => {
  it("préfère un meilleur Sharpe implicite", () => {
    const good = fund({ isin: "A", expectedReturn: 0.12, volatility: 0.1 });
    const bad = fund({ isin: "B", expectedReturn: 0.05, volatility: 0.2 });
    expect(selectionScore(good, 0.02)).toBeGreaterThan(selectionScore(bad, 0.02));
  });
  it("bonifie les frais bas à profil égal", () => {
    const cheap = fund({ isin: "A", ter: 0 });
    const pricey = fund({ isin: "B", ter: 0.03 });
    expect(selectionScore(cheap, 0.02)).toBeGreaterThan(selectionScore(pricey, 0.02));
  });
});

describe("normalizeTargets", () => {
  it("normalise les cibles à 100", () => {
    const t = normalizeTargets({ actions: 3, obligations: 1 })!;
    expect(t.actions + t.obligations).toBeCloseTo(100, 9);
    expect(t.actions).toBeCloseTo(75, 9);
  });
  it("renvoie null si absent ou vide", () => {
    expect(normalizeTargets(undefined)).toBeNull();
    expect(normalizeTargets({})).toBeNull();
    expect(normalizeTargets({ actions: 0 })).toBeNull();
  });
});

describe("allocateSlots", () => {
  it("donne au moins un créneau par classe présente puis répartit par cible", () => {
    const slots = allocateSlots(
      { actions: 60, obligations: 30, crypto: 10 },
      { actions: 5, obligations: 5, crypto: 5 },
      6,
    );
    expect(slots.actions).toBeGreaterThanOrEqual(1);
    expect(slots.obligations).toBeGreaterThanOrEqual(1);
    expect(slots.crypto).toBeGreaterThanOrEqual(1);
    const total = slots.actions + slots.obligations + slots.crypto;
    expect(total).toBe(6);
    // la classe la plus lourde reçoit le plus de créneaux
    expect(slots.actions).toBeGreaterThanOrEqual(slots.obligations);
  });
  it("ne dépasse jamais le nombre de fonds disponibles", () => {
    const slots = allocateSlots({ actions: 60, crypto: 40 }, { actions: 1, crypto: 1 }, 7);
    expect(slots.actions).toBe(1);
    expect(slots.crypto).toBe(1);
  });
});

describe("projectWeights", () => {
  it("ramène chaque groupe à sa cible et respecte le plafond", () => {
    const groups = [[0, 1], [2]];
    const targets = [0.7, 0.3];
    const w = projectWeights([0.9, 0.9, 0.9], groups, targets, 0.5);
    expect(w[0] + w[1]).toBeCloseTo(0.7, 6);
    expect(w[2]).toBeCloseTo(0.3, 6);
    expect(Math.max(...w)).toBeLessThanOrEqual(0.5 + 1e-9);
  });
  it("répartit uniformément un groupe effondré à 0", () => {
    const w = projectWeights([0, 0], [[0, 1]], [1], 1);
    expect(w[0]).toBeCloseTo(0.5, 9);
    expect(w[1]).toBeCloseTo(0.5, 9);
  });
});

describe("portfolioStats", () => {
  it("calcule rendement, vol et Sharpe sur un cas connu", () => {
    // 2 actifs, poids 50/50, indépendants, vol 0.1 chacun.
    const cov = [
      [0.01, 0],
      [0, 0.01],
    ];
    const s = portfolioStats([0.5, 0.5], [0.08, 0.04], cov, 0.02);
    expect(s.ret).toBeCloseTo(0.06, 9);
    // variance = 0.25*0.01 + 0.25*0.01 = 0.005 → vol ≈ 0.0707
    expect(s.vol).toBeCloseTo(Math.sqrt(0.005), 9);
    expect(s.sharpe).toBeCloseTo((0.06 - 0.02) / Math.sqrt(0.005), 9);
  });
  it("Sharpe = 0 si volatilité nulle", () => {
    const s = portfolioStats([1], [0.05], [[0]], 0.02);
    expect(s.sharpe).toBe(0);
  });
});

describe("maximizeSharpe", () => {
  it("bat l'équipondération (single groupe, actifs indépendants)", () => {
    const mu = [0.12, 0.06, 0.03];
    const cov = [
      [0.04, 0, 0],
      [0, 0.01, 0],
      [0, 0, 0.0025],
    ];
    const groups = [[0, 1, 2]];
    const cap = 0.6;
    const w = maximizeSharpe(mu, cov, groups, [1], cap, 0.02);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    const optSharpe = portfolioStats(w, mu, cov, 0.02).sharpe;
    const eqSharpe = portfolioStats([1 / 3, 1 / 3, 1 / 3], mu, cov, 0.02).sharpe;
    expect(optSharpe).toBeGreaterThanOrEqual(eqSharpe - 1e-9);
  });
  it("respecte les sommes de groupe imposées", () => {
    const mu = [0.12, 0.1, 0.04];
    const cov = [
      [0.04, 0, 0],
      [0, 0.03, 0],
      [0, 0, 0.0025],
    ];
    const groups = [[0, 1], [2]];
    const w = maximizeSharpe(mu, cov, groups, [0.6, 0.4], 0.5, 0.02);
    expect(w[0] + w[1]).toBeCloseTo(0.6, 6);
    expect(w[2]).toBeCloseTo(0.4, 6);
  });
  it("est déterministe (mêmes entrées → mêmes poids)", () => {
    const mu = [0.12, 0.06];
    const cov = [
      [0.04, 0.002],
      [0.002, 0.01],
    ];
    const a = maximizeSharpe(mu, cov, [[0, 1]], [1], 0.7, 0.02);
    const b = maximizeSharpe(mu, cov, [[0, 1]], [1], 0.7, 0.02);
    expect(a).toEqual(b);
  });
});

describe("buildGroups", () => {
  it("un seul groupe quand pas de cibles", () => {
    const { groups, groupTargets } = buildGroups(universe(), null);
    expect(groups).toHaveLength(1);
    expect(groupTargets).toEqual([1]);
  });
  it("redistribue la cible d'une classe absente vers les présentes", () => {
    const selected = [fund({ isin: "EQ1", assetClass: "actions" })];
    // cible immobilier 50% mais aucun fonds immo → tout va aux actions
    const { groups, groupTargets } = buildGroups(
      selected,
      normalizeTargets({ actions: 50, immobilier: 50 }),
    );
    expect(groups).toHaveLength(1);
    expect(groupTargets[0]).toBeCloseTo(1, 9);
  });
});

describe("weightedAverage", () => {
  it("ignore les valeurs nulles en renormalisant leur poids", () => {
    expect(weightedAverage([4, null, 6], [0.5, 0.3, 0.2])).toBeCloseTo(
      (4 * 0.5 + 6 * 0.2) / (0.5 + 0.2),
      9,
    );
  });
  it("renvoie null si tout est nul", () => {
    expect(weightedAverage([null, null], [0.5, 0.5])).toBeNull();
  });
});

describe("selectFunds", () => {
  it("respecte 4–7 supports et couvre les classes cibles", () => {
    const { selected } = selectFunds(universe(), {
      ...DEFAULT_CONSTRAINTS,
      classTargets: { actions: 60, obligations: 30, crypto: 10 },
    });
    expect(selected.length).toBeGreaterThanOrEqual(4);
    expect(selected.length).toBeLessThanOrEqual(7);
    const classes = new Set(selected.map((f) => f.assetClass));
    expect(classes.has("actions")).toBe(true);
    expect(classes.has("obligations")).toBe(true);
    expect(classes.has("crypto")).toBe(true);
  });
  it("inclut d'office un mustInclude", () => {
    const { selected } = selectFunds(universe(), {
      ...DEFAULT_CONSTRAINTS,
      mustInclude: ["BD2"],
      classTargets: { actions: 100 },
    });
    expect(selected.some((f) => f.isin === "BD2")).toBe(true);
  });
  it("signale un mustInclude introuvable", () => {
    const { notes } = selectFunds(universe(), {
      ...DEFAULT_CONSTRAINTS,
      mustInclude: ["ZZ9"],
    });
    expect(notes.some((n) => n.includes("ZZ9"))).toBe(true);
  });
});

describe("optimizeAllocation (bout en bout)", () => {
  it("produit une allocation valide respectant cibles et cardinalité", () => {
    const res = optimizeAllocation(universe(), zeroCorr, {
      classTargets: { actions: 60, obligations: 30, crypto: 10 },
    });
    // poids somment à 100
    const total = res.lines.reduce((s, l) => s + l.weight, 0);
    expect(total).toBeCloseTo(100, 0);
    // 4 à 7 lignes
    expect(res.lines.length).toBeGreaterThanOrEqual(4);
    expect(res.lines.length).toBeLessThanOrEqual(7);
    // cibles de classe respectées (~ à 1 pt près après arrondi)
    expect(res.classWeights.actions ?? 0).toBeCloseTo(60, 0);
    expect(res.classWeights.obligations ?? 0).toBeCloseTo(30, 0);
    expect(res.classWeights.crypto ?? 0).toBeCloseTo(10, 0);
    // métriques renseignées
    expect(res.sharpe).toBeGreaterThan(0);
    expect(res.diversification.assetClasses).toBe(3);
    expect(res.weightedSri).not.toBeNull();
  });

  it("fonctionne sans cibles (allocation libre max-Sharpe)", () => {
    const res = optimizeAllocation(universe(), zeroCorr, {});
    const total = res.lines.reduce((s, l) => s + l.weight, 0);
    expect(total).toBeCloseTo(100, 0);
    expect(res.lines.length).toBeLessThanOrEqual(7);
  });

  it("est déterministe", () => {
    const a = optimizeAllocation(universe(), zeroCorr, { classTargets: { actions: 70, obligations: 30 } });
    const b = optimizeAllocation(universe(), zeroCorr, { classTargets: { actions: 70, obligations: 30 } });
    expect(a.lines).toEqual(b.lines);
  });

  it("renvoie un résultat vide et une note si l'univers est vide", () => {
    const res = optimizeAllocation([], zeroCorr, {});
    expect(res.lines).toHaveLength(0);
    expect(res.notes.length).toBeGreaterThan(0);
  });

  it("relève le plafond quand une classe a trop peu de supports", () => {
    // crypto 40% avec un seul fonds crypto → il doit peser 40% (> cap 35%)
    const res = optimizeAllocation(universe(), zeroCorr, {
      classTargets: { actions: 60, crypto: 40 },
      maxWeightPerFund: 0.35,
    });
    const cr = res.lines.find((l) => l.assetClass === "crypto")!;
    expect(cr.weight).toBeCloseTo(40, 0);
    expect(res.notes.some((n) => n.toLowerCase().includes("plafond"))).toBe(true);
  });
});
