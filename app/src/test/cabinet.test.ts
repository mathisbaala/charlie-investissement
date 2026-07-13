import { describe, it, expect } from "vitest";
import {
  EMPTY_CABINET,
  emptyContract,
  cabinetContract,
  resolveUcRetroShare,
  resolveFundRetrocession,
  type CabinetSettings,
} from "../lib/cabinet";

function cab(): CabinetSettings {
  return {
    ...EMPTY_CABINET,
    insurers: ["Cardif Lux Vie"],
    contracts: [
      {
        key: "Cardif Lux Vie::Cardif Elite Lux",
        contractFeeShare: 0.005,
        ucRetroShare: 0.5,
        fundOverrides: [{ isin: "LU0000000001", share: 0.6 }],
      },
      emptyContract("Cardif Lux Vie::Cardif Essentiel"),
    ],
  };
}

describe("cabinetContract", () => {
  it("retrouve la convention par clé, null sinon", () => {
    expect(cabinetContract(cab(), "Cardif Lux Vie::Cardif Elite Lux")?.ucRetroShare).toBe(0.5);
    expect(cabinetContract(cab(), "Axa::Inconnu")).toBeNull();
  });
});

describe("resolveUcRetroShare (cascade)", () => {
  const contract = cab().contracts[0];
  it("l'exception par fonds prime sur le taux du contrat", () => {
    expect(resolveUcRetroShare(contract, "LU0000000001")).toBe(0.6);
    expect(resolveUcRetroShare(contract, "lu0000000001")).toBe(0.6); // insensible à la casse
  });
  it("retombe sur le taux UC du contrat", () => {
    expect(resolveUcRetroShare(contract, "FR0000000009")).toBe(0.5);
  });
  it("null sans convention ou sans taux renseigné", () => {
    expect(resolveUcRetroShare(null, "FR0000000009")).toBeNull();
    expect(resolveUcRetroShare(cab().contracts[1], "FR0000000009")).toBeNull();
  });
});

describe("resolveFundRetrocession", () => {
  const contract = cab().contracts[0];
  it("applique part × frais courants du fonds", () => {
    // 50 % × 1,8 % de frais → 0,9 % d'encours/an
    expect(resolveFundRetrocession(contract, "FR0000000009", 0.018, 0.004)).toBeCloseTo(0.009, 9);
    // exception 60 % × 1,0 % → 0,6 %
    expect(resolveFundRetrocession(contract, "LU0000000001", 0.01, 0.004)).toBeCloseTo(0.006, 9);
  });
  it("retombe sur l'estimation quand la convention ou les frais manquent", () => {
    expect(resolveFundRetrocession(null, "X", 0.018, 0.004)).toBe(0.004);
    expect(resolveFundRetrocession(contract, "X", null, 0.004)).toBe(0.004);
    expect(resolveFundRetrocession(cab().contracts[1], "X", 0.018, null)).toBeNull();
  });
});
