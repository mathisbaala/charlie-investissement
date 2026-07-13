import { describe, it, expect } from "vitest";
import {
  futureValue,
  requiredAnnualReturn,
  normCdf,
  goalSuccessProbability,
  goalSuccessProbabilityMC,
  mulberry32,
  goalToPlan,
  pocketSriCap,
} from "../lib/goalPlanning";
import { emptyGoal } from "../lib/clientProfile";

describe("futureValue", () => {
  it("capitalise le capital de départ (sans versements)", () => {
    // 10 000 € à 7,177 %/an sur 10 ans ≈ ×2.
    const fv = futureValue({ initial: 10_000, monthly: 0, years: 10, target: 0 }, Math.pow(2, 1 / 10) - 1);
    expect(fv).toBeCloseTo(20_000, 6);
  });
  it("somme les versements à taux nul", () => {
    const fv = futureValue({ initial: 0, monthly: 100, years: 10, target: 0 }, 0);
    expect(fv).toBeCloseTo(12_000, 6);
  });
  it("les versements profitent de la capitalisation à taux positif", () => {
    const fv = futureValue({ initial: 0, monthly: 100, years: 10, target: 0 }, 0.05);
    expect(fv).toBeGreaterThan(12_000);
  });
});

describe("requiredAnnualReturn", () => {
  it("retrouve le taux de doublement sur 10 ans", () => {
    const r = requiredAnnualReturn({ initial: 10_000, monthly: 0, years: 10, target: 20_000 });
    expect(r!).toBeCloseTo(Math.pow(2, 1 / 10) - 1, 6);
  });
  it("renvoie ~0 quand l'épargne seule suffit exactement", () => {
    const r = requiredAnnualReturn({ initial: 0, monthly: 100, years: 10, target: 12_000 });
    expect(Math.abs(r!)).toBeLessThan(1e-4);
  });
  it("est négatif quand la cible est déjà couverte (objectif sécurisé)", () => {
    const r = requiredAnnualReturn({ initial: 50_000, monthly: 0, years: 5, target: 30_000 });
    expect(r!).toBeLessThan(0);
  });
  it("renvoie null si la cible est hors de portée même à +100 %/an", () => {
    expect(
      requiredAnnualReturn({ initial: 100, monthly: 0, years: 2, target: 1_000_000 }),
    ).toBeNull();
  });
  it("renvoie null sur plan invalide", () => {
    expect(requiredAnnualReturn({ initial: 0, monthly: 0, years: 10, target: 10_000 })).toBeNull();
    expect(requiredAnnualReturn({ initial: 100, monthly: 0, years: 0, target: 10_000 })).toBeNull();
    expect(requiredAnnualReturn({ initial: 100, monthly: 0, years: 10, target: 0 })).toBeNull();
  });
});

describe("normCdf", () => {
  it("vaut 0,5 en 0 et est symétrique", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.5) + normCdf(-1.5)).toBeCloseTo(1, 6);
  });
  it("retrouve les quantiles classiques", () => {
    expect(normCdf(1.6449)).toBeCloseTo(0.95, 3);
    expect(normCdf(-1.6449)).toBeCloseTo(0.05, 3);
  });
});

describe("goalSuccessProbability", () => {
  const plan = { initial: 10_000, monthly: 200, years: 10, target: 40_000 };

  it("est élevée quand le rendement attendu dépasse largement le requis", () => {
    const rReq = requiredAnnualReturn(plan)!;
    const p = goalSuccessProbability(plan, rReq + 0.06, 0.05);
    expect(p!).toBeGreaterThan(0.9);
  });
  it("est faible quand le rendement attendu est très en dessous du requis", () => {
    const rReq = requiredAnnualReturn(plan)!;
    const p = goalSuccessProbability(plan, Math.max(rReq - 0.06, -0.5), 0.05);
    expect(p!).toBeLessThan(0.1);
  });
  it("portefeuille sans aléa : 1 ou 0 selon que μ couvre le requis", () => {
    const rReq = requiredAnnualReturn(plan)!;
    expect(goalSuccessProbability(plan, rReq + 0.01, 0)).toBe(1);
    expect(goalSuccessProbability(plan, rReq - 0.01, 0)).toBe(0);
  });
  it("cible hors de portée → probabilité 0", () => {
    const p = goalSuccessProbability({ initial: 100, monthly: 0, years: 2, target: 1_000_000 }, 0.08, 0.12);
    expect(p).toBe(0);
  });
  it("plan invalide → null", () => {
    expect(goalSuccessProbability({ initial: 0, monthly: 0, years: 10, target: 1 }, 0.05, 0.1)).toBeNull();
  });
});

describe("goalSuccessProbabilityMC", () => {
  it("est déterministe à graine fixée", () => {
    const plan = { initial: 10_000, monthly: 200, years: 10, target: 40_000 };
    const a = goalSuccessProbabilityMC(plan, 0.07, 0.12);
    const b = goalSuccessProbabilityMC(plan, 0.07, 0.12);
    expect(a).toBe(b);
  });

  it("recoupe l'approximation log-normale sans versements (± 5 pts)", () => {
    const plan = { initial: 10_000, monthly: 0, years: 10, target: 18_000 };
    const analytic = goalSuccessProbability(plan, 0.07, 0.15)!;
    const mc = goalSuccessProbabilityMC(plan, 0.07, 0.15, { paths: 4000 })!;
    expect(Math.abs(mc - analytic)).toBeLessThan(0.05);
  });

  it("augmente avec l'épargne mensuelle", () => {
    const sans = goalSuccessProbabilityMC({ initial: 10_000, monthly: 0, years: 10, target: 40_000 }, 0.07, 0.12)!;
    const avec = goalSuccessProbabilityMC({ initial: 10_000, monthly: 300, years: 10, target: 40_000 }, 0.07, 0.12)!;
    expect(avec).toBeGreaterThan(sans);
  });

  it("portefeuille sans aléa : 1 ou 0 selon la valeur future déterministe", () => {
    const plan = { initial: 10_000, monthly: 0, years: 10, target: 20_000 };
    expect(goalSuccessProbabilityMC(plan, 0.08, 0)).toBe(1); // 10k ×1.08^10 ≈ 21,6k
    expect(goalSuccessProbabilityMC(plan, 0.05, 0)).toBe(0); // ≈ 16,3k < 20k
  });

  it("plan invalide → null", () => {
    expect(goalSuccessProbabilityMC({ initial: 0, monthly: 0, years: 10, target: 1 }, 0.05, 0.1)).toBeNull();
  });
});

describe("mulberry32", () => {
  it("produit une suite reproductible dans [0, 1)", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 5; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(124)()).not.toBe(mulberry32(123)());
  });
});

describe("pocketSriCap", () => {
  it("durcit avec un horizon court, s'ouvre avec un horizon long", () => {
    expect(pocketSriCap(2, "important", null)).toBe(2);
    expect(pocketSriCap(5, "important", null)).toBe(4);
    expect(pocketSriCap(8, "important", null)).toBe(6);
    expect(pocketSriCap(20, "important", null)).toBe(7);
  });
  it("retire un cran de risque aux projets vitaux (plancher 1)", () => {
    expect(pocketSriCap(8, "vital", null)).toBe(5);
    expect(pocketSriCap(2, "vital", null)).toBe(1);
    expect(pocketSriCap(2, "souhaitable", null)).toBe(2);
  });
  it("ne dépasse jamais le plafond global du client (MIF)", () => {
    expect(pocketSriCap(20, "souhaitable", 3)).toBe(3);
    expect(pocketSriCap(8, "important", 4)).toBe(4);
  });
});

describe("goalToPlan", () => {
  it("convertit un projet complet", () => {
    const g = { ...emptyGoal("g1"), target_eur: 80_000, horizon_years: 5, initial_eur: 20_000, monthly_eur: 400 };
    expect(goalToPlan(g)).toEqual({ initial: 20_000, monthly: 400, years: 5, target: 80_000 });
  });
  it("borne à 0 les moyens négatifs et tolère les absents", () => {
    const g = { ...emptyGoal("g2"), target_eur: 10_000, horizon_years: 3, initial_eur: -5, monthly_eur: null };
    expect(goalToPlan(g)).toEqual({ initial: 0, monthly: 0, years: 3, target: 10_000 });
  });
  it("rejette un projet sans cible ou sans horizon", () => {
    expect(goalToPlan({ ...emptyGoal("g3"), target_eur: null, horizon_years: 5 })).toBeNull();
    expect(goalToPlan({ ...emptyGoal("g4"), target_eur: 10_000, horizon_years: null })).toBeNull();
  });
});
