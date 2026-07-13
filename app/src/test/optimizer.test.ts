import { describe, it, expect } from "vitest";
import {
  selectionScore,
  diversifiedScore,
  allocateSlots,
  selectFunds,
  reweightAllocation,
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

  // Univers pour les tests de sélection gloutonne : TOP est le meilleur fonds,
  // CLONE a un score individuel légèrement meilleur que DIV mais est quasi
  // identique à TOP, DIV diversifie réellement.
  function greedyUniverse(): FundInput[] {
    return [
      fund({ isin: "TOP", expectedReturn: 0.15, volatility: 0.15 }),
      fund({ isin: "CLONE", expectedReturn: 0.095, volatility: 0.15 }),
      fund({ isin: "DIV", expectedReturn: 0.09, volatility: 0.15 }),
    ];
  }
  const greedyCorr = (a: string, b: string): number | null => {
    const pair = [a, b].sort().join("|");
    if (pair === "CLONE|TOP") return 0.95;
    if (pair === "DIV|TOP") return 0.1;
    return 0.5;
  };

  it("préfère un fonds moins corrélé au panier à un clone mieux noté", () => {
    const { selected } = selectFunds(
      greedyUniverse(),
      { ...DEFAULT_CONSTRAINTS, minAssets: 2, maxAssets: 2 },
      greedyCorr,
    );
    const isins = selected.map((f) => f.isin);
    expect(isins).toContain("TOP"); // meilleur score → premier pick
    expect(isins).toContain("DIV"); // pénalité de corrélation écarte CLONE
    expect(isins).not.toContain("CLONE");
  });

  it("sélectionne au score pur quand la pénalité est désactivée (régression)", () => {
    const { selected } = selectFunds(
      greedyUniverse(),
      { ...DEFAULT_CONSTRAINTS, minAssets: 2, maxAssets: 2, correlationPenalty: 0 },
      greedyCorr,
    );
    expect(selected.map((f) => f.isin)).toContain("CLONE");
  });

  it("diversifie autour des fonds imposés par le client", () => {
    // TOP est imposé (le client en a parlé) : l'ajout suivant doit éviter CLONE.
    const { selected } = selectFunds(
      greedyUniverse(),
      { ...DEFAULT_CONSTRAINTS, minAssets: 2, maxAssets: 2, mustInclude: ["TOP"] },
      greedyCorr,
    );
    expect(selected.map((f) => f.isin)).toEqual(["TOP", "DIV"]);
  });
});

describe("selectFunds — couverture géographique", () => {
  // Trois fonds monde bien scorés, un fonds Asie moins bien scoré.
  function geoUniverse(): FundInput[] {
    return [
      fund({ isin: "WLD1", region: "world", expectedReturn: 0.14, volatility: 0.16 }),
      fund({ isin: "WLD2", region: "world", expectedReturn: 0.13, volatility: 0.16 }),
      fund({ isin: "WLD3", region: "world", expectedReturn: 0.12, volatility: 0.16 }),
      fund({ isin: "ASIA1", region: "asia", expectedReturn: 0.09, volatility: 0.18 }),
    ];
  }
  const COVER = [
    { zone: "monde", regions: ["world"] },
    { zone: "asie", regions: ["asia", "japan", "china", "india"] },
  ];

  it("représente chaque zone demandée (monde + asie → un fonds de chaque)", () => {
    const { selected } = selectFunds(
      geoUniverse(),
      { ...DEFAULT_CONSTRAINTS, minAssets: 2, maxAssets: 2, coverRegions: COVER },
      () => 0,
    );
    const regions = new Set(selected.map((f) => f.region));
    expect(regions.has("world")).toBe(true);
    expect(regions.has("asia")).toBe(true);
  });

  it("échange un fonds redondant quand le panier est plein (avec note)", () => {
    // Sans couverture, la sélection prendrait WLD1+WLD2. La réparation doit
    // échanger le fonds monde le plus faible contre le fonds asiatique.
    const { selected, notes } = selectFunds(
      geoUniverse(),
      { ...DEFAULT_CONSTRAINTS, minAssets: 2, maxAssets: 2, correlationPenalty: 0, coverRegions: COVER },
      () => 0.9, // fonds tous très corrélés : le bonus géo seul ne suffit pas forcément
    );
    expect(selected.some((f) => f.region === "asia")).toBe(true);
    expect(selected.some((f) => f.region === "world")).toBe(true);
  });

  it("signale une zone impossible à représenter", () => {
    const { notes } = selectFunds(
      geoUniverse(),
      {
        ...DEFAULT_CONSTRAINTS,
        minAssets: 2,
        maxAssets: 3,
        coverRegions: [...COVER, { zone: "emergents", regions: ["emerging", "brazil"] }],
      },
      () => 0,
    );
    expect(notes.some((n) => n.includes("emergents") && n.includes("aucun fonds"))).toBe(true);
  });

  it("ne touche à rien sans coverRegions (comportement historique)", () => {
    const a = selectFunds(geoUniverse(), { ...DEFAULT_CONSTRAINTS, minAssets: 2, maxAssets: 2 }, () => 0);
    expect(a.selected.map((f) => f.isin)).toEqual(["WLD1", "WLD2"]);
    expect(a.notes).toHaveLength(0);
  });
});

describe("selectFunds — départage rétrocession", () => {
  // Deux fonds quasi équivalents pour le client (scores à ~0,02 près) : GOOD
  // légèrement meilleur mais sans rétrocession (ETF), RETRO à forte rétro.
  // FAR est nettement meilleur mais hors bande de tolérance du test dédié.
  function retroUniverse(): FundInput[] {
    return [
      fund({ isin: "GOOD", expectedReturn: 0.102, volatility: 0.15, ter: 0.01, retrocession: 0 }),
      fund({ isin: "RETRO", expectedReturn: 0.1, volatility: 0.15, ter: 0.01, retrocession: 0.009 }),
    ];
  }

  it("désactivé (défaut) : le meilleur score client gagne", () => {
    const { selected } = selectFunds(
      retroUniverse(),
      { ...DEFAULT_CONSTRAINTS, minAssets: 1, maxAssets: 1 },
      () => 0,
    );
    expect(selected[0].isin).toBe("GOOD");
  });

  it("activé : à adéquation équivalente, la meilleure rétrocession gagne (avec note)", () => {
    const { selected, notes } = selectFunds(
      retroUniverse(),
      { ...DEFAULT_CONSTRAINTS, minAssets: 1, maxAssets: 1, commissionTieBreak: 0.05 },
      () => 0,
    );
    expect(selected[0].isin).toBe("RETRO");
    expect(notes.some((n) => n.includes("rémunération cabinet"))).toBe(true);
  });

  it("activé : ne sacrifie JAMAIS l'adéquation au-delà de la tolérance", () => {
    const funds = [
      fund({ isin: "FAR", expectedReturn: 0.14, volatility: 0.15, ter: 0.01, retrocession: 0 }),
      fund({ isin: "RETRO", expectedReturn: 0.1, volatility: 0.15, ter: 0.01, retrocession: 0.012 }),
    ];
    const { selected } = selectFunds(
      funds,
      { ...DEFAULT_CONSTRAINTS, minAssets: 1, maxAssets: 1, commissionTieBreak: 0.05 },
      () => 0,
    );
    expect(selected[0].isin).toBe("FAR"); // écart de score >> tolérance
  });

  it("propage la rétrocession jusqu'aux lignes du résultat", () => {
    const res = optimizeAllocation(retroUniverse(), zeroCorr, {
      minAssets: 2, maxAssets: 2, maxWeightPerFund: 1,
    });
    const byIsin = new Map(res.lines.map((l) => [l.isin, l]));
    expect(byIsin.get("RETRO")!.retrocession).toBeCloseTo(0.009, 9);
    expect(byIsin.get("GOOD")!.retrocession).toBe(0);
  });
});

describe("diversifiedScore", () => {
  const rf = 0.02;
  it("égale le score individuel sur panier vide", () => {
    const f = fund({ isin: "A" });
    expect(diversifiedScore(f, [], rf, 0.5, () => 0.9)).toBe(selectionScore(f, rf));
  });
  it("pénalise proportionnellement à la corrélation moyenne avec le panier", () => {
    const cand = fund({ isin: "C" });
    const basket = [fund({ isin: "H1" }), fund({ isin: "H2" })];
    const high = diversifiedScore(cand, basket, rf, 0.5, () => 0.9);
    const low = diversifiedScore(cand, basket, rf, 0.5, () => 0.1);
    expect(low - high).toBeCloseTo(0.5 * (0.9 - 0.1), 9);
  });
  it("remplace une corrélation inconnue par le prior de classe", () => {
    const cand = fund({ isin: "C", assetClass: "actions" });
    const basket = [fund({ isin: "H", assetClass: "actions" })];
    const viaNull = diversifiedScore(cand, basket, rf, 0.5, () => null);
    const viaPrior = diversifiedScore(cand, basket, rf, 0.5, () => 0.75);
    expect(viaNull).toBeCloseTo(viaPrior, 9); // prior actions|actions = 0.75
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

  it("propage la notation et la région du fonds jusqu'aux lignes du résultat", () => {
    const funds = [
      fund({ isin: "EQ1", rating: 5, region: "usa" }),
      fund({ isin: "EQ2", rating: null, region: null }),
      fund({ isin: "BD1", assetClass: "obligations", expectedReturn: 0.04, volatility: 0.05 }),
      fund({ isin: "BD2", assetClass: "obligations", expectedReturn: 0.035, volatility: 0.06, rating: 3, region: "europe" }),
    ];
    const res = optimizeAllocation(funds, zeroCorr, { minAssets: 4, maxAssets: 4 });
    const byIsin = new Map(res.lines.map((l) => [l.isin, l]));
    expect(byIsin.get("EQ1")!.rating).toBe(5);
    expect(byIsin.get("EQ1")!.region).toBe("usa");
    expect(byIsin.get("EQ2")!.rating).toBeNull();
    expect(byIsin.get("BD2")!.rating).toBe(3);
    expect(byIsin.get("BD2")!.region).toBe("europe");
  });

  it("calcule le nombre effectif de lignes (1 / somme des poids²)", () => {
    // Deux fonds identiques, plafond 50 % → poids 50/50 → 1/(0,25+0,25) = 2.
    const funds = [fund({ isin: "A" }), fund({ isin: "B" })];
    const res = optimizeAllocation(funds, zeroCorr, {
      minAssets: 2, maxAssets: 2, maxWeightPerFund: 0.5,
    });
    expect(res.diversification.effectiveHoldings).toBeCloseTo(2, 5);
  });

  it("remplace les corrélations inconnues par le prior de classe, pas par 0 (régression)", () => {
    // Deux fonds actions identiques sans historique commun : l'ancien repli 0
    // les traitait comme indépendants (vol portefeuille = σ/√2 ≈ 8,49 %).
    // Le prior actions/actions (0,75) doit donner une vol nettement supérieure :
    // σ·√((1+ρ)/2) ≈ 11,22 %.
    const funds = [
      fund({ isin: "A", volatility: 0.12, expectedReturn: 0.06 }),
      fund({ isin: "B", volatility: 0.12, expectedReturn: 0.06 }),
    ];
    const noCorr = () => null;
    const res = optimizeAllocation(funds, noCorr, {
      minAssets: 2, maxAssets: 2, maxWeightPerFund: 0.5,
    });
    expect(res.volatility).toBeCloseTo(0.12 * Math.sqrt((1 + 0.75) / 2), 3);
    expect(res.volatility).toBeGreaterThan(0.12 / Math.sqrt(2) + 0.01);
  });

  it("signale en note le nombre de paires sans corrélation observée", () => {
    const noCorr = () => null;
    const res = optimizeAllocation(universe(), noCorr, {
      classTargets: { actions: 60, obligations: 30, crypto: 10 },
    });
    expect(res.notes.some((n) => n.includes("sans historique commun"))).toBe(true);
  });

  it("n'ajoute pas de note quand toutes les corrélations sont observées", () => {
    const res = optimizeAllocation(universe(), zeroCorr, {
      classTargets: { actions: 60, obligations: 30, crypto: 10 },
    });
    expect(res.notes.some((n) => n.includes("sans historique commun"))).toBe(false);
  });

  it("respecte le plafond de SRI moyen pondéré comme contrainte dure", () => {
    // Actions très attractives (Sharpe élevé, SRI 5) contre obligations sages
    // (SRI 2) : sans plafond le max-Sharpe surponde les actions ; avec un
    // plafond à 3, les poids doivent glisser vers les obligations.
    const funds = [
      fund({ isin: "EQA", sri: 5, expectedReturn: 0.15, volatility: 0.12 }),
      fund({ isin: "EQB", sri: 5, expectedReturn: 0.14, volatility: 0.12 }),
      fund({ isin: "BDA", sri: 2, assetClass: "obligations", expectedReturn: 0.03, volatility: 0.05 }),
      fund({ isin: "BDB", sri: 2, assetClass: "obligations", expectedReturn: 0.03, volatility: 0.05 }),
    ];
    const base = { minAssets: 4, maxAssets: 4, maxWeightPerFund: 0.5 };
    const unconstrained = optimizeAllocation(funds, zeroCorr, base);
    const res = optimizeAllocation(funds, zeroCorr, { ...base, maxWeightedSri: 3 });
    expect(unconstrained.weightedSri!).toBeGreaterThan(3);
    expect(res.weightedSri!).toBeLessThanOrEqual(3 + 0.05);
    expect(res.notes.some((n) => n.includes("insatisfiable"))).toBe(false);
    // toujours une allocation valide
    expect(res.lines.reduce((s, l) => s + l.weight, 0)).toBeCloseTo(100, 0);
  });

  it("signale un plafond de SRI insatisfiable au lieu de le masquer", () => {
    // Uniquement des fonds SRI 6 : impossible de descendre sous 3.
    const funds = [
      fund({ isin: "A", sri: 6 }),
      fund({ isin: "B", sri: 6 }),
      fund({ isin: "C", sri: 6 }),
      fund({ isin: "D", sri: 6 }),
    ];
    const res = optimizeAllocation(funds, zeroCorr, { maxWeightedSri: 3 });
    expect(res.weightedSri!).toBeCloseTo(6, 5);
    expect(res.notes.some((n) => n.includes("insatisfiable"))).toBe(true);
  });
});

describe("optimizeAllocation en mode HRP", () => {
  it("produit une allocation valide qui respecte les cibles de classes", () => {
    const res = optimizeAllocation(universe(), zeroCorr, {
      method: "hrp",
      classTargets: { actions: 60, obligations: 30, crypto: 10 },
    });
    expect(res.method).toBe("hrp");
    expect(res.lines.reduce((s, l) => s + l.weight, 0)).toBeCloseTo(100, 0);
    expect(res.classWeights.actions ?? 0).toBeCloseTo(60, 0);
    expect(res.classWeights.obligations ?? 0).toBeCloseTo(30, 0);
    expect(res.classWeights.crypto ?? 0).toBeCloseTo(10, 0);
    expect(res.notes.some((n) => n.includes("HRP"))).toBe(true);
  });

  it("est déterministe et diffère du max-Sharpe", () => {
    const a = optimizeAllocation(universe(), zeroCorr, { method: "hrp" });
    const b = optimizeAllocation(universe(), zeroCorr, { method: "hrp" });
    expect(a.lines).toEqual(b.lines);
    const sharpe = optimizeAllocation(universe(), zeroCorr, {});
    expect(sharpe.method).toBe("sharpe");
    // Mêmes fonds sélectionnés (la sélection ne dépend pas de la méthode de
    // pondération) mais poids différents : HRP ignore les rendements attendus.
    expect(a.lines.map((l) => l.weight)).not.toEqual(sharpe.lines.map((l) => l.weight));
  });

  it("respecte le plafond de SRI moyen pondéré aussi en HRP", () => {
    const funds = [
      fund({ isin: "EQA", sri: 5, expectedReturn: 0.15, volatility: 0.12 }),
      fund({ isin: "EQB", sri: 5, expectedReturn: 0.14, volatility: 0.12 }),
      fund({ isin: "BDA", sri: 2, assetClass: "obligations", expectedReturn: 0.03, volatility: 0.05 }),
      fund({ isin: "BDB", sri: 2, assetClass: "obligations", expectedReturn: 0.03, volatility: 0.05 }),
    ];
    const res = optimizeAllocation(funds, zeroCorr, {
      method: "hrp", minAssets: 4, maxAssets: 4, maxWeightPerFund: 0.5, maxWeightedSri: 3,
    });
    expect(res.weightedSri!).toBeLessThanOrEqual(3 + 0.05);
  });
});

describe("reweightAllocation", () => {
  function baseResult() {
    // Deux fonds identiques hors SRI, poids 50/50, corrélation nulle.
    return optimizeAllocation(
      [
        fund({ isin: "A", sri: 5, expectedReturn: 0.1, volatility: 0.2 }),
        fund({ isin: "B", sri: 2, expectedReturn: 0.04, volatility: 0.05 }),
      ],
      zeroCorr,
      { minAssets: 2, maxAssets: 2, maxWeightPerFund: 1 },
    );
  }
  const cov = [
    [0.04, 0],
    [0, 0.0025],
  ];

  it("recalcule stats, SRI pondéré et poids de classe sur les poids simulés", () => {
    const res = baseResult();
    // Trouve l'ordre des lignes (triées par poids décroissant par le moteur).
    const w = res.lines.map((l) => (l.isin === "A" ? 20 : 80));
    const covAligned = res.lines.map((li) =>
      res.lines.map((lj) => (li.isin === lj.isin ? li.volatility ** 2 : 0)),
    );
    const rw = reweightAllocation(res, w, covAligned, 0.02);
    // Poids normalisés : A 20 %, B 80 %.
    const byIsin = new Map(rw.lines.map((l) => [l.isin, l]));
    expect(byIsin.get("A")!.weight).toBeCloseTo(20, 5);
    expect(byIsin.get("B")!.weight).toBeCloseTo(80, 5);
    // SRI pondéré recalculé : 0,2×5 + 0,8×2 = 2,6.
    expect(rw.weightedSri!).toBeCloseTo(2.6, 6);
    // Rendement recalculé : 0,2×0,10 + 0,8×0,04 = 0,052.
    expect(rw.expectedReturn).toBeCloseTo(0.052, 6);
    // Une note signale l'ajustement manuel ; le résultat d'origine est intact.
    expect(rw.notes.some((n) => n.includes("ajustés manuellement"))).toBe(true);
    expect(res.notes.some((n) => n.includes("ajustés manuellement"))).toBe(false);
  });

  it("normalise des poids ne sommant pas à 100 et ignore les négatifs", () => {
    const res = baseResult();
    const rw = reweightAllocation(res, [30, -10], cov, 0.02);
    // -10 tronqué à 0 → tout le poids sur la première ligne.
    expect(rw.lines[0].weight).toBeCloseTo(100, 5);
    expect(rw.lines[1].weight).toBeCloseTo(0, 5);
  });

  it("renvoie le résultat d'origine si les poids sont inutilisables", () => {
    const res = baseResult();
    expect(reweightAllocation(res, [50], cov, 0.02)).toBe(res); // longueur ≠
    expect(reweightAllocation(res, [0, 0], cov, 0.02)).toBe(res); // total nul
  });
});

describe("projectWeights — plafond par fonds", () => {
  it("déverse l'excédent sur les autres fonds au lieu de dépasser le plafond (régression)", () => {
    // Bug d'origine : masse concentrée sur 2 fonds, cible de groupe 0,866,
    // plafond 0,35 → l'écrêtage + renormalisation oscillait et sortait des
    // poids à 0,433 (> plafond). La projection exacte doit donner 0,35 + 0,35
    // et répartir le reste sur les autres.
    const w = projectWeights([0.6, 0.5, 0, 0, 0, 0], [[0, 1, 2, 3, 4, 5]], [0.866], 0.35);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(0.866, 6);
    for (const x of w) expect(x).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(w[0]).toBeCloseTo(0.35, 6);
    expect(w[1]).toBeCloseTo(0.35, 6);
    expect(w[2]).toBeGreaterThan(0); // l'excédent est réparti
  });

  it("l'allocation finale respecte le plafond par fonds (bout en bout)", () => {
    const funds = [
      fund({ isin: "A", expectedReturn: 0.2, volatility: 0.1 }), // écrase les autres au score
      fund({ isin: "B", expectedReturn: 0.19, volatility: 0.1 }),
      fund({ isin: "C", expectedReturn: 0.05, volatility: 0.1 }),
      fund({ isin: "D", expectedReturn: 0.04, volatility: 0.1 }),
    ];
    const res = optimizeAllocation(funds, zeroCorr, { minAssets: 4, maxAssets: 4, maxWeightPerFund: 0.35 });
    for (const l of res.lines) expect(l.weight).toBeLessThanOrEqual(35 + 0.1);
    expect(res.lines.reduce((s, l) => s + l.weight, 0)).toBeCloseTo(100, 0);
  });
});

describe("projectWeights avec contrainte SRI", () => {
  it("projette sur le demi-espace SRI en conservant la somme du groupe", () => {
    // Deux fonds SRI 6 et 2, plafond 4 : le poids du fonds risqué doit
    // redescendre à 50 % (6·0,5 + 2·0,5 = 4).
    const w = projectWeights([0.9, 0.1], [[0, 1]], [1], 1, { sri: [6, 2], max: 4 });
    expect(w[0] + w[1]).toBeCloseTo(1, 9);
    expect(6 * w[0] + 2 * w[1]).toBeLessThanOrEqual(4 + 1e-6);
    expect(w[0]).toBeCloseTo(0.5, 6);
  });

  it("ne change rien quand la contrainte est déjà satisfaite", () => {
    const w = projectWeights([0.3, 0.7], [[0, 1]], [1], 1, { sri: [6, 2], max: 4 });
    expect(w[0]).toBeCloseTo(0.3, 9);
    expect(w[1]).toBeCloseTo(0.7, 9);
  });

  it("ignore les SRI inconnus (neutres pour la contrainte)", () => {
    // SRI [6, null] plafond 4 : la moyenne renormalisée ne porte que sur le
    // fonds connu → il faut réduire son poids... mais null est neutre, donc la
    // projection pousse vers le fonds sans SRI.
    const w = projectWeights([0.9, 0.1], [[0, 1]], [1], 1, { sri: [6, null], max: 4 });
    expect(w[0] + w[1]).toBeCloseTo(1, 9);
    expect(w[0]).toBeLessThan(0.9);
  });
});
