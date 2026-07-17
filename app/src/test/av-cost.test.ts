import { describe, it, expect } from "vitest";
import {
  contractTotalCost,
  indicativeContractFee,
  ENV_INDICATIVE_FEE,
} from "@/lib/av-cost";
import type { ContractType } from "@/lib/insurer-envelope";

describe("indicativeContractFee", () => {
  it("défaut « av » (0,8 %) si types absent ou vide", () => {
    expect(indicativeContractFee(null)).toBe(ENV_INDICATIVE_FEE.av);
    expect(indicativeContractFee([])).toBe(0.8);
  });
  it("retient l'enveloppe la plus chère (borne haute)", () => {
    expect(indicativeContractFee(["pea", "av"])).toBe(0.8);
    expect(indicativeContractFee(["per"])).toBe(0.6);
    expect(indicativeContractFee(["pea"])).toBe(0);
  });
});

describe("contractTotalCost", () => {
  it("frais contrat SOURCÉ : total = supports + contrat sourcé", () => {
    // avg_fee 0.006 (0,6 %) + frais contrat sourcé 0,5 % = 1,1 %
    const c = contractTotalCost(0.006, 0.5, ["av"]);
    expect(c.supportsPct).toBe(0.6);
    expect(c.contractPct).toBe(0.5);
    expect(c.contractSourced).toBe(true);
    expect(c.total).toBe(1.1);
  });

  it("frais contrat INDICATIF : total = supports + indicatif enveloppe", () => {
    // avg_fee 0.009 (0,9 %) + indicatif AV 0,8 % = 1,7 %
    const c = contractTotalCost(0.009, null, ["av"]);
    expect(c.supportsPct).toBe(0.9);
    expect(c.contractPct).toBe(0.8);
    expect(c.contractSourced).toBe(false);
    expect(c.total).toBe(1.7);
  });

  it("PEA indicatif : coût contrat nul → total = frais supports seuls", () => {
    const c = contractTotalCost(0.002, null, ["pea"]);
    expect(c.contractPct).toBe(0);
    expect(c.contractSourced).toBe(false);
    expect(c.total).toBe(0.2);
  });

  it("frais supports inconnus → CTD non calculable (total null), frais contrat conservé", () => {
    const c = contractTotalCost(null, 0.7, ["av"]);
    expect(c.supportsPct).toBeNull();
    expect(c.contractPct).toBe(0.7);
    expect(c.total).toBeNull();
  });

  it("frais contrat sourcé à 0 est significatif (pas traité comme absent)", () => {
    const c = contractTotalCost(0.005, 0, ["av"]);
    expect(c.contractSourced).toBe(true);
    expect(c.contractPct).toBe(0);
    expect(c.total).toBe(0.5);
  });

  it("arrondit le total à 2 décimales (bruit flottant)", () => {
    // 0.007*... → 0,7 % + 0,35 % ; on vérifie l'absence de 1.0499999
    const c = contractTotalCost(0.007, 0.35, ["av"]);
    expect(c.total).toBe(1.05);
  });
});

// Type-only usage pour verrouiller la signature ContractType.
const _t: ContractType[] = ["av", "per", "pea", "capi", "pep"];
void _t;
