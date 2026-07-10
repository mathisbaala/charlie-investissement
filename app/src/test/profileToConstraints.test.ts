import { describe, it, expect } from "vitest";
import {
  renormalize,
  targetsForProfile,
  profileToConstraints,
  filterFundsByProfile,
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
});
