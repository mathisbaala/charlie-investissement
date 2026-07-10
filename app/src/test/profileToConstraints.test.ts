import { describe, it, expect } from "vitest";
import {
  renormalize,
  targetsForProfile,
  profileToConstraints,
} from "../lib/profileToConstraints";

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
});
