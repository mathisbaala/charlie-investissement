import { describe, it, expect } from "vitest";
import {
  renormalize,
  targetsForProfile,
  profileToConstraints,
  filterFundsByProfile,
  filterUniverse,
  regionsForGeographies,
  GEO_TO_REGIONS,
} from "../lib/profileToConstraints";
import type { FundInput } from "../lib/optimizer";

describe("renormalize", () => {
  it("ramène la somme à 100", () => {
    const t = renormalize({ actions: 3, obligations: 1 });
    expect((t.actions ?? 0) + (t.obligations ?? 0)).toBeCloseTo(100, 1);
    expect(t.actions).toBeCloseTo(75, 1);
  });
  it("ignore les valeurs nulles/négatives", () => {
    expect(renormalize({ actions: 0 })).toEqual({});
  });
});

describe("targetsForProfile", () => {
  it("prudent est majoritairement défensif (oblig + monétaire > 50%)", () => {
    const t = targetsForProfile("prudent");
    const defensive = (t.obligations ?? 0) + (t.monetaire ?? 0);
    expect(defensive).toBeGreaterThan(50);
    expect(t.actions ?? 0).toBeLessThan(20);
  });
  it("offensif est majoritairement actions", () => {
    const t = targetsForProfile("offensif");
    expect(t.actions ?? 0).toBeGreaterThan(60);
  });
  it("restreint aux classes choisies et renormalise à 100", () => {
    const t = targetsForProfile("equilibre", ["actions", "obligations"]);
    expect(Object.keys(t).sort()).toEqual(["actions", "obligations"]);
    expect((t.actions ?? 0) + (t.obligations ?? 0)).toBeCloseTo(100, 1);
  });
  it("mappe scpi/multi_actifs vers immobilier/diversifie", () => {
    const t = targetsForProfile("equilibre", ["scpi", "multi_actifs"]);
    expect(Object.keys(t).sort()).toEqual(["diversifie", "immobilier"]);
  });
  it("ignore private_equity (pas de bucket) et retombe sur la répartition type", () => {
    const t = targetsForProfile("dynamique", ["private_equity"]);
    // aucune classe exploitable → répartition type dynamique
    expect(t.actions ?? 0).toBeGreaterThan(50);
  });
});

describe("profileToConstraints", () => {
  it("produit cibles + plafond SRI selon le risque", () => {
    const c = profileToConstraints({ risk_profile: "prudent", asset_classes: [], max_ter: null });
    expect(c.maxWeightedSri).toBe(3);
    expect(c.classTargets).toBeDefined();
  });
  it("défaut equilibre si profil de risque absent", () => {
    const c = profileToConstraints({ risk_profile: null, asset_classes: [], max_ter: null });
    expect(c.maxWeightedSri).toBe(4);
  });
  it("honore les classes souhaitées", () => {
    const c = profileToConstraints({ risk_profile: "dynamique", asset_classes: ["actions"], max_ter: null });
    expect(Object.keys(c.classTargets ?? {})).toEqual(["actions"]);
  });
  it("durcit le plafond SRI selon la tolérance à la perte", () => {
    // dynamique = SRI 5, mais perte_max 10% → plafond 4 (le plus contraignant)
    const c = profileToConstraints({ risk_profile: "dynamique", asset_classes: [], perte_max: "10" });
    expect(c.maxWeightedSri).toBe(4);
  });
  it("ignore une tolérance illimitée", () => {
    const c = profileToConstraints({ risk_profile: "prudent", asset_classes: [], perte_max: "illimitee" });
    expect(c.maxWeightedSri).toBe(3); // reste le plafond du profil prudent
  });
});

describe("filterFundsByProfile", () => {
  function f(over: Partial<FundInput> & { isin: string }): FundInput {
    return { name: over.isin, assetClass: "actions", expectedReturn: 0.08, volatility: 0.12, ...over };
  }
  const universe: FundInput[] = [
    f({ isin: "CHEAP8", ter: 0.005, sfdr: 8 }),
    f({ isin: "PRICEY6", ter: 0.02, sfdr: 6 }),
    f({ isin: "ART9", ter: 0.015, sfdr: 9 }),
    f({ isin: "NOTER", ter: null, sfdr: 8 }),
  ];

  it("écarte les fonds au-dessus du plafond de frais (en %)", () => {
    const { funds, dropped } = filterFundsByProfile(universe, { max_ter: 1, esg: "indifferent" });
    // garde ceux à TER <= 1% : CHEAP8 (0,5%), NOTER (inconnu, gardé) ; écarte PRICEY6 (2%), ART9 (1,5%)
    expect(funds.map((x) => x.isin).sort()).toEqual(["CHEAP8", "NOTER"]);
    expect(dropped).toBe(2);
  });
  it("filtre ESG art8 (SFDR 8 ou 9)", () => {
    const { funds } = filterFundsByProfile(universe, { max_ter: null, esg: "art8" });
    expect(funds.map((x) => x.isin).sort()).toEqual(["ART9", "CHEAP8", "NOTER"]);
  });
  it("filtre ESG art9 (SFDR 9 uniquement)", () => {
    const { funds } = filterFundsByProfile(universe, { max_ter: null, esg: "art9" });
    expect(funds.map((x) => x.isin)).toEqual(["ART9"]);
  });
  it("ne filtre rien en mode indifferent sans plafond", () => {
    const { funds, dropped } = filterFundsByProfile(universe, { max_ter: null, esg: "indifferent" });
    expect(funds).toHaveLength(4);
    expect(dropped).toBe(0);
  });
  it("applique aussi les zones géographiques quand le profil en fournit", () => {
    const geoUniverse = [
      f({ isin: "US", region: "usa" }),
      f({ isin: "EU", region: "europe" }),
      f({ isin: "NULL", region: null }),
    ];
    const { funds } = filterFundsByProfile(geoUniverse, {
      max_ter: null, esg: "indifferent", geographies: ["amerique_nord"],
    });
    expect(funds.map((x) => x.isin).sort()).toEqual(["NULL", "US"]);
  });
});

describe("regionsForGeographies", () => {
  it("renvoie null sans zone (aucune contrainte)", () => {
    expect(regionsForGeographies([])).toBeNull();
    expect(regionsForGeographies(["zone_inconnue"])).toBeNull();
  });
  it("mappe une zone profil vers les régions fines de la base", () => {
    const r = regionsForGeographies(["europe"])!;
    expect(r.has("europe")).toBe(true);
    expect(r.has("eurozone")).toBe(true);
    expect(r.has("france")).toBe(true);
    expect(r.has("usa")).toBe(false);
  });
  it("fait l'union de plusieurs zones", () => {
    const r = regionsForGeographies(["amerique_nord", "asie"])!;
    expect(r.has("usa")).toBe(true);
    expect(r.has("japan")).toBe(true);
    expect(r.has("europe")).toBe(false);
  });
  it("couvre toutes les zones du vocabulaire profil", () => {
    for (const zone of Object.keys(GEO_TO_REGIONS)) {
      expect(regionsForGeographies([zone])!.size).toBeGreaterThan(0);
    }
  });
});

describe("filterUniverse", () => {
  function f(over: Partial<FundInput> & { isin: string }): FundInput {
    return { name: over.isin, assetClass: "actions", expectedReturn: 0.08, volatility: 0.12, ...over };
  }
  const universe: FundInput[] = [
    f({ isin: "USA5", region: "usa", sri: 5, ter: 0.002, sfdr: 6 }),
    f({ isin: "EUR3", region: "europe", sri: 3, ter: 0.015, sfdr: 8 }),
    f({ isin: "WLD4", region: "world", sri: 4, ter: 0.01, sfdr: 9 }),
    f({ isin: "NOGEO", region: null, sri: null, ter: null, sfdr: null }),
  ];

  it("filtre par zones géographiques en gardant les fonds sans donnée géo", () => {
    const { funds, dropped } = filterUniverse(universe, { geographies: ["europe"] });
    expect(funds.map((x) => x.isin).sort()).toEqual(["EUR3", "NOGEO"]);
    expect(dropped).toBe(2);
  });
  it("filtre par plafond SRI par fonds en gardant les SRI inconnus", () => {
    const { funds } = filterUniverse(universe, { sriMax: 3 });
    expect(funds.map((x) => x.isin).sort()).toEqual(["EUR3", "NOGEO"]);
  });
  it("écarte les ISIN exclus, sans tenir compte de la casse", () => {
    const { funds, dropped } = filterUniverse(universe, { exclude: ["usa5", "WLD4"] });
    expect(funds.map((x) => x.isin).sort()).toEqual(["EUR3", "NOGEO"]);
    expect(dropped).toBe(2);
  });
  it("combine tous les filtres (frais, ESG, géo, SRI, exclusions)", () => {
    const { funds } = filterUniverse(universe, {
      maxTer: 1.6, esg: "art8", geographies: ["europe", "monde"], sriMax: 4, exclude: ["NOGEO"],
    });
    expect(funds.map((x) => x.isin).sort()).toEqual(["EUR3", "WLD4"]);
  });
  it("sans option, ne filtre rien", () => {
    const { funds, dropped } = filterUniverse(universe, {});
    expect(funds).toHaveLength(4);
    expect(dropped).toBe(0);
  });
});
